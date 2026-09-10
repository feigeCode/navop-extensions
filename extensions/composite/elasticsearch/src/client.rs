use std::time::Duration;

use elasticsearch::{
    Elasticsearch, SearchParts,
    auth::Credentials,
    cat::{CatIndicesParts, CatShardsParts},
    cluster::ClusterHealthParts,
    http::{
        response::Response,
        transport::{SingleNodeConnectionPool, TransportBuilder},
    },
    indices::{
        IndicesCloseParts, IndicesCreateParts, IndicesDeleteParts, IndicesGetAliasParts,
        IndicesGetMappingParts, IndicesGetParts, IndicesGetSettingsParts, IndicesOpenParts,
        IndicesRefreshParts, IndicesStatsParts,
    },
    params::{Bytes, Level, Refresh},
    CountParts, DeleteParts, GetParts, IndexParts,
};
use extension_protocol::error::{ProtocolError, error_codes};
use serde_json::{Value, json};

use crate::error::{ProviderResult, boxed_error, invalid_params};

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HTTP_BODY_BYTES: usize = 16 * 1024 * 1024;

pub(crate) const STANDARD_VERSION: u32 = 1;

pub(crate) const CAPABILITY_CLUSTER_READ: &str = "cluster_read";
pub(crate) const CAPABILITY_CLUSTER_NODES: &str = "cluster_nodes";
pub(crate) const CAPABILITY_INDEX_READ: &str = "index_read";
pub(crate) const CAPABILITY_INDEX_STATS: &str = "index_stats";
pub(crate) const CAPABILITY_INDEX_SHARDS: &str = "index_shards";
pub(crate) const CAPABILITY_INDEX_WRITE: &str = "index_write";
pub(crate) const CAPABILITY_DOCUMENT_READ: &str = "document_read";
pub(crate) const CAPABILITY_DOCUMENT_WRITE: &str = "document_write";
pub(crate) const CAPABILITY_ALIAS_WRITE: &str = "alias_write";
pub(crate) const CAPABILITY_SEARCH: &str = "search";
pub(crate) const CAPABILITY_SEARCH_ASYNC: &str = "search_async";

pub(crate) fn all_capabilities() -> Vec<&'static str> {
    vec![
        CAPABILITY_CLUSTER_READ,
        CAPABILITY_CLUSTER_NODES,
        CAPABILITY_INDEX_READ,
        CAPABILITY_INDEX_STATS,
        CAPABILITY_INDEX_SHARDS,
        CAPABILITY_INDEX_WRITE,
        CAPABILITY_DOCUMENT_READ,
        CAPABILITY_DOCUMENT_WRITE,
        CAPABILITY_ALIAS_WRITE,
        CAPABILITY_SEARCH,
        CAPABILITY_SEARCH_ASYNC,
    ]
}

pub(crate) fn capabilities_payload() -> Value {
    let mut flags = serde_json::Map::new();
    for capability in all_capabilities() {
        flags.insert(capability.to_owned(), Value::Bool(true));
    }
    json!({
        "standard_version": STANDARD_VERSION,
        "capabilities": Value::Object(flags),
    })
}

#[derive(Clone, Debug)]
pub(crate) struct ElasticsearchResource {
    client: Elasticsearch,
}

pub(crate) fn build_client(
    url: &str,
    credentials: Option<Credentials>,
) -> Result<ElasticsearchResource, Box<ProtocolError>> {
    let url = url
        .parse::<elasticsearch::http::Url>()
        .map_err(|error| invalid_params(format!("invalid Elasticsearch URL: {error}")))?;
    let pool = SingleNodeConnectionPool::new(url);
    let mut transport = TransportBuilder::new(pool)
        .disable_proxy()
        .timeout(HTTP_TIMEOUT)
        .enable_meta_header(true);
    if let Some(credentials) = credentials {
        transport = transport.auth(credentials);
    }
    let transport = transport
        .build()
        .map_err(|error| boxed_error(error_codes::INTERNAL_ERROR, error.to_string()))?;
    Ok(ElasticsearchResource {
        client: Elasticsearch::new(transport),
    })
}

