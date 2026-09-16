//! `exec-bridge` / `exec` 子命令:把本地进程的 stdio 桥接到 Docker 的 exec 流。
//!
//! 两种入口:
//!
//! - `docker-provider exec-bridge <container> [cmd...]`:工作台 Exec 终端使用,
//!   总是申请 TTY 并进入本地 raw 模式,做交互式桥接。
//! - `docker-provider exec [-i] [-t] <container> <cmd...>`:docker CLI 兼容写法。
//!   侧边栏容器文件树后端用它执行 `ls`/`stat`/`cat` 等非交互命令(`-i`,stdin 转发);
//!   带 `-t` 时退化为交互式桥接。
//!
//! 两种入口都用 Docker API,不需要本机安装 `docker` CLI。连接目标与 docker CLI
//! 一致,取自 `DOCKER_HOST` / `DOCKER_TLS_VERIFY` / `DOCKER_CERT_PATH`。

use std::{io::Write, time::Duration};

use bollard::{
    Docker,
    container::LogOutput,
    exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults},
};
use futures_util::StreamExt;
use tokio::{io::AsyncWriteExt, sync::mpsc, time::sleep};

use super::DockerTarget;

/// `exec-bridge <container> [cmd...]`:交互式桥接(工作台 Exec 终端)。
pub(super) async fn run(args: &[String]) -> Result<i32, String> {
    let (container, cmd) = split_container_command(args)?;
    stream(&container, cmd, true).await
}

/// `exec [-i] [-t] <container> <cmd...>`:docker CLI 兼容入口。
///
/// `-t` 走交互式(raw 模式 + 窗口同步),否则非交互收集输出。
/// 侧边栏文件树后端固定使用 `exec -i <container> <cmd>`。
pub(super) async fn run_exec(args: &[String]) -> Result<i32, String> {
    let (container, cmd, tty) = parse_exec(args)?;
    stream(&container, cmd, tty).await
}

/// 解析 `exec` 的参数:`[-i] [-t] [--] <container> [cmd...]`。
fn parse_exec(args: &[String]) -> Result<(String, Vec<String>, bool), String> {
    let mut tty = false;
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        match arg {
            "--" => {
                index += 1;
                break;
            }
            "-i" | "--interactive" => index += 1,
            "-t" | "--tty" => {
                tty = true;
                index += 1;
            }
            // 合并短选项,如 `-it` / `-ti`。
            _ if arg.len() > 1
                && arg.starts_with('-')
                && !arg.starts_with("--")
                && arg[1..].chars().all(|ch| ch == 'i' || ch == 't') =>
            {
                if arg[1..].contains('t') {
                    tty = true;
                }
                index += 1;
            }
            _ => break,
        }
    }
    let (container, cmd) = split_container_command(&args[index..])?;
    Ok((container, cmd, tty))
}

fn split_container_command(args: &[String]) -> Result<(String, Vec<String>), String> {
    let container = args
        .first()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "usage: docker-provider exec <container> [cmd...]".to_string())?
        .clone();
    let cmd = if args.len() > 1 {
        args[1..].to_vec()
    } else {
        vec!["sh".to_string()]
    };
    Ok((container, cmd))
}

async fn connect() -> Result<Docker, String> {
    DockerTarget::from_env()
        .and_then(|target| target.connect())
        .map_err(|error| error.to_string())
}

