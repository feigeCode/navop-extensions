package dm

import (
	"strings"
	"testing"
)

// 回归：这两条 SQL 都曾在真实达梦实例（DM8）上把树节点拖到 20s+ 或直接报错。
// 细节见 2026-09-29 的排查：单表索引 23.7s（撞上 navop 30s 请求超时 →
// “加载失败”）、函数节点 -2207。
func TestSpecAvoidsSlowAndUnsupportedDamengCatalogQueries(t *testing.T) {
	cfg := ConfigFromWireNoError(t, map[string]any{
		"host":     "127.0.0.1",
		"username": "SYSDBA",
	})
	spec := Spec()

	indexesSQL := spec.SchemaSQL.Indexes(cfg, "AI_M_TEST", "ai-manager-330-dev", "ai_skill_ability_sync_record")

	// ALL_IND_COLUMNS 上带 TABLE_OWNER/TABLE_NAME，字典层可以直接过滤；
	// ALL_INDEXES 上的同名谓词在达梦上无法下推，必须避免让它驱动连接。
	driver := strings.Index(indexesSQL, "FROM ALL_IND_COLUMNS c JOIN ALL_INDEXES i")
	joined := strings.Index(indexesSQL, "FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS")
	if driver < 0 || joined >= 0 {
		t.Fatalf("indexes SQL must drive from ALL_IND_COLUMNS, got %q", indexesSQL)
	}
	// 过滤条件必须落在驱动表（c = ALL_IND_COLUMNS）上。
	for _, want := range []string{
		"c.TABLE_NAME = 'AI_SKILL_ABILITY_SYNC_RECORD'",
		"c.TABLE_OWNER = 'AI-MANAGER-330-DEV'",
		"pk.OWNER = 'AI-MANAGER-330-DEV'",
		"pk.CONSTRAINT_TYPE = 'P'",
	} {
		if !strings.Contains(indexesSQL, want) {
			t.Fatalf("indexes SQL %q does not contain %q", indexesSQL, want)
		}
	}
	if got := strings.Count(indexesSQL, "LISTAGG"); got != 1 {
		t.Fatalf("indexes SQL should aggregate index columns once, found %d LISTAGG in %q", got, indexesSQL)
	}
	if !strings.Contains(indexesSQL, "ORDER BY i.INDEX_NAME") {
		t.Fatalf("indexes SQL %q is missing the index name ordering", indexesSQL)
	}

	// ALL_PROCEDURES 在达梦没有 DATA_TYPE 列：引用它会抛 -2207，整个“函数”节点加载失败。
	functionsSQL := spec.SchemaSQL.Functions(cfg, "AI_M_TEST", "ai-manager-330-dev")
	if strings.Contains(functionsSQL, "ALL_PROCEDURES") || strings.Contains(functionsSQL, "p.DATA_TYPE") {
		t.Fatalf("functions SQL must not touch ALL_PROCEDURES, got %q", functionsSQL)
	}
	if !strings.Contains(functionsSQL, "LEFT JOIN ALL_ARGUMENTS a") {
		t.Fatalf("functions SQL should read the return type from ALL_ARGUMENTS, got %q", functionsSQL)
	}
}
