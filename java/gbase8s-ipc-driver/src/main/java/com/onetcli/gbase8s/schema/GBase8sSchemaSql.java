package com.onetcli.gbase8s.schema;

import java.util.List;

public final class GBase8sSchemaSql {
    private GBase8sSchemaSql() {
    }

    public static String databasesSql() {
        return "SELECT name FROM sysmaster:sysdatabases ORDER BY name";
    }

    public static String schemasSql(String database) {
        return "SELECT username, username FROM sysusers ORDER BY username";
    }

    public static String objectsSql(String database, String schema, List<String> kinds) {
        return "SELECT tabname, CASE tabtype WHEN 'T' THEN 'table' WHEN 'V' THEN 'view' ELSE 'table' END, '' FROM systables WHERE tabid >= 100 ORDER BY tabname";
    }

    public static String columnsSql(String database, String schema, String table) {
        return "SELECT c.colno + 1, c.colname, c.coltype, CASE WHEN BITAND(c.coltype, 256) = 256 THEN 'NO' ELSE 'YES' END, '' FROM syscolumns c JOIN systables t ON c.tabid = t.tabid WHERE t.tabname = '" + escapeSql(table) + "' ORDER BY c.colno";
    }

    public static String primaryKeyColumnsSql(String database, String schema, String table) {
        return "SELECT c.colname FROM syscolumns c "
            + "JOIN systables t ON c.tabid = t.tabid "
            + "JOIN sysconstraints cn ON cn.tabid = t.tabid AND cn.constrtype = 'P' "
            + "JOIN sysindexes i ON i.tabid = t.tabid AND i.idxname = cn.idxname "
            + "WHERE t.tabname = '" + escapeSql(table) + "' AND ("
            + partEquals("i", "c.colno")
            + ") ORDER BY c.colno";
    }

    public static String indexesSql(String database, String schema, String table) {
        return "SELECT i.idxname, i.idxtype, CASE WHEN cn.constrtype = 'P' THEN 'YES' ELSE 'NO' END, "
            + "c.colname, c.colno "
            + "FROM sysindexes i "
            + "JOIN systables t ON i.tabid = t.tabid "
            + "LEFT JOIN sysconstraints cn ON cn.tabid = i.tabid AND cn.idxname = i.idxname "
            + "JOIN syscolumns c ON c.tabid = i.tabid AND (" + partEquals("i", "c.colno") + ") "
            + "WHERE t.tabname = '" + escapeSql(table) + "' "
            + "ORDER BY i.idxname, c.colno";
    }

    public static String viewsSql(String database, String schema) {
        return "SELECT tabname, 'view', '' FROM systables WHERE tabid >= 100 AND tabtype = 'V' ORDER BY tabname";
    }

    private static String partEquals(String indexAlias, String value) {
        StringBuilder sql = new StringBuilder();
        for (int i = 1; i <= 16; i++) {
            if (i > 1) {
                sql.append(" OR ");
            }
            sql.append(indexAlias).append(".part").append(i).append(" = ").append(value);
        }
        return sql.toString();
    }

    private static String escapeSql(String value) {
        return value == null ? "" : value.replace("'", "''");
    }
}
