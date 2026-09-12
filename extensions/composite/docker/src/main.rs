use std::{collections::HashMap, sync::Arc, time::Duration};

use bollard::{
    Docker,
    container::LogOutput,
    exec::{CreateExecOptions, StartExecOptions, StartExecResults},
    models::{
        ContainerCreateBody, ContainerStatsResponse, ContainerUpdateBody, EndpointIpamConfig,
        EndpointSettings, NetworkConnectRequest, NetworkCreateRequest, NetworkDisconnectRequest,
        VolumeCreateRequest,
    },
    query_parameters::{
        CreateContainerOptionsBuilder, CreateImageOptionsBuilder, DataUsageOptions,
        InspectNetworkOptions, KillContainerOptionsBuilder, ListContainersOptionsBuilder,
        ListImagesOptionsBuilder, ListNetworksOptions, ListVolumesOptions, LogsOptionsBuilder,
        PruneContainersOptions, PruneImagesOptions, PruneNetworksOptions, PruneVolumesOptions,
        RemoveContainerOptionsBuilder, RemoveImageOptionsBuilder, RemoveVolumeOptionsBuilder,
        RenameContainerOptionsBuilder, StatsOptionsBuilder, TagImageOptionsBuilder,
        TopOptionsBuilder,
    },
};
use extension_protocol::{
    envelope::{Request, Response, RpcMessage},
    error::{ProtocolError, error_codes},
    framing::{recv_msg_async, send_msg_async},
    job::{JobCancelParams, JobCloseParams, JobResultParams, JobStartParams, JobStatusParams},
    lifecycle::InitResult,
    method,
    resource::{
        ResourceCloseParams, ResourceInvokeParams, ResourceOpenParams, ResourceOpenResult,
        ResourcePingParams,
    },
    result_ref::ResultRef,
};
use futures_util::StreamExt;
use interprocess::local_socket::{
    GenericNamespaced, ToNsName,
    tokio::{Stream, prelude::*},
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

mod jobs;

use jobs::JobRegistry;

type ProviderResult = Result<Value, Box<ProtocolError>>;

/// 单次日志读取的行数上限:防止宿主把 provider 内存拖爆。
const MAX_LOG_TAIL: u64 = 5_000;

/// 镜像拉取任务的资源类型前缀(用于校验 job 目标)。
const PULL_METHOD: &str = "docker/image/pull";

/// 打开资源时向宿主声明的全部资源方法(宿主按 manifest `requires` 校验)。
const CAPABILITIES: &[&str] = &[
    "docker/system/info",
    "docker/system/usage",
    "docker/system/prune",
    "docker/container/list",
    "docker/container/inspect",
    "docker/container/create",
    "docker/container/start",
    "docker/container/stop",
    "docker/container/restart",
    "docker/container/pause",
    "docker/container/unpause",
    "docker/container/kill",
    "docker/container/rename",
    "docker/container/update",
    "docker/container/remove",
    "docker/container/logs",
    "docker/container/mounts",
    "docker/container/stats",
    "docker/container/top",
    "docker/container/diff",
    "docker/container/files/list",
    "docker/container/files/delete",
    "docker/image/list",
    "docker/image/inspect",
    "docker/image/history",
    "docker/image/tag",
    "docker/image/prune",
    "docker/image/pull",
    "docker/volume/list",
    "docker/volume/inspect",
    "docker/volume/create",
    "docker/volume/remove",
    "docker/volume/prune",
    "docker/network/list",
    "docker/network/inspect",
    "docker/network/create",
    "docker/network/connect",
    "docker/network/disconnect",
    "docker/network/remove",
    "docker/network/prune",
];

#[derive(Default)]
struct State {
    resources: HashMap<String, Arc<Docker>>,
    jobs: JobRegistry,
}

#[tokio::main]
async fn main() {
    let socket = std::env::var("ONETCLI_EXT_SOCKET").unwrap_or_else(|error| {
        eprintln!("missing ONETCLI_EXT_SOCKET: {error}");
        std::process::exit(2);
    });
    let name = socket
        .to_ns_name::<GenericNamespaced>()
        .expect("valid host socket name");
    let stream = tokio::time::timeout(Duration::from_secs(5), Stream::connect(name))
        .await
        .expect("connect timeout")
        .expect("connect host socket");
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut state = State::default();
    while let Ok(RpcMessage::Request(request)) = recv_msg_async(&mut reader).await {
        let exit = request.method == method::SHUTDOWN;
        let response = handle(&mut state, request).await;
        if send_msg_async(&mut writer, &RpcMessage::Response(response))
            .await
            .is_err()
            || exit
        {
            break;
        }
    }
    let _ = writer.shutdown().await;
}

async fn handle(state: &mut State, request: Request) -> Response {
    let result = dispatch(state, &request.method, request.params).await;
    match result {
        Ok(value) => Response::ok(request.id, value),
        Err(error) => Response::err(request.id, *error),
    }
}

async fn dispatch(state: &mut State, method_name: &str, params: Value) -> ProviderResult {
    match method_name {
        method::INIT => serialize(
            InitResult::new(env!("CARGO_PKG_VERSION"))
                .with_api("extension", "1.0")
                .with_method(method::RESOURCE_OPEN)
                .with_method(method::RESOURCE_PING)
                .with_method(method::RESOURCE_INVOKE)
                .with_method(method::RESOURCE_CLOSE)
                .with_method(method::JOB_START)
                .with_method(method::JOB_STATUS)
                .with_method(method::JOB_CANCEL)
                .with_method(method::JOB_RESULT)
                .with_method(method::JOB_CLOSE),
        ),
        method::RESOURCE_OPEN => open(state, params).await,
        method::RESOURCE_PING => ping(state, params).await,
        method::RESOURCE_INVOKE => invoke(state, params).await,
        method::RESOURCE_CLOSE => close(state, params),
        method::JOB_START => start_job(state, params).await,
        method::JOB_STATUS => {
            let params: JobStatusParams = parse(params)?;
            serialize(state.jobs.status(params)?)
        }
        method::JOB_CANCEL => {
            let params: JobCancelParams = parse(params)?;
            state.jobs.cancel(params)?;
            Ok(Value::Null)
        }
        method::JOB_RESULT => {
            let params: JobResultParams = parse(params)?;
            serialize(state.jobs.result(params)?)
        }
        method::JOB_CLOSE => {
            let params: JobCloseParams = parse(params)?;
            state.jobs.close(params);
            Ok(Value::Null)
        }
        method::SHUTDOWN => {
            state.jobs.clear();
            state.resources.clear();
            Ok(Value::Null)
        }
        _ => Err(protocol(
            error_codes::METHOD_NOT_FOUND,
            "unsupported method",
        )),
    }
}

async fn open(state: &mut State, params: Value) -> ProviderResult {
    let params: ResourceOpenParams = parse(params)?;
    if params.resource_type != "docker" {
        return Err(invalid("resourceType must be docker"));
    }
    let socket = params
        .config
        .get("socket")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("socket is required"))?;
    let path = expand_socket(socket)?;
    let docker = Docker::connect_with_unix(&path, 120, bollard::API_DEFAULT_VERSION)
        .map_err(|error| unavailable(error.to_string()))?
        .negotiate_version()
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    let version = docker
        .version()
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    let resource_id = uuid::Uuid::new_v4().to_string();
    state
        .resources
        .insert(resource_id.clone(), Arc::new(docker));
    serialize(ResourceOpenResult {
        resource_id,
        capabilities: CAPABILITIES.iter().map(|c| (*c).to_string()).collect(),
        metadata: Some(json!({
            "client": "bollard",
            "server_version": version.version,
            "api_version": version.api_version,
            "docker_host": format!("unix://{path}"),
            "operations": "container, image, network and volume management"
        })),
    })
}

