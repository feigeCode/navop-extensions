package com.navop.oscar.server;

import com.navop.oscar.jdbc.OscarConfig;

import java.sql.Connection;

public interface JdbcConnectionFactory {
    Connection open(OscarConfig config) throws Exception;
}
