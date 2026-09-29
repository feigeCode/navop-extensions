package com.navop.gbase8a.server;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.navop.gbase8a.db.JdbcQueryRunner;
import com.navop.gbase8a.db.QueryResult;
import com.navop.gbase8a.jdbc.GBase8aConfig;
import com.navop.gbase8a.schema.GBase8aSchemaSql;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class GBase8aIpcServer {
    private static final String DRIVER_ID = "gbase8a";

    private final ObjectMapper mapper = new ObjectMapper();
    private final JdbcConnectionFactory connectionFactory;
    private final JdbcQueryRunner queryRunner = new JdbcQueryRunner();
    private final Map<Long, ConnectionState> connections = new LinkedHashMap<Long, ConnectionState>();
    private final Map<String, CursorState> cursors = new LinkedHashMap<String, CursorState>();
    private final Map<String, TxState> transactions = new LinkedHashMap<String, TxState>();
    private final Map<String, ImportState> imports = new LinkedHashMap<String, ImportState>();
    private final Map<String, StreamState> streams = new LinkedHashMap<String, StreamState>();
    private boolean initialized;
    private long nextConnId = 1L;
    private long nextCursorId = 1L;
    private long nextTxId = 1L;
    private long nextImportId = 1L;

    public GBase8aIpcServer(JdbcConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }

    public synchronized JsonNode handle(JsonNode request) {
        JsonNode id = request == null ? JsonNodeFactory.instance.nullNode() : request.path("id");
        try {
            if (request == null || !request.isObject()) {
                return error(id, ProtocolError.INVALID_REQUEST, "request must be a JSON object");
            }
            JsonNode version = request.get("jsonrpc");
            if (version != null && !"2.0".equals(version.asText())) {
                return error(id, ProtocolError.INVALID_REQUEST, "jsonrpc must be 2.0");
            }
            String method = request.path("method").asText("");
            JsonNode params = request.path("params");
            if (requiresInit(method) && !initialized) {
                return error(id, ProtocolError.NOT_INITIALIZED, "init must be called first");
            }
            return dispatch(id, method, params);
        } catch (IllegalArgumentException error) {
            return error(id, ProtocolError.INVALID_PARAMS, error.getMessage());
        } catch (SQLException error) {
            return sqlError(id, ProtocolError.SQL_SYNTAX, error);
        } catch (Exception error) {
            return error(id, ProtocolError.INTERNAL_ERROR, error.getMessage());
        }
    }

    private JsonNode dispatch(JsonNode id, String method, JsonNode params) throws Exception {
        if ("init".equals(method)) {
            String incompatibility = HostVersion.incompatibility(params.path("host_version").asText(null));
            if (incompatibility != null) {
                return error(id, ProtocolError.SERVER_INCOMPATIBLE, incompatibility);
            }
            initialized = true;
            return ok(id, initResult());
        }
        if ("$/ping".equals(method)) {
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("pong", Boolean.TRUE);
            return ok(id, result);
        }
        if ("shutdown".equals(method)) {
            closeAll();
            return ok(id, null);
        }
        if ("conn/test".equals(method)) {
            return handleConnTest(id, params);
        }
        if ("conn/open".equals(method)) {
            return handleConnOpen(id, params);
        }
        if ("conn/close".equals(method)) {
            return handleConnClose(id, params);
        }
        if ("conn/ping".equals(method)) {
            return handleConnPing(id, params);
        }
        if ("conn/use".equals(method)) {
            return handleConnUse(id, params);
        }
        if ("schema/databases".equals(method)) {
            return handleSchemaDatabases(id, params);
        }
        if ("schema/schemas".equals(method)) {
            return handleSchemaSchemas(id, params);
        }
        if ("schema/objects".equals(method)) {
            return handleSchemaObjects(id, params);
        }
        if ("schema/object_view".equals(method)) {
            return handleSchemaObjectView(id, params);
        }
        if ("schema/columns".equals(method)) {
            return handleSchemaColumns(id, params);
        }
        if ("schema/indexes".equals(method)) {
            return handleSchemaIndexes(id, params);
        }
        if ("schema/foreign_keys".equals(method)) {
            return handleSchemaForeignKeys(id, params);
        }
        if ("schema/checks".equals(method)) {
            return handleSchemaChecks(id, params);
        }
        if ("schema/views".equals(method)) {
            return handleSchemaViews(id, params);
        }
        if ("schema/functions".equals(method)) {
            return handleSchemaFunctions(id, params);
        }
        if ("schema/procedures".equals(method)) {
            return handleSchemaProcedures(id, params);
        }
        if ("query/start".equals(method)) {
            return handleQueryStart(id, params);
        }
        if ("cursor/fetch".equals(method)) {
            return handleCursorFetch(id, params);
        }
        if ("cursor/close".equals(method)) {
            return handleCursorClose(id, params);
        }
        if ("cursor/cancel".equals(method)) {
            return handleCursorCancel(id, params);
        }
        if ("exec/run".equals(method)) {
            return handleExecRun(id, params);
        }
        if ("exec/batch".equals(method)) {
            return handleExecBatch(id, params);
        }
        if ("tx/begin".equals(method)) {
            return handleTxBegin(id, params);
        }
        if ("tx/commit".equals(method)) {
            return handleTxCommit(id, params);
        }
        if ("tx/rollback".equals(method)) {
            return handleTxRollback(id, params);
        }
        if ("tx/savepoint".equals(method)) {
            return handleTxSavepoint(id, params);
        }
        if ("tx/release".equals(method)) {
            return handleTxRelease(id, params);
        }
        if ("ddl/build".equals(method)) {
            return handleDdlBuild(id, params);
        }
        if ("ddl/build_create_table".equals(method)) {
            return handleDdlBuildCreateTable(id, params);
        }
        if ("ddl/build_alter_table".equals(method)) {
            return handleDdlBuildAlterTable(id, params);
        }
        if ("ddl/build_drop".equals(method)) {
            return handleDdlBuildDrop(id, params);
        }
        if ("data/export".equals(method)) {
            return handleDataExport(id, params);
        }
        if ("data/import_begin".equals(method)) {
            return handleDataImportBegin(id, params);
        }
        if ("data/import_chunk".equals(method)) {
            return handleDataImportChunk(id, params);
        }
        if ("data/import_commit".equals(method)) {
            return handleDataImportCommit(id, params);
        }
        if ("data/import_abort".equals(method)) {
            return handleDataImportAbort(id, params);
        }
        if ("stream/read".equals(method)) {
            return handleStreamRead(id, params);
        }
        if ("stream/close".equals(method)) {
            return handleStreamClose(id, params);
        }
        if ("schema/triggers".equals(method) || "schema/sequences".equals(method) || "schema/types".equals(method)) {
            return ok(id, new ArrayList<Map<String, Object>>());
        }
        if ("schema/view_definition".equals(method)) {
            return handleSchemaViewDefinition(id, params);
        }
        if ("schema/dump_ddl".equals(method)) {
            return handleSchemaDumpDdl(id, params);
        }
        return error(id, ProtocolError.METHOD_NOT_FOUND, "method `" + method + "` is not implemented");
    }

    private boolean requiresInit(String method) {
        return !"init".equals(method) && !"shutdown".equals(method) && !"$/ping".equals(method);
    }

    private Map<String, Object> initResult() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        Map<String, String> api = new LinkedHashMap<String, String>();
        api.put("database", "1.0");
        List<String> features = new ArrayList<String>();
        features.add("streaming");
        features.add("schema_introspection");
        features.add("rich_errors");
        List<String> drivers = new ArrayList<String>();
        drivers.add(DRIVER_ID);
        List<String> methods = new ArrayList<String>();
        String[] methodNames = new String[]{
            "$/ping", "shutdown", "conn/test", "conn/open", "conn/close", "conn/ping", "conn/use",
            "query/start", "cursor/fetch", "cursor/close", "cursor/cancel", "exec/run", "exec/batch",
            "tx/begin", "tx/commit", "tx/rollback", "tx/savepoint", "tx/release",
            "ddl/build", "ddl/build_create_table", "ddl/build_alter_table", "ddl/build_drop",
            "data/export", "data/import_begin", "data/import_chunk", "data/import_commit", "data/import_abort",
            "stream/read", "stream/close", "schema/object_view", "schema/databases", "schema/schemas", "schema/objects",
            "schema/columns", "schema/indexes", "schema/foreign_keys", "schema/checks", "schema/views",
            "schema/functions", "schema/procedures", "schema/triggers", "schema/sequences", "schema/types",
            "schema/view_definition", "schema/dump_ddl"
        };
        for (String method : methodNames) {
            methods.add(method);
        }
        result.put("extension_version", "0.1.0");
        result.put("api_used", api);
        result.put("features", features);
        result.put("drivers_ready", drivers);
        result.put("methods", methods);
        result.put("name", "GBase 8a IPC Driver");
        return result;
    }

    private JsonNode handleConnTest(JsonNode id, JsonNode params) throws Exception {
        GBase8aConfig config = parseConfig(params);
        long start = System.currentTimeMillis();
        Connection connection = connectionFactory.open(config);
        try {
            connection.isValid(5);
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("ok", Boolean.TRUE);
            result.put("server_version", serverVersion(connection));
            result.put("warnings", new ArrayList<String>());
            result.put("latency_ms", Long.valueOf(System.currentTimeMillis() - start));
            return ok(id, result);
        } finally {
            connection.close();
        }
    }

    /**
     * Reports the banner the JDBC driver negotiated. The GBase 8a build string
     * is far more useful in the connection tooltip than a hardcoded product
     * name, so it is read from {@link DatabaseMetaData} and only falls back to
     * the plain product name when the server does not answer.
     */
    private String serverVersion(Connection connection) {
        try {
            String version = connection.getMetaData().getDatabaseProductVersion();
            if (version != null && !version.trim().isEmpty()) {
                return "GBase 8a " + version.trim();
            }
        } catch (SQLException ignored) {
            // Cosmetic only; fall through to the product name.
        }
        return "GBase 8a";
    }

    private JsonNode handleConnOpen(JsonNode id, JsonNode params) throws Exception {
        GBase8aConfig config = parseConfig(params);
        Connection connection = connectionFactory.open(config);
        connection.isValid(5);
        long connId = nextConnId++;
        connections.put(Long.valueOf(connId), new ConnectionState(config, connection));

        Map<String, Object> serverInfo = new LinkedHashMap<String, Object>();
        List<String> features = new ArrayList<String>();
        features.add("database_sql");
        serverInfo.put("version", serverVersion(connection));
        serverInfo.put("features", features);

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("conn_id", Long.valueOf(connId));
        result.put("server_info", serverInfo);
        return ok(id, result);
    }

    private JsonNode handleConnClose(JsonNode id, JsonNode params) throws SQLException {
        long connId = requiredLong(params, "conn_id");
        ConnectionState state = connections.remove(Long.valueOf(connId));
        if (state == null) {
            return error(id, ProtocolError.UNKNOWN_CONN_ID, "unknown conn_id " + connId);
        }
        closeTransactionsForConn(connId);
        closeImportsForConn(connId);
        state.connection.close();
        return ok(id, null);
    }

    private JsonNode handleConnPing(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        long start = System.currentTimeMillis();
        state.connection.isValid(5);
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("latency_ms", Long.valueOf(System.currentTimeMillis() - start));
        return ok(id, result);
    }

    private JsonNode handleConnUse(JsonNode id, JsonNode params) {
        long connId = requiredLong(params, "conn_id");
        if (!connections.containsKey(Long.valueOf(connId))) {
            return error(id, ProtocolError.UNKNOWN_CONN_ID, "unknown conn_id " + connId);
        }
        return ok(id, null);
    }

    private JsonNode handleSchemaDatabases(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        QueryResult query = queryRunner.queryBufferedStatement(state.connection, GBase8aSchemaSql.databasesSql(), null);
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            Map<String, Object> database = new LinkedHashMap<String, Object>();
            database.put("name", rowString(row, 0));
            database.put("charset", null);
            database.put("collation", null);
            database.put("comment", "");
            database.put("owner", null);
            database.put("size_bytes", null);
            database.put("extra", new LinkedHashMap<String, Object>());
            result.add(database);
        }
        return ok(id, result);
    }

    private JsonNode handleSchemaSchemas(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        QueryResult query = queryRunner.queryBuffered(state.connection, GBase8aSchemaSql.schemasSql(database), null, null);
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            Map<String, Object> schema = new LinkedHashMap<String, Object>();
            schema.put("name", rowString(row, 0));
            schema.put("owner", rowString(row, 1));
            schema.put("comment", "");
            result.add(schema);
        }
        return ok(id, result);
    }

    private JsonNode handleSchemaObjects(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        List<String> kinds = readStringArray(params.path("kinds"));
        QueryResult query = queryRunner.queryBuffered(
            state.connection,
            GBase8aSchemaSql.objectsSql(database, schema, kinds),
            null,
            null
        );
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            String kind = rowString(row, 1);
            if (!kinds.isEmpty() && !kinds.contains(kind)) {
                continue;
            }
            Map<String, Object> object = new LinkedHashMap<String, Object>();
            object.put("database", database);
            object.put("schema", schema);
            object.put("name", rowString(row, 0));
            object.put("kind", kind);
            object.put("comment", rowString(row, 2));
            object.put("row_count_estimate", null);
            object.put("size_bytes", null);
            object.put("created_at", null);
            object.put("updated_at", null);
            object.put("extra", new LinkedHashMap<String, Object>());
            result.add(object);
        }
        return ok(id, result);
    }

    private JsonNode handleSchemaColumns(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        String table = requiredText(params, "table");
        List<Map<String, Object>> result = readColumns(state.connection, database, schema, table);
        return ok(id, result);
    }

    /**
     * GBase 8a's {@code information_schema.COLUMNS} already reports the full
     * type text, nullability, default, comment and auto-increment flag, so this
     * maps the row straight onto the host column contract instead of rebuilding
     * a type from a numeric type code.
     */
    private List<Map<String, Object>> readColumns(Connection connection, String database, String schema, String table) throws SQLException {
        List<String> primaryColumns = primaryKeyColumns(connection, database, schema, table);
        QueryResult query = queryRunner.queryBuffered(
            connection,
            GBase8aSchemaSql.columnsSql(database, schema, table),
            null,
            null
        );
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            String name = rowString(row, GBase8aSchemaSql.ColumnIndex.NAME);
            String rawType = rowString(row, GBase8aSchemaSql.ColumnIndex.COLUMN_TYPE);
            String columnKey = rowString(row, GBase8aSchemaSql.ColumnIndex.KEY);
            String extraText = rowString(row, GBase8aSchemaSql.ColumnIndex.EXTRA);

            Map<String, Object> extra = new LinkedHashMap<String, Object>();
            if (!columnKey.isEmpty()) {
                extra.put("key", columnKey);
            }
            if (!extraText.isEmpty()) {
                extra.put("extra", extraText);
            }

            Map<String, Object> column = new LinkedHashMap<String, Object>();
            column.put("ordinal", Integer.valueOf(rowInt(row, GBase8aSchemaSql.ColumnIndex.ORDINAL)));
            column.put("name", name);
            column.put("type", rawType);
            column.put("raw_type", rawType);
            column.put("nullable", Boolean.valueOf(nullable(rowString(row, GBase8aSchemaSql.ColumnIndex.NULLABLE))));
            column.put("default", columnDefault(rowValue(row, GBase8aSchemaSql.ColumnIndex.DEFAULT)));
            column.put("is_primary", Boolean.valueOf(primaryColumns.contains(name)));
            column.put("is_unique", Boolean.valueOf("UNI".equalsIgnoreCase(columnKey)));
            column.put("is_partition_key", Boolean.FALSE);
            column.put("is_clustering_key", Boolean.FALSE);
            column.put("max_length", nullableLong(rowValue(row, GBase8aSchemaSql.ColumnIndex.MAX_LENGTH)));
            column.put("precision", nullableLong(rowValue(row, GBase8aSchemaSql.ColumnIndex.PRECISION)));
            column.put("scale", nullableLong(rowValue(row, GBase8aSchemaSql.ColumnIndex.SCALE)));
            column.put("comment", rowString(row, GBase8aSchemaSql.ColumnIndex.COMMENT));
            column.put("extra", extra);
            result.add(column);
        }
        return result;
    }

    private JsonNode handleSchemaDumpDdl(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        JsonNode objects = params.get("objects");
        if (objects == null || !objects.isArray()) {
            return ok(id, emptyDumpResult());
        }
        // The host sends every export target as an object ref. Only tables have
        // a usable DDL dump; views/sequences/etc. fall through to the host's
        // shared builders.
        String database = "";
        String schema = "";
        String table = "";
        for (JsonNode object : objects) {
            String kind = textOrEmpty(object.get("kind"));
            if (!isTableKind(kind)) {
                continue;
            }
            database = optionalText(object, "database", state.config.getDatabase());
            schema = optionalText(object, "schema", "");
            table = textOrEmpty(object.get("name"));
            break;
        }
        if (table.isEmpty()) {
            return ok(id, emptyDumpResult());
        }
        // SHOW CREATE TABLE is the authoritative DDL source on GBase 8a: it
        // reproduces the exact column types, defaults, inline comments and
        // secondary indexes the server holds. When it yields nothing — the
        // current user has no privilege on the table — the structure is
        // rebuilt from information_schema instead.
        List<String> statements = showCreateTable(state.connection, database, schema, table);
        if (statements.isEmpty()) {
            statements = buildTableDdl(state.connection, database, schema, table);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("statements", statements);
        return ok(id, result);
    }

    /**
     * Runs {@code SHOW CREATE TABLE} and returns the statement the server
     * produced. GBase 8a returns {@code (Table, Create Table)}, so the DDL sits
     * in the second column. An empty list means the server had no DDL to give,
     * and the caller falls back to rebuilding it from the catalogs.
     */
    private List<String> showCreateTable(Connection connection, String database, String schema, String table) {
        List<String> statements = new ArrayList<String>();
        try {
            QueryResult query = queryRunner.queryBufferedStatement(
                connection,
                GBase8aSchemaSql.dumpDdlSql(database, schema, table),
                null
            );
            for (List<Map<String, Object>> row : query.getRows()) {
                String ddl = ddlFromShowCreateTable(row);
                if (!ddl.isEmpty()) {
                    statements.add(ddl);
                }
            }
        } catch (SQLException error) {
            return new ArrayList<String>();
        }
        return statements;
    }

    /**
     * Locates the DDL inside a {@code SHOW CREATE TABLE} row. Searching for the
     * {@code CREATE} statement rather than trusting a fixed offset keeps the
     * reader working for views, whose result set has extra trailing columns.
     *
     * <p>{@code SHOW CREATE TABLE} returns a single unterminated statement, so
     * the text is emitted as-is: the host joins dump statements with newlines
     * and appends one trailing terminator.</p>
     */
    private String ddlFromShowCreateTable(List<Map<String, Object>> row) {
        for (int i = 0; i < row.size(); i++) {
            String value = rowString(row, i);
            if (value.toLowerCase(java.util.Locale.ROOT).startsWith("create ")) {
                return value;
            }
        }
        return row.size() > 1 ? rowString(row, 1) : "";
    }

    /**
     * Rebuilds a table's DDL from {@code information_schema} when
     * {@code SHOW CREATE TABLE} yields nothing: column types, NOT NULL,
     * PRIMARY KEY, table and column comments, and secondary indexes. Column
     * comments are inlined the way GBase 8a expects — {@code COMMENT ON} is not
     * part of its SQL dialect. Every statement is terminated with {@code ;}
     * because the host only appends one trailing terminator to the whole dump.
     */
    private List<String> buildTableDdl(Connection connection, String database, String schema, String table) {
        List<Map<String, Object>> columns;
        try {
            columns = readColumns(connection, database, schema, table);
        } catch (SQLException error) {
            return new ArrayList<String>();
        }
        if (columns.isEmpty()) {
            return new ArrayList<String>();
        }
        String tableName = qualifiedIdentifier("", schema, table);
        List<String> definitions = new ArrayList<String>();
        List<String> primary = new ArrayList<String>();
        for (Map<String, Object> column : columns) {
            definitions.add(dumpColumnDefinition(column));
            if (Boolean.TRUE.equals(column.get("is_primary"))) {
                primary.add(quote(String.valueOf(column.get("name"))));
            }
        }
        if (!primary.isEmpty()) {
            definitions.add("PRIMARY KEY (" + join(primary, ", ") + ")");
        }
        StringBuilder create = new StringBuilder("CREATE TABLE ")
            .append(tableName)
            .append(" (").append(join(definitions, ", ")).append(')');
        String tableComment = readTableComment(connection, database, schema, table);
        if (!tableComment.isEmpty()) {
            create.append(" COMMENT = '").append(sqlString(tableComment)).append('\'');
        }
        List<String> statements = new ArrayList<String>();
        statements.add(create.toString() + ";");
        for (Map<String, Object> index : readIndexes(connection, database, schema, table)) {
            if (Boolean.TRUE.equals(index.get("is_primary"))) {
                continue;
            }
            statements.add(indexStatement(schema, table, index) + ";");
        }
        return statements;
    }

    /**
     * Column comment travels inline, as GBase 8a stores it. Keeping it inside
     * the definition means {@code ALTER TABLE ... MODIFY COLUMN} carries the
     * comment along with the type, which is the only way MySQL-compatible
     * servers let a column comment change.
     */
    private static String dumpColumnDefinition(Map<String, Object> column) {
        String rawType = String.valueOf(column.get("raw_type"));
        StringBuilder definition = new StringBuilder();
        definition.append(quote(String.valueOf(column.get("name")))).append(' ').append(rawType);
        if (Boolean.FALSE.equals(column.get("nullable"))) {
            definition.append(" NOT NULL");
        }
        String defaultValue = literalDefault(rawType, String.valueOf(column.get("default")));
        if (defaultValue != null) {
            definition.append(" DEFAULT ").append(defaultValue);
        }
        String comment = String.valueOf(column.get("comment"));
        if (comment != null && !comment.isEmpty() && !"null".equals(comment)) {
            definition.append(" COMMENT '").append(sqlString(comment)).append('\'');
        }
        return definition.toString();
    }

    /**
     * Re-renders a default value as a SQL literal.
     *
     * <p>MySQL-compatible servers report {@code COLUMN_DEFAULT} for a string
     * column without the surrounding quotes ({@code guest}, not
     * {@code 'guest'}), so replaying the value verbatim produces a definition
     * that fails to parse. Numeric types and the expressions the server stores
     * pre-rendered ({@code CURRENT_TIMESTAMP}, {@code b'0'}) pass through
     * unchanged.</p>
     */
    private static String literalDefault(String type, String value) {
        if (value == null) {
            return null;
        }
        String text = value.trim();
        if (text.isEmpty() || "null".equalsIgnoreCase(text)) {
            return null;
        }
        if (isNumericType(type) || isPreRenderedDefault(text)) {
            return text;
        }
        return "'" + sqlString(text) + "'";
    }

    private static boolean isNumericType(String type) {
        String normalized = type == null ? "" : type.trim().toLowerCase(java.util.Locale.ROOT);
        String[] markers = {"int", "decimal", "numeric", "fixed", "float", "double", "real", "bit", "year"};
        for (String marker : markers) {
            if (normalized.contains(marker)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isPreRenderedDefault(String value) {
        String upper = value.toUpperCase(java.util.Locale.ROOT);
        if (upper.startsWith("CURRENT_TIMESTAMP") || upper.startsWith("CURRENT_DATE")
            || upper.startsWith("CURRENT_TIME") || upper.startsWith("LOCALTIME")
            || upper.startsWith("LOCALTIMESTAMP") || upper.startsWith("NOW(")) {
            return true;
        }
        if (upper.startsWith("B'") || upper.startsWith("X'") || upper.startsWith("(")) {
            return true;
        }
        try {
            new java.math.BigDecimal(value);
            return true;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private String readTableComment(Connection connection, String database, String schema, String table) {
        try {
            QueryResult query = queryRunner.queryBuffered(
                connection,
                GBase8aSchemaSql.tablesSql(database, schema),
                null,
                null
            );
            for (List<Map<String, Object>> row : query.getRows()) {
                if (table.equals(rowString(row, 0))) {
                    return rowString(row, 2);
                }
            }
        } catch (SQLException error) {
            // Table comments are best-effort; the export still carries the
            // column structure and column comments.
        }
        return "";
    }

    private String indexStatement(String schema, String table, Map<String, Object> index) {
        StringBuilder sql = new StringBuilder("CREATE ");
        if (Boolean.TRUE.equals(index.get("is_unique"))) {
            sql.append("UNIQUE ");
        }
        sql.append("INDEX ").append(quote(String.valueOf(index.get("name"))))
            .append(" ON ").append(qualifiedIdentifier("", schema, table))
            .append(" (").append(quoteList(stringList(index.get("columns")))).append(")");
        return sql.toString();
    }

    private boolean isTableKind(String kind) {
        return "table".equals(kind) || "base_table".equals(kind);
    }

    private Map<String, Object> emptyDumpResult() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("statements", new ArrayList<String>());
        return result;
    }

    private JsonNode handleSchemaIndexes(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        String table = requiredText(params, "table");
        List<Map<String, Object>> result = readIndexes(state.connection, database, schema, table);
        return ok(id, result);
    }

    private JsonNode handleSchemaForeignKeys(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        String table = requiredText(params, "table");
        QueryResult query = queryRunner.queryBuffered(
            state.connection,
            GBase8aSchemaSql.foreignKeysSql(database, schema, table),
            null,
            null
        );
        Map<String, Map<String, Object>> foreignKeys = new LinkedHashMap<String, Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            String name = rowString(row, 0);
            if (name.isEmpty()) {
                continue;
            }
            Map<String, Object> foreignKey = foreignKeys.get(name);
            if (foreignKey == null) {
                foreignKey = new LinkedHashMap<String, Object>();
                foreignKey.put("database", database);
                foreignKey.put("schema", schema);
                foreignKey.put("name", name);
                foreignKey.put("from_table", rowString(row, 1));
                foreignKey.put("from_columns", new ArrayList<String>());
                foreignKey.put("to_table", rowString(row, 3));
                foreignKey.put("to_columns", new ArrayList<String>());
                foreignKey.put("on_update", referentialAction(rowString(row, 5)));
                foreignKey.put("on_delete", referentialAction(rowString(row, 6)));
                foreignKey.put("comment", "");
                foreignKey.put("extra", new LinkedHashMap<String, Object>());
                foreignKeys.put(name, foreignKey);
            }
            addUniqueString(foreignKey.get("from_columns"), rowString(row, 2));
            addUniqueString(foreignKey.get("to_columns"), rowString(row, 4));
        }
        return ok(id, new ArrayList<Map<String, Object>>(foreignKeys.values()));
    }

    /**
     * Reads a view's definition on demand. GBase 8a keeps it in
     * {@code information_schema.VIEWS}; a view the current user may not inspect
     * comes back with an empty definition rather than an error, so the tree
     * keeps listing it.
     */
    private JsonNode handleSchemaViewDefinition(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        String view = requiredText(params, "view");
        String sql = "";
        QueryResult query = queryRunner.queryBuffered(
            state.connection,
            GBase8aSchemaSql.viewDefinitionSql(database, schema, view),
            null,
            null
        );
        if (!query.getRows().isEmpty()) {
            sql = rowString(query.getRows().get(0), 0);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sql", sql);
        result.put("is_materialized", Boolean.FALSE);
        return ok(id, result);
    }

    /**
     * GBase 8a exposes no {@code CHECK} constraint catalog, so the answer is an
     * honest empty list rather than a query that can never return rows. The
     * method stays routed because {@code driver.json} declares it, and the
     * connection is still validated so an unknown {@code conn_id} fails loudly.
     */
    private JsonNode handleSchemaChecks(JsonNode id, JsonNode params) {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        return ok(id, new ArrayList<Map<String, Object>>());
    }

    private JsonNode handleSchemaViews(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        QueryResult query = queryRunner.queryBuffered(
            state.connection,
            GBase8aSchemaSql.viewsSql(database, schema),
            null,
            null
        );
        List<Map<String, Object>> result = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            Map<String, Object> view = new LinkedHashMap<String, Object>();
            view.put("database", database);
            view.put("schema", schema);
            view.put("name", rowString(row, 0));
            view.put("kind", rowString(row, 1));
            view.put("definition_sql", "");
            view.put("comment", rowString(row, 2));
            view.put("extra", new LinkedHashMap<String, Object>());
            result.add(view);
        }
        return ok(id, result);
    }

    private JsonNode handleSchemaFunctions(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        List<Map<String, Object>> result = readRoutines(
            state.connection,
            database,
            schema,
            GBase8aSchemaSql.functionsSql(database, schema),
            true
        );
        return ok(id, result);
    }

    private JsonNode handleSchemaProcedures(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        List<Map<String, Object>> result = readRoutines(
            state.connection,
            database,
            schema,
            GBase8aSchemaSql.proceduresSql(database, schema),
            false
        );
        return ok(id, result);
    }

    private JsonNode handleSchemaObjectView(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String view = requiredText(params, "view");
        String database = optionalText(params, "database", state.config.getDatabase());
        String schema = optionalText(params, "schema", "");
        if ("databases".equals(view)) {
            QueryResult query = queryRunner.queryBufferedStatement(state.connection, GBase8aSchemaSql.databasesSql(), null);
            List<List<String>> rows = new ArrayList<List<String>>();
            for (List<Map<String, Object>> row : query.getRows()) {
                rows.add(rowValues(rowString(row, 0)));
            }
            return ok(id, objectView("Databases", objectViewColumns("name", "Name"), rows));
        }
        if ("schemas".equals(view)) {
            QueryResult query = queryRunner.queryBuffered(state.connection, GBase8aSchemaSql.schemasSql(database), null, null);
            List<List<String>> rows = new ArrayList<List<String>>();
            for (List<Map<String, Object>> row : query.getRows()) {
                rows.add(rowValues(rowString(row, 0), rowString(row, 1)));
            }
            return ok(id, objectView("Schemas", objectViewColumns("name", "Name", "owner", "Owner"), rows));
        }
        if ("tables".equals(view)) {
            QueryResult query = queryRunner.queryBuffered(
                state.connection,
                GBase8aSchemaSql.objectsSql(database, schema, java.util.Collections.singletonList("table")),
                null,
                null
            );
            List<List<String>> rows = new ArrayList<List<String>>();
            for (List<Map<String, Object>> row : query.getRows()) {
                rows.add(rowValues(rowString(row, 0), rowString(row, 1), rowString(row, 2)));
            }
            return ok(id, objectView("Tables", objectViewColumns("name", "Name", "kind", "Kind", "comment", "Comment"), rows));
        }
        if ("views".equals(view)) {
            QueryResult query = queryRunner.queryBuffered(state.connection, GBase8aSchemaSql.viewsSql(database, schema), null, null);
            List<List<String>> rows = new ArrayList<List<String>>();
            for (List<Map<String, Object>> row : query.getRows()) {
                rows.add(rowValues(rowString(row, 0), rowString(row, 1), rowString(row, 2)));
            }
            return ok(id, objectView("Views", objectViewColumns("name", "Name", "kind", "Kind", "comment", "Comment"), rows));
        }
        if ("columns".equals(view)) {
            String table = requiredText(params, "table");
            QueryResult query = queryRunner.queryBuffered(
                state.connection,
                GBase8aSchemaSql.columnsSql(database, schema, table),
                null,
                null
            );
            List<List<String>> rows = new ArrayList<List<String>>();
            for (List<Map<String, Object>> row : query.getRows()) {
                rows.add(rowValues(
                    rowString(row, GBase8aSchemaSql.ColumnIndex.NAME),
                    rowString(row, GBase8aSchemaSql.ColumnIndex.COLUMN_TYPE),
                    Boolean.toString(nullable(rowString(row, GBase8aSchemaSql.ColumnIndex.NULLABLE))),
                    emptyIfNull(columnDefault(rowValue(row, GBase8aSchemaSql.ColumnIndex.DEFAULT))),
                    rowString(row, GBase8aSchemaSql.ColumnIndex.COMMENT)
                ));
            }
            return ok(id, objectView("Columns", columnObjectViewColumns(), rows));
        }
        if ("indexes".equals(view)) {
            String table = requiredText(params, "table");
            List<List<String>> rows = new ArrayList<List<String>>();
            for (Map<String, Object> index : readIndexes(state.connection, database, schema, table)) {
                rows.add(rowValues(
                    String.valueOf(index.get("name")),
                    join(stringList(index.get("columns")), ", "),
                    String.valueOf(index.get("is_unique")),
                    String.valueOf(index.get("is_primary")),
                    String.valueOf(index.get("type"))
                ));
            }
            return ok(id, objectView("Indexes", indexObjectViewColumns(), rows));
        }
        if ("functions".equals(view)) {
            List<List<String>> rows = new ArrayList<List<String>>();
            for (Map<String, Object> function : readRoutines(
                state.connection,
                database,
                schema,
                GBase8aSchemaSql.functionsSql(database, schema),
                true
            )) {
                rows.add(rowValues(
                    String.valueOf(function.get("name")),
                    String.valueOf(function.get("returns")),
                    String.valueOf(function.get("language")),
                    String.valueOf(function.get("comment"))
                ));
            }
            return ok(id, objectView("Functions", objectViewColumns("name", "Name", "returns", "Returns", "language", "Language", "comment", "Comment"), rows));
        }
        if ("procedures".equals(view)) {
            List<List<String>> rows = new ArrayList<List<String>>();
            for (Map<String, Object> procedure : readRoutines(
                state.connection,
                database,
                schema,
                GBase8aSchemaSql.proceduresSql(database, schema),
                false
            )) {
                rows.add(rowValues(
                    String.valueOf(procedure.get("name")),
                    String.valueOf(procedure.get("language")),
                    String.valueOf(procedure.get("comment"))
                ));
            }
            return ok(id, objectView("Procedures", objectViewColumns("name", "Name", "language", "Language", "comment", "Comment"), rows));
        }
        if ("triggers".equals(view) || "sequences".equals(view)) {
            return ok(id, objectView(titleForObjectView(view), objectViewColumns("name", "Name"), new ArrayList<List<String>>()));
        }
        return error(id, ProtocolError.NOT_SUPPORTED, "unsupported object view: " + view);
    }

    private Map<String, Object> objectView(String title, List<Map<String, Object>> columns, List<List<String>> rows) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("title", title);
        result.put("columns", columns);
        result.put("rows", rows);
        return result;
    }

    private List<Map<String, Object>> columnObjectViewColumns() {
        List<Map<String, Object>> columns = new ArrayList<Map<String, Object>>();
        columns.add(objectViewColumn("name", "Field", 220, ""));
        columns.add(objectViewColumn("type", "Type", 160, ""));
        columns.add(objectViewColumn("nullable", "Null?", 72, "right"));
        columns.add(objectViewColumn("default", "Default", 180, ""));
        columns.add(objectViewColumn("comment", "Comment", 260, ""));
        return columns;
    }

    private List<Map<String, Object>> indexObjectViewColumns() {
        List<Map<String, Object>> columns = new ArrayList<Map<String, Object>>();
        columns.add(objectViewColumn("name", "Name", 220, ""));
        columns.add(objectViewColumn("columns", "Columns", 220, ""));
        columns.add(objectViewColumn("unique", "Unique?", 90, "right"));
        columns.add(objectViewColumn("primary", "Primary?", 90, "right"));
        columns.add(objectViewColumn("type", "Type", 140, ""));
        return columns;
    }

    private List<Map<String, Object>> objectViewColumns(String... values) {
        List<Map<String, Object>> columns = new ArrayList<Map<String, Object>>();
        for (int i = 0; i + 1 < values.length; i += 2) {
            int width = "name".equals(values[i]) ? 220 : 0;
            columns.add(objectViewColumn(values[i], values[i + 1], width, ""));
        }
        return columns;
    }

    private Map<String, Object> objectViewColumn(String key, String name, int width, String align) {
        Map<String, Object> column = new LinkedHashMap<String, Object>();
        column.put("key", key);
        column.put("name", name);
        if (width > 0) {
            column.put("width_px", Integer.valueOf(width));
        }
        if (align != null && align.length() > 0) {
            column.put("align", align);
        }
        return column;
    }

    private List<String> rowValues(String... values) {
        List<String> row = new ArrayList<String>();
        for (String value : values) {
            row.add(value == null ? "" : value);
        }
        return row;
    }

    private List<String> primaryKeyColumns(Connection connection, String database, String schema, String table) {
        List<String> columns = new ArrayList<String>();
        try {
            QueryResult query = queryRunner.queryBuffered(
                connection,
                GBase8aSchemaSql.primaryKeyColumnsSql(database, schema, table),
                null,
                null
            );
            for (List<Map<String, Object>> row : query.getRows()) {
                String column = rowString(row, 0);
                if (!column.isEmpty() && !columns.contains(column)) {
                    columns.add(column);
                }
            }
        } catch (SQLException error) {
            return new ArrayList<String>();
        }
        return columns;
    }

    @SuppressWarnings("unchecked")
    private List<String> stringList(Object value) {
        if (value instanceof List<?>) {
            List<String> out = new ArrayList<String>();
            for (Object item : (List<Object>) value) {
                out.add(String.valueOf(item));
            }
            return out;
        }
        return new ArrayList<String>();
    }

    @SuppressWarnings("unchecked")
    private void addUniqueString(Object target, String value) {
        if (!(target instanceof List<?>) || value == null || value.isEmpty()) {
            return;
        }
        List<String> list = (List<String>) target;
        if (!list.contains(value)) {
            list.add(value);
        }
    }

    private List<Map<String, Object>> readIndexes(Connection connection, String database, String schema, String table) {
        Map<String, Map<String, Object>> indexes = new LinkedHashMap<String, Map<String, Object>>();
        try {
            QueryResult query = queryRunner.queryBuffered(
                connection,
                GBase8aSchemaSql.indexesSql(database, schema, table),
                null,
                null
            );
            for (List<Map<String, Object>> row : query.getRows()) {
                String name = rowString(row, 0);
                if (name.isEmpty()) {
                    continue;
                }
                Map<String, Object> index = indexes.get(name);
                if (index == null) {
                    String constraintType = rowString(row, 2);
                    boolean primary = "P".equalsIgnoreCase(constraintType);
                    String type = rowString(row, 1);
                    index = new LinkedHashMap<String, Object>();
                    index.put("database", database);
                    index.put("schema", schema);
                    index.put("table", table);
                    index.put("name", name);
                    index.put("columns", new ArrayList<String>());
                    index.put("is_unique", Boolean.valueOf(primary || "U".equalsIgnoreCase(type)));
                    index.put("is_primary", Boolean.valueOf(primary));
                    index.put("constraint_type", constraintType);
                    index.put("type", primary ? "PRIMARY" : ("U".equalsIgnoreCase(type) ? "UNIQUE" : "INDEX"));
                    index.put("comment", "");
                    index.put("extra", new LinkedHashMap<String, Object>());
                    indexes.put(name, index);
                }
                String column = rowString(row, 3);
                if (!column.isEmpty()) {
                    List<String> columns = stringList(index.get("columns"));
                    if (!columns.contains(column)) {
                        columns.add(column);
                    }
                    index.put("columns", columns);
                }
            }
        } catch (SQLException error) {
            return new ArrayList<Map<String, Object>>();
        }
        return new ArrayList<Map<String, Object>>(indexes.values());
    }

    private List<Map<String, Object>> readRoutines(Connection connection, String database, String schema, String sql, boolean function) throws SQLException {
        QueryResult query = queryRunner.queryBuffered(connection, sql, null, null);
        Map<String, Map<String, Object>> routines = new LinkedHashMap<String, Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            String name = rowString(row, 0);
            if (name.isEmpty()) {
                continue;
            }
            String owner = rowString(row, 1);
            String key = owner + "." + name;
            Map<String, Object> routine = routines.get(key);
            if (routine == null) {
                // DTD_IDENTIFIER is already the full return type on
                // MySQL-compatible servers (for example `decimal(10,2)`).
                String returnType = function ? rowString(row, 2) : "";
                routine = new LinkedHashMap<String, Object>();
                routine.put("database", database);
                routine.put("schema", owner);
                routine.put("name", name);
                routine.put("return_type", returnType.isEmpty() ? null : returnType);
                routine.put("returns", returnType);
                routine.put("language", rowString(row, 3));
                routine.put("comment", rowString(row, 4));
                routine.put("definition", "");
                routine.put("extra", new LinkedHashMap<String, Object>());
                routines.put(key, routine);
            }
            String definition = String.valueOf(routine.get("definition"));
            routine.put("definition", definition + rowString(row, 5));
        }
        return new ArrayList<Map<String, Object>>(routines.values());
    }

    /**
     * GBase 8a reports referential actions as text ({@code CASCADE},
     * {@code SET NULL}, {@code RESTRICT}, {@code NO ACTION},
     * {@code SET DEFAULT}), so the value is normalized rather than decoded.
     */
    private String referentialAction(String value) {
        String action = value == null ? "" : value.trim().toUpperCase(java.util.Locale.ROOT);
        return action.isEmpty() ? "NO ACTION" : action;
    }

    private String titleForObjectView(String view) {
        if (view == null || view.length() == 0) {
            return "";
        }
        return view.substring(0, 1).toUpperCase() + view.substring(1);
    }

    private JsonNode handleQueryStart(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String txId = optionalText(params, "tx_id", "");
        if (!txId.isEmpty() && requireTransaction(id, txId, requiredLong(params, "conn_id")) == null) {
            return lastError;
        }
        String sql = requiredText(params, "sql");
        QueryResult query = queryRunner.queryBuffered(
            state.connection,
            sql,
            readParams(params),
            optionalInt(params, "max_rows")
        );
        String cursorId = DRIVER_ID + "-cursor-" + nextCursorId++;
        cursors.put(cursorId, new CursorState(query.getRows()));

        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("cursor_id", cursorId);
        result.put("columns", query.getColumns());
        result.put("row_count_known", Boolean.TRUE);
        result.put("row_count_estimate", Integer.valueOf(query.getRows().size()));
        return ok(id, result);
    }

    private JsonNode handleCursorFetch(JsonNode id, JsonNode params) {
        String cursorId = requiredText(params, "cursor_id");
        CursorState cursor = cursors.get(cursorId);
        if (cursor == null) {
            return error(id, ProtocolError.UNKNOWN_CURSOR_ID, "unknown cursor_id `" + cursorId + "`");
        }
        int n = optionalInt(params, "n") == null ? 500 : Math.max(0, optionalInt(params, "n").intValue());
        List<List<Map<String, Object>>> rows = cursor.take(n);
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("rows", rows);
        result.put("done", Boolean.valueOf(cursor.isDone()));
        return ok(id, result);
    }

    private JsonNode handleCursorClose(JsonNode id, JsonNode params) {
        String cursorId = requiredText(params, "cursor_id");
        if (cursors.remove(cursorId) == null) {
            return error(id, ProtocolError.UNKNOWN_CURSOR_ID, "unknown cursor_id `" + cursorId + "`");
        }
        return ok(id, null);
    }

    private JsonNode handleCursorCancel(JsonNode id, JsonNode params) {
        String cursorId = requiredText(params, "cursor_id");
        if (cursors.remove(cursorId) == null) {
            return error(id, ProtocolError.UNKNOWN_CURSOR_ID, "unknown cursor_id `" + cursorId + "`");
        }
        return ok(id, null);
    }

    private JsonNode handleExecRun(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String txId = optionalText(params, "tx_id", "");
        if (!txId.isEmpty() && requireTransaction(id, txId, requiredLong(params, "conn_id")) == null) {
            return lastError;
        }
        long affected = queryRunner.execRun(state.connection, requiredText(params, "sql"), readParams(params));
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("affected_rows", Long.valueOf(affected));
        result.put("warnings", new ArrayList<String>());
        return ok(id, result);
    }

    private JsonNode handleExecBatch(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        List<String> statements = readStringArray(params.path("statements"));
        boolean stopOnError = !params.has("stop_on_error") || params.path("stop_on_error").asBoolean(true);
        boolean inTransaction = params.path("in_transaction").asBoolean(false);
        boolean originalAutoCommit = state.connection.getAutoCommit();
        if (inTransaction) {
            state.connection.setAutoCommit(false);
        }
        List<Map<String, Object>> results = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> errors = new ArrayList<Map<String, Object>>();
        try {
            for (int i = 0; i < statements.size(); i++) {
                try {
                    long affected = queryRunner.execRun(state.connection, statements.get(i), null);
                    Map<String, Object> result = new LinkedHashMap<String, Object>();
                    result.put("affected_rows", Long.valueOf(affected));
                    result.put("warnings", new ArrayList<String>());
                    results.add(result);
                } catch (SQLException error) {
                    Map<String, Object> item = new LinkedHashMap<String, Object>();
                    item.put("index", Integer.valueOf(i));
                    item.put("code", Integer.valueOf(ProtocolError.SQL_SYNTAX));
                    item.put("message", sqlErrorMessage(error));
                    item.put("data", sqlErrorData(error));
                    errors.add(item);
                    if (stopOnError) {
                        break;
                    }
                }
            }
            if (inTransaction) {
                if (errors.isEmpty()) {
                    state.connection.commit();
                } else {
                    state.connection.rollback();
                }
            }
        } finally {
            if (inTransaction) {
                state.connection.setAutoCommit(originalAutoCommit);
            }
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("results", results);
        out.put("errors", errors);
        return ok(id, out);
    }

    private JsonNode handleTxBegin(JsonNode id, JsonNode params) throws SQLException {
        long connId = requiredLong(params, "conn_id");
        ConnectionState state = requireConnection(id, connId);
        if (state == null) {
            return lastError;
        }
        if (state.activeTxId != null) {
            return error(id, ProtocolError.INVALID_PARAMS, "connection already has an active transaction");
        }
        state.originalAutoCommit = state.connection.getAutoCommit();
        state.connection.setAutoCommit(false);
        String txId = DRIVER_ID + "-tx-" + nextTxId++;
        state.activeTxId = txId;
        transactions.put(txId, new TxState(connId));
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("tx_id", txId);
        return ok(id, result);
    }

    private JsonNode handleTxCommit(JsonNode id, JsonNode params) throws SQLException {
        TxState tx = requireTransaction(id, requiredText(params, "tx_id"), -1L);
        if (tx == null) {
            return lastError;
        }
        ConnectionState state = connections.get(Long.valueOf(tx.connId));
        state.connection.commit();
        finishTransaction(requiredText(params, "tx_id"), state);
        return ok(id, null);
    }

    private JsonNode handleTxRollback(JsonNode id, JsonNode params) throws SQLException {
        String txId = requiredText(params, "tx_id");
        TxState tx = requireTransaction(id, txId, -1L);
        if (tx == null) {
            return lastError;
        }
        ConnectionState state = connections.get(Long.valueOf(tx.connId));
        String savepoint = optionalText(params, "to_savepoint", "");
        if (!savepoint.isEmpty()) {
            Savepoint sp = tx.savepoints.get(savepoint);
            if (sp == null) {
                return error(id, ProtocolError.INVALID_PARAMS, "unknown savepoint `" + savepoint + "`");
            }
            state.connection.rollback(sp);
            return ok(id, null);
        }
        state.connection.rollback();
        finishTransaction(txId, state);
        return ok(id, null);
    }

    private JsonNode handleTxSavepoint(JsonNode id, JsonNode params) throws SQLException {
        String txId = requiredText(params, "tx_id");
        TxState tx = requireTransaction(id, txId, -1L);
        if (tx == null) {
            return lastError;
        }
        String name = requiredText(params, "name");
        ConnectionState state = connections.get(Long.valueOf(tx.connId));
        tx.savepoints.put(name, state.connection.setSavepoint(name));
        return ok(id, null);
    }

    private JsonNode handleTxRelease(JsonNode id, JsonNode params) throws SQLException {
        String txId = requiredText(params, "tx_id");
        TxState tx = requireTransaction(id, txId, -1L);
        if (tx == null) {
            return lastError;
        }
        String name = requiredText(params, "name");
        Savepoint sp = tx.savepoints.remove(name);
        if (sp == null) {
            return error(id, ProtocolError.INVALID_PARAMS, "unknown savepoint `" + name + "`");
        }
        ConnectionState state = connections.get(Long.valueOf(tx.connId));
        state.connection.releaseSavepoint(sp);
        return ok(id, null);
    }

    private JsonNode handleDdlBuild(JsonNode id, JsonNode params) {
        String op = requiredText(params, "op");
        JsonNode payload = params.path("payload");
        if ("create_table".equals(op)) {
            return handleDdlBuildCreateTable(id, payload);
        }
        if ("drop_table".equals(op) || "drop_view".equals(op)) {
            return handleDdlBuildDrop(id, payload);
        }
        if ("create_database".equals(op)) {
            String database = requiredText(payload, "database_name");
            String sql = "CREATE DATABASE " + quote(database);
            List<String> statements = new ArrayList<String>();
            statements.add(sql);
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("sql", sql);
            result.put("statements", statements);
            return ok(id, result);
        }
        if ("drop_database".equals(op)) {
            String database = requiredText(payload, "database_name");
            String sql = "DROP DATABASE " + quote(database);
            List<String> statements = new ArrayList<String>();
            statements.add(sql);
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("sql", sql);
            result.put("statements", statements);
            return ok(id, result);
        }
        return error(id, ProtocolError.INVALID_PARAMS, "ddl op `" + op + "` is not supported");
    }

    private JsonNode handleDdlBuildCreateTable(JsonNode id, JsonNode params) {
        JsonNode spec = params.path("spec");
        String table = requiredText(spec, "name");
        String schema = optionalText(spec, "schema", "");
        boolean withComments = params.path("options").path("with_comments").asBoolean(true);
        List<String> defs = new ArrayList<String>();
        List<String> primary = new ArrayList<String>();
        for (JsonNode col : spec.path("columns")) {
            if (col.path("is_primary").asBoolean(false)) {
                primary.add(requiredText(col, "name"));
            }
            defs.add(columnDefinition(col, withComments));
        }
        JsonNode pk = spec.path("primary_key");
        if (pk.isArray()) {
            primary.clear();
            for (JsonNode item : pk) {
                primary.add(item.asText());
            }
        }
        if (!primary.isEmpty()) {
            defs.add("PRIMARY KEY (" + quoteList(primary) + ")");
        }
        StringBuilder sql = new StringBuilder("CREATE TABLE ");
        if (params.path("options").path("if_not_exists").asBoolean(false)) {
            sql.append("IF NOT EXISTS ");
        }
        sql.append(qualifiedIdentifier("", schema, table)).append(" (").append(join(defs, ", ")).append(")");
        // GBase 8a has no COMMENT ON statement. Column comments already travel
        // inside each definition; the table comment is a trailing table option.
        String tableComment = optionalText(spec, "comment", "");
        if (withComments && !tableComment.isEmpty()) {
            sql.append(" COMMENT = '").append(sqlString(tableComment)).append('\'');
        }
        List<String> statements = new ArrayList<String>();
        statements.add(sql.toString());
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sql", sql.toString());
        result.put("statements", statements);
        return ok(id, result);
    }

    private JsonNode handleDdlBuildAlterTable(JsonNode id, JsonNode params) {
        JsonNode toSpec = params.path("to_spec");
        JsonNode fromSpec = params.path("from_spec");
        String table = requiredText(toSpec, "name");
        String schema = optionalText(toSpec, "schema", "");
        JsonNode options = params.path("options");
        boolean withRollback = options.path("with_rollback").asBoolean(false);
        boolean allowDestructive = options.path("allow_destructive").asBoolean(false);
        List<String> statements = new ArrayList<String>();
        List<String> rollback = new ArrayList<String>();
        List<String> warnings = new ArrayList<String>();
        Map<String, JsonNode> fromColumns = columnsByName(fromSpec.path("columns"));
        Map<String, JsonNode> toColumns = columnsByName(toSpec.path("columns"));
        String tableName = qualifiedIdentifier("", schema, table);
        String fromTableComment = optionalText(fromSpec, "comment", "");
        String toTableComment = optionalText(toSpec, "comment", "");
        if (!fromTableComment.equals(toTableComment)) {
            statements.add(tableCommentStatement(tableName, toTableComment));
            if (withRollback) {
                rollback.add(0, tableCommentStatement(tableName, fromTableComment));
            }
        }
        for (JsonNode rename : params.path("column_renames")) {
            String oldName = rename.path("old_name").asText("");
            String newName = rename.path("new_name").asText("");
            if (!oldName.trim().isEmpty() && !newName.trim().isEmpty() && !oldName.equals(newName)) {
                statements.add("ALTER TABLE " + tableName + " RENAME COLUMN " + quote(oldName) + " TO " + quote(newName));
                if (withRollback) {
                    rollback.add(0, "ALTER TABLE " + tableName + " RENAME COLUMN " + quote(newName) + " TO " + quote(oldName));
                }
            }
        }
        for (JsonNode column : toSpec.path("columns")) {
            String name = column.path("name").asText("");
            if (!name.isEmpty() && !fromColumns.containsKey(name)) {
                // The inline COMMENT rides along with the definition, so no
                // separate comment statement is needed.
                statements.add("ALTER TABLE " + tableName + " ADD " + columnDefinition(column, true));
                if (withRollback) {
                    rollback.add(0, "ALTER TABLE " + tableName + " DROP " + quote(name));
                }
            }
        }
        if (allowDestructive) {
            for (JsonNode column : fromSpec.path("columns")) {
                String name = column.path("name").asText("");
                if (!name.isEmpty() && !toColumns.containsKey(name)) {
                    statements.add("ALTER TABLE " + tableName + " DROP " + quote(name));
                    warnings.add("drop column may lose data: " + name);
                }
            }
        }
        for (JsonNode column : toSpec.path("columns")) {
            String name = column.path("name").asText("");
            JsonNode fromColumn = fromColumns.get(name);
            if (name.isEmpty() || fromColumn == null) {
                continue;
            }
            String fromComment = optionalText(fromColumn, "comment", "");
            String toComment = optionalText(column, "comment", "");
            if (!fromComment.equals(toComment)) {
                // A column comment can only change together with its full
                // definition on MySQL-compatible servers.
                statements.add(columnCommentStatement(tableName, columnDefinition(column, true)));
                if (withRollback) {
                    rollback.add(0, columnCommentStatement(tableName, columnDefinition(fromColumn, true)));
                }
            }
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("statements", statements);
        result.put("rollback_statements", rollback);
        result.put("warnings", warnings);
        return ok(id, result);
    }

    /**
     * GBase 8a has no {@code COMMENT ON} statement. A table comment is set
     * through the {@code ALTER TABLE ... COMMENT =} table option, and a column
     * comment only ever changes as part of a full {@code MODIFY COLUMN}
     * definition — see {@link #columnCommentStatement}.
     */
    private static String tableCommentStatement(String tableName, String comment) {
        return "ALTER TABLE " + tableName + " COMMENT = '" + sqlString(comment == null ? "" : comment) + "'";
    }

    private static String columnCommentStatement(String tableName, String definition) {
        return "ALTER TABLE " + tableName + " MODIFY COLUMN " + definition;
    }

    private static String sqlString(String value) {
        return value.replace("'", "''");
    }

    /**
     * Builds a column definition. {@code includeComment} controls whether the
     * inline {@code COMMENT '...'} clause is emitted, which is how GBase 8a
     * attaches column comments to the column itself.
     */
    private String columnDefinition(JsonNode col, boolean includeComment) {
        String name = requiredText(col, "name");
        String type = requiredText(col, "type");
        StringBuilder def = new StringBuilder();
        def.append(qualifiedIdentifier("", "", name)).append(' ').append(type);
        if (col.has("nullable") && !col.path("nullable").asBoolean(true)) {
            def.append(" NOT NULL");
        }
        if (col.has("default") && !col.path("default").isNull()) {
            String defaultValue = literalDefault(type, col.path("default").asText(""));
            if (defaultValue != null) {
                def.append(" DEFAULT ").append(defaultValue);
            }
        }
        if (includeComment) {
            String comment = optionalText(col, "comment", "");
            if (!comment.isEmpty()) {
                def.append(" COMMENT '").append(sqlString(comment)).append('\'');
            }
        }
        return def.toString();
    }

    private Map<String, JsonNode> columnsByName(JsonNode columns) {
        Map<String, JsonNode> result = new LinkedHashMap<String, JsonNode>();
        for (JsonNode column : columns) {
            String name = column.path("name").asText("");
            if (!name.isEmpty()) {
                result.put(name, column);
            }
        }
        return result;
    }

    private JsonNode handleDdlBuildDrop(JsonNode id, JsonNode params) {
        String kind = optionalText(params, "kind", "table").toUpperCase().replace('_', ' ');
        StringBuilder sql = new StringBuilder("DROP ").append(kind);
        if (params.path("if_exists").asBoolean(false)) {
            sql.append(" IF EXISTS");
        }
        sql.append(' ').append(qualifiedIdentifier(optionalText(params, "database", ""), optionalText(params, "schema", ""), requiredText(params, "name")));
        if (params.path("cascade").asBoolean(false)) {
            sql.append(" CASCADE");
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sql", sql.toString());
        return ok(id, result);
    }

    private JsonNode handleDataExport(JsonNode id, JsonNode params) throws SQLException {
        ConnectionState state = requireConnection(id, requiredLong(params, "conn_id"));
        if (state == null) {
            return lastError;
        }
        String streamId = requiredText(params, "stream_id");
        String sql = optionalText(params, "sql", "");
        if (sql.isEmpty()) {
            sql = "SELECT * FROM " + qualifiedIdentifier(optionalText(params, "database", ""), optionalText(params, "schema", ""), requiredText(params, "table"));
        }
        String format = requiredText(params, "format");
        QueryResult query = queryRunner.queryBuffered(state.connection, sql, readParams(params), optionalInt(params, "max_rows"));
        byte[] data = exportBytes(format, query, params.path("options"));
        streams.put(streamId, new StreamState(data));
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("estimated_bytes", Long.valueOf(data.length));
        result.put("estimated_rows", Long.valueOf(query.getRows().size()));
        Map<String, Object> metadata = new LinkedHashMap<String, Object>();
        metadata.put("format", format);
        metadata.put("columns", query.getColumns());
        result.put("metadata", metadata);
        return ok(id, result);
    }

    private JsonNode handleDataImportBegin(JsonNode id, JsonNode params) {
        long connId = requiredLong(params, "conn_id");
        if (!connections.containsKey(Long.valueOf(connId))) {
            return error(id, ProtocolError.UNKNOWN_CONN_ID, "unknown conn_id " + connId);
        }
        String format = requiredText(params, "format");
        if (!"json".equals(format) && !"ndjson".equals(format) && !"csv".equals(format)) {
            return error(id, ProtocolError.INVALID_PARAMS, "import format `" + format + "` is not supported");
        }
        String importId = DRIVER_ID + "-import-" + nextImportId++;
        imports.put(importId, new ImportState(connId, optionalText(params, "database", ""), optionalText(params, "schema", ""), requiredText(params, "table"), readStringArray(params.path("columns"))));
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("import_id", importId);
        return ok(id, result);
    }

    private JsonNode handleDataImportChunk(JsonNode id, JsonNode params) throws SQLException {
        String importId = requiredText(params, "import_id");
        ImportState state = imports.get(importId);
        if (state == null) {
            return error(id, ProtocolError.INVALID_PARAMS, "unknown import_id `" + importId + "`");
        }
        ConnectionState conn = connections.get(Long.valueOf(state.connId));
        String sql = insertSql(state);
        long inserted = 0L;
        for (JsonNode row : params.path("rows")) {
            List<Map<String, Object>> cells = mapper.convertValue(row, new TypeReference<List<Map<String, Object>>>() {});
            inserted += queryRunner.execRun(conn.connection, sql, cells);
        }
        state.inserted += inserted;
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("inserted", Long.valueOf(inserted));
        result.put("failed", new ArrayList<Map<String, Object>>());
        return ok(id, result);
    }

    private JsonNode handleDataImportCommit(JsonNode id, JsonNode params) {
        String importId = requiredText(params, "import_id");
        ImportState state = imports.remove(importId);
        if (state == null) {
            return error(id, ProtocolError.INVALID_PARAMS, "unknown import_id `" + importId + "`");
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("inserted", Long.valueOf(state.inserted));
        result.put("updated", Long.valueOf(0L));
        result.put("deleted", Long.valueOf(0L));
        result.put("failed", new ArrayList<Map<String, Object>>());
        result.put("elapsed_ms", Long.valueOf(System.currentTimeMillis() - state.startedAt));
        return ok(id, result);
    }

    private JsonNode handleDataImportAbort(JsonNode id, JsonNode params) {
        imports.remove(requiredText(params, "import_id"));
        return ok(id, null);
    }

    private JsonNode handleStreamRead(JsonNode id, JsonNode params) {
        String streamId = requiredText(params, "stream_id");
        StreamState stream = streams.get(streamId);
        if (stream == null) {
            return error(id, ProtocolError.INVALID_PARAMS, "unknown stream_id `" + streamId + "`");
        }
        int max = optionalInt(params, "max_bytes") == null ? 65536 : Math.max(0, optionalInt(params, "max_bytes").intValue());
        int end = Math.min(stream.data.length, stream.offset + max);
        byte[] chunk = new byte[end - stream.offset];
        System.arraycopy(stream.data, stream.offset, chunk, 0, chunk.length);
        stream.offset = end;
        boolean done = stream.offset >= stream.data.length;
        if (done) {
            streams.remove(streamId);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("data", Base64.getEncoder().encodeToString(chunk));
        result.put("done", Boolean.valueOf(done));
        return ok(id, result);
    }

    private JsonNode handleStreamClose(JsonNode id, JsonNode params) {
        streams.remove(requiredText(params, "stream_id"));
        return ok(id, null);
    }

    private GBase8aConfig parseConfig(JsonNode params) {
        String driverId = textOrEmpty(params.path("driver_id"));
        if (!driverId.isEmpty() && !DRIVER_ID.equals(driverId)) {
            throw new IllegalArgumentException("unsupported driver_id `" + driverId + "`");
        }
        Map<String, Object> raw = mapper.convertValue(
            params.path("config"),
            new TypeReference<Map<String, Object>>() {
            }
        );
        return GBase8aConfig.fromWire(raw);
    }

    private List<Map<String, Object>> readParams(JsonNode params) {
        JsonNode node = params.path("params");
        if (!node.isArray()) {
            return null;
        }
        return mapper.convertValue(
            node,
            new TypeReference<List<Map<String, Object>>>() {
            }
        );
    }

    private JsonNode lastError;

    private ConnectionState requireConnection(JsonNode id, long connId) {
        ConnectionState state = connections.get(Long.valueOf(connId));
        if (state == null) {
            lastError = error(id, ProtocolError.UNKNOWN_CONN_ID, "unknown conn_id " + connId);
            return null;
        }
        lastError = null;
        return state;
    }

    private TxState requireTransaction(JsonNode id, String txId, long expectedConnId) {
        TxState tx = transactions.get(txId);
        if (tx == null) {
            lastError = error(id, ProtocolError.INVALID_PARAMS, "unknown tx_id `" + txId + "`");
            return null;
        }
        if (expectedConnId >= 0 && tx.connId != expectedConnId) {
            lastError = error(id, ProtocolError.INVALID_PARAMS, "tx_id `" + txId + "` does not belong to conn_id " + expectedConnId);
            return null;
        }
        lastError = null;
        return tx;
    }

    private void finishTransaction(String txId, ConnectionState state) throws SQLException {
        transactions.remove(txId);
        state.connection.setAutoCommit(state.originalAutoCommit);
        state.activeTxId = null;
    }

    /**
     * GBase 8a always accepts explicit transactions, so unlike GBase 8s there is
     * no per-database "logging mode" to probe. Whether a particular table takes
     * part in a transaction is decided by its storage engine, and the server
     * reports that as an ordinary SQL error if it does not.
     */
    private static String quote(String name) {
        return GBase8aSchemaSql.quoteIdentifier(name);
    }

    private static String qualifiedIdentifier(String database, String schema, String name) {
        return GBase8aSchemaSql.qualifiedIdentifier(database, schema, name);
    }

    private static String quoteList(List<String> names) {
        List<String> quoted = new ArrayList<String>();
        for (String name : names) {
            if (name != null && !name.trim().isEmpty()) {
                quoted.add(quote(name));
            }
        }
        return join(quoted, ", ");
    }

    private static String join(List<String> values, String separator) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                out.append(separator);
            }
            out.append(values.get(i));
        }
        return out.toString();
    }

    private byte[] exportBytes(String format, QueryResult query, JsonNode options) throws SQLException {
        if ("json".equals(format)) {
            try {
                List<Map<String, Object>> rows = rowsAsObjects(query);
                return mapper.writeValueAsBytes(rows);
            } catch (Exception error) {
                throw new SQLException(error);
            }
        }
        if ("ndjson".equals(format)) {
            try {
                StringBuilder out = new StringBuilder();
                for (Map<String, Object> row : rowsAsObjects(query)) {
                    out.append(mapper.writeValueAsString(row)).append('\n');
                }
                return out.toString().getBytes(StandardCharsets.UTF_8);
            } catch (Exception error) {
                throw new SQLException(error);
            }
        }
        if ("csv".equals(format)) {
            String delimiterValue = optionalText(options, "delimiter", ",");
            String quoteValue = optionalText(options, "quote", "\"");
            String nullString = optionalText(options, "null_string", "\\N");
            String delimiter = delimiterValue.isEmpty() ? "," : delimiterValue.substring(0, 1);
            char delimiterChar = delimiter.charAt(0);
            char quote = quoteValue.isEmpty() ? '"' : quoteValue.charAt(0);
            StringBuilder out = new StringBuilder();
            List<String> names = columnNames(query);
            if (options.path("header").asBoolean(true)) {
                List<String> header = new ArrayList<String>();
                for (String name : names) {
                    header.add(csvCell(name, nullString, delimiterChar, quote));
                }
                out.append(join(header, delimiter)).append('\n');
            }
            for (Map<String, Object> row : rowsAsObjects(query)) {
                List<String> cells = new ArrayList<String>();
                for (String name : names) {
                    cells.add(csvCell(row.get(name), nullString, delimiterChar, quote));
                }
                out.append(join(cells, delimiter)).append('\n');
            }
            return out.toString().getBytes(StandardCharsets.UTF_8);
        }
        throw new SQLException("export format `" + format + "` is not supported");
    }

    static String csvCell(Object value, String nullString, char delimiter, char quote) {
        if (value == null) {
            return nullString;
        }
        String text = String.valueOf(value);
        boolean quoteField = text.isEmpty()
            || text.equals(nullString)
            || text.indexOf(delimiter) >= 0
            || text.indexOf(quote) >= 0
            || text.indexOf('\n') >= 0
            || text.indexOf('\r') >= 0;
        if (!quoteField) {
            return text;
        }
        String quoteText = String.valueOf(quote);
        return quoteText + text.replace(quoteText, quoteText + quoteText) + quoteText;
    }

    private List<Map<String, Object>> rowsAsObjects(QueryResult query) {
        List<String> names = columnNames(query);
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            Map<String, Object> object = new LinkedHashMap<String, Object>();
            for (int i = 0; i < names.size(); i++) {
                object.put(names.get(i), rowValue(row, i));
            }
            rows.add(object);
        }
        return rows;
    }

    private List<List<String>> hostRows(QueryResult query) {
        List<List<String>> rows = new ArrayList<List<String>>();
        for (List<Map<String, Object>> row : query.getRows()) {
            List<String> out = new ArrayList<String>();
            for (int i = 0; i < query.getColumns().size(); i++) {
                Object value = rowValue(row, i);
                out.add(value == null ? null : String.valueOf(value));
            }
            rows.add(out);
        }
        return rows;
    }

    private List<Map<String, Object>> hostColumnMeta(QueryResult query) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> column : query.getColumns()) {
            String name = String.valueOf(column.get("name"));
            String dbType = String.valueOf(column.get("type"));
            Map<String, Object> meta = new LinkedHashMap<String, Object>();
            meta.put("name", name);
            meta.put("db_type", dbType);
            meta.put("field_type", hostFieldType(dbType));
            Object nullable = column.get("nullable");
            meta.put("nullable", nullable instanceof Boolean ? nullable : Boolean.TRUE);
            out.add(meta);
        }
        return out;
    }

    private List<String> columnNames(QueryResult query) {
        List<String> names = new ArrayList<String>();
        for (Map<String, Object> column : query.getColumns()) {
            names.add(String.valueOf(column.get("name")));
        }
        return names;
    }

    private String hostFieldType(String dbType) {
        String upper = dbType == null ? "" : dbType.toUpperCase();
        if (upper.contains("INT") || upper.contains("SERIAL")) {
            return "Integer";
        }
        if (upper.contains("DECIMAL") || upper.contains("NUMERIC") || upper.contains("FLOAT")
            || upper.contains("DOUBLE") || upper.contains("REAL") || upper.contains("MONEY")) {
            return "Decimal";
        }
        if (upper.contains("BOOLEAN") || upper.contains("BOOL")) {
            return "Boolean";
        }
        if (upper.contains("DATE") && !upper.contains("TIME")) {
            return "Date";
        }
        if (upper.contains("TIME") && !upper.contains("DATE")) {
            return "Time";
        }
        if (upper.contains("DATETIME") || upper.contains("TIMESTAMP")) {
            return "DateTime";
        }
        if (upper.contains("BLOB") || upper.contains("BYTE") || upper.contains("BINARY")) {
            return "Binary";
        }
        if (upper.contains("TEXT") || upper.contains("CLOB")) {
            return "LongText";
        }
        if (upper.contains("CHAR") || upper.contains("VARCHAR") || upper.contains("LVARCHAR")) {
            return "Text";
        }
        return "Unknown";
    }

    private String insertSql(ImportState state) {
        if (state.columns.isEmpty()) {
            throw new IllegalArgumentException("data import requires explicit columns");
        }
        List<String> placeholders = new ArrayList<String>();
        for (int i = 0; i < state.columns.size(); i++) {
            placeholders.add("?");
        }
        return "INSERT INTO " + qualifiedIdentifier(state.database, state.schema, state.table) + " (" + quoteList(state.columns) + ") VALUES (" + join(placeholders, ", ") + ")";
    }

    private long requiredLong(JsonNode params, String field) {
        JsonNode value = params.get(field);
        if (value == null || !value.canConvertToLong()) {
            throw new IllegalArgumentException("missing required parameter `" + field + "`");
        }
        return value.asLong();
    }

    private String requiredText(JsonNode params, String field) {
        String value = textOrEmpty(params.get(field));
        if (value.isEmpty()) {
            throw new IllegalArgumentException("missing required parameter `" + field + "`");
        }
        return value;
    }

    private Integer optionalInt(JsonNode params, String field) {
        JsonNode value = params.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return Integer.valueOf(value.asInt());
    }

    private String optionalText(JsonNode params, String field, String defaultValue) {
        String value = textOrEmpty(params.get(field));
        return value.isEmpty() ? defaultValue : value;
    }

    private List<String> readStringArray(JsonNode node) {
        List<String> out = new ArrayList<String>();
        if (node == null || !node.isArray()) {
            return out;
        }
        for (JsonNode item : node) {
            String value = textOrEmpty(item);
            if (!value.isEmpty()) {
                out.add(value);
            }
        }
        return out;
    }

    private Object rowValue(List<Map<String, Object>> row, int index) {
        if (row == null || index < 0 || index >= row.size()) {
            return null;
        }
        Map<String, Object> cell = row.get(index);
        if (cell == null || "null".equals(String.valueOf(cell.get("type")))) {
            return null;
        }
        return cell.get("value");
    }

    private String rowString(List<Map<String, Object>> row, int index) {
        Object value = rowValue(row, index);
        return value == null ? "" : String.valueOf(value).trim();
    }

    private int rowInt(List<Map<String, Object>> row, int index) {
        Object value = rowValue(row, index);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value == null || String.valueOf(value).trim().isEmpty()) {
            return 0;
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private boolean nullable(String value) {
        String normalized = value == null ? "" : value.trim().toUpperCase();
        if ("NO".equals(normalized) || "N".equals(normalized) || "0".equals(normalized) || "FALSE".equals(normalized)) {
            return false;
        }
        return true;
    }

    /**
     * GBase 8a reports the column default exactly as the server stores it
     * ({@code 0}, {@code CURRENT_TIMESTAMP}, ...) or NULL when the column has
     * none, so only the empty string needs normalizing.
     */
    private String columnDefault(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    /**
     * {@code information_schema} reports character length, numeric precision and
     * scale as nullable numbers. Values the column type does not define come
     * back as SQL NULL, which must stay null rather than becoming 0.
     */
    private Long nullableLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return Long.valueOf(((Number) value).longValue());
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) {
            return null;
        }
        try {
            return Long.valueOf(text);
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private String textOrEmpty(JsonNode node) {
        return node == null || node.isNull() ? "" : node.asText("").trim();
    }

    private JsonNode ok(JsonNode id, Object result) {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("jsonrpc", "2.0");
        response.set("id", id == null || id.isMissingNode() ? JsonNodeFactory.instance.nullNode() : id);
        response.set("result", result == null ? JsonNodeFactory.instance.nullNode() : mapper.valueToTree(result));
        return response;
    }

    private JsonNode error(JsonNode id, int code, String message) {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        ObjectNode error = JsonNodeFactory.instance.objectNode();
        response.put("jsonrpc", "2.0");
        response.set("id", id == null || id.isMissingNode() ? JsonNodeFactory.instance.nullNode() : id);
        error.put("code", code);
        error.put("message", message == null ? "" : message);
        response.set("error", error);
        return response;
    }

    private JsonNode sqlError(JsonNode id, int code, SQLException exception) {
        ObjectNode response = (ObjectNode) error(id, code, sqlErrorMessage(exception));
        ((ObjectNode) response.get("error")).set("data", mapper.valueToTree(sqlErrorData(exception)));
        return response;
    }

    private Map<String, Object> sqlErrorData(SQLException exception) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        if (exception.getSQLState() != null && !exception.getSQLState().isEmpty()) {
            data.put("sqlstate", exception.getSQLState());
        }
        data.put("vendor_code", Integer.valueOf(exception.getErrorCode()));

        List<Map<String, Object>> chain = new ArrayList<Map<String, Object>>();
        SQLException current = exception;
        for (int depth = 0; current != null && depth < 32; depth++) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("message", current.getMessage() == null ? "" : current.getMessage());
            if (current.getSQLState() != null && !current.getSQLState().isEmpty()) {
                item.put("sqlstate", current.getSQLState());
            }
            item.put("vendor_code", Integer.valueOf(current.getErrorCode()));
            chain.add(item);
            SQLException next = current.getNextException();
            if (next == current) {
                break;
            }
            current = next;
        }
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("chain", chain);
        data.put("extra", extra);
        return data;
    }

    private String sqlErrorMessage(SQLException exception) {
        StringBuilder message = new StringBuilder();
        SQLException current = exception;
        for (int depth = 0; current != null && depth < 32; depth++) {
            if (message.length() > 0) {
                message.append("\nCaused by: ");
            }
            String currentMessage = current.getMessage();
            message.append(currentMessage == null || currentMessage.isEmpty()
                ? current.getClass().getName()
                : currentMessage);
            if (current.getSQLState() != null && !current.getSQLState().isEmpty()) {
                message.append(" [SQLSTATE ").append(current.getSQLState()).append(']');
            }
            message.append(" [vendor code ").append(current.getErrorCode()).append(']');
            SQLException next = current.getNextException();
            if (next == current) {
                break;
            }
            current = next;
        }
        return message.toString();
    }

    private void closeAll() throws SQLException {
        SQLException failure = null;
        for (TxState tx : transactions.values()) {
            ConnectionState state = connections.get(Long.valueOf(tx.connId));
            if (state != null) {
                try {
                    state.connection.rollback();
                    state.connection.setAutoCommit(state.originalAutoCommit);
                } catch (SQLException error) {
                    failure = error;
                }
            }
        }
        transactions.clear();
        imports.clear();
        streams.clear();
        for (ConnectionState state : connections.values()) {
            try {
                state.connection.close();
            } catch (SQLException error) {
                failure = error;
            }
        }
        connections.clear();
        cursors.clear();
        if (failure != null) {
            throw failure;
        }
    }

    private void closeTransactionsForConn(long connId) throws SQLException {
        List<String> ids = new ArrayList<String>();
        for (Map.Entry<String, TxState> entry : transactions.entrySet()) {
            if (entry.getValue().connId == connId) {
                ids.add(entry.getKey());
            }
        }
        ConnectionState state = connections.get(Long.valueOf(connId));
        for (String id : ids) {
            if (state != null) {
                state.connection.rollback();
                state.connection.setAutoCommit(state.originalAutoCommit);
                state.activeTxId = null;
            }
            transactions.remove(id);
        }
    }

    private void closeImportsForConn(long connId) {
        List<String> ids = new ArrayList<String>();
        for (Map.Entry<String, ImportState> entry : imports.entrySet()) {
            if (entry.getValue().connId == connId) {
                ids.add(entry.getKey());
            }
        }
        for (String id : ids) {
            imports.remove(id);
        }
    }

    private static final class ConnectionState {
        private final GBase8aConfig config;
        private final Connection connection;
        private boolean originalAutoCommit = true;
        private String activeTxId;

        private ConnectionState(GBase8aConfig config, Connection connection) {
            this.config = config;
            this.connection = connection;
        }
    }

    private static final class TxState {
        private final long connId;
        private final Map<String, Savepoint> savepoints = new LinkedHashMap<String, Savepoint>();

        private TxState(long connId) {
            this.connId = connId;
        }
    }

    private static final class ImportState {
        private final long connId;
        private final String database;
        private final String schema;
        private final String table;
        private final List<String> columns;
        private final long startedAt = System.currentTimeMillis();
        private long inserted;

        private ImportState(long connId, String database, String schema, String table, List<String> columns) {
            this.connId = connId;
            this.database = database;
            this.schema = schema;
            this.table = table;
            this.columns = columns;
        }
    }

    private static final class StreamState {
        private final byte[] data;
        private int offset;

        private StreamState(byte[] data) {
            this.data = data;
        }
    }

    private static final class CursorState {
        private final List<List<Map<String, Object>>> rows;
        private int offset;

        private CursorState(List<List<Map<String, Object>>> rows) {
            this.rows = rows;
        }

        private List<List<Map<String, Object>>> take(int n) {
            int end = Math.min(rows.size(), offset + n);
            List<List<Map<String, Object>>> page = new ArrayList<List<Map<String, Object>>>(rows.subList(offset, end));
            offset = end;
            return page;
        }

        private boolean isDone() {
            return offset >= rows.size();
        }
    }
}
