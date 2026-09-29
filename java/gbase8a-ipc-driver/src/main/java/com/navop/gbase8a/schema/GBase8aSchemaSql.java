package com.navop.gbase8a.schema;

import java.util.List;
import java.util.Locale;

/**
 * Catalog queries for GBase 8a.
 *
 * <p>GBase 8a is a MySQL-wire distributed column-store, so its catalog is
 * {@code information_schema}, not the Informix-style {@code sysmaster} /
 * {@code systables} family used by GBase 8s. There is no separate schema level:
 * a GBase 8a database <em>is</em> the schema, which is why every query below
 * resolves its target through {@link #catalog(String, String)}.</p>
 *
 * <p>Every method returns a plain {@code SELECT} whose column positions match
 * the contract the IPC server reads. List queries are ordered explicitly so a
 * tree refresh is stable.</p>
 */
public final class GBase8aSchemaSql {
    private GBase8aSchemaSql() {
    }

    /**
     * Column order consumed by the server's {@code readColumns}. Keep the two
     * sides in sync when editing.
     */
    public static final class ColumnIndex {
        public static final int ORDINAL = 0;
        public static final int NAME = 1;
        public static final int DATA_TYPE = 2;
        public static final int COLUMN_TYPE = 3;
        public static final int NULLABLE = 4;
        public static final int DEFAULT = 5;
        public static final int COMMENT = 6;
        public static final int MAX_LENGTH = 7;
        public static final int PRECISION = 8;
        public static final int SCALE = 9;
        public static final int KEY = 10;
        public static final int EXTRA = 11;

        private ColumnIndex() {
        }
    }

    public static String databasesSql() {
        return "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME";
    }

    /**
     * GBase 8a has no schema-level owner, so the name is echoed in the owner
     * position to keep the object-view column filled instead of blank.
     */
    public static String schemasSql(String database) {
        return "SELECT SCHEMA_NAME, SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME";
    }

    public static String objectsSql(String database, String schema, List<String> kinds) {
        return "SELECT TABLE_NAME, CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END, "
            + "COALESCE(TABLE_COMMENT, '') "
            + "FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + kindFilter(kinds)
            + " ORDER BY TABLE_NAME";
    }

    public static String tablesSql(String database, String schema) {
        return "SELECT TABLE_NAME, 'table', COALESCE(TABLE_COMMENT, '') "
            + "FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_TYPE <> 'VIEW' ORDER BY TABLE_NAME";
    }

    public static String viewsSql(String database, String schema) {
        return "SELECT TABLE_NAME, 'view', COALESCE(TABLE_COMMENT, '') "
            + "FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME";
    }

    /**
     * {@code COLUMN_TYPE} already carries the full type as the server stores it
     * ({@code int(11)}, {@code varchar(64)}, {@code decimal(10,2)}), so the
     * server does not have to reconstruct a type from a numeric type code.
     */
    public static String columnsSql(String database, String schema, String table) {
        return "SELECT ORDINAL_POSITION, COLUMN_NAME, COALESCE(DATA_TYPE, ''), COALESCE(COLUMN_TYPE, DATA_TYPE, ''), "
            + "COALESCE(IS_NULLABLE, 'YES'), COLUMN_DEFAULT, COALESCE(COLUMN_COMMENT, ''), "
            + "CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, COALESCE(COLUMN_KEY, ''), COALESCE(EXTRA, '') "
            + "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_NAME = '" + escapeSql(table) + "' ORDER BY ORDINAL_POSITION";
    }

    public static String primaryKeyColumnsSql(String database, String schema, String table) {
        return "SELECT COLUMN_NAME FROM information_schema.STATISTICS "
            + "WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_NAME = '" + escapeSql(table) + "' AND INDEX_NAME = 'PRIMARY'"
            + " ORDER BY SEQ_IN_INDEX";
    }

    /**
     * One row per index column. Positions expected by the server's
     * {@code readIndexes}: name, uniqueness marker ({@code U}/{@code D}),
     * primary-key marker ({@code P}), column name, ordinal.
     */
    public static String indexesSql(String database, String schema, String table) {
        return "SELECT INDEX_NAME, CASE WHEN NON_UNIQUE = 0 THEN 'U' ELSE 'D' END, "
            + "CASE WHEN INDEX_NAME = 'PRIMARY' THEN 'P' ELSE '' END, COLUMN_NAME, SEQ_IN_INDEX "
            + "FROM information_schema.STATISTICS "
            + "WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_NAME = '" + escapeSql(table) + "'"
            + " ORDER BY INDEX_NAME, SEQ_IN_INDEX";
    }

