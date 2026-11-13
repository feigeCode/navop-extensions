package com.navop.db2.server;

import com.navop.db2.jdbc.Db2Config;

import java.sql.Connection;

public interface JdbcConnectionFactory {
    Connection open(Db2Config config) throws Exception;
}
