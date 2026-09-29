package com.navop.gbase8a.server;

import com.navop.gbase8a.jdbc.GBase8aConfig;

import java.sql.Connection;

public interface JdbcConnectionFactory {
    Connection open(GBase8aConfig config) throws Exception;
}
