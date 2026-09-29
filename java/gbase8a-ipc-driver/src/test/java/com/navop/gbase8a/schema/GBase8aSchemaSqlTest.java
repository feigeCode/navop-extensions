package com.navop.gbase8a.schema;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class GBase8aSchemaSqlTest {
    @Test
    public void databasesSqlReadsInformationSchemaSchemata() {
        assertEquals(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
            GBase8aSchemaSql.databasesSql()
        );
    }

    @Test
    public void schemasSqlEchoesTheNameInTheOwnerPosition() {
        assertEquals(
            "SELECT SCHEMA_NAME, SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
            GBase8aSchemaSql.schemasSql("stores")
        );
    }

    /**
     * GBase 8a has no separate schema level: the tree's schema is the database,
     * and an unset schema falls back to the connection default.
     */
    @Test
    public void catalogPrefersSchemaThenDatabase() {
        assertEquals("shop", GBase8aSchemaSql.catalog("stores", "shop"));
        assertEquals("stores", GBase8aSchemaSql.catalog("stores", ""));
        assertEquals("stores", GBase8aSchemaSql.catalog("stores", "   "));
        assertEquals("", GBase8aSchemaSql.catalog("", ""));
    }

    @Test
    public void objectsSqlFiltersByCatalogAndKind() {
        assertEquals(
            "SELECT TABLE_NAME, CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END, "
                + "COALESCE(TABLE_COMMENT, '') FROM information_schema.TABLES "
                + "WHERE TABLE_SCHEMA = 'shop' AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME",
            GBase8aSchemaSql.objectsSql("stores", "shop", Collections.singletonList("view"))
        );
    }

    @Test
    public void objectsSqlWithoutKindsListsTablesAndViewsTogether() {
        String sql = GBase8aSchemaSql.objectsSql("stores", "", Collections.<String>emptyList());

        assertTrue(sql, sql.contains("WHERE TABLE_SCHEMA = 'stores' ORDER BY TABLE_NAME"));
        // No kind filtering is applied, so the WHERE clause stops at the schema.
        assertFalse(sql, sql.contains("AND TABLE_TYPE"));
    }

    @Test
    public void objectsSqlWithUnknownKindsMatchesNothing() {
        assertTrue(
            GBase8aSchemaSql.objectsSql("stores", "", Collections.singletonList("sequence"))
                .contains("AND 1 = 0")
        );
    }

    @Test
    public void tablesSqlAndViewsSqlSplitOnTableType() {
        assertEquals(
            "SELECT TABLE_NAME, 'table', COALESCE(TABLE_COMMENT, '') FROM information_schema.TABLES "
                + "WHERE TABLE_SCHEMA = 'stores' AND TABLE_TYPE <> 'VIEW' ORDER BY TABLE_NAME",
            GBase8aSchemaSql.tablesSql("stores", "")
        );
        assertEquals(
            "SELECT TABLE_NAME, 'view', COALESCE(TABLE_COMMENT, '') FROM information_schema.TABLES "
                + "WHERE TABLE_SCHEMA = 'stores' AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME",
            GBase8aSchemaSql.viewsSql("stores", "")
        );
    }

    /**
     * COLUMN_TYPE carries the full type text, which is why the driver never has
     * to decode a numeric type code the way the GBase 8s driver does.
     */
    @Test
    public void columnsSqlSelectsTheServerProvidedTypeText() {
        String sql = GBase8aSchemaSql.columnsSql("stores", "", "order'items");

        assertTrue(sql, sql.contains("COALESCE(COLUMN_TYPE, DATA_TYPE, '')"));
        assertTrue(sql, sql.contains("AND TABLE_NAME = 'order''items'"));
        assertTrue(sql, sql.endsWith("ORDER BY ORDINAL_POSITION"));
    }

    @Test
    public void columnIndexContractMatchesTheServerReader() {
        assertEquals(0, GBase8aSchemaSql.ColumnIndex.ORDINAL);
        assertEquals(1, GBase8aSchemaSql.ColumnIndex.NAME);
        assertEquals(2, GBase8aSchemaSql.ColumnIndex.DATA_TYPE);
        assertEquals(3, GBase8aSchemaSql.ColumnIndex.COLUMN_TYPE);
        assertEquals(4, GBase8aSchemaSql.ColumnIndex.NULLABLE);
        assertEquals(5, GBase8aSchemaSql.ColumnIndex.DEFAULT);
        assertEquals(6, GBase8aSchemaSql.ColumnIndex.COMMENT);
        assertEquals(7, GBase8aSchemaSql.ColumnIndex.MAX_LENGTH);
        assertEquals(8, GBase8aSchemaSql.ColumnIndex.PRECISION);
        assertEquals(9, GBase8aSchemaSql.ColumnIndex.SCALE);
        assertEquals(10, GBase8aSchemaSql.ColumnIndex.KEY);
        assertEquals(11, GBase8aSchemaSql.ColumnIndex.EXTRA);
    }

    @Test
    public void primaryKeyColumnsComeFromThePrimaryIndex() {
        assertEquals(
            "SELECT COLUMN_NAME FROM information_schema.STATISTICS "
                + "WHERE TABLE_SCHEMA = 'stores' AND TABLE_NAME = 'sample' AND INDEX_NAME = 'PRIMARY' "
                + "ORDER BY SEQ_IN_INDEX",
            GBase8aSchemaSql.primaryKeyColumnsSql("stores", "", "sample")
        );
    }

    @Test
    public void indexesSqlEmitsTheMarkersTheServerReads() {
        String sql = GBase8aSchemaSql.indexesSql("stores", "", "sample");

        assertTrue(sql, sql.contains("CASE WHEN NON_UNIQUE = 0 THEN 'U' ELSE 'D' END"));
        assertTrue(sql, sql.contains("CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'P' ELSE '' END"));
    }

    @Test
    public void foreignKeysSqlJoinsReferentialRulesAsText() {
        String sql = GBase8aSchemaSql.foreignKeysSql("stores", "", "sample");

        assertTrue(sql, sql.contains("REFERENTIAL_CONSTRAINTS"));
        assertTrue(sql, sql.contains("UPDATE_RULE"));
        assertTrue(sql, sql.contains("DELETE_RULE"));
        assertTrue(sql, sql.contains("REFERENCED_TABLE_NAME IS NOT NULL"));
    }

    @Test
    public void routinesSqlSeparatesFunctionsFromProcedures() {
        assertTrue(GBase8aSchemaSql.functionsSql("stores", "").contains("ROUTINE_TYPE = 'FUNCTION'"));
        assertTrue(GBase8aSchemaSql.proceduresSql("stores", "").contains("ROUTINE_TYPE = 'PROCEDURE'"));
    }

    @Test
    public void viewDefinitionSqlReadsInformationSchemaViews() {
        assertEquals(
            "SELECT COALESCE(VIEW_DEFINITION, ''), 'NO' FROM information_schema.VIEWS "
                + "WHERE TABLE_SCHEMA = 'stores' AND TABLE_NAME = 'v_sample'",
            GBase8aSchemaSql.viewDefinitionSql("stores", "", "v_sample")
        );
    }

    @Test
    public void dumpDdlUsesShowCreateTableWithBacktickQuoting() {
        assertEquals(
            "SHOW CREATE TABLE `store_sales`.`order``items`",
            GBase8aSchemaSql.dumpDdlSql("", "store_sales", "order`items")
        );
    }

    @Test
    public void quoteIdentifierEscapesEmbeddedBackticks() {
        assertEquals("`name`", GBase8aSchemaSql.quoteIdentifier("name"));
        assertEquals("`a``b`", GBase8aSchemaSql.quoteIdentifier("a`b"));
        assertEquals("`trimmed`", GBase8aSchemaSql.quoteIdentifier("  trimmed  "));
        assertEquals("``", GBase8aSchemaSql.quoteIdentifier(""));
        assertEquals("", GBase8aSchemaSql.quoteIdentifier(null));
    }

    @Test
    public void qualifiedIdentifierFallsBackToDatabaseAndQuotesBothParts() {
        assertEquals("`shop`.`t`", GBase8aSchemaSql.qualifiedIdentifier("", "shop", "t"));
        assertEquals("`stores`.`t`", GBase8aSchemaSql.qualifiedIdentifier("stores", "", "t"));
        assertEquals("`t`", GBase8aSchemaSql.qualifiedIdentifier("", "", "t"));
    }

    @Test
    public void escapeSqlDoublesQuotesAndToleratesNull() {
        assertEquals("it''s", GBase8aSchemaSql.escapeSql("it's"));
        assertEquals("", GBase8aSchemaSql.escapeSql(null));
    }

    @Test
    public void objectsSqlAcceptsBothTableKindSpellings() {
        String sql = GBase8aSchemaSql.objectsSql("stores", "", Arrays.asList("table", "base_table"));

        assertTrue(sql, sql.contains("AND TABLE_TYPE <> 'VIEW'"));
    }
}
