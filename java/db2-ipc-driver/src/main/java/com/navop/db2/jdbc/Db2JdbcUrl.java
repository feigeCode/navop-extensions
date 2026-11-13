package com.navop.db2.jdbc;

public final class Db2JdbcUrl {
    private Db2JdbcUrl() {
    }

    public static String build(Db2Config config) {
        if (config.getJdbcUrl() != null && !config.getJdbcUrl().trim().isEmpty()) {
            return config.getJdbcUrl().trim();
        }
        validateUrlPart("host", config.getHost());
        validateUrlPart("database", config.getDatabase());

        return "jdbc:db2://" + config.getHost() + ':' + config.getPort() + '/' + config.getDatabase();
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
