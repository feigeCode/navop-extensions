package com.navop.gbase8a;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.navop.gbase8a.ipc.FramedJsonTransport;
import com.navop.gbase8a.jdbc.GBase8aJdbcConnectionFactory;
import com.navop.gbase8a.server.GBase8aIpcServer;
import com.navop.gbase8a.socket.HostSocket;
import com.navop.gbase8a.socket.HostSocketConnector;

import java.io.EOFException;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Process entry point: connects to the host socket and serves framed JSON-RPC
 * requests until the host asks for shutdown or closes the socket.
 */
public final class GBase8aDriverMain {
    private GBase8aDriverMain() {
    }

    public static void main(String[] args) throws Exception {
        String socketName = HostSocketConnector.socketNameFromEnvOrArg(args);
        if (socketName.isEmpty()) {
            throw new IllegalArgumentException("missing ONETCLI_EXT_SOCKET or first socket name argument");
        }

        File workingDir = new File(System.getProperty("user.dir", "."));
        GBase8aIpcServer server = new GBase8aIpcServer(new GBase8aJdbcConnectionFactory(workingDir));
        HostSocket socket = new HostSocketConnector().connect(socketName);
        try {
            serve(socket.getInputStream(), socket.getOutputStream(), server);
        } finally {
            socket.close();
        }
    }

    public static void serve(InputStream input, OutputStream output, GBase8aIpcServer server) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        FramedJsonTransport transport = FramedJsonTransport.forStreams(input, output, mapper);
        while (true) {
            JsonNode request;
            try {
                request = transport.read();
            } catch (EOFException eof) {
                return;
            }

            boolean shutdown = isShutdown(request);
            if (!hasId(request)) {
                if (shutdown) {
                    return;
                }
                continue;
            }

            JsonNode response = server.handle(request);
            transport.write(response);
            if (shutdown) {
                return;
            }
        }
    }

    private static boolean hasId(JsonNode request) {
        return request != null && request.has("id");
    }

    private static boolean isShutdown(JsonNode request) {
        return request != null && "shutdown".equals(request.path("method").asText(""));
    }
}
