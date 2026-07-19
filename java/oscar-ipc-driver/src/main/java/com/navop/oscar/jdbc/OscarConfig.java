package com.navop.oscar.jdbc;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class OscarConfig {
    public static final int DEFAULT_PORT = 2003;
    public static final String DEFAULT_DRIVER_CLASS = "com.oscar.Driver";

    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String database;
    private final String driverClass;
    private final String jdbcUrl;
    private final String jdbcJar;
    private final Map<String, String> extraParams;

    private OscarConfig(
        String host,
        int port,
        String username,
        String password,
        String database,
        String driverClass,
        String jdbcUrl,
        String jdbcJar,
        Map<String, String> extraParams
    ) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.database = database;
        this.driverClass = driverClass;
        this.jdbcUrl = jdbcUrl;
        this.jdbcJar = jdbcJar;
        this.extraParams = Collections.unmodifiableMap(new LinkedHashMap<String, String>(extraParams));
    }

    public static OscarConfig fromWire(Map<String, Object> raw) {
        if (raw == null) {
            throw new IllegalArgumentException("config is required");
        }
        Map<String, String> extra = readExtraParams(raw);
        OscarConfig config = new OscarConfig(
            trimmedStringValue(raw, "host"),
            portValue(raw.get("port")),
            trimmedStringValue(raw, "username"),
            stringValue(raw, "password"),
            trimmedStringValue(raw, "database"),
            defaultString(configString(raw, extra, "driver_class"), DEFAULT_DRIVER_CLASS),
            configString(raw, extra, "jdbc_url"),
            configString(raw, extra, "jdbc_jar"),
            extra
        );
        config.validate();
        return config;
    }

    private static Map<String, String> readExtraParams(Map<String, Object> raw) {
        Map<String, String> out = new LinkedHashMap<String, String>();
        Object nested = raw.get("extra_params");
        if (nested instanceof Map<?, ?>) {
            Map<?, ?> nestedMap = (Map<?, ?>) nested;
            for (Map.Entry<?, ?> entry : nestedMap.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    putExtraParam(out, String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
                }
            }
        }
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            String key = entry.getKey();
            if (key != null && key.startsWith("extra_params.") && entry.getValue() != null) {
                putExtraParam(out, key, String.valueOf(entry.getValue()));
            }
        }
        return out;
    }

    private static void putExtraParam(Map<String, String> out, String key, String value) {
        if (key.startsWith("extra_params.")) {
            key = key.substring("extra_params.".length());
        }
        out.put(key.trim(), value.trim());
    }

    private void validate() {
        require(host, "host");
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("port must be between 1 and 65535");
        }
        require(username, "username");
        require(database, "database");
        require(driverClass, "driver_class");
    }

    private static void require(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("missing required config field " + field);
        }
    }

    private static String stringValue(Map<String, Object> raw, String key) {
        Object value = raw.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static String trimmedStringValue(Map<String, Object> raw, String key) {
        return stringValue(raw, key).trim();
    }

    private static String configString(Map<String, Object> raw, Map<String, String> extra, String key) {
        String value = trimmedStringValue(raw, key);
        if (value != null && !value.trim().isEmpty()) {
            return value;
        }
        value = extra.get(key);
        return value == null ? "" : value;
    }

    private static int portValue(Object value) {
        if (value == null) {
            return DEFAULT_PORT;
        }
        if (value instanceof Number) {
            int port = ((Number) value).intValue();
            return port == 0 ? DEFAULT_PORT : port;
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) {
            return DEFAULT_PORT;
        }
        try {
            int port = Integer.parseInt(text);
            return port == 0 ? DEFAULT_PORT : port;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("port must be a number");
        }
    }

    private static String defaultString(String value, String defaultValue) {
        return value == null || value.trim().isEmpty() ? defaultValue : value;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public String getUsername() {
        return username;
    }

    public String getPassword() {
        return password;
    }

    public String getDatabase() {
        return database;
    }

    public String getDriverClass() {
        return driverClass;
    }

    public String getJdbcUrl() {
        return jdbcUrl;
    }

    public String getJdbcJar() {
        return jdbcJar;
    }

    public Map<String, String> getExtraParams() {
        return extraParams;
    }
}