    /**
     * {@code REFERENTIAL_CONSTRAINTS} is the only place MySQL-compatible servers
     * expose the referential actions as text, so the server can pass
     * {@code UPDATE_RULE} / {@code DELETE_RULE} straight through.
     */
    public static String foreignKeysSql(String database, String schema, String table) {
        String catalog = escapeSql(catalog(database, schema));
        return "SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, "
            + "k.REFERENCED_COLUMN_NAME, COALESCE(rc.UPDATE_RULE, ''), COALESCE(rc.DELETE_RULE, ''), k.ORDINAL_POSITION "
            + "FROM information_schema.KEY_COLUMN_USAGE k "
            + "LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc "
            + "ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME "
            + "WHERE k.TABLE_SCHEMA = '" + catalog + "' AND k.TABLE_NAME = '" + escapeSql(table) + "'"
            + " AND k.REFERENCED_TABLE_NAME IS NOT NULL "
            + "ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION";
    }

    /**
     * GBase 8a does not surface {@code CHECK} constraints through
     * {@code information_schema}, so the server answers {@code schema/checks}
     * with an empty list rather than running a query that cannot succeed.
     */
    public static String functionsSql(String database, String schema) {
        return routinesSql(database, schema, "FUNCTION");
    }

    public static String proceduresSql(String database, String schema) {
        return routinesSql(database, schema, "PROCEDURE");
    }

    /**
     * Column order expected by the server's {@code readRoutines}: routine name,
     * definition schema, return type, language, comment, body, sequence.
     */
    private static String routinesSql(String database, String schema, String routineType) {
        return "SELECT ROUTINE_NAME, ROUTINE_SCHEMA, COALESCE(DTD_IDENTIFIER, ''), 'SQL', "
            + "COALESCE(ROUTINE_COMMENT, ''), COALESCE(ROUTINE_DEFINITION, ''), 1 "
            + "FROM information_schema.ROUTINES "
            + "WHERE ROUTINE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND ROUTINE_TYPE = '" + escapeSql(routineType) + "' ORDER BY ROUTINE_NAME";
    }

    /**
     * {@code VIEW_DEFINITION} is null for views the current user cannot inspect;
     * the query still returns the row so the tree keeps the entry.
     */
    public static String viewDefinitionSql(String database, String schema, String view) {
        return "SELECT COALESCE(VIEW_DEFINITION, ''), 'NO' FROM information_schema.VIEWS "
            + "WHERE TABLE_SCHEMA = '" + escapeSql(catalog(database, schema)) + "'"
            + " AND TABLE_NAME = '" + escapeSql(view) + "'";
    }

    /**
     * {@code SHOW CREATE TABLE} is the authoritative DDL source on
     * MySQL-compatible servers: it reproduces the exact column types, defaults,
     * inline comments and secondary indexes the server holds. The statement
     * text lands in the second result column, as required by the server's
     * {@code SHOW CREATE TABLE} reader.
     */
    public static String dumpDdlSql(String database, String schema, String table) {
        return "SHOW CREATE TABLE " + qualifiedIdentifier(database, schema, table);
    }

    /** In GBase 8a the tree's database and schema refer to the same namespace. */
    public static String catalog(String database, String schema) {
        if (schema != null && schema.trim().length() > 0) {
            return schema.trim();
        }
        if (database != null && database.trim().length() > 0) {
            return database.trim();
        }
        return "";
    }

    public static String qualifiedIdentifier(String database, String schema, String name) {
        String catalog = catalog(database, schema);
        if (catalog.length() == 0) {
            return quoteIdentifier(name);
        }
        return quoteIdentifier(catalog) + "." + quoteIdentifier(name);
    }

    public static String quoteIdentifier(String value) {
        if (value == null) {
            return "";
        }
        return '`' + value.trim().replace("`", "``") + '`';
    }

    public static String escapeSql(String value) {
        return value == null ? "" : value.replace("'", "''");
    }

    private static String kindFilter(List<String> kinds) {
        if (kinds == null || kinds.isEmpty()) {
            return "";
        }
        boolean wantsTable = false;
        boolean wantsView = false;
        for (String kind : kinds) {
            if (kind == null) {
                continue;
            }
            String normalized = kind.trim().toLowerCase(Locale.ROOT);
            if ("table".equals(normalized) || "base_table".equals(normalized)) {
                wantsTable = true;
            } else if ("view".equals(normalized)) {
                wantsView = true;
            }
        }
        if (wantsTable && wantsView) {
            return "";
        }
        if (wantsTable) {
            return " AND TABLE_TYPE <> 'VIEW'";
        }
        if (wantsView) {
            return " AND TABLE_TYPE = 'VIEW'";
        }
        // An unrecognized kind set must match nothing rather than everything.
        return " AND 1 = 0";
    }
}