type ExecResult = Result<Response, Box<ProtocolError>>;

pub(crate) async fn execute(
    resource: &ElasticsearchResource,
    method_name: &str,
    params: &Value,
) -> ProviderResult {
    if method_name == "elasticsearch/capabilities" {
        return Ok(capabilities_payload());
    }
    let response: Response = match method_name {
        "elasticsearch/cluster/info" => resource
            .client
            .info()
            .send()
            .await
            .map_err(map_client_error)?,
        "elasticsearch/cluster/health" => build_health(resource, params).await?,
        "elasticsearch/cluster/stats" => resource
            .client
            .cluster()
            .stats(elasticsearch::cluster::ClusterStatsParts::None)
            .send()
            .await
            .map_err(map_client_error)?,
        "elasticsearch/nodes/list" => resource
            .client
            .cat()
            .nodes()
            .format("json")
            .bytes(Bytes::B)
            .h(&[
                "name",
                "ip",
                "heap.percent",
                "ram.percent",
                "cpu",
                "load_1m",
                "node.role",
                "master",
                "disk.total",
                "disk.used",
                "disk.used_percent",
                "version",
            ])
            .send()
            .await
            .map_err(map_client_error)?,
        "elasticsearch/index/list" => resource
            .client
            .cat()
            .indices(CatIndicesParts::None)
            .format("json")
            .bytes(Bytes::B)
            .h(&[
                "index",
                "health",
                "status",
                "pri",
                "rep",
                "docs.count",
                "docs.deleted",
                "store.size",
                "pri.store.size",
                "creation.date",
            ])
            .send()
            .await
            .map_err(map_client_error)?,
        "elasticsearch/index/get" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .get(IndicesGetParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/mapping" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .get_mapping(IndicesGetMappingParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/settings" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .get_settings(IndicesGetSettingsParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/aliases" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .get_alias(IndicesGetAliasParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/stats" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .stats(IndicesStatsParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/shards" => {
            let indices_owned = collect_index_strings(params);
            let indices_refs: Vec<&str> =
                indices_owned.iter().map(String::as_str).collect();
            let parts: CatShardsParts<'_> = if indices_refs.is_empty() {
                CatShardsParts::None
            } else {
                CatShardsParts::Index(&indices_refs)
            };
            resource
                .client
                .cat()
                .shards(parts)
                .format("json")
                .bytes(Bytes::B)
                .h(&[
                    "index",
                    "shard",
                    "prirep",
                    "state",
                    "docs",
                    "store",
                    "ip",
                    "node",
                    "unassigned.reason",
                ])
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/create" => execute_index_create(resource, params).await?,
        "elasticsearch/index/delete" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .delete(IndicesDeleteParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/refresh" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .refresh(IndicesRefreshParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/open" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .open(IndicesOpenParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/close" => {
            let index = index_name(params)?;
            resource
                .client
                .indices()
                .close(IndicesCloseParts::Index(&[index.as_str()]))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/index/alias/update" => execute_alias_update(resource, params).await?,
        "elasticsearch/count" => execute_count(resource, params).await?,
        "elasticsearch/document/get" => {
            let index = index_name(params)?;
            let id = doc_id(params)?;
            resource
                .client
                .get(GetParts::IndexId(index.as_str(), id.as_str()))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/document/index" => execute_document_index(resource, params).await?,
        "elasticsearch/document/delete" => {
            let index = index_name(params)?;
            let id = doc_id(params)?;
            resource
                .client
                .delete(DeleteParts::IndexId(index.as_str(), id.as_str()))
                .send()
                .await
                .map_err(map_client_error)?
        }
        "elasticsearch/search" => execute_search(resource, params).await?,
        _ => {
            return Err(boxed_error(
                error_codes::METHOD_NOT_FOUND,
                format!("unknown Elasticsearch method `{method_name}`"),
            ));
        }
    };
    response_json(response).await
}

pub(crate) async fn validate_connection(
    resource: &ElasticsearchResource,
) -> Result<(), Box<ProtocolError>> {
    let value = execute(resource, "elasticsearch/cluster/info", &Value::Null).await?;
    let version = value
        .pointer("/version/number")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            boxed_error(
                error_codes::DATA_INVALID_ENCODING,
                "missing Elasticsearch version",
            )
        })?;
    if version.split('.').next() != Some("9") {
        return Err(boxed_error(
            error_codes::SERVER_INCOMPATIBLE,
            format!("Elasticsearch 9.x is required; server reported {version}"),
        ));
    }
    Ok(())
}

async fn build_health(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let cluster = resource.client.cluster();
    let mut builder = cluster.health(ClusterHealthParts::None);
    if let Some(level) = params.get("level").and_then(Value::as_str) {
        let parsed = match level {
            "indices" => Level::Indices,
            "shards" => Level::Shards,
            _ => Level::Cluster,
        };
        builder = builder.level(parsed);
    }
    if let Some(timeout) = params.get("timeout").and_then(Value::as_str) {
        builder = builder.timeout(timeout);
    }
    Ok(builder.send().await.map_err(map_client_error)?)
}

async fn execute_index_create(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let name = index_name(params)?;
    let mut body = serde_json::Map::new();
    if let Some(settings) = params.get("settings") {
        ensure_object(settings, "settings")?;
        if !settings.is_null() {
            body.insert("settings".to_owned(), settings.clone());
        }
    }
    if let Some(mappings) = params.get("mappings") {
        ensure_object(mappings, "mappings")?;
        if !mappings.is_null() {
            body.insert("mappings".to_owned(), mappings.clone());
        }
    }
    if let Some(aliases) = params.get("aliases") {
        ensure_object(aliases, "aliases")?;
        if !aliases.is_null() {
            body.insert("aliases".to_owned(), aliases.clone());
        }
    }
    let body_value = if body.is_empty() {
        json!({})
    } else {
        Value::Object(body)
    };
    Ok(resource
        .client
        .indices()
        .create(IndicesCreateParts::Index(name.as_str()))
        .body(body_value)
        .send()
        .await
        .map_err(map_client_error)?)
}

async fn execute_alias_update(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let actions = params
        .get("actions")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_params("`actions` array is required for alias updates"))?;
    if actions.is_empty() {
        return Err(invalid_params("`actions` must contain at least one entry"));
    }
    Ok(resource
        .client
        .indices()
        .update_aliases()
        .body(json!({ "actions": actions }))
        .send()
        .await
        .map_err(map_client_error)?)
}

async fn execute_count(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let indices_owned = collect_index_strings(params);
    let indices_refs: Vec<&str> = indices_owned.iter().map(String::as_str).collect();
    let parts: CountParts<'_> = if indices_refs.is_empty() {
        CountParts::None
    } else {
        CountParts::Index(&indices_refs)
    };
    let body = count_body(params)?;
    Ok(resource
        .client
        .count(parts)
        .body(body)
        .send()
        .await
        .map_err(map_client_error)?)
}

async fn execute_document_index(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let index = index_name(params)?;
    let id = doc_id(params)?;
    let body = params
        .get("body")
        .cloned()
        .ok_or_else(|| invalid_params("document body is required"))?;
    if !body.is_object() {
        return Err(invalid_params("document body must be a JSON object"));
    }
    let refresh = params
        .get("refresh")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut builder = resource
        .client
        .index(IndexParts::IndexId(index.as_str(), id.as_str()))
        .body(body);
    if refresh {
        builder = builder.refresh(Refresh::True);
    }
    Ok(builder.send().await.map_err(map_client_error)?)
}

async fn execute_search(
    resource: &ElasticsearchResource,
    params: &Value,
) -> ExecResult {
    let indices_owned = collect_index_strings(params);
    let indices_refs: Vec<&str> = indices_owned.iter().map(String::as_str).collect();
    let body = search_body(params)?;

    let mut builder = if indices_refs.is_empty() {
        resource.client.search(SearchParts::None).body(body)
    } else {
        resource
            .client
            .search(SearchParts::Index(&indices_refs))
            .body(body)
    };
    if let Some(from) = params.get("from").and_then(Value::as_i64) {
        builder = builder.from(from);
    }
    if let Some(size) = params.get("size").and_then(Value::as_i64) {
        builder = builder.size(size);
    }

    let sort_owned = collect_string_array(params, "sort");
    let sort_refs: Vec<&str> = sort_owned.iter().map(String::as_str).collect();
    if !sort_refs.is_empty() {
        builder = builder.sort(&sort_refs);
    }

    if let Some(track) = params.get("track_total_hits").and_then(Value::as_bool) {
        builder = builder.track_total_hits(track);
    }
    Ok(builder.send().await.map_err(map_client_error)?)
}

async fn response_json(response: Response) -> ProviderResult {
    let status = response.status_code();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_HTTP_BODY_BYTES as u64)
    {
        return Err(boxed_error(
            error_codes::DATA_VALUE_OUT_OF_RANGE,
            "Elasticsearch response exceeds the provider limit",
        ));
    }
    let body = response.bytes().await.map_err(map_client_error)?;
    if body.len() > MAX_HTTP_BODY_BYTES {
        return Err(boxed_error(
            error_codes::DATA_VALUE_OUT_OF_RANGE,
            "Elasticsearch response exceeds the provider limit",
        ));
    }
    let value = serde_json::from_slice::<Value>(&body).map_err(|_| {
        boxed_error(
            error_codes::DATA_INVALID_ENCODING,
            "Elasticsearch returned invalid JSON",
        )
    })?;
    if status.is_success() {
        return Ok(value);
    }
    let code = match status.as_u16() {
        401 => error_codes::AUTH_FAILED,
        403 => error_codes::PERMISSION_DENIED,
        404 => error_codes::SQL_OBJECT_NOT_FOUND,
        408 | 504 => error_codes::IO_TIMEOUT,
        _ => error_codes::IO_CONNECTION_REFUSED,
    };
    let reason = value
        .pointer("/error/reason")
        .and_then(Value::as_str)
        .unwrap_or("Elasticsearch request failed");
    Err(boxed_error(code, format!("HTTP {status}: {reason}")))
}

