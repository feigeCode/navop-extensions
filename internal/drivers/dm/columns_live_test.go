package dm

import (
	"database/sql"
	"os"
	"testing"

	_ "gitee.com/chunanyong/dm"
)

// TestColumnsSQLReturnsColumnComments 是对真实达梦实例的回归：
// 达梦 ALL_COL_COMMENTS.OWNER 列不可用，只有按 SCHEMA_NAME 关联才能取回列注释。
// 未设置 NAVOP_DM_PASSWORD 时跳过。
func TestColumnsSQLReturnsColumnComments(t *testing.T) {
	password := os.Getenv("NAVOP_DM_PASSWORD")
	if password == "" {
		t.Skip("NAVOP_DM_PASSWORD 未设置，跳过真实达梦实例校验")
	}
	cfg := ConfigFromWireNoError(t, map[string]any{
		"host":     envOrDefault("NAVOP_DM_HOST", "127.0.0.1"),
		"port":     envOrDefault("NAVOP_DM_PORT", "5236"),
		"username": envOrDefault("NAVOP_DM_USER", "SYSDBA"),
		"password": password,
		"database": os.Getenv("NAVOP_DM_DATABASE"),
	})
	dsn, err := Spec().BuildDSN(cfg)
	if err != nil {
		t.Fatalf("build dsn: %v", err)
	}
	db, err := sql.Open("dm", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	// 随便挑一条已存在的列注释作为夹具。
	var schemaName, tableName, columnName, comment string
	err = db.QueryRow(`SELECT SCHEMA_NAME, TABLE_NAME, COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS
		WHERE COMMENTS IS NOT NULL AND ROWNUM <= 1`).
		Scan(&schemaName, &tableName, &columnName, &comment)
	if err != nil {
		if err == sql.ErrNoRows {
			t.Skip("实例里没有任何列注释，无法校验")
		}
		t.Fatalf("查夹具失败: %v", err)
	}

	query := Spec().SchemaSQL.Columns(cfg, cfg.Database, schemaName, tableName)
	rows, err := db.Query(query)
	if err != nil {
		t.Fatalf("Columns SQL 执行失败: %v\nSQL: %s", err, query)
	}
	defer rows.Close()

	found := false
	total := 0
	for rows.Next() {
		var id int
		var name, dataType, nullable string
		var defaultValue, columnComment sql.NullString
		if err := rows.Scan(&id, &name, &dataType, &nullable, &defaultValue, &columnComment); err != nil {
			t.Fatalf("scan: %v", err)
		}
		total++
		if name == columnName && columnComment.String == comment {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("迭代失败: %v", err)
	}
	if total == 0 {
		t.Fatalf("%s.%s 没有查回任何列，SQL: %s", schemaName, tableName, query)
	}
	if !found {
		t.Fatalf("列注释没取回来：期望 %s.%s.%s = %q，SQL: %s", schemaName, tableName, columnName, comment, query)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
