package com.navop.db2.jdbc;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class Db2JdbcUrlTest {
    @Test
    public void buildsDefaultDb2JdbcUrl() {
        Db2Config config = Db2Config.fromWire(validWireConfig());

        assertEquals("jdbc:db2://127.0.0.1:50000/SAMPLE", Db2JdbcUrl.build(config));
    }

    @Test
    public void usesExplicitJdbcUrlWhenProvided() {
        Map<String, Object> raw = validWireConfig();
        raw.put("jdbc_url", "jdbc:db2://example:50000/demo");
        Db2Config config = Db2Config.fromWire(raw);

        assertEquals("jdbc:db2://example:50000/demo", Db2JdbcUrl.build(config));
    }

    @Test
    public void rejectsUnsafeUrlParts() {
        assertInvalid("host", "bad;host", "SAMPLE");
        assertInvalid("host", "bad\nhost", "SAMPLE");
        assertInvalid("database", "127.0.0.1", "bad;db");
        assertInvalid("database", "127.0.0.1", "bad\rdb");
    }

    private static Map<String, Object> validWireConfig() {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "SYSDBA");
        raw.put("password", "secret");
        raw.put("database", "SAMPLE");
        return raw;
    }

    private static void assertInvalid(String field, String host, String database) {
        Map<String, Object> raw = validWireConfig();
        raw.put("host", host);
        raw.put("database", database);
        try {
            Db2JdbcUrl.build(Db2Config.fromWire(raw));
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(field));
            return;
        }
        throw new AssertionError("expected invalid " + field + " to fail");
    }
}
