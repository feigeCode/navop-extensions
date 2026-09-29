package com.navop.gbase8a.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.navop.gbase8a.jdbc.GBase8aConfig;
import org.junit.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * End-to-end tests for the GBase 8a IPC server.
 *
 * <p>GBase 8a is MySQL-wire compatible, so instead of emulating a proprietary
 * catalog the fixture stands up the MySQL-shaped
 * {@code information_schema} tables (with the GBase-specific
 * {@code TABLE_COMMENT}, {@code COLUMN_TYPE}, {@code COLUMN_KEY} and
 * {@code EXTRA} columns) inside H2 and rewrites the driver's
 * {@code information_schema.} references onto that fixture schema. {@code SHOW
 * CREATE TABLE} is translated into a canned result set, since H2 has no
 * equivalent statement.</p>
 */
public class GBase8aIpcServerTest {
    private static final AtomicInteger SERVER_DB_COUNTER = new AtomicInteger();
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String CATALOG_SCHEMA = "gbase_catalog";
    private static final String OFFICIAL_DDL =
        "CREATE TABLE `sample` (\n"
            + "  `id` int(11) NOT NULL,\n"
            + "  `name` varchar(64) DEFAULT NULL COMMENT 'Sample column comment',\n"
            + "  `price` decimal(10,2) DEFAULT NULL,\n"
            + "  PRIMARY KEY (`id`),\n"
            + "  UNIQUE KEY `uk_sample_name` (`name`)\n"
            + ") ENGINE=EXPRESS DEFAULT CHARSET=utf8 COMMENT='Sample table comment'";

    // ---------------------------------------------------------------- init

    @Test
    public void initPublishesTheDriverSurface() throws Exception {
        GBase8aIpcServer server = newServer();

        JsonNode result = server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}")).get("result");

