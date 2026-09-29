package com.navop.gbase8a.jdbc;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class GBase8aJdbcUrlTest {
    @Test
    public void configUsesGBase8aDefaultsAndNestedExtraParams() {
        GBase8aConfig config = GBase8aConfig.fromWire(validWireConfig());

        assertEquals("127.0.0.1", config.getHost());
        assertEquals(5258, config.getPort());
        assertEquals("gbase", config.getUsername());
        assertEquals("secret", config.getPassword());
        assertEquals("stores", config.getDatabase());
        assertEquals("com.gbase.jdbc.Driver", config.getDriverClass());
        assertEquals("", config.getJdbcJar());
        assertEquals("store_sales", config.getExtraParams().get("gclusterId"));
    }

    @Test
    public void configAcceptsFlatExtraParamKeysAndDriverOverride() {
        Map<String, Object> raw = validWireConfig();
        raw.remove("extra_params");
        raw.put("extra_params.characterEncoding", "utf8");
        raw.put("extra_params.driver_class", "example.Driver");
        raw.put("extra_params.jdbc_jar", "/opt/gbase/gbase-connector-java.jar");
        raw.put("port", "5259");

        GBase8aConfig config = GBase8aConfig.fromWire(raw);

        assertEquals(5259, config.getPort());
        assertEquals("example.Driver", config.getDriverClass());
        assertEquals("/opt/gbase/gbase-connector-java.jar", config.getJdbcJar());
        assertEquals("utf8", config.getExtraParams().get("characterEncoding"));
    }

    @Test
    public void topLevelDriverSettingsOverrideExtraParams() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("driver_class", "extra.Driver");
        extra.put("jdbc_jar", "/opt/extra.jar");
        raw.put("driver_class", "top.Driver");
        raw.put("jdbc_jar", "/opt/top.jar");

        GBase8aConfig config = GBase8aConfig.fromWire(raw);

        assertEquals("top.Driver", config.getDriverClass());
        assertEquals("/opt/top.jar", config.getJdbcJar());
    }

    @Test
    public void configAcceptsPrefixedKeysInsideNestedExtraParamsForOldForms() {
        Map<String, Object> raw = validWireConfig();
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("extra_params.characterEncoding", "gbk");
        extra.put("extra_params.gclusterId", "old-form-cluster");
        raw.put("extra_params", extra);

        GBase8aConfig config = GBase8aConfig.fromWire(raw);

        assertEquals("gbk", config.getExtraParams().get("characterEncoding"));
        assertEquals("old-form-cluster", config.getExtraParams().get("gclusterId"));
    }

    @Test
    public void jdbcUrlUsesOfficialGBase8aFormatWithSortedProperties() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("characterEncoding", "utf8");
        extra.put("connectTimeout", "5000");

        GBase8aConfig config = GBase8aConfig.fromWire(raw);

        assertEquals(
            "jdbc:gbase://127.0.0.1:5258/stores?characterEncoding=utf8&connectTimeout=5000&gclusterId=store_sales",
            GBase8aJdbcUrl.build(config)
        );
    }

    /**
     * The official driver fails the whole connection with
     * "driver not support property X" for any property it does not know, so the
     * keys this driver consumes itself must never reach the query string.
     */
    @Test
    public void jdbcUrlNeverForwardsDriverManagedOrSshProperties() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("jdk_home", "/opt/jdk8");
        extra.put("jdbc_jar", "lib/gbase-connector-java-9.5.0.10-build1-bin.jar");
        extra.put("driver_class", "com.gbase.jdbc.Driver");
        extra.put("ssh_auth_type", "password");
        extra.put(" SSH_PORT ", "22");

        String jdbcUrl = GBase8aJdbcUrl.build(GBase8aConfig.fromWire(raw));

        assertEquals("jdbc:gbase://127.0.0.1:5258/stores?gclusterId=store_sales", jdbcUrl);
        assertFalse(jdbcUrl.toLowerCase().contains("ssh"));
        assertFalse(jdbcUrl.contains("jdk_home"));
        assertFalse(jdbcUrl.contains("jdbc_jar"));
        assertFalse(jdbcUrl.contains("driver_class"));
    }

    /**
     * A blank optional field must behave as an absent one: forwarding
     * {@code connectTimeout=} would be a different property value than omitting
     * the property entirely.
     */
    @Test
    public void jdbcUrlSkipsBlankOptionalProperties() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("characterEncoding", "");
        extra.put("connectTimeout", "   ");

        assertEquals(
            "jdbc:gbase://127.0.0.1:5258/stores?gclusterId=store_sales",
            GBase8aJdbcUrl.build(GBase8aConfig.fromWire(raw))
        );
    }

    @Test
    public void jdbcUrlOverrideWinsWhenProvided() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("jdbc_url", "jdbc:gbase://10.0.0.9:5258/warehouse?useUnicode=true");
        extra.put("gclusterId", "store_sales");

        assertEquals(
            "jdbc:gbase://10.0.0.9:5258/warehouse?useUnicode=true",
            GBase8aJdbcUrl.build(GBase8aConfig.fromWire(raw))
        );
    }

    @Test
    public void jdbcUrlOverrideMustBeAGBaseUrl() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("jdbc_url", "jdbc:mysql://10.0.0.9:3306/warehouse");

        try {
            GBase8aConfig.fromWire(raw);
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains("jdbc_url"));
            return;
        }
        throw new AssertionError("expected a non-GBase jdbc_url override to fail");
    }

    @Test
    public void missingRequiredFieldsReturnClearErrors() {
        assertInvalid(missing("host"), "host");
        assertInvalid(missing("username"), "username");
        assertInvalid(missing("database"), "database");
    }

    @Test
    public void portDefaultsWhenAbsentOrZero() {
        Map<String, Object> raw = validWireConfig();
        raw.remove("port");
        assertEquals(5258, GBase8aConfig.fromWire(raw).getPort());

        raw.put("port", 0);
        assertEquals(5258, GBase8aConfig.fromWire(raw).getPort());
    }

    @Test
    public void jdbcUrlRejectsPropertyInjectionCharacters() {
        Map<String, Object> raw = validWireConfig();
        @SuppressWarnings("unchecked")
        Map<String, Object> extra = (Map<String, Object>) raw.get("extra_params");
        extra.put("BAD", "a&b");

        try {
            GBase8aJdbcUrl.build(GBase8aConfig.fromWire(raw));
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains("BAD"));
            return;
        }
        throw new AssertionError("expected invalid JDBC property to fail");
    }

    @Test
    public void jdbcUrlRejectsDatabaseContainingQueryDelimiters() {
        Map<String, Object> raw = validWireConfig();
        raw.put("database", "stores?x=1");

        try {
            GBase8aJdbcUrl.build(GBase8aConfig.fromWire(raw));
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains("database"));
            return;
        }
        throw new AssertionError("expected an invalid database name to fail");
    }

    private static Map<String, Object> validWireConfig() {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "gbase");
        raw.put("password", "secret");
        raw.put("database", "stores");
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("gclusterId", "store_sales");
        raw.put("extra_params", extra);
        return raw;
    }

    private static Map<String, Object> missing(String key) {
        Map<String, Object> raw = validWireConfig();
        raw.remove(key);
        return raw;
    }

    private static void assertInvalid(Map<String, Object> raw, String field) {
        try {
            GBase8aConfig.fromWire(raw);
        } catch (IllegalArgumentException error) {
            assertTrue(error.getMessage().contains(field));
            return;
        }
        throw new AssertionError("expected missing " + field + " to fail");
    }
}