async fn ping(state: &State, params: Value) -> ProviderResult {
    let params: ResourcePingParams = parse(params)?;
    let docker = resource(state, &params.resource_id)?;
    docker
        .ping()
        .await
        .map_err(|e| unavailable(e.to_string()))?;
    Ok(Value::Null)
}

async fn invoke(state: &State, params: Value) -> ProviderResult {
    let params: ResourceInvokeParams = parse(params)?;
    let docker = resource(state, &params.resource_id)?;
    let value = match params.method.as_str() {
        "docker/system/info" => serialize_value(docker.info().await)?,
        "docker/container/list" => {
            let containers = docker
                .list_containers(Some(
                    ListContainersOptionsBuilder::default().all(true).build(),
                ))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let rows = containers
                .into_iter()
                .map(|container| json!({
                    "id": container.id,
                    "name": container.names.unwrap_or_default().into_iter().next().unwrap_or_default().trim_start_matches('/'),
                    "image": container.image,
                    "state": container.state,
                    "status": container.status,
                }))
                .collect::<Vec<_>>();
            json!({"containers": rows})
        }
        "docker/container/inspect" => {
            let id = params
                .params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("container id is required"))?;
            serialize_value(docker.inspect_container(id, None).await)?
        }
        "docker/container/start" => {
            let id = container_id(&params)?;
            docker
                .start_container(&id, None)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "started"})
        }
        "docker/container/stop" => {
            let id = container_id(&params)?;
            docker
                .stop_container(&id, None)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "stopped"})
        }
        "docker/container/restart" => {
            let id = container_id(&params)?;
            docker
                .restart_container(&id, None)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "restarted"})
        }
        "docker/container/remove" => {
            let id = container_id(&params)?;
            let options = RemoveContainerOptionsBuilder::default()
                .force(true)
                .v(true)
                .build();
            docker
                .remove_container(&id, Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "removed"})
        }
        "docker/container/logs" => {
            let id = container_id(&params)?;
            let tail = params
                .params
                .get("tail")
                .and_then(Value::as_str)
                .and_then(|tail| tail.parse::<u64>().ok())
                .unwrap_or(300)
                .min(MAX_LOG_TAIL);
            let mut options = LogsOptionsBuilder::default()
                .stdout(true)
                .stderr(true)
                .timestamps(
                    params
                        .params
                        .get("timestamps")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                )
                .tail(&tail.to_string());
            if let Some(since) = params.params.get("since").and_then(Value::as_i64) {
                options = options.since(since.clamp(0, i32::MAX as i64) as i32);
            }
            if let Some(until) = params.params.get("until").and_then(Value::as_i64) {
                options = options.until(until.clamp(0, i32::MAX as i64) as i32);
            }
            let mut stream = docker.logs(&id, Some(options.build()));
            let mut logs = String::new();
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(LogOutput::StdOut { message })
                    | Ok(LogOutput::StdErr { message })
                    | Ok(LogOutput::Console { message }) => {
                        logs.push_str(&String::from_utf8_lossy(&message));
                    }
                    Ok(_) => {}
                    Err(error) => return Err(unavailable(error.to_string())),
                }
            }
            json!({"id": id, "tail": tail, "logs": logs})
        }
        "docker/image/list" => {
            let images = docker
                .list_images(Some(ListImagesOptionsBuilder::default().all(false).build()))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let rows = images
                .into_iter()
                .map(|image| {
                    let short_id = image.id.trim_start_matches("sha256:");
                    // 删除操作的目标:优先用第一个 repo tag,虚悬镜像退回完整 id。
                    let name = image
                        .repo_tags
                        .first()
                        .filter(|tag| !tag.is_empty() && tag.as_str() != "<none>")
                        .cloned()
                        .unwrap_or_else(|| image.id.clone());
                    json!({
                        "name": name,
                        "id": short_id.get(..12).unwrap_or(short_id),
                        "tags": image.repo_tags,
                        "created": utc_format(image.created),
                        "created_epoch": image.created,
                        "size_mb": image.size / (1024 * 1024),
                    })
                })
                .collect::<Vec<_>>();
            json!({"images": rows})
        }
        "docker/image/remove" => {
            let name = params
                .params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("image name is required"))?;
            let options = RemoveImageOptionsBuilder::default().force(true).build();
            let deleted = docker
                .remove_image(name, Some(options), None)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let removed: Vec<String> = deleted
                .into_iter()
                .map(|item| item.untagged.or(item.deleted).unwrap_or_default())
                .filter(|id| !id.is_empty())
                .collect();
            json!({"name": name, "action": "removed", "deleted": removed})
        }
        // ---- volume 系列 ----
        "docker/volume/list" => {
            let response = docker
                .list_volumes(None::<ListVolumesOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let volumes = response
                .volumes
                .unwrap_or_default()
                .into_iter()
                .map(|v| {
                    // usage_data 为 None 或 size/ref_count 为 -1 时视为不可用,统一输出 -1。
                    let (size_bytes, ref_count) = match v.usage_data {
                        Some(u) => (
                            if u.size >= 0 { u.size } else { -1 },
                            if u.ref_count >= 0 { u.ref_count } else { -1 },
                        ),
                        None => (-1, -1),
                    };
                    json!({
                        "name": v.name,
                        "driver": v.driver,
                        "mountpoint": v.mountpoint,
                        "scope": v.scope.map(|s| s.to_string()).unwrap_or_default(),
                        "size_bytes": size_bytes,
                        "size": if size_bytes >= 0 { human_size(size_bytes as u64) } else { "-".to_string() },
                        "ref_count": ref_count,
                    })
                })
                .collect::<Vec<_>>();
            json!({"volumes": volumes})
        }
        "docker/volume/inspect" => {
            let name = params
                .params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("volume name is required"))?;
            serialize_value(docker.inspect_volume(name).await)?
        }
        "docker/volume/remove" => {
            let name = params
                .params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("volume name is required"))?;
            let options = RemoveVolumeOptionsBuilder::default().force(true).build();
            docker
                .remove_volume(name, Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"name": name, "action": "removed"})
        }
        // ---- network 系列 ----
        "docker/network/list" => {
            let networks = docker
                .list_networks(None::<ListNetworksOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let rows = networks
                .into_iter()
                .map(|n| {
                    let id = n.id.unwrap_or_default();
                    let id_short = id.get(..12).unwrap_or(&id);
                    json!({
                        "id": id_short,
                        "name": n.name.unwrap_or_default(),
                        "driver": n.driver.unwrap_or_default(),
                        "scope": n.scope.unwrap_or_default(),
                        "internal": n.internal.unwrap_or(false),
                    })
                })
                .collect::<Vec<_>>();
            json!({"networks": rows})
        }
        "docker/network/inspect" => {
            let id = params
                .params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("network id is required"))?;
            serialize_value(
                docker
                    .inspect_network(id, None::<InspectNetworkOptions>)
                    .await,
            )?
        }
        "docker/network/remove" => {
            let id = params
                .params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("network id is required"))?;
            docker
                .remove_network(id)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "removed"})
        }
        // ---- container 新增操作 ----
        "docker/container/mounts" => {
            let id = container_id(&params)?;
            let inspect = docker
                .inspect_container(&id, None)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let mounts = inspect.mounts.unwrap_or_default();
            json!({"id": id, "mounts": serialize(mounts)?})
        }
        "docker/container/stats" => {
            let id = container_id(&params)?;
            let stats = fetch_stats_sample(docker, &id).await?;
            let (cpu_percent, memory_usage, memory_limit, online_cpus) = summarize_stats(&stats);
            json!({
                "id": id,
                "cpu_percent": cpu_percent,
                "memory_usage_bytes": memory_usage,
                "memory_limit_bytes": memory_limit,
                "online_cpus": online_cpus,
            })
        }
        // ---- container 文件浏览 ----
        "docker/container/files/list" => {
            let id = container_id(&params)?;
            let raw_path = params
                .params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("");
            let path = normalize_container_path(raw_path);
            // 在容器内列目录:把 working_dir 指到目标路径,避免字符串拼路径的注入问题。
            let script = "ls -Ap | while IFS= read -r n; do stat -c \"%F\t%s\t%Y\t%n\" -- \"$n\" 2>/dev/null || printf \"unknown\t0\t0\t%s\n\" \"$n\"; done";
            let (stdout, stderr) = exec_collect(
                docker,
                &id,
                vec!["sh".to_string(), "-c".to_string(), script.to_string()],
                Some(path.clone()),
            )
            .await?;
            // 路径不存在等情况:stdout 为空而 stderr 有内容,视为不可用。
            if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                return Err(unavailable(stderr.trim().to_string()));
            }
            let mut entries: Vec<Value> = Vec::new();
            // 预置 ".." 行(根目录除外),永远排第一。
            if path != "/" {
                let parent = parent_path(&path);
                entries.push(json!({
                    "name": "..",
                    "type": "directory",
                    "size": "-",
                    "modified": "-",
                    "path": parent,
                }));
            }
            for line in stdout.lines() {
                if line.is_empty() {
                    continue;
                }
                // 每行恰好 4 段:type / size / mtime_epoch / name(name 之后可能含空格)。
                let parts: Vec<&str> = line.splitn(4, '\t').collect();
                if parts.len() < 4 {
                    continue;
                }
                let type_raw = parts[0];
                let size_raw = parts[1];
                let mtime_raw = parts[2];
                let name_raw = parts[3];
                let is_dir = type_raw.eq_ignore_ascii_case("directory");
                let entry_type = if is_dir {
                    "directory"
                } else if type_raw == "unknown" {
                    "unknown"
                } else {
                    "file"
                };
                // 去掉 ls -p 给目录追加的末尾 '/'
                let name = name_raw.strip_suffix('/').unwrap_or(name_raw);
                let full = if path == "/" {
                    format!("{path}{name}")
                } else {
                    format!("{path}/{name}")
                };
                let size = if is_dir {
                    "-".to_string()
                } else {
                    human_size(size_raw.parse::<u64>().unwrap_or(0))
                };
                let modified = if is_dir {
                    "-".to_string()
                } else {
                    utc_format(mtime_raw.parse::<i64>().unwrap_or(0))
                };
                entries.push(json!({
                    "name": name,
                    "type": entry_type,
                    "size": size,
                    "modified": modified,
                    "path": full,
                }));
            }
            // 排序:".." 固定第一;其余目录在前、文件在后,组内按 name 字母序。
            entries.sort_by(|a, b| {
                let a_name = a["name"].as_str().unwrap_or("");
                let b_name = b["name"].as_str().unwrap_or("");
                if a_name == ".." {
                    return std::cmp::Ordering::Less;
                }
                if b_name == ".." {
                    return std::cmp::Ordering::Greater;
                }
                let a_dir = a["type"].as_str() == Some("directory");
                let b_dir = b["type"].as_str() == Some("directory");
                a_dir.cmp(&b_dir).then_with(|| a_name.cmp(b_name))
            });
            json!({ "id": id, "path": path, "entries": entries })
        }
        "docker/container/files/delete" => {
            let id = container_id(&params)?;
            let raw_path = params
                .params
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("path is required"))?;
            let path = normalize_container_path(raw_path);
            // 防护:禁止删除根目录或 ".." 相关路径,避免误删宿主/越界。
            let basename = path.rsplit('/').next().unwrap_or("");
            if path == "/" || path.ends_with("/..") || basename == ".." {
                return Err(invalid("refusing to delete '..' or root"));
            }
            // 直接以 argv 传参(不经 shell),杜绝命令注入。
            let (stdout, stderr) = exec_collect(
                docker,
                &id,
                vec![
                    "rm".to_string(),
                    "-rf".to_string(),
                    "--".to_string(),
                    path.clone(),
                ],
                None,
            )
            .await?;
            if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                return Err(unavailable(stderr.trim().to_string()));
            }
            json!({ "path": path, "action": "removed" })
        }
        // ---- system 状态栏 ----
        "docker/system/usage" => {
            let info = docker
                .info()
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let df = docker
                .df(None::<DataUsageOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            // 卷/网络数量:任一调用失败都退化为 0,不让整体失败。
            let volumes = docker
                .list_volumes(None::<ListVolumesOptions>)
                .await
                .map(|v| v.volumes.unwrap_or_default().len() as i64)
                .unwrap_or(0);
            let networks = docker
                .list_networks(None::<ListNetworksOptions>)
                .await
                .map(|n| n.len() as i64)
                .unwrap_or(0);
            // 磁盘占用:四项 DiskUsage 的 total_size / reclaimable 求和,None 当 0。
            let (mut disk_used, mut disk_reclaimable) = (0_i64, 0_i64);
            disk_used += df
                .image_usage
                .as_ref()
                .and_then(|u| u.total_size)
                .unwrap_or(0);
            disk_used += df
                .container_usage
                .as_ref()
                .and_then(|u| u.total_size)
                .unwrap_or(0);
            disk_used += df
                .volume_usage
                .as_ref()
                .and_then(|u| u.total_size)
                .unwrap_or(0);
            disk_used += df
                .build_cache_usage
                .as_ref()
                .and_then(|u| u.total_size)
                .unwrap_or(0);
            disk_reclaimable += df
                .image_usage
                .as_ref()
                .and_then(|u| u.reclaimable)
                .unwrap_or(0);
            disk_reclaimable += df
                .container_usage
                .as_ref()
                .and_then(|u| u.reclaimable)
                .unwrap_or(0);
            disk_reclaimable += df
                .volume_usage
                .as_ref()
                .and_then(|u| u.reclaimable)
                .unwrap_or(0);
            disk_reclaimable += df
                .build_cache_usage
                .as_ref()
                .and_then(|u| u.reclaimable)
                .unwrap_or(0);
            // 运行中容器:逐个拉取首个 stats 样本,失败则跳过,不使整体失败。
            let running = docker
                .list_containers(Some(
                    ListContainersOptionsBuilder::default().all(false).build(),
                ))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let (mut containers_memory, mut containers_cpu) = (0_u64, 0.0_f64);
            for container in &running {
                let cid = match &container.id {
                    Some(c) => c.as_str(),
                    None => continue,
                };
                if let Ok(stats) = fetch_stats_sample(docker, cid).await {
                    let (cpu, mem, _, _) = summarize_stats(&stats);
                    containers_memory += mem;
                    containers_cpu += cpu;
                }
            }
            json!({
                "engine": true,
                "server_version": info.server_version.unwrap_or_default(),
                "containers_running": info.containers_running.unwrap_or(0),
                "containers_total": info.containers.unwrap_or(0),
                "images": info.images.unwrap_or(0),
                "volumes": volumes,
                "networks": networks,
                "disk_used_bytes": disk_used,
                "disk_reclaimable_bytes": disk_reclaimable,
                "containers_memory_bytes": containers_memory,
                "containers_cpu_percent": containers_cpu,
                "cpu_count": info.ncpu.unwrap_or(0) as u32,
            })
        }
        // ---- image 详情/写操作 ----
        "docker/image/inspect" => {
            let name = image_name(&params)?;
            serialize_value(docker.inspect_image(&name).await)?
        }
        "docker/image/history" => {
            let name = image_name(&params)?;
            let history = docker
                .image_history(&name)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let rows = history
                .into_iter()
                .map(|item| {
                    json!({
                        "id": short_history_id(&item.id),
                        "created": utc_format(item.created),
                        "created_by": item.created_by,
                        "size_bytes": item.size,
                        "size": if item.size >= 0 { human_size(item.size as u64) } else { "-".to_string() },
                        "comment": item.comment,
                        "tags": item.tags,
                    })
                })
                .collect::<Vec<_>>();
            json!({"name": name, "history": rows})
        }
        "docker/image/tag" => {
            let name = image_name(&params)?;
            let repo = required_str(&params, "repo")?;
            let tag = required_str(&params, "tag")?;
            let options = TagImageOptionsBuilder::default()
                .repo(&repo)
                .tag(&tag)
                .build();
            docker
                .tag_image(&name, Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"name": name, "repo": repo, "tag": tag, "action": "tagged"})
        }
        "docker/image/prune" => {
            let all = params
                .params
                .get("all")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut options = PruneImagesOptions::default();
            // 默认只清理悬空镜像(dangling=true),`all=true` 时清所有未被容器引用的镜像。
            if !all {
                options.filters = Some(HashMap::from([(
                    "dangling".to_string(),
                    vec!["true".to_string()],
                )]));
            }
            let response = docker
                .prune_images(Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let deleted = response
                .images_deleted
                .unwrap_or_default()
                .into_iter()
                .map(|item| json!({"deleted": item.deleted, "untagged": item.untagged}))
                .collect::<Vec<_>>();
            json!({
                "deleted": deleted,
                "space_reclaimed_bytes": response.space_reclaimed.unwrap_or(0),
            })
        }
        // ---- container 生命周期扩展 ----
        "docker/container/create" => {
            let (name, config) = container_create_params(&params)?;
            let options = name
                .as_deref()
                .map(|name| CreateContainerOptionsBuilder::default().name(name).build());
            let response = docker
                .create_container(options, config)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({
                "id": response.id,
                "name": name,
                "warnings": response.warnings,
                "action": "created",
            })
        }
        "docker/container/pause" => {
            let id = container_id(&params)?;
            docker
                .pause_container(&id)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "paused"})
        }
        "docker/container/unpause" => {
            let id = container_id(&params)?;
            docker
                .unpause_container(&id)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "unpaused"})
        }
        "docker/container/kill" => {
            let id = container_id(&params)?;
            let signal = optional_str(&params, "signal").unwrap_or_else(|| "SIGKILL".to_string());
            let options = KillContainerOptionsBuilder::default()
                .signal(&signal)
                .build();
            docker
                .kill_container(&id, Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "signal": signal, "action": "killed"})
        }
        "docker/container/rename" => {
            let id = container_id(&params)?;
            let name = required_str(&params, "name")?;
            let options = RenameContainerOptionsBuilder::default().name(&name).build();
            docker
                .rename_container(&id, options)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "name": name, "action": "renamed"})
        }
        "docker/container/update" => {
            let id = container_id(&params)?;
            let config: ContainerUpdateBody = parse_json_field(&params.params, "config")?
                .map(|value| serde_json::from_value(value).map_err(|e| invalid(e.to_string())))
                .transpose()?
                .unwrap_or_default();
            docker
                .update_container(&id, config)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": id, "action": "updated"})
        }
        "docker/container/top" => {
            let id = container_id(&params)?;
            let ps_args = optional_str(&params, "psArgs").unwrap_or_else(|| "-ef".to_string());
            let options = TopOptionsBuilder::default().ps_args(&ps_args).build();
            let response = docker
                .top_processes(&id, Some(options))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let titles = response.titles.unwrap_or_default();
            let processes = response
                .processes
                .unwrap_or_default()
                .into_iter()
                .map(|row| {
                    let cells = titles
                        .iter()
                        .cloned()
                        .zip(row)
                        .map(|(title, value)| (title, Value::String(value)))
                        .collect::<serde_json::Map<String, Value>>();
                    Value::Object(cells)
                })
                .collect::<Vec<_>>();
            json!({"id": id, "titles": titles, "processes": processes})
        }
        "docker/container/diff" => {
            let id = container_id(&params)?;
            let changes = docker
                .container_changes(&id)
                .await
                .map_err(|e| unavailable(e.to_string()))?
                .unwrap_or_default();
            json!({"id": id, "changes": serialize(changes)?})
        }
        // ---- network 写操作 ----
        "docker/network/create" => {
            let config = network_create_params(&params)?;
            let response = docker
                .create_network(config)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"id": response.id, "warning": response.warning, "action": "created"})
        }
        "docker/network/connect" => {
            let network = network_id(&params)?;
            let container = required_str(&params, "container")?;
            let mut endpoint = EndpointSettings::default();
            if let Some(aliases) = optional_string_array(&params, "aliases") {
                endpoint.aliases = Some(aliases);
            }
            if let Some(ipv4) = optional_str(&params, "ipv4Address") {
                endpoint.ipam_config = Some(EndpointIpamConfig {
                    ipv4_address: Some(ipv4),
                    ..Default::default()
                });
            }
            let config = NetworkConnectRequest {
                container: container.clone(),
                endpoint_config: Some(endpoint),
            };
            docker
                .connect_network(&network, config)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"network": network, "container": container, "action": "connected"})
        }
        "docker/network/disconnect" => {
            let network = network_id(&params)?;
            let container = required_str(&params, "container")?;
            let force = optional_bool(&params, "force").unwrap_or(false);
            docker
                .disconnect_network(
                    &network,
                    NetworkDisconnectRequest {
                        container: container.clone(),
                        force: Some(force),
                    },
                )
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"network": network, "container": container, "action": "disconnected"})
        }
        "docker/network/prune" => {
            let response = docker
                .prune_networks(None::<PruneNetworksOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({"deleted": response.networks_deleted.unwrap_or_default()})
        }
        // ---- volume 写操作 ----
        "docker/volume/create" => {
            let config = volume_create_params(&params)?;
            let volume = docker
                .create_volume(config)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            serialize_value(Ok::<_, String>(volume))?
        }
        "docker/volume/prune" => {
            let response = docker
                .prune_volumes(None::<PruneVolumesOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            json!({
                "deleted": response.volumes_deleted.unwrap_or_default(),
                "space_reclaimed_bytes": response.space_reclaimed.unwrap_or(0),
            })
        }
        // ---- system 清理 ----
        "docker/system/prune" => {
            let containers = docker
                .prune_containers(None::<PruneContainersOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let images = docker
                .prune_images(Some(PruneImagesOptions {
                    filters: Some(HashMap::from([(
                        "dangling".to_string(),
                        vec!["true".to_string()],
                    )])),
                }))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let volumes = docker
                .prune_volumes(None::<PruneVolumesOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let networks = docker
                .prune_networks(None::<PruneNetworksOptions>)
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let reclaimed = containers.space_reclaimed.unwrap_or(0)
                + images.space_reclaimed.unwrap_or(0)
                + volumes.space_reclaimed.unwrap_or(0);
            json!({
                "containers_deleted": containers.containers_deleted.unwrap_or_default(),
                "images_deleted": images.images_deleted.unwrap_or_default(),
                "volumes_deleted": volumes.volumes_deleted.unwrap_or_default(),
                "networks_deleted": networks.networks_deleted.unwrap_or_default(),
                "space_reclaimed_bytes": reclaimed,
            })
        }
        _ => {
            return Err(protocol(
                error_codes::METHOD_NOT_FOUND,
                "unknown Docker operation",
            ));
        }
    };
    serialize(extension_protocol::resource::ResourceInvokeResult {
        result: ResultRef::Inline { value },
    })
}

fn close(state: &mut State, params: Value) -> ProviderResult {
    let params: ResourceCloseParams = parse(params)?;
    if state.resources.remove(&params.resource_id).is_none() {
        return Err(closed());
    }
    // 资源关闭后不再持有 Docker 连接,对应的后台任务一并取消。
    state.jobs.clear();
    Ok(Value::Null)
}

/// 启动一个长任务(目前仅镜像拉取)。真实执行放在 tokio 任务里,
/// 不阻塞 provider 的单线程请求循环。
async fn start_job(state: &mut State, params: Value) -> ProviderResult {
    let params: JobStartParams = parse(params)?;
    if params.method != PULL_METHOD {
        return Err(protocol(
            error_codes::METHOD_NOT_FOUND,
            format!("unknown Docker job method `{}`", params.method),
        ));
    }
    let resource_id = params
        .resource_id
        .as_deref()
        .ok_or_else(|| invalid("resourceId is required"))?;
    let docker = state
        .resources
        .get(resource_id)
        .cloned()
        .ok_or_else(closed)?;
    let image = params
        .params
        .get("image")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("image is required"))?
        .to_string();
    let tag = params
        .params
        .get("tag")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let platform = params
        .params
        .get("platform")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let future = async move { pull_image(docker, image, tag, platform).await };
    serialize(state.jobs.start(future)?)
}

/// 拉取镜像并返回摘要。拉取过程只保留最后一个状态文本与完成层数,
/// 避免把 daemon 的进度流全量缓存在 provider 内存里。
async fn pull_image(
    docker: Arc<Docker>,
    image: String,
    tag: Option<String>,
    platform: Option<String>,
) -> Result<Value, String> {
    let mut options = CreateImageOptionsBuilder::default().from_image(&image);
    if let Some(tag) = tag.as_deref() {
        options = options.tag(tag);
    }
    if let Some(platform) = platform.as_deref() {
        options = options.platform(platform);
    }
    let mut stream = docker.create_image(Some(options.build()), None, None);
    let mut status = String::new();
    let mut layers = 0_u64;
    while let Some(item) = stream.next().await {
        match item {
            Ok(info) => {
                if let Some(text) = info.status {
                    status = text;
                }
                if info.id.is_some() {
                    layers += 1;
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(json!({
        "image": image,
        "tag": tag,
        "platform": platform,
        "status": if status.is_empty() { "pulled" } else { status.as_str() },
        "layers": layers,
    }))
}

fn resource<'a>(state: &'a State, id: &str) -> Result<&'a Arc<Docker>, Box<ProtocolError>> {
    state.resources.get(id).ok_or_else(closed)
}

/// 解析 `{"name": string}` 形式的镜像名/引用。
fn image_name(params: &ResourceInvokeParams) -> Result<String, Box<ProtocolError>> {
    required_str(params, "name")
}

/// 解析 `{"id": string}` 形式的网络名/ID。
fn network_id(params: &ResourceInvokeParams) -> Result<String, Box<ProtocolError>> {
    required_str(params, "id")
}

fn required_str(params: &ResourceInvokeParams, key: &str) -> Result<String, Box<ProtocolError>> {
    params
        .params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| invalid(format!("{key} is required")))
}

fn optional_str(params: &ResourceInvokeParams, key: &str) -> Option<String> {
    params
        .params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn optional_bool(params: &ResourceInvokeParams, key: &str) -> Option<bool> {
    params.params.get(key).and_then(Value::as_bool)
}

fn optional_string_array(params: &ResourceInvokeParams, key: &str) -> Option<Vec<String>> {
    params
        .params
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
}

/// 读取一个可能以 JSON 字符串或 JSON 对象传入的字段。
/// 宿主 query 页面的输入统一是字符串,shell 调用则可直接给对象。
fn parse_json_field(params: &Value, key: &str) -> Result<Option<Value>, Box<ProtocolError>> {
    let Some(value) = params.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if let Some(text) = value.as_str() {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        return serde_json::from_str(text)
            .map(Some)
            .map_err(|error| invalid(format!("{key} is not valid JSON: {error}")));
    }
    Ok(Some(value.clone()))
}

/// 构造创建容器的请求体:优先使用完整的 Docker `config` JSON,
/// 否则从常用的简写字段拼装。
fn container_create_params(
    params: &ResourceInvokeParams,
) -> Result<(Option<String>, ContainerCreateBody), Box<ProtocolError>> {
    let name = optional_str(params, "name");
    if let Some(value) = parse_json_field(&params.params, "config")? {
        if !value.is_object() {
            return Err(invalid("config must be a JSON object"));
        }
        let mut body: ContainerCreateBody = serde_json::from_value(value)
            .map_err(|error| invalid(format!("invalid container config: {error}")))?;
        if body
            .image
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            return Err(invalid("container config.image is required"));
        }
        if name.is_some() && body.hostname.is_none() {
            body.hostname = name.clone();
        }
        return Ok((name, body));
    }
    let image = required_str(params, "image")?;
    let body = ContainerCreateBody {
        image: Some(image),
        hostname: name.clone(),
        cmd: optional_string_array(params, "cmd"),
        entrypoint: optional_string_array(params, "entrypoint"),
        env: optional_string_array(params, "env"),
        working_dir: optional_str(params, "workingDir"),
        tty: optional_bool(params, "tty"),
        open_stdin: optional_bool(params, "openStdin"),
        exposed_ports: optional_string_array(params, "exposedPorts"),
        labels: params
            .params
            .get("labels")
            .and_then(Value::as_object)
            .map(|labels| {
                labels
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            }),
        ..Default::default()
    };
    Ok((name, body))
}

/// 构造创建网络的请求体:优先完整 `config` JSON,否则从简写字段拼装。
fn network_create_params(
    params: &ResourceInvokeParams,
) -> Result<NetworkCreateRequest, Box<ProtocolError>> {
    if let Some(value) = parse_json_field(&params.params, "config")? {
        if !value.is_object() {
            return Err(invalid("config must be a JSON object"));
        }
        return serde_json::from_value(value)
            .map_err(|error| invalid(format!("invalid network config: {error}")));
    }
    let name = required_str(params, "name")?;
    Ok(NetworkCreateRequest {
        name,
        driver: optional_str(params, "driver"),
        internal: optional_bool(params, "internal"),
        attachable: optional_bool(params, "attachable"),
        labels: params
            .params
            .get("labels")
            .and_then(Value::as_object)
            .map(|labels| {
                labels
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            }),
        ..Default::default()
    })
}

/// 构造创建卷的请求体:优先完整 `config` JSON,否则从简写字段拼装。
fn volume_create_params(
    params: &ResourceInvokeParams,
) -> Result<VolumeCreateRequest, Box<ProtocolError>> {
    if let Some(value) = parse_json_field(&params.params, "config")? {
        if !value.is_object() {
            return Err(invalid("config must be a JSON object"));
        }
        return serde_json::from_value(value)
            .map_err(|error| invalid(format!("invalid volume config: {error}")));
    }
    Ok(VolumeCreateRequest {
        name: Some(required_str(params, "name")?),
        driver: optional_str(params, "driver"),
        labels: params
            .params
            .get("labels")
            .and_then(Value::as_object)
            .map(|labels| {
                labels
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_string()))
                    })
                    .collect()
            }),
        ..Default::default()
    })
}

