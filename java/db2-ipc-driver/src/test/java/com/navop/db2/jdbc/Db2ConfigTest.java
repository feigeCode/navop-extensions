package com.navop.db2.jdbc;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class Db2ConfigTest {
    @Test
    public void configUsesDb2Defaults() {
        Db2Config config = Db2Config.fromWire(validWireConfig());

        assertEquals("127.0.0.1", config.getHost());
        assertEquals(50000, config.getPort());
        assertEquals("SYSDBA", config.getUsername());
        assertEquals("secret", config.getPassword());
        assertEquals("SAMPLE", config.getDatabase());
        assertEquals("com.ibm.db2.jcc.DB2Driver", config.getDriverClass());
        assertEquals("", config.getJdbcUrl());
        assertEquals("", config.getJdbcJar());
    }

    @Test
    public void configAcceptsTopLevelJdbcOverrides() {
        Map<String, Object> raw = validWireConfig();
        raw.put("port", "2103");
        raw.put("driver_class", "example.Driver");
        raw.put("jdbc_url", "jdbc:db2://custom:50000/demo");
        raw.put("jdbc_jar", "/opt/db2/db2-jdbc.jar");

        Db2Config config = Db2Config.fromWire(raw);

        assertEquals(2103, config.getPort());
        assertEquals("example.Driver", config.getDriverClass());
        assertEquals("jdbc:db2://custom:50000/demo", config.getJdbcUrl());
        assertEquals("/opt/db2/db2-jdbc.jar", config.getJdbcJar());
    }

    @Test
    public void configAcceptsNestedExtraParamsForOldForms() {
        Map<String, Object> raw = validWireConfig();
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("extra_params.driver_class", "nested.Driver");
        extra.put("extra_params.jdbc_url", "jdbc:db2://nested:50000/db");
        extra.put("extra_params.jdbc_jar", "/opt/nested.jar");
        raw.put("extra_params", extra);

        Db2Config config = Db2Config.fromWire(raw);

        assertEquals("nested.Driver", config.getDriverClass());
        assertEquals("jdbc:db2://nested:50000/db", config.getJdbcUrl());
        assertEquals("/opt/nested.jar", config.getJdbcJar());
    }

    @Test
    public void missingRequiredFieldsReturnClearErrors() {
        assertInvalid(missing("host"), "host");
        assertInvalid(missing("username"), "username");
        assertInvalid(missing("database"), "database");
    }

    @Test
    public void invalidPortReturnsClearError() {
        Map<String, Object> raw = validWireConfig();
        raw.put("port", "not-a-number");

        assertInvalid(raw, "port");
    }

    private static Map<String, Object> validWireConfig() {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "SYSDBA");
        raw.put("password", "secret");
        raw.put("database", "SAMPLE");
        return raw;
    }

    private static Map<String, Object> missing(String key) {
        Map<String, Object> raw = validWireConfig();
        raw.remove(key);
        return raw;
    }

    private static void assertInvalid(Map<String, Object> raw, String field) {
        try {
            Db2Config.fromWire(raw);
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(field));
            return;
        }
        throw new AssertionError("expected invalid " + field + " to fail");
    }
}