fn map_client_error(error: elasticsearch::Error) -> Box<ProtocolError> {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("timed out") {
        error_codes::IO_TIMEOUT
    } else if lower.contains("certificate") {
        error_codes::TLS_CERT_INVALID
    } else {
        error_codes::IO_CONNECTION_REFUSED
    };
    boxed_error(code, format!("Elasticsearch SDK request failed: {message}"))
}

fn ensure_object(value: &Value, field: &str) -> Result<(), Box<ProtocolError>> {
    if value.is_object() || value.is_null() {
        Ok(())
    } else {
        Err(invalid_params(format!("`{field}` must be a JSON object")))
    }
}

fn index_name(params: &Value) -> Result<String, Box<ProtocolError>> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| invalid_params("index name is required"))?;
    if name.len() > 256 || name.contains('/') || name.contains('?') || name.contains('#') {
        return Err(invalid_params("invalid index name"));
    }
    Ok(name.to_owned())
}

fn doc_id(params: &Value) -> Result<String, Box<ProtocolError>> {
    let id = params
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| invalid_params("document id is required"))?;
    if id.len() > 512 {
        return Err(invalid_params("invalid document id"));
    }
    Ok(id.to_owned())
}

fn collect_index_strings(params: &Value) -> Vec<String> {
    collect_string_array(params, "indices")
}

