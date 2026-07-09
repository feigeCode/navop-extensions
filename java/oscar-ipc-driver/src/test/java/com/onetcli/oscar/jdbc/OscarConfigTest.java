package com.onetcli.oscar.jdbc;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class OscarConfigTest {
    @Test
    public void configUsesOscarDefaults() {
        OscarConfig config = OscarConfig.fromWire(validWireConfig());

        assertEquals("127.0.0.1", config.getHost());
        assertEquals(2003, config.getPort());
        assertEquals("SYSDBA", config.getUsername());
        assertEquals("secret", config.getPassword());
        assertEquals("OSRDB", config.getDatabase());
        assertEquals("com.oscar.Driver", config.getDriverClass());
        assertEquals("", config.getJdbcUrl());
        assertEquals("", config.getJdbcJar());
    }

    @Test
    public void configAcceptsTopLevelJdbcOverrides() {
        Map<String, Object> raw = validWireConfig();
        raw.put("port", "2103");
        raw.put("driver_class", "example.Driver");
        raw.put("jdbc_url", "jdbc:oscar://custom:2003/demo");
        raw.put("jdbc_jar", "/opt/oscar/oscar-jdbc.jar");

        OscarConfig config = OscarConfig.fromWire(raw);

        assertEquals(2103, config.getPort());
        assertEquals("example.Driver", config.getDriverClass());
        assertEquals("jdbc:oscar://custom:2003/demo", config.getJdbcUrl());
        assertEquals("/opt/oscar/oscar-jdbc.jar", config.getJdbcJar());
    }

    @Test
    public void configAcceptsNestedExtraParamsForOldForms() {
        Map<String, Object> raw = validWireConfig();
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("extra_params.driver_class", "nested.Driver");
        extra.put("extra_params.jdbc_url", "jdbc:oscar://nested:2003/db");
        extra.put("extra_params.jdbc_jar", "/opt/nested.jar");
        raw.put("extra_params", extra);

        OscarConfig config = OscarConfig.fromWire(raw);

        assertEquals("nested.Driver", config.getDriverClass());
        assertEquals("jdbc:oscar://nested:2003/db", config.getJdbcUrl());
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
        raw.put("database", "OSRDB");
        return raw;
    }

    private static Map<String, Object> missing(String key) {
        Map<String, Object> raw = validWireConfig();
        raw.remove(key);
        return raw;
    }

    private static void assertInvalid(Map<String, Object> raw, String field) {
        try {
            OscarConfig.fromWire(raw);
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(field));
            return;
        }
        throw new AssertionError("expected invalid " + field + " to fail");
    }
}
