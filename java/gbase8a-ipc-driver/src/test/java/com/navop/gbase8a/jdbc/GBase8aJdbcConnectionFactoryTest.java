package com.navop.gbase8a.jdbc;

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

public class GBase8aJdbcConnectionFactoryTest {
    @Test
    public void openUsesOfficialUrlAndCredentialProperties() throws Exception {
        RecordingDriver.lastUrl = null;
        RecordingDriver.lastProperties = null;

        GBase8aConfig config = GBase8aConfig.fromWire(configFor(RecordingDriver.class.getName()));
        GBase8aJdbcConnectionFactory factory = new GBase8aJdbcConnectionFactory(new File("."));

        Connection connection = factory.open(config);
        try {
            assertEquals(
                "jdbc:gbase://127.0.0.1:5258/store_sales?characterEncoding=utf8&gclusterId=gc1",
                RecordingDriver.lastUrl
            );
            assertEquals("gbase", RecordingDriver.lastProperties.getProperty("user"));
            assertEquals("secret", RecordingDriver.lastProperties.getProperty("password"));
        } finally {
            connection.close();
        }
    }

    /**
     * Credentials travel in the properties object, so the URL the driver may
     * echo in an error message never carries the password.
     */
    @Test
    public void openKeepsPasswordOutOfTheJdbcUrl() throws Exception {
        RecordingDriver.lastUrl = null;

        GBase8aJdbcConnectionFactory factory = new GBase8aJdbcConnectionFactory(new File("."));
        factory.open(GBase8aConfig.fromWire(configFor(RecordingDriver.class.getName())));

        assertTrue(RecordingDriver.lastUrl.indexOf("secret") < 0);
        assertTrue(RecordingDriver.lastUrl.indexOf("password") < 0);
    }

    /**
     * The wire config cannot distinguish "no password" from "empty password",
     * and GBase 8a accounts may legitimately have one, so the empty value is
     * passed through rather than dropped.
     */
    @Test
    public void openPassesAnEmptyPasswordThrough() throws Exception {
        RecordingDriver.lastProperties = null;
        Map<String, Object> raw = configFor(RecordingDriver.class.getName());
        raw.remove("password");

        GBase8aJdbcConnectionFactory factory = new GBase8aJdbcConnectionFactory(new File("."));
        factory.open(GBase8aConfig.fromWire(raw));

        assertEquals("gbase", RecordingDriver.lastProperties.getProperty("user"));
        assertEquals("", RecordingDriver.lastProperties.getProperty("password"));
    }

    @Test
    public void openFailsWhenDriverDoesNotAcceptUrl() throws Exception {
        GBase8aConfig config = GBase8aConfig.fromWire(configFor(NullDriver.class.getName()));
        GBase8aJdbcConnectionFactory factory = new GBase8aJdbcConnectionFactory(new File("."));

        try {
            factory.open(config);
        } catch (SQLException error) {
            assertTrue(error.getMessage().contains("did not accept JDBC URL"));
            return;
        }
        throw new AssertionError("expected null driver connection to fail");
    }

    private static Map<String, Object> configFor(String driverClass) {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("host", "127.0.0.1");
        raw.put("username", "gbase");
        raw.put("password", "secret");
        raw.put("database", "store_sales");
        raw.put("driver_class", driverClass);
        Map<String, Object> extra = new LinkedHashMap<String, Object>();
        extra.put("gclusterId", "gc1");
        extra.put("characterEncoding", "utf8");
        raw.put("extra_params", extra);
        return raw;
    }

    public static final class RecordingDriver implements Driver {
        private static String lastUrl;
        private static Properties lastProperties;

        @Override
        public Connection connect(String url, Properties info) throws SQLException {
            lastUrl = url;
            lastProperties = info;
            return DriverManager.getConnection("jdbc:h2:mem:gbase8a_factory_recording");
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
