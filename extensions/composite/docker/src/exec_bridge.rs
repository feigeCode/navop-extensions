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
#[cfg(windows)]
use windows_sys::{
    Win32::System::Console::{
        CONSOLE_MODE, CONSOLE_SCREEN_BUFFER_INFO, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT,
        ENABLE_PROCESSED_INPUT, ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING,
        GetConsoleMode, GetConsoleScreenBufferInfo, GetStdHandle, STD_HANDLE, STD_INPUT_HANDLE,
        STD_OUTPUT_HANDLE, SetConsoleMode,
    },
    core::BOOL,
};

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

    let mut resize = resize_watcher(tty);
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

/// 终端尺寸变化的通知源。两端形状一致,调用方(`select!` 里那一路)不分平台。
///
/// - Unix:内核把窗口变化转成 `SIGWINCH`,直接订阅信号最省事。
/// - Windows:**没有**等价信号 —— ConPTY 的缩放由宿主重设伪控制台,不产生任何
///   事件(也没有 `SIGWINCH` 可订阅),只能定时轮询控制台尺寸、变了才唤醒。
#[cfg(unix)]
type ResizeWatcher = tokio::signal::unix::Signal;

/// Unix 侧申请尺寸变化监听;`tty` 为假或注册失败时返回 `None`。
#[cfg(unix)]
fn resize_watcher(tty: bool) -> Option<ResizeWatcher> {
    if !tty {
        return None;
    }
    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::window_change()).ok()
}

#[cfg(windows)]
struct ResizeWatcher {
    /// 上次上报的尺寸;轮询到不等时才唤醒,避免每 200ms 都白跑一次 resize。
    last: Option<(u16, u16)>,
}

/// Windows 侧申请尺寸变化监听(轮询式),以当前尺寸为基线。
#[cfg(windows)]
fn resize_watcher(tty: bool) -> Option<ResizeWatcher> {
    tty.then(|| ResizeWatcher { last: tty_size() })
}

/// Windows 侧尺寸轮询周期。200ms:人眼察觉不到延迟,开销可忽略。
#[cfg(windows)]
const RESIZE_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// 等待一次终端尺寸变化;未启用时永久挂起(不参与 `select!`)。
#[cfg(unix)]
async fn next_resize(resize: &mut Option<ResizeWatcher>) {
    match resize {
        Some(signal) => {
            signal.recv().await;
        }
        None => std::future::pending::<()>().await,
    }
}

/// 等待一次终端尺寸变化;未启用时永久挂起(不参与 `select!`)。
///
/// Windows 侧退化实现:每 `RESIZE_POLL_INTERVAL` 读一次控制台尺寸,
/// 与上次不同才返回。**不是** busy loop —— 每次都在 `sleep` 上让出。
#[cfg(windows)]
async fn next_resize(resize: &mut Option<ResizeWatcher>) {
    let Some(watcher) = resize.as_mut() else {
        return std::future::pending::<()>().await;
    };
    loop {
        sleep(RESIZE_POLL_INTERVAL).await;
        let current = tty_size();
        if current != watcher.last {
            watcher.last = current;
            return;
        }
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
///
/// 两个平台各一套实现,`enter()` / `size()` 的形状一致,调用方不分平台:
///
/// - Unix:`termios`(`cfmakeraw` + `TIOCGWINSZ`)。
/// - Windows:控制台模式。输入侧关掉行缓冲/回显/`ENABLE_PROCESSED_INPUT`
///   (等价于关掉 `ISIG`,让 Ctrl+C 作为字节交给远端),并开
///   `ENABLE_VIRTUAL_TERMINAL_INPUT` 使按键以 VT 序列原样透传;输出侧开
///   `ENABLE_VIRTUAL_TERMINAL_PROCESSING`,否则容器里的转义序列会被控制台
///   当普通字符处理掉。宿主侧终端走 ConPTY(`crates/terminal/src/pty_backend.rs`),
///   这里拿到的是伪控制台句柄。
///
/// 两边都容忍「标准流不是终端」(被重定向/管道):此时不做 raw 处理,仍可转发字节。
#[cfg(unix)]
struct Tty {
    original: Option<libc::termios>,
}

#[cfg(unix)]
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

#[cfg(unix)]
impl Drop for Tty {
    fn drop(&mut self) {
        if let Some(original) = self.original {
            unsafe {
                libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &original);
            }
        }
    }
}

#[cfg(windows)]
struct Tty {
    stdin: Option<CONSOLE_MODE>,
    stdout: Option<CONSOLE_MODE>,
}

#[cfg(windows)]
impl Tty {
    fn enter() -> Self {
        // 输入:非控制台(管道)时 `None`,与 Unix 侧 `tcgetattr` 失败同样处理。
        let stdin = console_mode(STD_INPUT_HANDLE).and_then(|original| {
            let raw = (original
                & !(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT))
                | ENABLE_VIRTUAL_TERMINAL_INPUT;
            set_console_mode(STD_INPUT_HANDLE, raw).then_some(original)
        });
        let stdout = console_mode(STD_OUTPUT_HANDLE).and_then(|original| {
            set_console_mode(
                STD_OUTPUT_HANDLE,
                original | ENABLE_VIRTUAL_TERMINAL_PROCESSING,
            )
            .then_some(original)
        });
        Self { stdin, stdout }
    }

    fn size(&self) -> Option<(u16, u16)> {
        tty_size()
    }
}

/// 读取当前控制台窗口尺寸。
///
/// `srWindow` 是**闭区间**(含两端),所以宽高都要 +1。非控制台(管道/重定向)时
/// `GetConsoleScreenBufferInfo` 失败 ⇒ `None`,与 Unix 侧 `ioctl` 失败同样处理。
#[cfg(windows)]
fn tty_size() -> Option<(u16, u16)> {
    let mut info: CONSOLE_SCREEN_BUFFER_INFO = unsafe { std::mem::zeroed() };
    let ok: BOOL =
        unsafe { GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &mut info) };
    if ok == 0 {
        return None;
    }
    let width = i32::from(info.srWindow.Right) - i32::from(info.srWindow.Left) + 1;
    let height = i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1;
    if width > 0 && height > 0 {
        Some((width as u16, height as u16))
    } else {
        None
    }
}

#[cfg(windows)]
impl Drop for Tty {
    fn drop(&mut self) {
        if let Some(original) = self.stdin {
            set_console_mode(STD_INPUT_HANDLE, original);
        }
        if let Some(original) = self.stdout {
            set_console_mode(STD_OUTPUT_HANDLE, original);
        }
    }
}

#[cfg(windows)]
fn console_mode(which: STD_HANDLE) -> Option<CONSOLE_MODE> {
    let mut mode: CONSOLE_MODE = 0;
    let ok: BOOL = unsafe { GetConsoleMode(GetStdHandle(which), &mut mode) };
    (ok != 0).then_some(mode)
}

#[cfg(windows)]
fn set_console_mode(which: STD_HANDLE, mode: CONSOLE_MODE) -> bool {
    let ok: BOOL = unsafe { SetConsoleMode(GetStdHandle(which), mode) };
    ok != 0
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
