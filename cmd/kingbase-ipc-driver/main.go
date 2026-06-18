package main

import (
	"fmt"
	"os"

	"onetcli-db-ipc-drivers/internal/drivers/kingbase"
	"onetcli-db-ipc-drivers/internal/runner"
)

func main() {
	if err := runner.Run(kingbase.Spec()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
