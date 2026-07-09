package com.onetcli.oscar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onetcli.oscar.ipc.FramedJsonTransport;
import com.onetcli.oscar.jdbc.OscarJdbcConnectionFactory;
import com.onetcli.oscar.server.OscarIpcServer;
import com.onetcli.oscar.socket.HostSocket;
import com.onetcli.oscar.socket.HostSocketConnector;

import java.io.EOFException;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public final class OscarDriverMain {
    private OscarDriverMain() {
    }

    public static void main(String[] args) throws Exception {
        String socketName = HostSocketConnector.socketNameFromEnvOrArg(args);
        if (socketName.isEmpty()) {
            throw new IllegalArgumentException("missing ONETCLI_EXT_SOCKET or first socket name argument");
        }

        File workingDir = new File(System.getProperty("user.dir", "."));
        OscarIpcServer server = new OscarIpcServer(new OscarJdbcConnectionFactory(workingDir));
        HostSocket socket = new HostSocketConnector().connect(socketName);
        try {
            serve(socket.getInputStream(), socket.getOutputStream(), server);
        } finally {
            socket.close();
        }
    }

    public static void serve(InputStream input, OutputStream output, OscarIpcServer server) throws IOException {
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