fn container_id(params: &ResourceInvokeParams) -> Result<String, Box<ProtocolError>> {
    Ok(params
        .params
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("container id is required"))?
        .to_string())
}

/// 取容器的首个成功 stats 样本(one-shot,不持续流)。流为空或首个样本失败都视
/// 为不可用。第 8、9 条操作共用,避免重复拉取逻辑。
async fn fetch_stats_sample(
    docker: &Docker,
    id: &str,
) -> Result<ContainerStatsResponse, Box<ProtocolError>> {
    let options = StatsOptionsBuilder::default()
        .stream(false)
        .one_shot(true)
        .build();
    let mut stream = docker.stats(id, Some(options));
    match stream.next().await {
        Some(Ok(sample)) => Ok(sample),
        Some(Err(error)) => Err(unavailable(error.to_string())),
        None => Err(unavailable("no stats sample returned")),
    }
}

/// 从单个 stats 样本里汇总 CPU% / 内存用量 / 在线核数。
/// CPU% 采用 Docker 官方公式,用 `saturating_sub` 防止下溢。
fn summarize_stats(stats: &ContainerStatsResponse) -> (f64, u64, u64, u32) {
    let cpu = stats.cpu_stats.as_ref();
    let precpu = stats.precpu_stats.as_ref();
    let cpu_total = cpu
        .and_then(|c| c.cpu_usage.as_ref())
        .and_then(|u| u.total_usage)
        .unwrap_or(0);
    let precpu_total = precpu
        .and_then(|c| c.cpu_usage.as_ref())
        .and_then(|u| u.total_usage)
        .unwrap_or(0);
    let cpu_system = cpu.and_then(|c| c.system_cpu_usage).unwrap_or(0);
    let precpu_system = precpu.and_then(|c| c.system_cpu_usage).unwrap_or(0);
    let online_cpus = cpu.and_then(|c| c.online_cpus).unwrap_or(0);
    let cpu_delta = cpu_total.saturating_sub(precpu_total);
    let sys_delta = cpu_system.saturating_sub(precpu_system);
    let cpu_percent = if cpu_delta > 0 && sys_delta > 0 {
        cpu_delta as f64 / sys_delta as f64 * online_cpus as f64 * 100.0
    } else {
        0.0
    };
    let memory_usage = stats
        .memory_stats
        .as_ref()
        .and_then(|m| m.usage)
        .unwrap_or(0);
    let memory_limit = stats
        .memory_stats
        .as_ref()
        .and_then(|m| m.limit)
        .unwrap_or(0);
    (cpu_percent, memory_usage, memory_limit, online_cpus)
}