fn collect_string_array(params: &Value, key: &str) -> Vec<String> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

fn count_body(params: &Value) -> Result<Value, Box<ProtocolError>> {
    if let Some(body) = params.get("body") {
        if !body.is_object() {
            return Err(invalid_params("count body must be a JSON object"));
        }
        return Ok(body.clone());
    }
    if let Some(query) = params.get("query").and_then(Value::as_str) {
        let trimmed = query.trim();
        if trimmed.is_empty() || trimmed == "*" {
            return Ok(json!({ "query": { "match_all": {} } }));
        }
        return Ok(json!({
            "query": {
                "simple_query_string": { "query": trimmed, "fields": ["*"] }
            }
        }));
    }
    Ok(json!({ "query": { "match_all": {} } }))
}

pub(crate) fn search_body(params: &Value) -> Result<Value, Box<ProtocolError>> {
    if let Some(body) = params.get("body") {
        if !body.is_object() {
            return Err(invalid_params("search body must be a JSON object"));
        }
        return Ok(body.clone());
    }
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .ok_or_else(|| invalid_params("non-empty search query is required"))?;
    if query == "*" {
        return Ok(json!({ "query": { "match_all": {} } }));
    }
    Ok(json!({
        "query": {
            "simple_query_string": {
                "query": query,
                "fields": ["*"]
            }
        }
    }))
}

