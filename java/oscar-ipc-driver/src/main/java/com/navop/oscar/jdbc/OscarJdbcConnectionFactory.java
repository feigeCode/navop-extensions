package com.navop.oscar.jdbc;

import com.navop.oscar.server.JdbcConnectionFactory;

import java.io.File;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.SQLException;
import java.util.Properties;

public final class OscarJdbcConnectionFactory implements JdbcConnectionFactory {
    private final File workingDir;

    public OscarJdbcConnectionFactory(File workingDir) {
        this.workingDir = workingDir == null ? new File(".") : workingDir;
    }

    @Override
    public Connection open(OscarConfig config) throws Exception {
        Driver driver = DriverLoader.loadDriver(config.getDriverClass(), workingDir, config.getJdbcJar());
        String url = OscarJdbcUrl.build(config);
        Properties properties = new Properties();
        properties.setProperty("user", config.getUsername());
        if (config.getPassword() != null) {
            properties.setProperty("password", config.getPassword());
        }

        Connection connection = driver.connect(url, properties);
        if (connection == null) {
            throw new SQLException("JDBC driver " + config.getDriverClass() + " did not accept JDBC URL: " + url);
        }
        return connection;
    }
}
