package iotdb

import "testing"

func TestNormalizeSQLScopesRelativeDevice(t *testing.T) {
	got := normalizeSQL("root.onetcli_smoke", "SELECT * FROM d1")
	want := "SELECT * FROM root.onetcli_smoke.d1"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeSQLDoesNotInjectTimeProjection(t *testing.T) {
	got := normalizeSQL("root.onetcli_smoke", "SELECT temperature FROM d1")
	want := "SELECT temperature FROM root.onetcli_smoke.d1"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeHostInsertForIoTDB(t *testing.T) {
	got := normalizeSQL(
		"root.onetcli_smoke",
		"INSERT INTO d1 (Time, temperature, status) VALUES ('2', '42.5', 'true')",
	)
	want := "INSERT INTO root.onetcli_smoke.d1(timestamp, temperature, status) VALUES (2, 42.5, true)"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeHostUpdateForIoTDB(t *testing.T) {
	got := normalizeSQL(
		"root.onetcli_smoke",
		"UPDATE root.onetcli_smoke.d1 SET root.onetcli_smoke.d1.status = 'false' WHERE Time = '1'",
	)
	want := "INSERT INTO root.onetcli_smoke.d1(timestamp, status) VALUES (1, false)"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeCreateDatabaseForIoTDBStorageGroup(t *testing.T) {
	got := normalizeSQL("root", "CREATE DATABASE onetcli_smoke")
	want := "SET STORAGE GROUP TO root.onetcli_smoke"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeDropDatabaseForIoTDBStorageGroup(t *testing.T) {
	got := normalizeSQL("root.onetcli_smoke", "DROP DATABASE child_group")
	want := "DELETE STORAGE GROUP root.onetcli_smoke.child_group"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}
