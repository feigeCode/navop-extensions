package com.navop.gbase8s.server;

import com.navop.gbase8s.jdbc.GBase8sConfig;

import java.sql.Connection;

public interface JdbcConnectionFactory {
    Connection open(GBase8sConfig config) throws Exception;
}
