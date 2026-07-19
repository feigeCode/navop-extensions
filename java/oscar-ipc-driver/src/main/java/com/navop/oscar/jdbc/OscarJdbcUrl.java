package com.navop.oscar.jdbc;

public final class OscarJdbcUrl {
    private OscarJdbcUrl() {
    }

    public static String build(OscarConfig config) {
        if (config.getJdbcUrl() != null && !config.getJdbcUrl().trim().isEmpty()) {
            return config.getJdbcUrl().trim();
        }
        validateUrlPart("host", config.getHost());
        validateUrlPart("database", config.getDatabase());

        return "jdbc:oscar://" + config.getHost() + ':' + config.getPort() + '/' + config.getDatabase();
    }

    private static void validateUrlPart(String name, String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        if (value.indexOf(';') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            throw new IllegalArgumentException(name + " contains invalid JDBC URL characters");
        }
    }
}