/// 建立一次 exec 并在本地 stdio 与远端流之间双向转发,返回退出码。
///
/// `tty` 为真时申请远端 TTY、本地进入 raw 模式并同步窗口大小;为假时
/// 按 stdout/stderr 分流,stdin 仍转发(侧边栏 `cat > file` 需要)。
async fn stream(container: &str, cmd: Vec<String>, tty: bool) -> Result<i32, String> {
    let docker = connect().await?;
    // raw 模式守卫:离开作用域(含提前 return)自动恢复本地终端。
    let tty_guard = if tty { Some(Tty::enter()) } else { None };

    let created = docker
        .create_exec(
            container,
            CreateExecOptions {
                cmd: Some(cmd),
                attach_stdin: Some(true),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                tty: Some(tty),
                ..Default::default()
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    let (mut output, mut input) = match docker
        .start_exec(
            &created.id,
            Some(StartExecOptions {
                tty,
                detach: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|error| error.to_string())?
    {
        StartExecResults::Attached { output, input } => (output, input),
        StartExecResults::Detached => return Err("exec returned detached".into()),
    };

    if tty && let Some((width, height)) = tty_guard.as_ref().and_then(Tty::size) {
        let _ = docker
            .resize_exec(&created.id, ResizeExecOptions { width, height })
            .await;
    }

    // 本地 stdin 是阻塞 fd,交给独立线程读,主循环用 channel 取。
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<Vec<u8>>(16);
    std::thread::spawn(move || {
        use std::io::Read;
        let mut stdin = std::io::stdin();
        let mut buffer = [0u8; 4096];
        while let Ok(read) = stdin.read(&mut buffer) {
            if read == 0 || stdin_tx.blocking_send(buffer[..read].to_vec()).is_err() {
                break;
            }
        }
    });

    let mut resize = if tty {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::window_change()).ok()
    } else {
        None
    };
    let mut stdout = std::io::stdout();
    let mut stderr = std::io::stderr();
    // 本地 stdin 一旦 EOF,就关掉远端 exec 的 stdin(半关闭),让容器内的
    // `cat`/`sh` 等看到 EOF;否则它们会一直等输入而卡死。
    let mut stdin_closed = false;

    loop {
        tokio::select! {
            chunk = output.next() => {
                match chunk {
                    Some(Ok(message)) => match message {
                        LogOutput::StdErr { message } => {
                            stderr.write_all(&message).map_err(|error| error.to_string())?;
                            stderr.flush().map_err(|error| error.to_string())?;
                        }
                        LogOutput::StdOut { message } | LogOutput::Console { message } => {
                            stdout.write_all(&message).map_err(|error| error.to_string())?;
                            stdout.flush().map_err(|error| error.to_string())?;
                        }
                        _ => {}
                    },
                    Some(Err(error)) => return Err(error.to_string()),
                    None => break,
                }
            }
            bytes = stdin_rx.recv(), if !stdin_closed => {
                match bytes {
                    Some(bytes) => {
                        if input.write_all(&bytes).await.is_err() {
                            stdin_closed = true;
                            continue;
                        }
                        let _ = input.flush().await;
                    }
                    None => {
                        let _ = input.shutdown().await;
                        stdin_closed = true;
                    }
                }
            }
            _ = next_resize(&mut resize) => {
                if let Some((width, height)) = tty_guard.as_ref().and_then(Tty::size) {
                    let _ = docker
                        .resize_exec(&created.id, ResizeExecOptions { width, height })
                        .await;
                }
            }
        }
    }

    drop(input);
    drop(tty_guard);
    Ok(exit_code(&docker, &created.id).await)
}

/// 等待终端尺寸变化信号;未注册成功时永久挂起(不参与 select)。
async fn next_resize(resize: &mut Option<tokio::signal::unix::Signal>) {
    match resize {
        Some(signal) => {
            signal.recv().await;
        }
        None => std::future::pending::<()>().await,
    }
}

/// exec 结束后读取退出码;短暂轮询等待 daemon 回填。
async fn exit_code(docker: &Docker, exec_id: &str) -> i32 {
    for _ in 0..50 {
        if let Ok(info) = docker.inspect_exec(exec_id).await
            && let Some(code) = info.exit_code
        {
            return code as i32;
        }
        sleep(Duration::from_millis(100)).await;
    }
    0
}

/// 本地终端 raw 模式守卫:进入时关闭行缓冲/回显,退出(Drop)时恢复。
struct Tty {
    original: Option<libc::termios>,
}

impl Tty {
    fn enter() -> Self {
        let mut original: libc::termios = unsafe { std::mem::zeroed() };
        if unsafe { libc::tcgetattr(libc::STDIN_FILENO, &mut original) } != 0 {
            // 非 TTY(如被管道重定向):不做 raw 处理,仍可转发字节。
            return Self { original: None };
        }
        let mut raw = original;
        unsafe {
            libc::cfmakeraw(&mut raw);
            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &raw);
        }
        Self {
            original: Some(original),
        }
    }

    fn size(&self) -> Option<(u16, u16)> {
        let mut size: libc::winsize = unsafe { std::mem::zeroed() };
        let result = unsafe { libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &mut size) };
        if result == 0 && size.ws_col > 0 && size.ws_row > 0 {
            Some((size.ws_col, size.ws_row))
        } else {
            None
        }
    }
}

impl Drop for Tty {
    fn drop(&mut self) {
        if let Some(original) = self.original {
            unsafe {
                libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &original);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(list: &[&str]) -> Vec<String> {
        list.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn parse_exec_reads_flags_container_and_command() {
        let (container, cmd, tty) = parse_exec(&argv(&["-i", "abc", "ls", "-Ap"])).unwrap();
        assert_eq!(container, "abc");
        assert_eq!(cmd, vec!["ls".to_string(), "-Ap".to_string()]);
        assert!(!tty);

        let (container, cmd, tty) = parse_exec(&argv(&["-it", "abc", "sh"])).unwrap();
        assert_eq!(container, "abc");
        assert_eq!(cmd, vec!["sh".to_string()]);
        assert!(tty);

        // 默认命令是 sh;`--` 之后可接以 `-` 开头的容器名。
        let (container, cmd, tty) = parse_exec(&argv(&["-ti", "abc"])).unwrap();
        assert_eq!(container, "abc");
        assert_eq!(cmd, vec!["sh".to_string()]);
        assert!(tty);

        let (container, _, _) = parse_exec(&argv(&["--", "-weird", "sh"])).unwrap();
        assert_eq!(container, "-weird");

        assert!(parse_exec(&argv(&["-i"])).is_err());
    }
}