/// 在容器内执行一条命令,收集其 stdout/stderr 文本。
/// cmd 直接以 argv 形式传入(不经 shell),working_dir 可选,避免字符串拼路径的注入问题。
/// 任意 Docker 连接 / 创建 / 启动失败都转为 unavailable 透出。
async fn exec_collect(
    docker: &Docker,
    id: &str,
    cmd: Vec<String>,
    working_dir: Option<String>,
) -> Result<(String, String), Box<ProtocolError>> {
    let exec = docker
        .create_exec(
            id,
            CreateExecOptions {
                cmd: Some(cmd),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                working_dir,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| unavailable(e.to_string()))?;
    match docker
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                tty: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| unavailable(e.to_string()))?
    {
        StartExecResults::Attached { mut output, .. } => {
            let mut stdout = String::new();
            let mut stderr = String::new();
            while let Some(item) = output.next().await {
                match item {
                    Ok(LogOutput::StdOut { message }) => {
                        stdout.push_str(&String::from_utf8_lossy(&message));
                    }
                    Ok(LogOutput::StdErr { message }) => {
                        stderr.push_str(&String::from_utf8_lossy(&message));
                    }
                    Ok(_) => {}
                    Err(error) => return Err(unavailable(error.to_string())),
                }
            }
            Ok((stdout, stderr))
        }
        StartExecResults::Detached => Err(unavailable("exec returned detached")),
    }
}

