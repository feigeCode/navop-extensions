package com.navop.db2;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.navop.db2.ipc.FramedJsonTransport;
import com.navop.db2.jdbc.Db2Config;
import com.navop.db2.server.Db2IpcServer;
import com.navop.db2.server.JdbcConnectionFactory;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.sql.Connection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class Db2DriverMainTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    public void serveWritesResponsesAndStopsAfterShutdown() throws Exception {
        ByteArrayOutputStream inbound = new ByteArrayOutputStream();
        FramedJsonTransport requestWriter = FramedJsonTransport.forOutput(inbound, mapper);
        requestWriter.write(mapper.readTree("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"init\",\"params\":{\"host_version\":\"0.10.0\"}}"));
        requestWriter.write(mapper.readTree("{\"jsonrpc\":\"2.0\",\"method\":\"$/ping\",\"params\":{}}"));
        requestWriter.write(mapper.readTree("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"shutdown\",\"params\":{}}"));
        requestWriter.write(mapper.readTree("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"$/ping\",\"params\":{}}"));

        ByteArrayOutputStream outbound = new ByteArrayOutputStream();
        Db2DriverMain.serve(
            new ByteArrayInputStream(inbound.toByteArray()),
            outbound,
            new Db2IpcServer(new JdbcConnectionFactory() {
                @Override
                public Connection open(Db2Config config) {
                    throw new UnsupportedOperationException("not used");
                }
            })
        );

        FramedJsonTransport responseReader = FramedJsonTransport.forInput(
            new ByteArrayInputStream(outbound.toByteArray()),
            mapper
        );
        JsonNode init = responseReader.read();
        JsonNode shutdown = responseReader.read();

        assertEquals(1, init.get("id").asInt());
        assertEquals("db2", init.get("result").get("drivers_ready").get(0).asText());
        assertEquals(2, shutdown.get("id").asInt());
        assertTrue(shutdown.get("result").isNull());
        try {
            responseReader.read();
        } catch (EOFException expected) {
            return;
        }
        throw new AssertionError("expected no response after shutdown");
    }
}
