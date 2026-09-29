package com.navop.gbase8a.jdbc;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Builds the official GBase 8a JDBC URL:
 *
 * <pre>jdbc:gbase://&lt;host&gt;:&lt;port&gt;/&lt;database&gt;?&lt;property&gt;=&lt;value&gt;&amp;...</pre>
 *
 * <p>GBase 8a's driver derives from MySQL Connector/J and <b>rejects unknown
 * URL properties</b> with {@code SQLException: driver not support property X},
 * so the keys this driver consumes itself — plus the host-managed SSH fields —
 * must never reach the query string. Optional properties that the user left
 * blank are skipped as well, because an empty value is not the same as an
 * absent one.</p>
 */
public final class GBase8aJdbcUrl {
    private static final String URL_PREFIX = "jdbc:gbase://";

    /**
     * Extra-parameter keys owned by this driver or by the host. They are read
     * from {@code extra_params} for their own purposes and are not JDBC
     * properties, so forwarding them would fail the connection.
     */
    private static final Set<String> DRIVER_MANAGED_KEYS = new HashSet<String>(Arrays.asList(
        "jdbc_url",
        "jdbc_jar",
        "jdk_home",
        "driver_class"
    ));

    private GBase8aJdbcUrl() {
    }

    public static String build(GBase8aConfig config) {
        String override = config.getJdbcUrl();
        if (override != null && !override.trim().isEmpty()) {
            return override.trim();
        }

        validateUrlPart("host", config.getHost());
        validateUrlPart("database", config.getDatabase());

        StringBuilder url = new StringBuilder(URL_PREFIX)
            .append(config.getHost())
            .append(':')
            .append(config.getPort())
            .append('/')
            .append(config.getDatabase());

        Map<String, String> sorted = new TreeMap<String, String>(config.getExtraParams());
        boolean firstProperty = true;
        for (Map.Entry<String, String> entry : sorted.entrySet()) {
            if (isHostManaged(entry.getKey()) || isBlank(entry.getValue())) {
                continue;
            }
            url.append(firstProperty ? '?' : '&');
            firstProperty = false;
            appendProperty(url, entry.getKey(), entry.getValue());
        }
        return url.toString();
    }

    private static boolean isHostManaged(String key) {
        if (key == null || key.trim().isEmpty()) {
            return true;
        }
        String normalized = key.trim().toLowerCase(Locale.ROOT);
        return normalized.startsWith("ssh_") || DRIVER_MANAGED_KEYS.contains(normalized);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static void appendProperty(StringBuilder url, String key, String value) {
        validatePropertyKey(key);
        validatePropertyValue(key, value);
        url.append(key).append('=').append(value);
    }

    private static void validateUrlPart(String name, String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        if (containsAny(value, ";?&#")) {
            throw new IllegalArgumentException(name + " contains invalid JDBC URL characters");
        }
        if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            throw new IllegalArgumentException(name + " contains invalid JDBC URL characters");
        }
    }

    private static void validatePropertyKey(String key) {
        if (key == null || key.trim().isEmpty()) {
            throw new IllegalArgumentException("JDBC property key is required");
        }
        if (containsAny(key, ";=&?#")) {
            throw new IllegalArgumentException("JDBC property " + key + " contains invalid characters");
        }
    }

    private static void validatePropertyValue(String key, String value) {
        if (value == null) {
            throw new IllegalArgumentException("JDBC property " + key + " value is required");
        }
        if (containsAny(value, ";&?#")) {
            throw new IllegalArgumentException("JDBC property " + key + " contains invalid characters");
        }
        if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("JDBC property " + key + " contains invalid characters");
        }
    }

    private static boolean containsAny(String value, String characters) {
        for (int i = 0; i < value.length(); i++) {
            if (characters.indexOf(value.charAt(i)) >= 0) {
                return true;
            }
        }
        return false;
    }
}
