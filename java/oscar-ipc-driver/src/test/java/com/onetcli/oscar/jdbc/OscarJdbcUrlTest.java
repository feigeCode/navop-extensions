package com.onetcli.oscar.jdbc;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class OscarJdbcUrlTest {
    @Test
    public void buildsDefaultOscarJdbcUrl() {
        OscarConfig config = OscarConfig.fromWire(validWireConfig());

        assertEquals("jdbc:oscar://127.0.0.1:2003/OSRDB", OscarJdbcUrl.build(config));
    }

    @Test
    public void usesExplicitJdbcUrlWhenProvided() {
        Map<String, Object> raw = validWireConfig();
        raw.put("jdbc_url", "jdbc:oscar://example:2003/demo");
        OscarConfig config = OscarConfig.fromWire(raw);

        assertEquals("jdbc:oscar://example:2003/demo", OscarJdbcUrl.build(config));
    }

    @Test
    public void rejectsUnsafeUrlParts() {
        assertInvalid("host", "bad;host", "OSRDB");
        assertInvalid("host", "bad\nhost", "OSRDB");
        assertInvalid("database", "127.0.0.1", "bad;db");
        assertInvalid("database", "127.0.0.1", "bad\rdb");
    }

    private static Map<String, Object> validWireConfig() {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "SYSDBA");
        raw.put("password", "secret");
        raw.put("database", "OSRDB");
        return raw;
    }

    private static void assertInvalid(String field, String host, String database) {
        Map<String, Object> raw = validWireConfig();
        raw.put("host", host);
        raw.put("database", database);
        try {
            OscarJdbcUrl.build(OscarConfig.fromWire(raw));
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(field));
            return;
        }
        throw new AssertionError("expected invalid " + field + " to fail");
    }
}
