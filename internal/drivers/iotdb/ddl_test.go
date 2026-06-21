package iotdb

import (
	"context"
	"testing"
)

func TestDdlBuildCreateDatabaseBuildsStorageGroup(t *testing.T) {
	server := NewServer()
	ctx := context.Background()
	mustOK(t, server.Handle(ctx, message(1, "init", nil)))

	resp := server.Handle(ctx, message(2, "ddl/build", map[string]any{
		"op": "create_database",
		"payload": map[string]any{
			"database_name": "root.onetcli_smoke",
		},
	}))

	result := resultMap(t, resp)
	statements := result["statements"].([]any)
	if len(statements) != 1 || statements[0] != "SET STORAGE GROUP TO root.onetcli_smoke" {
		t.Fatalf("statements = %#v, want storage group creation", statements)
	}
}

func TestDdlBuildDropDatabaseBuildsStorageGroupDelete(t *testing.T) {
	server := NewServer()
	ctx := context.Background()
	mustOK(t, server.Handle(ctx, message(1, "init", nil)))

	resp := server.Handle(ctx, message(2, "ddl/build", map[string]any{
		"op": "drop_database",
		"payload": map[string]any{
			"name": "root.onetcli_smoke",
		},
	}))

	result := resultMap(t, resp)
	statements := result["statements"].([]any)
	if len(statements) != 1 || statements[0] != "DELETE STORAGE GROUP root.onetcli_smoke" {
		t.Fatalf("statements = %#v, want storage group deletion", statements)
	}
}
