package com.navop.gbase8a;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.navop.gbase8a.ipc.FramedJsonTransport;
import com.navop.gbase8a.jdbc.GBase8aConfig;
import com.navop.gbase8a.server.GBase8aIpcServer;
import com.navop.gbase8a.server.JdbcConnectionFactory;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.sql.Connection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class GBase8aDriverMainTest {
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
        GBase8aDriverMain.serve(
            new ByteArrayInputStream(inbound.toByteArray()),
            outbound,
            new GBase8aIpcServer(new JdbcConnectionFactory() {
                @Override
                public Connection open(GBase8aConfig config) {
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
        assertEquals("gbase8a", init.get("result").get("drivers_ready").get(0).asText());
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
