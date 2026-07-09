package com.onetcli.oscar.schema;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertEquals;

public class OscarSchemaSqlTest {
    @Test
    public void databaseSqlUsesSysmasterDatabases() {
        assertEquals(
            "SELECT name FROM sysmaster:sysdatabases ORDER BY name",
            OscarSchemaSql.databasesSql()
        );
    }

    @Test
    public void schemasSqlUsesSysusers() {
        assertEquals(
            "SELECT username, username FROM sysusers ORDER BY username",
            OscarSchemaSql.schemasSql("OSRDB")
        );
    }

    @Test
    public void objectsSqlMapsTablesAndViews() {
        assertEquals(
            "SELECT tabname, CASE tabtype WHEN 'T' THEN 'table' WHEN 'V' THEN 'view' ELSE 'table' END, '' FROM systables WHERE tabid >= 100 AND TRIM(owner) = 'SYSDBA' AND tabtype IN ('T', 'V') ORDER BY tabname",
            OscarSchemaSql.objectsSql("OSRDB", "SYSDBA", Arrays.asList("table", "view"))
        );
    }

    @Test
    public void columnsSqlEscapesTableName() {
        assertEquals(
            "SELECT c.colno, c.colname, c.coltype, CASE WHEN BITAND(c.coltype, 256) = 256 THEN 'NO' ELSE 'YES' END, d.default FROM syscolumns c JOIN systables t ON c.tabid = t.tabid LEFT JOIN sysdefaults d ON d.tabid = c.tabid AND d.colno = c.colno WHERE t.tabname = 'order''items' AND TRIM(t.owner) = 'SYSDBA' ORDER BY c.colno",
            OscarSchemaSql.columnsSql("OSRDB", "SYSDBA", "order'items")
        );
    }
}