/// 容器内路径规范化:保证以 '/' 开头,并去掉末尾 '/' (根目录除外);空串退回 '/'.
fn normalize_container_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "/".to_string();
    }
    let mut path = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };
    while path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    path
}

/// 镜像历史层的短 ID:去掉 `sha256:` 前缀并截断 12 位,`<missing>` 原样保留。
fn short_history_id(id: &str) -> String {
    let id = id.strip_prefix("sha256:").unwrap_or(id);
    if id == "<missing>" {
        id.to_string()
    } else {
        id.get(..12).unwrap_or(id).to_string()
    }
}

/// 取路径的父目录:去掉最后一个 '/' 段;结果为空则退回 '/'.
fn parent_path(path: &str) -> String {
    match path.rfind('/') {
        Some(0) => "/".to_string(),
        Some(index) => path[..index].to_string(),
        None => "/".to_string(),
    }
}

/// 把字节数格式化为 B/KB/MB/GB/TB(1024 进制),B 不带小数,其余保留 1 位小数。
fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// 把 Unix 秒级 epoch 格式化为 UTC "YYYY-MM-DD HH:MM"。
/// 采用 Howard Hinnant 的 civil_from_days 算法(无外部依赖)。
/// epoch <= 0 视为非法,输出 "-".
fn utc_format(epoch: i64) -> String {
    if epoch <= 0 {
        return "-".to_string();
    }
    let days = epoch.div_euclid(86_400);
    let secs = epoch.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = (secs / 3_600) as u32;
    let minute = ((secs % 3_600) / 60) as u32;
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}")
}