pub(crate) fn normalize_result(method_name: &str, value: Value) -> Value {
    match method_name {
        "elasticsearch/index/list" => normalize_indices(value),
        "elasticsearch/index/shards" => normalize_cat_rows(value, "shards"),
        "elasticsearch/nodes/list" => normalize_nodes(value),
        "elasticsearch/search" => normalize_search(value),
        _ => value,
    }
}

fn string_or_null(value: Option<&Value>) -> Value {
    value
        .and_then(Value::as_str)
        .map(|s| Value::String(s.to_string()))
        .unwrap_or(Value::Null)
}

fn u64_or_null(value: Option<&Value>) -> Value {
    value
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
        .map(Value::from)
        .unwrap_or(Value::Null)
}

fn normalize_indices(value: Value) -> Value {
    let Some(indices) = value.as_array() else {
        return json!({ "indices": value });
    };
    let normalized: Vec<Value> = indices
        .iter()
        .map(|index| {
            json!({
                "name": string_or_null(index.get("index").or_else(|| index.get("name"))),
                "health": string_or_null(index.get("health")),
                "status": string_or_null(index.get("status")),
                "pri": u64_or_null(index.get("pri")),
                "rep": u64_or_null(index.get("rep")),
                "docs": u64_or_null(index.get("docs.count")),
                "docs_deleted": u64_or_null(index.get("docs.deleted")),
                "size_bytes": u64_or_null(index.get("store.size")),
                "pri_store_bytes": u64_or_null(index.get("pri.store.size")),
                "creation_date": u64_or_null(index.get("creation.date")),
            })
        })
        .collect();
    json!({ "indices": normalized })
}

fn normalize_nodes(value: Value) -> Value {
    let Some(nodes) = value.as_array() else {
        return json!({ "nodes": value });
    };
    let normalized: Vec<Value> = nodes
        .iter()
        .map(|node| {
            json!({
                "name": string_or_null(node.get("name")),
                "ip": string_or_null(node.get("ip")),
                "heap_percent": u64_or_null(node.get("heap.percent")),
                "ram_percent": u64_or_null(node.get("ram.percent")),
                "cpu": u64_or_null(node.get("cpu")),
                "load_1m": string_or_null(node.get("load_1m")),
                "node_role": string_or_null(node.get("node.role")),
                "master": string_or_null(node.get("master")),
                "disk_total_bytes": u64_or_null(node.get("disk.total")),
                "disk_used_bytes": u64_or_null(node.get("disk.used")),
                "disk_used_percent": u64_or_null(node.get("disk.used_percent")),
                "version": string_or_null(node.get("version")),
            })
        })
        .collect();
    json!({ "nodes": normalized })
}

fn normalize_cat_rows(value: Value, key: &str) -> Value {
    let array = value.as_array().cloned().unwrap_or_default();
    json!({ key: array })
}

pub(crate) fn normalize_search(value: Value) -> Value {
    json!({ "raw": value })
}
