package dm

import (
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	_ "gitee.com/chunanyong/dm"
)

// TestSchemasSQLReturnsAllSchemas 是对真实达梦实例的回归：
// 库/schema 列表换用 ALL_USERS ∪ ALL_OBJECTS 之后，结果必须和旧的
// ALL_TABLES 全表扫描写法完全一致（旧的 ~850ms，新的 ~150ms）。
// 未设置 NAVOP_DM_PASSWORD 时跳过。
func TestSchemasSQLReturnsAllSchemas(t *testing.T) {
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

	names := func(query string) []string {
		rows, err := db.Query(query)
		if err != nil {
			t.Fatalf("查询失败: %v\nSQL: %s", err, query)
		}
		defer rows.Close()
		cols, err := rows.Columns()
		if err != nil {
			t.Fatalf("取列失败: %v", err)
		}
		var out []string
		for rows.Next() {
			vals := make([]any, len(cols))
			holders := make([]any, len(cols))
			for i := range vals {
				holders[i] = &vals[i]
			}
			if err := rows.Scan(holders...); err != nil {
				t.Fatalf("scan: %v", err)
			}
			name := ""
			if vals[0] != nil {
				name = fmt.Sprint(vals[0])
			}
			if strings.TrimSpace(name) == "" {
				t.Fatalf("列表里出现空名字: %s", query)
			}
			for _, extra := range vals[1:] {
				if extra == nil || fmt.Sprint(extra) == "" {
					t.Fatalf("schemas 第二列（owner）为空: %s", query)
				}
			}
			out = append(out, name)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("迭代失败: %v", err)
		}
		return out
	}

	// 旧写法只作为参照留在测试里，业务 SQL 已经不用 ALL_TABLES。
	legacy := `SELECT NAME, NAME FROM (SELECT USER AS NAME FROM DUAL UNION SELECT USERNAME AS NAME FROM ALL_USERS UNION SELECT OWNER AS NAME FROM ALL_TABLES) WHERE NAME IS NOT NULL ORDER BY NAME`
	spec := Spec()

	oldNames, newNames := names(legacy), names(spec.SchemaSQL.Schemas(cfg, cfg.Database))
	sort.Strings(oldNames)
	sort.Strings(newNames)
	if fmt.Sprint(oldNames) != fmt.Sprint(newNames) {
		t.Fatalf("schema 列表结果变了: 旧 %d 条 / 新 %d 条", len(oldNames), len(newNames))
	}
	if len(newNames) == 0 {
		t.Fatal("schema 列表为空")
	}

	// 单列的 Databases 版本必须和两列的 Schemas 版本给出同一批名字。
	databases := names(spec.SchemaSQL.Databases(cfg))
	sort.Strings(databases)
	if fmt.Sprint(databases) != fmt.Sprint(newNames) {
		t.Fatalf("databases 与 schemas 列表不一致: %d / %d 条", len(databases), len(newNames))
	}
	t.Logf("schema 列表 %d 条，与旧写法一致", len(newNames))
}
