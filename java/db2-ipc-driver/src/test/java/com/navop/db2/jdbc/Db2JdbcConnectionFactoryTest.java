package com.navop.db2.jdbc;

import org.junit.Test;

import java.io.File;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.logging.Logger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class Db2JdbcConnectionFactoryTest {
    @Test
    public void openUsesDefaultUrlAndCredentialProperties() throws Exception {
        RecordingDriver.lastUrl = null;
        RecordingDriver.lastProperties = null;

        Db2Config config = Db2Config.fromWire(configFor(RecordingDriver.class.getName(), ""));
        Db2JdbcConnectionFactory factory = new Db2JdbcConnectionFactory(new File("."));

        Connection connection = factory.open(config);
        try {
            assertEquals("jdbc:db2://127.0.0.1:50000/SAMPLE", RecordingDriver.lastUrl);
            assertEquals("SYSDBA", RecordingDriver.lastProperties.getProperty("user"));
            assertEquals("secret", RecordingDriver.lastProperties.getProperty("password"));
        } finally {
            connection.close();
        }
    }

    @Test
    public void openUsesExplicitJdbcUrl() throws Exception {
        RecordingDriver.lastUrl = null;
        RecordingDriver.lastProperties = null;

        Db2Config config = Db2Config.fromWire(configFor(
            RecordingDriver.class.getName(),
            "jdbc:db2://custom:50000/demo"
        ));
        Db2JdbcConnectionFactory factory = new Db2JdbcConnectionFactory(new File("."));

        Connection connection = factory.open(config);
        try {
            assertEquals("jdbc:db2://custom:50000/demo", RecordingDriver.lastUrl);
        } finally {
            connection.close();
        }
    }

    @Test
    public void openFailsWhenDriverDoesNotAcceptUrl() throws Exception {
        Db2Config config = Db2Config.fromWire(configFor(NullDriver.class.getName(), ""));
        Db2JdbcConnectionFactory factory = new Db2JdbcConnectionFactory(new File("."));

        try {
            factory.open(config);
        } catch (SQLException error) {
            assertTrue(error.getMessage().contains("did not accept JDBC URL"));
            return;
        }
        throw new AssertionError("expected null driver connection to fail");
    }

    private static Map<String, Object> configFor(String driverClass, String jdbcUrl) {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "SYSDBA");
        raw.put("password", "secret");
        raw.put("database", "SAMPLE");
        raw.put("driver_class", driverClass);
        if (!jdbcUrl.isEmpty()) {
            raw.put("jdbc_url", jdbcUrl);
        }
        return raw;
    }

    public static final class RecordingDriver implements Driver {
        private static String lastUrl;
        private static Properties lastProperties;

        @Override
        public Connection connect(String url, Properties info) throws SQLException {
            lastUrl = url;
            lastProperties = info;
            return DriverManager.getConnection("jdbc:h2:mem:db2_factory_recording");
        }

        @Override
        public boolean acceptsURL(String url) {
            return true;
        }

        @Override
        public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
            return new DriverPropertyInfo[0];
        }

        @Override
        public int getMajorVersion() {
            return 1;
        }

        @Override
        public int getMinorVersion() {
            return 0;
        }

        @Override
        public boolean jdbcCompliant() {
            return false;
        }

        @Override
        public Logger getParentLogger() {
            return Logger.getGlobal();
        }
    }

    public static final class NullDriver implements Driver {
        @Override
        public Connection connect(String url, Properties info) {
            return null;
        }

        @Override
        public boolean acceptsURL(String url) {
            return false;
        }

        @Override
        public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
            return new DriverPropertyInfo[0];
        }

        @Override
        public int getMajorVersion() {
            return 1;
        }

        @Override
        public int getMinorVersion() {
            return 0;
        }

        @Override
        public boolean jdbcCompliant() {
            return false;
        }

        @Override
        public Logger getParentLogger() {
            return Logger.getGlobal();
        }
    }
}
