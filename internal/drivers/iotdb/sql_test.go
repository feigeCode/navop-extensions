package iotdb

import "testing"

func TestNormalizeSQLScopesRelativeDevice(t *testing.T) {
	got := normalizeSQL("root.navop_smoke", "SELECT * FROM d1")
	want := "SELECT * FROM root.navop_smoke.d1"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeSQLDoesNotInjectTimeProjection(t *testing.T) {
	got := normalizeSQL("root.navop_smoke", "SELECT temperature FROM d1")
	want := "SELECT temperature FROM root.navop_smoke.d1"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeHostInsertForIoTDB(t *testing.T) {
	got := normalizeSQL(
		"root.navop_smoke",
		"INSERT INTO d1 (Time, temperature, status) VALUES ('2', '42.5', 'true')",
	)
	want := "INSERT INTO root.navop_smoke.d1(timestamp, temperature, status) VALUES (2, 42.5, true)"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeHostUpdateForIoTDB(t *testing.T) {
	got := normalizeSQL(
		"root.navop_smoke",
		"UPDATE root.navop_smoke.d1 SET root.navop_smoke.d1.status = 'false' WHERE Time = '1'",
	)
	want := "INSERT INTO root.navop_smoke.d1(timestamp, status) VALUES (1, false)"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeCreateDatabaseForIoTDBStorageGroup(t *testing.T) {
	got := normalizeSQL("root", "CREATE DATABASE navop_smoke")
	want := "SET STORAGE GROUP TO root.navop_smoke"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}

func TestNormalizeDropDatabaseForIoTDBStorageGroup(t *testing.T) {
	got := normalizeSQL("root.navop_smoke", "DROP DATABASE child_group")
	want := "DELETE STORAGE GROUP root.navop_smoke.child_group"
	if got != want {
		t.Fatalf("normalizeSQL() = %q, want %q", got, want)
	}
}
