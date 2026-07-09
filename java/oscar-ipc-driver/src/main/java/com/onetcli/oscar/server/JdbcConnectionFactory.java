package com.onetcli.oscar.server;

import com.onetcli.oscar.jdbc.OscarConfig;

import java.sql.Connection;

public interface JdbcConnectionFactory {
    Connection open(OscarConfig config) throws Exception;
}
