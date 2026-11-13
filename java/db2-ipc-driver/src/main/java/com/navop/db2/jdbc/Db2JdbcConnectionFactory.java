package com.navop.db2.jdbc;

import com.navop.db2.server.JdbcConnectionFactory;

import java.io.File;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.SQLException;
import java.util.Properties;

public final class Db2JdbcConnectionFactory implements JdbcConnectionFactory {
    private final File workingDir;

    public Db2JdbcConnectionFactory(File workingDir) {
        this.workingDir = workingDir == null ? new File(".") : workingDir;
    }

    @Override
    public Connection open(Db2Config config) throws Exception {
        Driver driver = DriverLoader.loadDriver(config.getDriverClass(), workingDir, config.getJdbcJar());
        String url = Db2JdbcUrl.build(config);
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
