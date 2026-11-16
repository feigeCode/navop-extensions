// navop.db 能力面绑定（modules: ["db"]），走 nsh 的 nativeModule。
//
// 与宿主 `ExtensionDbGateway` 同一套权限模型：清单里声明 `db:read:<conn>`
// / `db:write:*` / `db:connections:list` 等权限，宿主在每次调用时校验；
// 页面侧不需要（也不能）传权限。会话句柄 `dbs-N` 是宿主侧的临时 id，
// 页面重载后失效——别持久化它。
//
// 典型链路：listConnections → openSession → execute/listDatabases/
// listSchemas（可多次）→ closeSession。

import { navopNative } from "./native";

export type {
  DbColumnMetadata,
  DbForeignKey,
  DbFunction,
  DbIndex,
  DbSource,
  DbTable,
  DbTableDescription,
} from "./native";

import type { DbSource, DbTable, DbTableDescription, DbFunction } from "./native";

export type DbConnectionInfo = {
  id: number | string;
  name: string;
  driver: string;
  database?: string | null;
};

export type DbColumn = {
  name: string;
  typeName: string;
  nullable?: boolean;
};

export type DbValue = null | boolean | number | string | number[];

export type RowBatch = {
  columns: DbColumn[];
  /** 与 columns 等长的数组；Bytes 列是字节数组（每项 0-255）。 */
  rows: DbValue[][];
  nextCursor?: string | null;
};

export type DbCallOptions = {
  /** 单次执行的返回行数上限。 */
  maxRows?: number;
};

/** 列出当前工作区里的数据库连接（需要 `db:connections:list` 权限）。 */
export async function listConnections(): Promise<DbConnectionInfo[]> {
  const answer = await navopNative().Db.listConnections();
  return (answer?.connections ?? []) as DbConnectionInfo[];
}

/** 打开一个数据库会话；返回句柄供 execute/list* 使用。 */
export async function openSession(
  connectionId: number | string,
  database?: string,
): Promise<string> {
  const options: { connectionId: number | string; database?: string } = { connectionId };
  if (database !== undefined) options.database = database;
  const answer = await navopNative().Db.openSession(options);
  const sessionId = answer?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("宿主没有返回数据库会话句柄");
  }
  return sessionId;
}

/** 执行 SQL（权限按语句分类：读/写/建 schema/管理）。 */
export async function execute(
  sessionId: string,
  sql: string,
  options: DbCallOptions = {},
): Promise<RowBatch> {
  const payload: { sessionId: string; sql: string; maxRows?: number } = { sessionId, sql };
  if (options.maxRows !== undefined) payload.maxRows = options.maxRows;
  return (await navopNative().Db.execute(payload)) as RowBatch;
}

/** 列连接下的数据库（给会话句柄或连接）。 */
export async function listDatabases(source: string | DbSource): Promise<string[]> {
  const options = typeof source === "string" ? { sessionId: source } : source;
  const answer = await navopNative().Db.listDatabases(options);
  return (answer?.databases ?? []) as string[];
}

/** 列数据库里的 schema（给会话句柄或连接）。 */
export async function listSchemas(
  source: string | DbSource,
  database?: string,
): Promise<string[]> {
  const options: DbSource & { database: string } =
    typeof source === "string"
      ? { sessionId: source, database: database ?? "" }
      : { ...source, database: source.database ?? database ?? "" };
  if (options.database === "") {
    throw new Error("listSchemas 需要 database");
  }
  const answer = await navopNative().Db.listSchemas(options);
  return (answer?.schemas ?? []) as string[];
}

/** 库里的表与视图（只读元数据，需要 `db:schema:<conn>`）。 */
export async function listTables(source: string | DbSource): Promise<DbTable[]> {
  const options = typeof source === "string" ? { sessionId: source } : source;
  const answer = await navopNative().Db.listTables(options);
  return (answer?.tables ?? []) as DbTable[];
}

/**
 * 描述一张表：列、索引、外键一次取全。
 *
 * 元数据在宿主侧一个会话里取，页面不用先 openSession 再逐项查。
 */
export async function describeTable(
  source: string | DbSource,
  table: string,
): Promise<DbTableDescription> {
  const options = typeof source === "string" ? { sessionId: source, table } : { ...source, table };
  return (await navopNative().Db.describeTable(options)) as DbTableDescription;
}

/** 库里的函数/过程。 */
export async function listFunctions(source: string | DbSource): Promise<DbFunction[]> {
  const options = typeof source === "string" ? { sessionId: source } : source;
  const answer = await navopNative().Db.listFunctions(options);
  return (answer?.functions ?? []) as DbFunction[];
}

/** 关会话（幂等：句柄不存在也算成功）。 */
export async function closeSession(sessionId: string): Promise<void> {
  await navopNative().Db.closeSession({ sessionId });
}

/**
 * 请求宿主刷新已打开的数据库树（当前窗口里活着的树）。
 *
 * 返回实际刷新的连接根节点数量：0 表示树没打开（或该连接不在树上），
 * 宿主不会假装成功。
 */
export async function refreshTree(connectionId?: number | string): Promise<number> {
  const options: { connectionId?: number | string } = {};
  if (connectionId !== undefined) options.connectionId = connectionId;
  const result = await navopNative().Db.refreshTree(options);
  return typeof result?.refreshed === "number" ? result.refreshed : 0;
}