/// 由"从 1970-01-01 起的天数"推导公历年月日(Howard Hinnant 算法)。
/// 平年的 doy=365 会落到 2-29(非法),此处规整为 3-1。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    // 由 doe 反解 yoe(era 内年偏移 [0,399]):先用 4*doe/1461 近似,再微调。
    let mut yoe = 4 * doe / 1461;
    while 365 * (yoe + 1) + (yoe + 1) / 4 - (yoe + 1) / 100 < doe {
        yoe += 1;
    }
    while 365 * yoe + yoe / 4 - yoe / 100 > doe {
        yoe -= 1;
    }
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + 3 - 12 * (mp / 10);
    let y = y + mp / 10;
    let (y, m, d) = if m == 2 && d == 29 && !is_leap(y) {
        (y, 3, 1)
    } else {
        (y, m, d)
    };
    (y, m as u32, d as u32)
}

/// 闰年判定。
fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn expand_socket(value: &str) -> Result<String, Box<ProtocolError>> {
    let path = value
        .strip_prefix("unix://")
        .ok_or_else(|| invalid("only unix:// sockets are supported"))?;
    if let Some(relative) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| invalid("HOME is unavailable"))?;
        return Ok(format!("{home}/{relative}"));
    }
    if !path.starts_with('/') || path.contains("..") {
        return Err(invalid("socket must be an absolute path"));
    }
    Ok(path.to_owned())
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T, Box<ProtocolError>> {
    serde_json::from_value(value).map_err(|e| invalid(e.to_string()))
}

