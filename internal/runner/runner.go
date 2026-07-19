package runner

import (
	"context"
	"fmt"
	"os"

	"navop-db-ipc-drivers/internal/dbipc"
	"navop-db-ipc-drivers/internal/ipc"
)

func Run(spec dbipc.DriverSpec) error {
	socketName := ipc.SocketNameFromEnvOrArg(os.Args)
	if socketName == "" {
		return fmt.Errorf("%s requires %s or a socket name argument", spec.Name, ipc.SocketEnvVar)
	}
	conn, err := ipc.DialHostSocket(socketName)
	if err != nil {
		return err
	}
	server := dbipc.NewServer(spec, nil)
	return ipc.ServeConnected(conn, func(req ipc.Message) ipc.Message {
		return server.Handle(context.Background(), req)
	})
}
