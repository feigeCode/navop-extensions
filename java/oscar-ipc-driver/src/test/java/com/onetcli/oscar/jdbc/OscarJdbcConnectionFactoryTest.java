package com.onetcli.oscar.jdbc;

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

public class OscarJdbcConnectionFactoryTest {
    @Test
    public void openUsesDefaultUrlAndCredentialProperties() throws Exception {
        RecordingDriver.lastUrl = null;
        RecordingDriver.lastProperties = null;

        OscarConfig config = OscarConfig.fromWire(configFor(RecordingDriver.class.getName(), ""));
        OscarJdbcConnectionFactory factory = new OscarJdbcConnectionFactory(new File("."));

        Connection connection = factory.open(config);
        try {
            assertEquals("jdbc:oscar://127.0.0.1:2003/OSRDB", RecordingDriver.lastUrl);
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

        OscarConfig config = OscarConfig.fromWire(configFor(
            RecordingDriver.class.getName(),
            "jdbc:oscar://custom:2003/demo"
        ));
        OscarJdbcConnectionFactory factory = new OscarJdbcConnectionFactory(new File("."));

        Connection connection = factory.open(config);
        try {
            assertEquals("jdbc:oscar://custom:2003/demo", RecordingDriver.lastUrl);
        } finally {
            connection.close();
        }
    }

    @Test
    public void openFailsWhenDriverDoesNotAcceptUrl() throws Exception {
        OscarConfig config = OscarConfig.fromWire(configFor(NullDriver.class.getName(), ""));
        OscarJdbcConnectionFactory factory = new OscarJdbcConnectionFactory(new File("."));

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
        raw.put("database", "OSRDB");
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
            return DriverManager.getConnection("jdbc:h2:mem:oscar_factory_recording");
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