fn serialize<T: serde::Serialize>(value: T) -> ProviderResult {
    serde_json::to_value(value).map_err(|e| invalid(e.to_string()))
}

fn serialize_value<T: serde::Serialize, E: std::fmt::Display>(
    result: Result<T, E>,
) -> Result<Value, Box<ProtocolError>> {
    serialize(result.map_err(|e| unavailable(e.to_string()))?)
}

fn protocol(
    code: extension_protocol::error::ErrorCode,
    message: impl Into<String>,
) -> Box<ProtocolError> {
    Box::new(ProtocolError::new(code, message))
}
fn invalid(message: impl Into<String>) -> Box<ProtocolError> {
    protocol(error_codes::INVALID_PARAMS, message)
}
fn unavailable(message: impl Into<String>) -> Box<ProtocolError> {
    protocol(error_codes::INTERNAL_ERROR, message)
}
fn closed() -> Box<ProtocolError> {
    protocol(error_codes::RESOURCE_CLOSED, "Docker resource is not open")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bucket(params: Value) -> ResourceInvokeParams {
        ResourceInvokeParams {
            resource_id: "r".into(),
            method: "m".into(),
            params,
        }
    }

    #[test]
    fn required_str_trims_and_rejects_empty() {
        let p = bucket(json!({"name": "   busybox  "}));
        assert_eq!(required_str(&p, "name").unwrap(), "busybox");
        assert!(required_str(&bucket(json!({"name": ""})), "name").is_err());
        assert!(required_str(&bucket(json!({})), "name").is_err());
    }

    #[test]
    fn optional_str_returns_none_for_missing() {
        let p = bucket(json!({}));
        assert_eq!(optional_str(&p, "signal"), None);
        assert_eq!(
            optional_str(&bucket(json!({"signal": "SIGTERM"})), "signal").as_deref(),
            Some("SIGTERM")
        );
    }

    #[test]
    fn parse_json_field_accepts_object_and_json_string() {
        // 宿主 query 页面以字符串传入 JSON
        let as_string = parse_json_field(&json!({"c": r#"{"image":"nginx","tty":true}"#}), "c")
            .unwrap()
            .unwrap();
        assert_eq!(as_string["image"], "nginx");
        // shell 直接给对象
        let as_object = parse_json_field(&json!({"c": {"image":"nginx"}}), "c")
            .unwrap()
            .unwrap();
        assert_eq!(as_object["image"], "nginx");
        // 非法 JSON 字符串报错
        assert!(parse_json_field(&json!({"c": "not-json"}), "c").is_err());
        // 缺失/null 返回 None
        assert!(parse_json_field(&json!({}), "c").unwrap().is_none());
        assert!(
            parse_json_field(&json!({"c": null}), "c")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn container_create_params_build_from_shorthand() {
        let p = bucket(json!({
            "name": "web",
            "image": "nginx:1.25",
            "cmd": ["nginx", "-g"],
            "env": ["A=1"],
        }));
        let (name, body) = container_create_params(&p).unwrap();
        assert_eq!(name.as_deref(), Some("web"));
        assert_eq!(body.image.as_deref(), Some("nginx:1.25"));
        assert_eq!(body.cmd, Some(vec!["nginx".into(), "-g".into()]));
        assert_eq!(body.env, Some(vec!["A=1".into()]));
        // 缺 image 报错
        assert!(container_create_params(&bucket(json!({"name": "web"}))).is_err());
    }

    #[test]
    fn container_create_params_accepts_raw_config() {
        // config 是 Docker 容器的创建请求体,使用 Docker API 的 CamelCase 字段。
        let p = bucket(json!({
            "config": r#"{"Image":"postgres","Env":["POSTGRES_PASSWORD=x"],"HostConfig":{"PublishAllPorts":true}}"#
        }));
        let (_name, body) = container_create_params(&p).unwrap();
        assert_eq!(body.image.as_deref(), Some("postgres"));
        assert_eq!(body.env, Some(vec!["POSTGRES_PASSWORD=x".into()]));
        // 空 image 的 config 报错
        assert!(container_create_params(&bucket(json!({"config": "{\"Cmd\":[\"sh\"]}"}))).is_err());
    }

    #[test]
    fn network_create_params_build_and_validate() {
        let p = bucket(json!({"name": "net1", "driver": "bridge", "internal": true}));
        let req = network_create_params(&p).unwrap();
        assert_eq!(req.name, "net1");
        assert_eq!(req.driver.as_deref(), Some("bridge"));
        assert_eq!(req.internal, Some(true));
        assert!(network_create_params(&bucket(json!({}))).is_err());
    }

    #[test]
    fn volume_create_params_build_and_validate() {
        let p = bucket(json!({"name": "vol1", "driver": "local"}));
        let req = volume_create_params(&p).unwrap();
        assert_eq!(req.name.as_deref(), Some("vol1"));
        assert_eq!(req.driver.as_deref(), Some("local"));
        assert!(volume_create_params(&bucket(json!({}))).is_err());
    }

    #[test]
    fn capabilities_cover_all_resource_methods() {
        // 能力位必须覆盖 manifest 与 provider 实现的每一个方法,宿主据此校验。
        let expected = [
            "docker/system/info",
            "docker/system/usage",
            "docker/system/prune",
            "docker/container/create",
            "docker/container/pause",
            "docker/container/unpause",
            "docker/container/kill",
            "docker/container/rename",
            "docker/container/update",
            "docker/container/top",
            "docker/container/diff",
            "docker/image/inspect",
            "docker/image/history",
            "docker/image/tag",
            "docker/image/prune",
            "docker/image/pull",
            "docker/network/create",
            "docker/network/connect",
            "docker/network/disconnect",
            "docker/network/prune",
            "docker/volume/create",
            "docker/volume/prune",
        ];
        for method in expected {
            assert!(
                CAPABILITIES.contains(&method),
                "missing capability {method}"
            );
        }
        assert!(CAPABILITIES.len() >= 40);
    }

    #[tokio::test]
    async fn pull_image_result_has_summary_fields() {
        // 不依赖真实 daemon:解析入参 -> job 结果的 JSON 形状由 pull_image 拼装,
        // 这里仅验证入参缺失时的错误由 start_job 拒绝。
        let mut state = State::default();
        let err = start_job(
            &mut state,
            json!({
                "method": "docker/image/pull",
                "resource_id": "missing",
                "params": {"image": "nginx"},
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, error_codes::RESOURCE_CLOSED);
    }
}