        assertEquals("gbase8a", result.get("drivers_ready").get(0).asText());
        assertEquals("0.1.0", result.get("extension_version").asText());
        assertEquals("GBase 8a IPC Driver", result.get("name").asText());
        assertTrue(result.get("features").toString().contains("streaming"));
        assertTrue(result.get("features").toString().contains("schema_introspection"));
        assertTrue(result.get("methods").toString().contains("schema/dump_ddl"));
        assertTrue(result.get("methods").toString().contains("schema/object_view"));
    }

    @Test
    public void initRejectsAnOlderHost() throws Exception {
        GBase8aIpcServer server = newServer();

        JsonNode response = server.handle(request(1, "init", "{\"host_version\":\"0.9.0\"}"));

        assertEquals(ProtocolError.SERVER_INCOMPATIBLE, response.get("error").get("code").asInt());
    }

    @Test
    public void methodsOtherThanInitRequireInitialisation() throws Exception {
        GBase8aIpcServer server = newServer();

        JsonNode response = server.handle(request(1, "schema/databases", "{\"conn_id\":1}"));

        assertEquals(ProtocolError.NOT_INITIALIZED, response.get("error").get("code").asInt());
    }

    @Test
    public void unknownMethodsReturnMethodNotFound() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode response = server.handle(request(2, "gbase8a/table_data", "{}"));

        assertEquals(ProtocolError.METHOD_NOT_FOUND, response.get("error").get("code").asInt());
    }

    @Test
    public void pingWorksWithAndWithoutInitialisation() throws Exception {
        GBase8aIpcServer server = newServer();

        JsonNode response = server.handle(request(1, "$/ping", "{}"));

        assertTrue(response.get("result").get("pong").asBoolean());
    }

    @Test
    public void connTestRejectsAnotherDriverId() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode response = server.handle(request(2, "conn/test", configJson("gbase8s")));

        assertEquals(ProtocolError.INVALID_PARAMS, response.get("error").get("code").asInt());
        assertTrue(response.get("error").get("message").asText().contains("driver_id"));
    }

    // ------------------------------------------------------------- connect

    @Test
    public void connTestReportsTheNegotiatedServerVersion() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode result = server.handle(request(2, "conn/test", configJson("gbase8a"))).get("result");

        assertTrue(result.get("ok").asBoolean());
        assertTrue(result.toString(), result.get("server_version").asText().startsWith("GBase 8a"));
        assertTrue(result.get("warnings").isArray());
        assertTrue(result.has("latency_ms"));
    }

    @Test
    public void connOpenAndPingAndCloseFollowTheLifecycle() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode opened = server.handle(request(2, "conn/open", configJson("gbase8a"))).get("result");
        long connId = opened.get("conn_id").asLong();
        assertTrue(opened.get("server_info").get("version").asText().startsWith("GBase 8a"));
        assertTrue(opened.get("server_info").get("features").toString().contains("database_sql"));

        assertTrue(server.handle(request(3, "conn/ping", "{\"conn_id\":" + connId + "}")).has("result"));
        assertTrue(server.handle(request(4, "conn/use", "{\"conn_id\":" + connId + "}")).has("result"));
        assertTrue(server.handle(request(5, "conn/close", "{\"conn_id\":" + connId + "}")).has("result"));

        JsonNode closed = server.handle(request(6, "conn/ping", "{\"conn_id\":" + connId + "}"));
        assertEquals(ProtocolError.UNKNOWN_CONN_ID, closed.get("error").get("code").asInt());
    }

    @Test
    public void unknownConnIdIsReportedConsistently() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        for (String method : new String[]{
            "conn/close", "conn/ping", "conn/use", "schema/databases", "schema/schemas", "schema/objects",
            "schema/checks", "schema/views", "schema/functions", "schema/procedures"
        }) {
            JsonNode response = server.handle(request(2, method, "{\"conn_id\":42}"));
            assertEquals(method, ProtocolError.UNKNOWN_CONN_ID, response.get("error").get("code").asInt());
        }
    }

    // -------------------------------------------------------------- catalog

    @Test
    public void schemaCatalogReturnsTablesViewsColumnsAndIndexes() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode databases = server.handle(request(3, "schema/databases", "{\"conn_id\":" + connId + "}")).get("result");
        assertEquals(1, databases.size());
        assertEquals("stores", databases.get(0).get("name").asText());

        JsonNode schemas = server.handle(request(4, "schema/schemas", "{\"conn_id\":" + connId + "}")).get("result");
        assertEquals("stores", schemas.get(0).get("name").asText());
        assertEquals("stores", schemas.get(0).get("owner").asText());

        JsonNode objects = server.handle(request(5, "schema/objects", "{\"conn_id\":" + connId
            + ",\"schema\":\"stores\",\"kinds\":[\"table\"]}")).get("result");
        assertEquals(1, objects.size());
        assertEquals("sample", objects.get(0).get("name").asText());
        assertEquals("table", objects.get(0).get("kind").asText());
        assertEquals("Sample table comment", objects.get(0).get("comment").asText());
        assertEquals("stores", objects.get(0).get("schema").asText());

        JsonNode views = server.handle(request(6, "schema/views", "{\"conn_id\":" + connId + "}")).get("result");
        assertEquals(1, views.size());
        assertEquals("v_sample", views.get(0).get("name").asText());
        assertEquals("view", views.get(0).get("kind").asText());

        JsonNode indexes = server.handle(request(7, "schema/indexes", "{\"conn_id\":" + connId + ",\"table\":\"sample\"}")).get("result");
        JsonNode primary = findByName(indexes, "PRIMARY");
        assertEquals("PRIMARY", primary.get("type").asText());
        assertTrue(primary.get("is_primary").asBoolean());
        assertTrue(primary.get("is_unique").asBoolean());
        assertEquals("id", primary.get("columns").get(0).asText());

        JsonNode unique = findByName(indexes, "uk_sample_name");
        assertEquals("UNIQUE", unique.get("type").asText());
        assertTrue(unique.get("is_unique").asBoolean());
        assertFalse(unique.get("is_primary").asBoolean());

        JsonNode plain = findByName(indexes, "idx_sample_price");
        assertEquals("INDEX", plain.get("type").asText());
        assertFalse(plain.get("is_unique").asBoolean());
    }

    @Test
    public void schemaColumnsMapsEveryHostField() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode columns = server.handle(request(3, "schema/columns", "{\"conn_id\":" + connId + ",\"database\":\"stores\",\"table\":\"sample\"}")).get("result");

        JsonNode id = findByName(columns, "id");
        assertEquals(1, id.get("ordinal").asInt());
        assertEquals("int(11)", id.get("type").asText());
        assertEquals("int(11)", id.get("raw_type").asText());
        assertFalse(id.get("nullable").asBoolean());
        assertTrue(id.get("is_primary").asBoolean());
        // COLUMN_KEY 'PRI' marks the primary key; 'UNI' is reserved for the
        // leading column of a non-primary unique index, matching MySQL.
        assertFalse(id.get("is_unique").asBoolean());
        assertEquals("PRI", id.get("extra").get("key").asText());
        assertEquals("auto_increment", id.get("extra").get("extra").asText());

        JsonNode name = findByName(columns, "name");
        assertEquals("varchar(64)", name.get("type").asText());
        assertTrue(name.get("nullable").asBoolean());
        assertEquals("Sample column comment", name.get("comment").asText());
        assertEquals(64L, name.get("max_length").asLong());
        assertFalse(name.get("is_primary").asBoolean());
        assertTrue(name.get("is_unique").asBoolean());

        JsonNode price = findByName(columns, "price");
        assertEquals("decimal(10,2)", price.get("type").asText());
        assertEquals("decimal(10,2)", price.get("raw_type").asText());
        assertEquals(10L, price.get("precision").asLong());
        assertEquals(2L, price.get("scale").asLong());
    }

    @Test
    public void schemaForeignKeysCombineColumnsAndReferentialRules() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode foreignKeys = server.handle(request(3, "schema/foreign_keys", "{\"conn_id\":" + connId + ",\"table\":\"child\"}")).get("result");

        assertEquals(1, foreignKeys.size());
        JsonNode fk = foreignKeys.get(0);
        assertEquals("fk_child_parent", fk.get("name").asText());
        assertEquals("child", fk.get("from_table").asText());
        assertEquals("parent_id", fk.get("from_columns").get(0).asText());
        assertEquals("parent", fk.get("to_table").asText());
        assertEquals("id", fk.get("to_columns").get(0).asText());
        assertEquals("CASCADE", fk.get("on_delete").asText());
        assertEquals("RESTRICT", fk.get("on_update").asText());
    }

    /**
     * GBase 8a has no CHECK catalog, so the driver answers with an empty list
     * rather than running a query that cannot succeed.
     */
    @Test
    public void schemaChecksReturnsAnEmptyList() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode checks = server.handle(request(3, "schema/checks", "{\"conn_id\":" + connId + ",\"table\":\"sample\"}")).get("result");

        assertTrue(checks.isArray());
        assertEquals(0, checks.size());
    }

    @Test
    public void schemaRoutinesSeparateFunctionsFromProcedures() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode functions = server.handle(request(3, "schema/functions", "{\"conn_id\":" + connId + "}")).get("result");
        assertEquals(1, functions.size());
        assertEquals("demo_add_one", functions.get(0).get("name").asText());
        assertEquals("decimal(10,2)", functions.get(0).get("return_type").asText());
        assertEquals("stores", functions.get(0).get("schema").asText());
        assertEquals("SQL", functions.get(0).get("language").asText());
        assertTrue(functions.get(0).get("definition").asText().contains("RETURN p + 1"));

        JsonNode procedures = server.handle(request(4, "schema/procedures", "{\"conn_id\":" + connId + "}")).get("result");
        assertEquals(1, procedures.size());
        assertEquals("demo_touch_proc", procedures.get(0).get("name").asText());
        assertTrue(procedures.get(0).get("return_type").isNull());
    }

    @Test
    public void schemaViewDefinitionReadsTheStoredDefinition() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode result = server.handle(request(3, "schema/view_definition", "{\"conn_id\":" + connId + ",\"view\":\"v_sample\"}")).get("result");

        assertEquals("select `id`,`name` from `sample`", result.get("sql").asText());
        assertFalse(result.get("is_materialized").asBoolean());
    }

    @Test
    public void schemaTypesSequencesAndTriggersReturnEmptyLists() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        for (String method : new String[]{"schema/triggers", "schema/sequences", "schema/types"}) {
            JsonNode response = server.handle(request(3, method, "{\"conn_id\":" + connId + "}"));
            assertTrue(method, response.get("result").isArray());
            assertEquals(method, 0, response.get("result").size());
        }
    }

    // ---------------------------------------------------------- object view

    @Test
    public void objectViewRendersEverySupportedTable() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode databases = objectView(server, connId, "{\"view\":\"databases\"}");
        assertEquals("Databases", databases.get("title").asText());
        assertEquals("stores", databases.get("rows").get(0).get(0).asText());

        JsonNode schemas = objectView(server, connId, "{\"view\":\"schemas\"}");
        assertEquals("Schemas", schemas.get("title").asText());
        assertEquals("stores", schemas.get("rows").get(0).get(1).asText());

        JsonNode tables = objectView(server, connId, "{\"view\":\"tables\"}");
        assertEquals("Tables", tables.get("title").asText());
        assertEquals("sample", tables.get("rows").get(0).get(0).asText());
        assertEquals("table", tables.get("rows").get(0).get(1).asText());

        JsonNode views = objectView(server, connId, "{\"view\":\"views\"}");
        assertEquals("v_sample", views.get("rows").get(0).get(0).asText());

        JsonNode columns = objectView(server, connId, "{\"view\":\"columns\",\"table\":\"sample\"}");
        assertEquals("Columns", columns.get("title").asText());
        assertEquals("id", columns.get("rows").get(0).get(0).asText());
        assertEquals("int(11)", columns.get("rows").get(0).get(1).asText());
        assertEquals("false", columns.get("rows").get(0).get(2).asText());
        assertTrue(columns.get("columns").get(2).has("align"));

        JsonNode indexes = objectView(server, connId, "{\"view\":\"indexes\",\"table\":\"sample\"}");
        assertEquals("Indexes", indexes.get("title").asText());
        JsonNode primaryRow = findRowStartingWith(indexes.get("rows"), "PRIMARY");
        assertEquals("id", primaryRow.get(1).asText());
        assertEquals("true", primaryRow.get(3).asText());

        JsonNode functions = objectView(server, connId, "{\"view\":\"functions\"}");
        assertEquals("demo_add_one", functions.get("rows").get(0).get(0).asText());

        JsonNode procedures = objectView(server, connId, "{\"view\":\"procedures\"}");
        assertEquals("demo_touch_proc", procedures.get("rows").get(0).get(0).asText());
    }

    @Test
    public void objectViewReturnsEmptyTablesForUnsupportedObjects() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        for (String name : new String[]{"triggers", "sequences"}) {
            JsonNode view = objectView(server, connId, "{\"view\":\"" + name + "\"}");
            assertEquals(0, view.get("rows").size());
            assertEquals("name", view.get("columns").get(0).get("key").asText());
        }
    }

    @Test
    public void objectViewRejectsAnUnsupportedName() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode response = server.handle(request(3, "schema/object_view", "{\"conn_id\":" + connId + ",\"view\":\"sessions\"}"));

        assertEquals(ProtocolError.NOT_SUPPORTED, response.get("error").get("code").asInt());
    }

    // ------------------------------------------------------------ dump DDL

    @Test
    public void dumpDdlPrefersShowCreateTable() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode statements = server.handle(request(3, "schema/dump_ddl", dumpRequest(connId, "table", "sample"))).get("result").get("statements");

        assertEquals(1, statements.size());
        assertEquals(OFFICIAL_DDL, statements.get(0).asText());
    }

    /**
     * When {@code SHOW CREATE TABLE} yields nothing the structure is rebuilt
     * from {@code information_schema}. GBase 8a has no {@code COMMENT ON}, so
     * column comments must travel inline inside the CREATE TABLE body.
     */
    @Test
    public void dumpDdlFallsBackToTheCatalogAndStaysReExecutable() throws Exception {
        GBase8aIpcServer server = newServer(false);
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode statements = server.handle(request(3, "schema/dump_ddl", dumpRequest(connId, "table", "sample"))).get("result").get("statements");

        assertEquals(3, statements.size());
        assertEquals(
            "CREATE TABLE `stores`.`sample` (`id` int(11) NOT NULL, `name` varchar(64) DEFAULT 'guest' COMMENT 'Sample column comment', "
                + "`price` decimal(10,2), PRIMARY KEY (`id`)) COMMENT = 'Sample table comment';",
            statements.get(0).asText()
        );
        // Index order follows the server's collation, so match on content.
        assertTrue(statements.toString(), containsStatement(statements, "CREATE UNIQUE INDEX `uk_sample_name` ON `stores`.`sample` (`name`);"));
        assertTrue(statements.toString(), containsStatement(statements, "CREATE INDEX `idx_sample_price` ON `stores`.`sample` (`price`);"));
        for (JsonNode statement : statements) {
            assertTrue(statement.asText(), statement.asText().endsWith(";"));
        }
    }

    @Test
    public void dumpDdlIgnoresNonTableTargets() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode statements = server.handle(request(3, "schema/dump_ddl", dumpRequest(connId, "view", "v_sample"))).get("result").get("statements");

        assertEquals(0, statements.size());
    }

    @Test
    public void dumpDdlWithoutObjectsReturnsAnEmptyScript() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode response = server.handle(request(3, "schema/dump_ddl", "{\"conn_id\":" + connId + "}"));

        assertEquals(0, response.get("result").get("statements").size());
    }

    // ---------------------------------------------------------- DDL builder

    @Test
    public void ddlBuildCreateTableInlinesCommentsAndTableOptions() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode result = server.handle(request(2, "ddl/build", "{\"op\":\"create_table\",\"payload\":{\"spec\":{"
            + "\"name\":\"demo\",\"schema\":\"myshop\",\"comment\":\"demo table\",\"columns\":["
            + "{\"name\":\"id\",\"type\":\"int(11)\",\"nullable\":false,\"is_primary\":true,\"comment\":\"pk\"},"
            + "{\"name\":\"name\",\"type\":\"varchar(32)\",\"nullable\":true,\"comment\":\"it's a name\"}"
            + "]},\"options\":{\"if_not_exists\":true,\"with_comments\":true}}}")).get("result");

        assertEquals(
            "CREATE TABLE IF NOT EXISTS `myshop`.`demo` (`id` int(11) NOT NULL COMMENT 'pk', "
                + "`name` varchar(32) COMMENT 'it''s a name', PRIMARY KEY (`id`)) COMMENT = 'demo table'",
            result.get("sql").asText()
        );
        assertEquals(1, result.get("statements").size());
    }

    @Test
    public void ddlBuildCreateTableCanOmitComments() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode result = server.handle(request(2, "ddl/build", "{\"op\":\"create_table\",\"payload\":{\"spec\":{"
            + "\"name\":\"demo\",\"comment\":\"demo table\",\"columns\":["
            + "{\"name\":\"id\",\"type\":\"int(11)\",\"comment\":\"pk\"}]},\"options\":{\"with_comments\":false}}}")).get("result");

        assertEquals("CREATE TABLE `demo` (`id` int(11))", result.get("sql").asText());
    }

    @Test
    public void ddlBuildCreateTableAcceptsAnExplicitPrimaryKeyList() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode result = server.handle(request(2, "ddl/build", "{\"op\":\"create_table\",\"payload\":{\"spec\":{"
            + "\"name\":\"demo\",\"primary_key\":[\"a\",\"b\"],\"columns\":["
            + "{\"name\":\"a\",\"type\":\"int(11)\"},{\"name\":\"b\",\"type\":\"int(11)\"}]}}}")).get("result");

        assertEquals("CREATE TABLE `demo` (`a` int(11), `b` int(11), PRIMARY KEY (`a`, `b`))", result.get("sql").asText());
    }

    /**
     * GBase 8a changes a column comment only as part of a full
     * {@code MODIFY COLUMN} definition, so the rebuild has to repeat the type
     * and nullability alongside the new comment.
     */
    @Test
    public void ddlBuildAlterTableUsesModifyColumnForCommentChanges() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode alter = server.handle(request(3, "ddl/build_alter_table", "{\"to_spec\":{\"name\":\"demo\",\"schema\":\"myshop\","
            + "\"comment\":\"new table comment\",\"columns\":["
            + "{\"name\":\"id\",\"type\":\"int(11)\",\"nullable\":false,\"comment\":\"new pk\"},"
            + "{\"name\":\"added\",\"type\":\"varchar(8)\",\"comment\":\"brand new\"}]},"
            + "\"from_spec\":{\"name\":\"demo\",\"comment\":\"old table comment\",\"columns\":["
            + "{\"name\":\"id\",\"type\":\"int(11)\",\"nullable\":false,\"comment\":\"old pk\"},"
            + "{\"name\":\"legacy\",\"type\":\"int(11)\"}]},"
            + "\"column_renames\":[{\"old_name\":\"old\",\"new_name\":\"renamed\"}],"
            + "\"options\":{\"with_rollback\":true,\"allow_destructive\":true}}")).get("result");

        JsonNode statements = alter.get("statements");
        assertEquals(5, statements.size());
        assertEquals("ALTER TABLE `myshop`.`demo` COMMENT = 'new table comment'", statements.get(0).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` RENAME COLUMN `old` TO `renamed`", statements.get(1).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` ADD `added` varchar(8) COMMENT 'brand new'", statements.get(2).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` DROP `legacy`", statements.get(3).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` MODIFY COLUMN `id` int(11) NOT NULL COMMENT 'new pk'", statements.get(4).asText());

        JsonNode rollback = alter.get("rollback_statements");
        assertEquals("ALTER TABLE `myshop`.`demo` MODIFY COLUMN `id` int(11) NOT NULL COMMENT 'old pk'", rollback.get(0).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` DROP `added`", rollback.get(1).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` RENAME COLUMN `renamed` TO `old`", rollback.get(2).asText());
        assertEquals("ALTER TABLE `myshop`.`demo` COMMENT = 'old table comment'", rollback.get(3).asText());
        assertEquals(1, alter.get("warnings").size());
    }

    @Test
    public void ddlBuildDropQuotesTheTargetAndHonoursFlags() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode result = server.handle(request(2, "ddl/build", "{\"op\":\"drop_table\",\"payload\":{"
            + "\"kind\":\"table\",\"name\":\"demo\",\"schema\":\"myshop\",\"if_exists\":true,\"cascade\":true}}")).get("result");

        assertEquals("DROP TABLE IF EXISTS `myshop`.`demo` CASCADE", result.get("sql").asText());
    }

    @Test
    public void ddlBuildDatabaseStatementsUseBacktickQuotingWithoutWithLog() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode created = server.handle(request(2, "ddl/build", "{\"op\":\"create_database\",\"payload\":{\"database_name\":\"shop\"}}")).get("result");
        assertEquals("CREATE DATABASE `shop`", created.get("sql").asText());

        JsonNode dropped = server.handle(request(3, "ddl/build", "{\"op\":\"drop_database\",\"payload\":{\"database_name\":\"shop\"}}")).get("result");
        assertEquals("DROP DATABASE `shop`", dropped.get("sql").asText());
    }

    @Test
    public void ddlBuildRejectsUnsupportedOperations() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));

        JsonNode response = server.handle(request(2, "ddl/build", "{\"op\":\"create_index\",\"payload\":{}}"));

        assertEquals(ProtocolError.INVALID_PARAMS, response.get("error").get("code").asInt());
    }

    // -------------------------------------------------------------- queries

    @Test
    public void queryStartPagesRowsThroughACursor() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode started = server.handle(request(3, "query/start", "{\"conn_id\":" + connId
            + ",\"sql\":\"SELECT id, name FROM sample ORDER BY id\"}")).get("result");
        String cursorId = started.get("cursor_id").asText();
        assertTrue(cursorId.startsWith("gbase8a-cursor-"));
        assertEquals(3, started.get("row_count_estimate").asInt());
        assertEquals("id", started.get("columns").get(0).get("name").asText());

        JsonNode first = server.handle(request(4, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\",\"n\":2}")).get("result");
        assertEquals(2, first.get("rows").size());
        assertFalse(first.get("done").asBoolean());
        assertEquals("alpha", first.get("rows").get(0).get(1).get("value").asText());

        JsonNode second = server.handle(request(5, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\",\"n\":2}")).get("result");
        assertEquals(1, second.get("rows").size());
        assertTrue(second.get("done").asBoolean());

        assertTrue(server.handle(request(6, "cursor/close", "{\"cursor_id\":\"" + cursorId + "\"}")).has("result"));
        JsonNode closed = server.handle(request(7, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}"));
        assertEquals(ProtocolError.UNKNOWN_CURSOR_ID, closed.get("error").get("code").asInt());
    }

    @Test
    public void cursorCancelDropsTheCursor() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String cursorId = server.handle(request(3, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT 1\"}"))
            .get("result").get("cursor_id").asText();

        assertTrue(server.handle(request(4, "cursor/cancel", "{\"cursor_id\":\"" + cursorId + "\"}")).has("result"));
        JsonNode again = server.handle(request(5, "cursor/cancel", "{\"cursor_id\":\"" + cursorId + "\"}"));
        assertEquals(ProtocolError.UNKNOWN_CURSOR_ID, again.get("error").get("code").asInt());
    }

    @Test
    public void execRunReportsAffectedRows() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode result = server.handle(request(3, "exec/run", "{\"conn_id\":" + connId
            + ",\"sql\":\"UPDATE sample SET name = ? WHERE id = ?\",\"params\":[{\"type\":\"text\",\"value\":\"x\"},{\"type\":\"i64\",\"value\":1}]}"))
            .get("result");

        assertEquals(1, result.get("affected_rows").asInt());
    }

    @Test
    public void execBatchStopsOnTheFirstErrorByDefault() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode result = server.handle(request(3, "exec/batch", "{\"conn_id\":" + connId + ",\"statements\":["
            + "\"UPDATE sample SET name = 'ok' WHERE id = 1\","
            + "\"UPDATE nope SET name = 'bad'\","
            + "\"UPDATE sample SET name = 'never' WHERE id = 2\"]}")).get("result");

        assertEquals(1, result.get("results").size());
        assertEquals(1, result.get("errors").size());
        assertEquals(1, result.get("errors").get(0).get("index").asInt());
    }

    @Test
    public void execBatchContinuesWhenStopOnErrorIsDisabled() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode result = server.handle(request(3, "exec/batch", "{\"conn_id\":" + connId
            + ",\"stop_on_error\":false,\"statements\":["
            + "\"UPDATE nope SET name = 'bad'\","
            + "\"UPDATE sample SET name = 'ok' WHERE id = 1\"]}")).get("result");

        assertEquals(1, result.get("results").size());
        assertEquals(1, result.get("errors").size());
    }

    @Test
    public void execBatchRollsBackATransactionWhenAStatementFails() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        server.handle(request(3, "exec/batch", "{\"conn_id\":" + connId + ",\"in_transaction\":true,\"statements\":["
            + "\"UPDATE sample SET name = 'rolled-back' WHERE id = 1\","
            + "\"UPDATE nope SET name = 'bad'\"]}"));

        JsonNode name = server.handle(request(4, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT name FROM sample WHERE id = 1\"}"));
        String cursorId = name.get("result").get("cursor_id").asText();
        JsonNode rows = server.handle(request(5, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}")).get("result").get("rows");

        assertEquals("alpha", rows.get(0).get(0).get("value").asText());
    }

    @Test
    public void execBatchCommitsATransactionWhenEveryStatementSucceeds() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        server.handle(request(3, "exec/batch", "{\"conn_id\":" + connId + ",\"in_transaction\":true,\"statements\":["
            + "\"UPDATE sample SET name = 'committed' WHERE id = 1\"]}"));

        JsonNode name = server.handle(request(4, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT name FROM sample WHERE id = 1\"}"));
        String cursorId = name.get("result").get("cursor_id").asText();
        JsonNode rows = server.handle(request(5, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}")).get("result").get("rows");

        assertEquals("committed", rows.get(0).get(0).get("value").asText());
    }

    // --------------------------------------------------------- transactions

    @Test
    public void transactionLifecycleCommitsAndRollsBack() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String txId = server.handle(request(3, "tx/begin", "{\"conn_id\":" + connId + "}")).get("result").get("tx_id").asText();
        assertTrue(txId.startsWith("gbase8a-tx-"));

        JsonNode nested = server.handle(request(4, "tx/begin", "{\"conn_id\":" + connId + "}"));
        assertEquals(ProtocolError.INVALID_PARAMS, nested.get("error").get("code").asInt());

        server.handle(request(5, "exec/run", "{\"conn_id\":" + connId + ",\"tx_id\":\"" + txId + "\",\"sql\":\"UPDATE sample SET name = 'tx' WHERE id = 1\"}"));
        assertTrue(server.handle(request(6, "tx/commit", "{\"tx_id\":\"" + txId + "\"}")).has("result"));

        JsonNode name = server.handle(request(7, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT name FROM sample WHERE id = 1\"}"));
        String cursorId = name.get("result").get("cursor_id").asText();
        JsonNode rows = server.handle(request(8, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}")).get("result").get("rows");
        assertEquals("tx", rows.get(0).get(0).get("value").asText());

        JsonNode afterCommit = server.handle(request(9, "tx/commit", "{\"tx_id\":\"" + txId + "\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, afterCommit.get("error").get("code").asInt());
    }

    @Test
    public void transactionRollsBackToASavepoint() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String txId = server.handle(request(3, "tx/begin", "{\"conn_id\":" + connId + "}")).get("result").get("tx_id").asText();
        server.handle(request(4, "exec/run", "{\"conn_id\":" + connId + ",\"tx_id\":\"" + txId + "\",\"sql\":\"UPDATE sample SET name = 'first' WHERE id = 1\"}"));
        assertTrue(server.handle(request(5, "tx/savepoint", "{\"tx_id\":\"" + txId + "\",\"name\":\"sp1\"}")).has("result"));
        server.handle(request(6, "exec/run", "{\"conn_id\":" + connId + ",\"tx_id\":\"" + txId + "\",\"sql\":\"UPDATE sample SET name = 'second' WHERE id = 1\"}"));
        assertTrue(server.handle(request(7, "tx/rollback", "{\"tx_id\":\"" + txId + "\",\"to_savepoint\":\"sp1\"}")).has("result"));

        JsonNode name = server.handle(request(8, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT name FROM sample WHERE id = 1\"}"));
        String cursorId = name.get("result").get("cursor_id").asText();
        JsonNode rows = server.handle(request(9, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}")).get("result").get("rows");

        assertEquals("first", rows.get(0).get(0).get("value").asText());
        assertTrue(server.handle(request(10, "tx/rollback", "{\"tx_id\":\"" + txId + "\"}")).has("result"));
    }

    @Test
    public void transactionReleaseDropsTheSavepoint() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String txId = server.handle(request(3, "tx/begin", "{\"conn_id\":" + connId + "}")).get("result").get("tx_id").asText();
        server.handle(request(4, "tx/savepoint", "{\"tx_id\":\"" + txId + "\",\"name\":\"sp1\"}"));

        assertTrue(server.handle(request(5, "tx/release", "{\"tx_id\":\"" + txId + "\",\"name\":\"sp1\"}")).has("result"));

        JsonNode again = server.handle(request(6, "tx/release", "{\"tx_id\":\"" + txId + "\",\"name\":\"sp1\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, again.get("error").get("code").asInt());

        JsonNode rollbackTo = server.handle(request(7, "tx/rollback", "{\"tx_id\":\"" + txId + "\",\"to_savepoint\":\"sp1\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, rollbackTo.get("error").get("code").asInt());
    }

    @Test
    public void transactionRejectsAnUnknownOrForeignTxId() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode unknown = server.handle(request(3, "tx/commit", "{\"tx_id\":\"missing\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, unknown.get("error").get("code").asInt());

        String txId = server.handle(request(4, "tx/begin", "{\"conn_id\":" + connId + "}")).get("result").get("tx_id").asText();
        JsonNode foreign = server.handle(request(5, "exec/run", "{\"conn_id\":999,\"tx_id\":\"" + txId + "\",\"sql\":\"SELECT 1\"}"));
        assertEquals(ProtocolError.UNKNOWN_CONN_ID, foreign.get("error").get("code").asInt());
    }

    // ----------------------------------------------------------- export/dump

    @Test
    public void dataExportWritesCsvJsonAndNdjsonToAStream() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        assertTrue(exportText(server, connId, "csv", 2).startsWith("id,name\n1,alpha\n"));
        assertTrue(exportText(server, connId, "json", 3).contains("\"name\":\"alpha\""));
        assertTrue(exportText(server, connId, "ndjson", 4).contains("\"id\":1"));
    }

    @Test
    public void streamReadDeliversChunksUntilDone() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        server.handle(request(3, "data/export", "{\"conn_id\":" + connId + ",\"stream_id\":\"s1\","
            + "\"sql\":\"SELECT * FROM sample ORDER BY id\",\"format\":\"csv\",\"options\":{}}"));

        JsonNode first = server.handle(request(4, "stream/read", "{\"stream_id\":\"s1\",\"max_bytes\":5}")).get("result");
        assertEquals(5, Base64.getDecoder().decode(first.get("data").asText()).length);
        assertFalse(first.get("done").asBoolean());

        JsonNode rest = server.handle(request(5, "stream/read", "{\"stream_id\":\"s1\"}")).get("result");
        assertTrue(rest.get("done").asBoolean());

        JsonNode gone = server.handle(request(6, "stream/read", "{\"stream_id\":\"s1\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, gone.get("error").get("code").asInt());
    }

    @Test
    public void streamCloseDropsTheStream() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        server.handle(request(3, "data/export", "{\"conn_id\":" + connId + ",\"stream_id\":\"s1\","
            + "\"sql\":\"SELECT * FROM sample\",\"format\":\"csv\",\"options\":{}}"));

        assertTrue(server.handle(request(4, "stream/close", "{\"stream_id\":\"s1\"}")).has("result"));
        JsonNode gone = server.handle(request(5, "stream/read", "{\"stream_id\":\"s1\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, gone.get("error").get("code").asInt());
    }

    @Test
    public void dataExportWithoutSqlFallsBackToTheWholeTable() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode result = server.handle(request(3, "data/export", "{\"conn_id\":" + connId + ",\"stream_id\":\"s1\","
            + "\"schema\":\"PUBLIC\",\"table\":\"sample\",\"format\":\"csv\",\"options\":{}}")).get("result");

        assertEquals("csv", result.get("metadata").get("format").asText());
        assertEquals(3, result.get("estimated_rows").asInt());
        assertTrue(result.get("estimated_bytes").asLong() > 0);
    }

    @Test
    public void dataImportStreamsRowsIntoTheTargetTable() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String importId = server.handle(request(3, "data/import_begin", "{\"conn_id\":" + connId
            + ",\"format\":\"json\",\"table\":\"sample\",\"columns\":[\"id\",\"name\"]}")).get("result").get("import_id").asText();
        assertTrue(importId.startsWith("gbase8a-import-"));

        JsonNode chunk = server.handle(request(4, "data/import_chunk", "{\"import_id\":\"" + importId + "\",\"rows\":["
            + "[{\"type\":\"i64\",\"value\":40},{\"type\":\"text\",\"value\":\"delta\"}],"
            + "[{\"type\":\"i64\",\"value\":41},{\"type\":\"text\",\"value\":\"epsilon\"}]]}")).get("result");
        assertEquals(2, chunk.get("inserted").asInt());

        JsonNode commit = server.handle(request(5, "data/import_commit", "{\"import_id\":\"" + importId + "\"}")).get("result");
        assertEquals(2, commit.get("inserted").asInt());
        assertEquals(0, commit.get("updated").asInt());
        assertTrue(commit.has("elapsed_ms"));

        JsonNode after = server.handle(request(6, "data/import_commit", "{\"import_id\":\"" + importId + "\"}"));
        assertEquals(ProtocolError.INVALID_PARAMS, after.get("error").get("code").asInt());
    }

    @Test
    public void dataImportRejectsAnUnsupportedFormat() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        JsonNode response = server.handle(request(3, "data/import_begin", "{\"conn_id\":" + connId
            + ",\"format\":\"xml\",\"table\":\"sample\"}"));

        assertEquals(ProtocolError.INVALID_PARAMS, response.get("error").get("code").asInt());
    }

    @Test
    public void dataImportAbortDropsTheImportWithoutWriting() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);

        String importId = server.handle(request(3, "data/import_begin", "{\"conn_id\":" + connId
            + ",\"format\":\"csv\",\"table\":\"sample\"}")).get("result").get("import_id").asText();

        assertTrue(server.handle(request(4, "data/import_abort", "{\"import_id\":\"" + importId + "\"}")).has("result"));
        JsonNode gone = server.handle(request(5, "data/import_chunk", "{\"import_id\":\"" + importId + "\",\"rows\":[]}"));
        assertEquals(ProtocolError.INVALID_PARAMS, gone.get("error").get("code").asInt());
    }

    // ------------------------------------------------------------ shutdown

    @Test
    public void shutdownClosesEveryConnectionAndCursor() throws Exception {
        GBase8aIpcServer server = newServer();
        server.handle(request(1, "init", "{\"host_version\":\"0.10.0\"}"));
        long connId = open(server);
        String cursorId = server.handle(request(3, "query/start", "{\"conn_id\":" + connId + ",\"sql\":\"SELECT 1\"}"))
            .get("result").get("cursor_id").asText();

        assertTrue(server.handle(request(4, "shutdown", "{}")).has("result"));

        assertEquals(ProtocolError.UNKNOWN_CURSOR_ID, server.handle(request(5, "cursor/fetch", "{\"cursor_id\":\"" + cursorId + "\"}")).get("error").get("code").asInt());
        assertEquals(ProtocolError.UNKNOWN_CONN_ID, server.handle(request(6, "conn/ping", "{\"conn_id\":" + connId + "}")).get("error").get("code").asInt());
    }

    @Test
    public void malformedRequestsAreRejected() throws Exception {
        GBase8aIpcServer server = newServer();

        JsonNode response = server.handle(MAPPER.readTree("{\"jsonrpc\":\"1.0\",\"id\":1,\"method\":\"$/ping\"}"));

        assertEquals(ProtocolError.INVALID_REQUEST, response.get("error").get("code").asInt());
    }

    // ------------------------------------------------------------- helpers

    private static String exportText(GBase8aIpcServer server, long connId, String format, int requestId) throws Exception {
        server.handle(request(requestId, "data/export", "{\"conn_id\":" + connId + ",\"stream_id\":\"s-" + format + "\","
            + "\"sql\":\"SELECT id, name FROM sample ORDER BY id\",\"format\":\"" + format + "\",\"options\":{}}"));
        JsonNode read = server.handle(request(requestId + 100, "stream/read", "{\"stream_id\":\"s-" + format + "\"}")).get("result");
        return new String(Base64.getDecoder().decode(read.get("data").asText()), "UTF-8");
    }

    private static JsonNode objectView(GBase8aIpcServer server, long connId, String params) throws Exception {
        return server.handle(request(50, "schema/object_view", "{\"conn_id\":" + connId + "," + params.substring(1)))
            .get("result");
    }

    private static long open(GBase8aIpcServer server) throws Exception {
        return server.handle(request(2, "conn/open", configJson("gbase8a")))
            .get("result")
            .get("conn_id")
            .asLong();
    }

    private static String dumpRequest(long connId, String kind, String name) {
        return "{\"conn_id\":" + connId + ",\"objects\":[{\"kind\":\"" + kind + "\",\"name\":\"" + name
            + "\",\"schema\":\"stores\",\"database\":\"stores\"}],\"options\":{}}";
    }

    private static JsonNode request(int id, String method, String params) throws Exception {
        return MAPPER.readTree("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"method\":\"" + method + "\",\"params\":" + params + "}");
    }

    private static JsonNode findByName(JsonNode rows, String name) {
        for (JsonNode row : rows) {
            if (name.equals(row.get("name").asText())) {
                return row;
            }
        }
        throw new AssertionError("missing row named " + name + ": " + rows);
    }

    private static JsonNode findRowStartingWith(JsonNode rows, String prefix) {
        for (JsonNode row : rows) {
            if (row.get(0).asText().startsWith(prefix)) {
                return row;
            }
        }
        throw new AssertionError("missing row starting with " + prefix + ": " + rows);
    }

    private static boolean containsStatement(JsonNode statements, String expected) {
        for (JsonNode statement : statements) {
            if (expected.equals(statement.asText())) {
                return true;
            }
        }
        return false;
    }

    private static String configJson(String driverId) {
        return "{\"driver_id\":\"" + driverId + "\",\"config\":{\"host\":\"127.0.0.1\",\"port\":5258,"
            + "\"username\":\"gbase\",\"password\":\"secret\",\"database\":\"stores\"}}";
    }

    private GBase8aIpcServer newServer() {
        return newServer(true);
    }

    private GBase8aIpcServer newServer(final boolean showCreateTable) {
        return new GBase8aIpcServer(new JdbcConnectionFactory() {
            @Override
            public Connection open(GBase8aConfig config) throws Exception {
                return fixtureConnection(showCreateTable);
            }
        });
    }

    /**
     * Stands up a MySQL-shaped {@code information_schema} and hands back a proxy
     * that points the driver's catalog queries at it.
     */
    private static Connection fixtureConnection(boolean showCreateTable) throws Exception {
        Connection delegate = DriverManager.getConnection(
            "jdbc:h2:mem:gbase8a_server_" + SERVER_DB_COUNTER.incrementAndGet() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE"
        );
        Statement statement = delegate.createStatement();
        statement.execute("CREATE TABLE sample (id INT NOT NULL, name VARCHAR(64), price DECIMAL(10,2))");
        statement.execute("INSERT INTO sample VALUES (1, 'alpha', 1.50)");
        statement.execute("INSERT INTO sample VALUES (2, 'beta', 2.50)");
        statement.execute("INSERT INTO sample VALUES (3, 'gamma', 3.50)");

        statement.execute("CREATE SCHEMA " + CATALOG_SCHEMA);
        statement.execute("CREATE TABLE " + CATALOG_SCHEMA + ".SCHEMATA (SCHEMA_NAME VARCHAR(64))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".SCHEMATA VALUES ('stores')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA
            + ".TABLES (TABLE_SCHEMA VARCHAR(64), TABLE_NAME VARCHAR(64), TABLE_TYPE VARCHAR(32), TABLE_COMMENT VARCHAR(255))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".TABLES VALUES ('stores', 'sample', 'BASE TABLE', 'Sample table comment')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".TABLES VALUES ('stores', 'v_sample', 'VIEW', 'Sample view comment')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA + ".COLUMNS (TABLE_SCHEMA VARCHAR(64), TABLE_NAME VARCHAR(64), "
            + "COLUMN_NAME VARCHAR(64), ORDINAL_POSITION INT, DATA_TYPE VARCHAR(64), COLUMN_TYPE VARCHAR(128), "
            + "IS_NULLABLE VARCHAR(8), COLUMN_DEFAULT VARCHAR(255), COLUMN_COMMENT VARCHAR(255), "
            + "CHARACTER_MAXIMUM_LENGTH INT, NUMERIC_PRECISION INT, NUMERIC_SCALE INT, COLUMN_KEY VARCHAR(8), EXTRA VARCHAR(64))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".COLUMNS VALUES ('stores', 'sample', 'id', 1, 'int', 'int(11)', "
            + "'NO', NULL, '', NULL, 10, 0, 'PRI', 'auto_increment')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".COLUMNS VALUES ('stores', 'sample', 'name', 2, 'varchar', 'varchar(64)', "
            + "'YES', 'guest', 'Sample column comment', 64, NULL, NULL, 'UNI', '')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".COLUMNS VALUES ('stores', 'sample', 'price', 3, 'decimal', 'decimal(10,2)', "
            + "'YES', NULL, '', NULL, 10, 2, 'MUL', '')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA
            + ".STATISTICS (TABLE_SCHEMA VARCHAR(64), TABLE_NAME VARCHAR(64), INDEX_NAME VARCHAR(64), NON_UNIQUE INT, "
            + "SEQ_IN_INDEX INT, COLUMN_NAME VARCHAR(64))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".STATISTICS VALUES ('stores', 'sample', 'PRIMARY', 0, 1, 'id')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".STATISTICS VALUES ('stores', 'sample', 'uk_sample_name', 0, 1, 'name')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".STATISTICS VALUES ('stores', 'sample', 'idx_sample_price', 1, 1, 'price')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA + ".VIEWS (TABLE_SCHEMA VARCHAR(64), TABLE_NAME VARCHAR(64), VIEW_DEFINITION VARCHAR(1024))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".VIEWS VALUES ('stores', 'v_sample', 'select `id`,`name` from `sample`')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA + ".ROUTINES (ROUTINE_NAME VARCHAR(64), ROUTINE_SCHEMA VARCHAR(64), "
            + "ROUTINE_TYPE VARCHAR(16), DTD_IDENTIFIER VARCHAR(128), ROUTINE_COMMENT VARCHAR(255), ROUTINE_DEFINITION VARCHAR(1024))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".ROUTINES VALUES ('demo_add_one', 'stores', 'FUNCTION', 'decimal(10,2)', "
            + "'adds one', 'RETURN p + 1')");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".ROUTINES VALUES ('demo_touch_proc', 'stores', 'PROCEDURE', NULL, "
            + "'touches rows', 'UPDATE sample SET name = name')");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA + ".KEY_COLUMN_USAGE (CONSTRAINT_SCHEMA VARCHAR(64), "
            + "CONSTRAINT_NAME VARCHAR(64), TABLE_SCHEMA VARCHAR(64), TABLE_NAME VARCHAR(64), COLUMN_NAME VARCHAR(64), "
            + "REFERENCED_TABLE_NAME VARCHAR(64), REFERENCED_COLUMN_NAME VARCHAR(64), ORDINAL_POSITION INT)");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".KEY_COLUMN_USAGE VALUES ('stores', 'fk_child_parent', 'stores', "
            + "'child', 'parent_id', 'parent', 'id', 1)");

        statement.execute("CREATE TABLE " + CATALOG_SCHEMA
            + ".REFERENTIAL_CONSTRAINTS (CONSTRAINT_SCHEMA VARCHAR(64), CONSTRAINT_NAME VARCHAR(64), "
            + "UPDATE_RULE VARCHAR(32), DELETE_RULE VARCHAR(32))");
        statement.execute("INSERT INTO " + CATALOG_SCHEMA + ".REFERENTIAL_CONSTRAINTS VALUES ('stores', 'fk_child_parent', 'RESTRICT', 'CASCADE')");

        statement.close();
        return wrap(delegate, showCreateTable);
    }

    private static Connection wrap(final Connection delegate, final boolean showCreateTable) {
        return (Connection) Proxy.newProxyInstance(
            GBase8aIpcServerTest.class.getClassLoader(),
            new Class<?>[]{Connection.class},
            new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                    String name = method.getName();
                    if ("createStatement".equals(name)) {
                        return wrapStatement((Statement) method.invoke(delegate, args), showCreateTable);
                    }
                    if ("prepareStatement".equals(name)) {
                        Object[] rewritten = args.clone();
                        rewritten[0] = rewrite(String.valueOf(args[0]), showCreateTable);
                        return invokeOn(method, delegate, rewritten);
                    }
                    if ("equals".equals(name)) {
                        return Boolean.valueOf(proxy == args[0]);
                    }
                    if ("hashCode".equals(name)) {
                        return Integer.valueOf(System.identityHashCode(proxy));
                    }
                    if ("toString".equals(name)) {
                        return "gbase8a-fixture-connection";
                    }
                    return invokeOn(method, delegate, args);
                }
            }
        );
    }

    private static Statement wrapStatement(final Statement delegate, final boolean showCreateTable) {
        return (Statement) Proxy.newProxyInstance(
            GBase8aIpcServerTest.class.getClassLoader(),
            new Class<?>[]{Statement.class},
            new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                    if ("executeQuery".equals(method.getName()) && args != null && args.length == 1
                        && args[0] instanceof String) {
                        Object[] rewritten = args.clone();
                        rewritten[0] = rewrite((String) args[0], showCreateTable);
                        return invokeOn(method, delegate, rewritten);
                    }
                    return invokeOn(method, delegate, args);
                }
            }
        );
    }

    private static Object invokeOn(Method method, Object target, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException error) {
            throw error.getCause();
        }
    }

    /**
     * Points catalog queries at the fixture schema and answers
     * {@code SHOW CREATE TABLE}, which H2 does not implement.
     */
    private static String rewrite(String sql, boolean showCreateTable) {
        if (sql == null) {
            return null;
        }
        if (sql.trim().toUpperCase(java.util.Locale.ROOT).startsWith("SHOW CREATE TABLE")) {
            if (!showCreateTable) {
                return "SELECT '' AS \"Table\", '' AS \"Create Table\" FROM " + CATALOG_SCHEMA + ".SCHEMATA WHERE 1 = 0";
            }
            return "SELECT 'sample' AS \"Table\", '" + OFFICIAL_DDL.replace("'", "''") + "' AS \"Create Table\"";
        }
        return sql.replace("information_schema.", CATALOG_SCHEMA + ".");
    }
}
