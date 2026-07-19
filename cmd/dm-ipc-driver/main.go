package main

import (
	"fmt"
	"os"

	"navop-db-ipc-drivers/internal/drivers/dm"
	"navop-db-ipc-drivers/internal/runner"
)

func main() {
	if err := runner.Run(dm.Spec()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
