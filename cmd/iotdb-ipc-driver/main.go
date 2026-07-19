package main

import (
	"fmt"
	"os"

	"navop-db-ipc-drivers/internal/drivers/iotdb"
)

func main() {
	if err := iotdb.Run(os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
