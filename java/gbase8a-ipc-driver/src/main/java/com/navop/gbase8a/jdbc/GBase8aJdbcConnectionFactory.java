package com.navop.gbase8a.jdbc;

import com.navop.gbase8a.server.JdbcConnectionFactory;

import java.io.File;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.SQLException;
import java.util.Properties;

/**
 * Opens physical GBase 8a connections with the official JDBC driver.
 *
 * <p>The driver is resolved from the process classpath first and otherwise from
 * {@code lib/*.jar} next to the launcher, so the packaged official JAR and a
 * user-supplied replacement are both supported. Credentials travel in the
 * {@link Properties} object rather than in the URL, which keeps the password
 * out of the connection string the driver may echo in error messages.</p>
 */
public final class GBase8aJdbcConnectionFactory implements JdbcConnectionFactory {
    private final File workingDir;

    public GBase8aJdbcConnectionFactory(File workingDir) {
        this.workingDir = workingDir == null ? new File(".") : workingDir;
    }

    @Override
    public Connection open(GBase8aConfig config) throws Exception {
        Driver driver = DriverLoader.loadDriver(config.getDriverClass(), workingDir, config.getJdbcJar());
        String url = GBase8aJdbcUrl.build(config);
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
