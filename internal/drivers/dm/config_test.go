package dm

import (
	"strings"
	"testing"

	"navop-db-ipc-drivers/internal/dbipc"
)

func TestSpecBuildsDamengDSNFromNavopConfig(t *testing.T) {
	cfg, err := ConfigFromWire(map[string]any{
		"host":     "127.0.0.1",
		"port":     float64(5236),
		"username": "SYSDBA",
		"password": "sysDBA*00",
		"database": "SYSDBA",
		"extra_params": map[string]any{
			"autoCommit": "true",
			"schema":     "APP",
		},
	})
	if err != nil {
		t.Fatalf("ConfigFromWire returned error: %v", err)
	}

	dsn, err := Spec().BuildDSN(cfg)
	if err != nil {
		t.Fatalf("BuildDSN returned error: %v", err)
	}

	if !strings.HasPrefix(dsn, "dm://SYSDBA:sysDBA*00@127.0.0.1:5236?") {
		t.Fatalf("dsn prefix = %q", dsn)
	}
	for _, want := range []string{"autoCommit=true", "schema=APP"} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("dsn %q does not contain %q", dsn, want)
		}
	}
}

func TestSpecBuildsDamengDSNWithDatabaseAsSchemaAndRawCredentials(t *testing.T) {
	cfg, err := ConfigFromWire(map[string]any{
		"host":     "2001:db8::10",
		"username": "SYS?DBA",
		"password": "p@ss?word",
		"database": "app",
	})
	if err != nil {
		t.Fatalf("ConfigFromWire returned error: %v", err)
	}

	dsn, err := Spec().BuildDSN(cfg)
	if err != nil {
		t.Fatalf("BuildDSN returned error: %v", err)
	}

	want := "dm://SYS?DBA:p@ss?word@[2001:db8::10]:5236?schema=app"
	if dsn != want {
		t.Fatalf("dsn = %q, want %q", dsn, want)
	}
}

func TestSpecBuildsDamengDSNWithoutHostManagedSSHOptions(t *testing.T) {
	cfg, err := ConfigFromWire(map[string]any{
		"host":     "127.0.0.1",
		"username": "SYSDBA",
		"password": "secret",
		"extra_params": map[string]any{
			"connect_timeout": "10",
			"ssh_auth_type":   "password",
			" SSH_PORT ":      22,
		},
	})
	if err != nil {
		t.Fatalf("ConfigFromWire returned error: %v", err)
	}

	dsn, err := Spec().BuildDSN(cfg)
	if err != nil {
		t.Fatalf("BuildDSN returned error: %v", err)
	}

	if !strings.Contains(dsn, "connect_timeout=10") {
		t.Fatalf("dsn %q does not contain connect_timeout=10", dsn)
	}
	if strings.Contains(strings.ToLower(dsn), "ssh_") {
		t.Fatalf("dsn leaked host-managed ssh options: %q", dsn)
	}
}

func TestSpecBuildsDamengMetadataSQLWithOwnerFilters(t *testing.T) {
	cfg := ConfigFromWireNoError(t, map[string]any{
		"host":     "127.0.0.1",
		"username": "SYSDBA",
	})
	spec := Spec()

	databasesSQL := spec.SchemaSQL.Databases(cfg)
	for _, want := range []string{"USERNAME AS NAME FROM ALL_USERS", "DISTINCT OWNER AS NAME FROM ALL_OBJECTS"} {
		if !strings.Contains(databasesSQL, want) {
			t.Fatalf("databases SQL %q does not contain %q", databasesSQL, want)
		}
	}
	// 回归：ALL_TABLES 全表扫描要 ~900ms（驱动不了库列表的性能），SYS.SYSOBJECTS 普通用户无权限。
	if strings.Contains(databasesSQL, "ALL_TABLES") {
		t.Fatalf("databases SQL regressed to the slow ALL_TABLES scan: %q", databasesSQL)
	}
	if strings.Contains(databasesSQL, "SYSOBJECTS") {
		t.Fatalf("databases SQL must not depend on SYS.SYSOBJECTS privileges: %q", databasesSQL)
	}

	schemasSQL := spec.SchemaSQL.Schemas(cfg, "AI_M_TEST")
	if !strings.Contains(schemasSQL, "SELECT NAME, NAME FROM") {
		t.Fatalf("schemas SQL must keep projecting two columns: %q", schemasSQL)
	}

	objectsSQL := spec.SchemaSQL.Objects(cfg, "", "app's", nil)
	for _, want := range []string{"ALL_OBJECTS", "ALL_TAB_COMMENTS", "OWNER = 'APP''S'"} {
		if !strings.Contains(objectsSQL, want) {
			t.Fatalf("objects SQL %q does not contain %q", objectsSQL, want)
		}
	}
	// 回归：ALL_TABLES/ALL_VIEWS 两段 UNION 实测 350ms，ALL_OBJECTS 只要 186ms。
	if strings.Contains(objectsSQL, "ALL_TABLES") {
		t.Fatalf("objects SQL regressed to the slow ALL_TABLES union: %q", objectsSQL)
	}
	// kind 过滤：只能落在子查询投影出来的 KIND 上（OBJECT_TYPE 推不进字典底层）。
	if tablesOnly := spec.SchemaSQL.Objects(cfg, "", "app", []string{"table"}); !strings.Contains(tablesOnly, "KIND IN ('table')") {
		t.Fatalf("objects SQL table filter lost: %q", tablesOnly)
	}
	if viewsOnly := spec.SchemaSQL.Objects(cfg, "", "app", []string{"view"}); !strings.Contains(viewsOnly, "KIND IN ('view')") {
		t.Fatalf("objects SQL view filter lost: %q", viewsOnly)
	}

	columnsSQL := spec.SchemaSQL.Columns(cfg, "", "app", "demo")
	for _, want := range []string{"ALL_TAB_COLUMNS", "ALL_COL_COMMENTS", "TABLE_NAME = 'DEMO'", "OWNER = 'APP'"} {
		if !strings.Contains(columnsSQL, want) {
			t.Fatalf("columns SQL %q does not contain %q", columnsSQL, want)
		}
	}

	indexesSQL := spec.SchemaSQL.Indexes(cfg, "", "app", "demo")
	// 必须以 ALL_IND_COLUMNS 驱动：达梦无法把 TABLE_NAME/TABLE_OWNER 下推到 ALL_INDEXES，
	// 旧写法单表查询要 20s+，会撞上上层 30s 请求超时。
	for _, want := range []string{"FROM ALL_IND_COLUMNS c JOIN ALL_INDEXES i", "ALL_INDEXES", "ALL_CONSTRAINTS", "TABLE_NAME = 'DEMO'", "TABLE_OWNER = 'APP'", "LISTAGG"} {
		if !strings.Contains(indexesSQL, want) {
			t.Fatalf("indexes SQL %q does not contain %q", indexesSQL, want)
		}
	}
	if strings.Contains(indexesSQL, "FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS") {
		t.Fatalf("indexes SQL regressed to the slow ALL_INDEXES-driven join: %q", indexesSQL)
	}

	foreignKeysSQL := spec.SchemaSQL.ForeignKeys(cfg, "", "app", "demo")
	for _, want := range []string{"ALL_CONSTRAINTS", "ALL_CONS_COLUMNS", "CONSTRAINT_TYPE = 'R'", "TABLE_NAME = 'DEMO'", "OWNER = 'APP'", "DELETE_RULE"} {
		if !strings.Contains(foreignKeysSQL, want) {
			t.Fatalf("foreign keys SQL %q does not contain %q", foreignKeysSQL, want)
		}
	}

	viewsSQL := spec.SchemaSQL.Views(cfg, "", "app")
	for _, want := range []string{"ALL_VIEWS", "ALL_TAB_COMMENTS", "OWNER = 'APP'", "'NO'"} {
		if !strings.Contains(viewsSQL, want) {
			t.Fatalf("views SQL %q does not contain %q", viewsSQL, want)
		}
	}

	functionsSQL := spec.SchemaSQL.Functions(cfg, "", "app")
	// 达梦的 ALL_PROCEDURES 没有 DATA_TYPE 列，引用它会报 -2207 导致“函数”节点加载失败。
	for _, want := range []string{"ALL_OBJECTS", "ALL_ARGUMENTS", "OBJECT_TYPE = 'FUNCTION'", "OWNER = 'APP'"} {
		if !strings.Contains(functionsSQL, want) {
			t.Fatalf("functions SQL %q does not contain %q", functionsSQL, want)
		}
	}
	if strings.Contains(functionsSQL, "ALL_PROCEDURES") {
		t.Fatalf("functions SQL references ALL_PROCEDURES, which dm rejects with -2207: %q", functionsSQL)
	}

	viewSQL := spec.SchemaSQL.ViewDefinition(cfg, "", "app", "v_demo")
	for _, want := range []string{"ALL_VIEWS", "TEXT", "VIEW_NAME = 'V_DEMO'", "OWNER = 'APP'"} {
		if !strings.Contains(viewSQL, want) {
			t.Fatalf("view definition SQL %q does not contain %q", viewSQL, want)
		}
	}
}

func TestSpecBuildsDamengColumnsSQLFromQualifiedTable(t *testing.T) {
	cfg := ConfigFromWireNoError(t, map[string]any{
		"host":     "127.0.0.1",
		"username": "SYSDBA",
	})

	columnsSQL := Spec().SchemaSQL.Columns(cfg, "", "", "app.demo")
	for _, want := range []string{"TABLE_NAME = 'DEMO'", "OWNER = 'APP'"} {
		if !strings.Contains(columnsSQL, want) {
			t.Fatalf("columns SQL %q does not contain %q", columnsSQL, want)
		}
	}
}

func ConfigFromWireNoError(t *testing.T, raw map[string]any) dbipc.Config {
	t.Helper()
	cfg, err := ConfigFromWire(raw)
	if err != nil {
		t.Fatalf("ConfigFromWire returned error: %v", err)
	}
	return cfg
}

func TestSpecBuildsDamengDumpDDL(t *testing.T) {
	cfg := ConfigFromWireNoError(t, map[string]any{
		"host":     "127.0.0.1",
		"username": "SYSDBA",
	})
	spec := Spec()
	if spec.SchemaSQL.DumpDDL == nil {
		t.Fatalf("dm Spec() must provide DumpDDL")
	}

	withoutOwner := spec.SchemaSQL.DumpDDL(cfg, "", "", "demo")
	if withoutOwner != "SELECT DBMS_METADATA.GET_DDL('TABLE', 'DEMO') FROM DUAL" {
		t.Fatalf("ownerless DumpDDL SQL = %q", withoutOwner)
	}

	withOwner := spec.SchemaSQL.DumpDDL(cfg, "APP", "APP", "demo")
	if withOwner != "SELECT DBMS_METADATA.GET_DDL('TABLE', 'DEMO', 'APP') FROM DUAL" {
		t.Fatalf("owner DumpDDL SQL = %q", withOwner)
	}

	qualified := spec.SchemaSQL.DumpDDL(cfg, "", "", "app.demo")
	if qualified != "SELECT DBMS_METADATA.GET_DDL('TABLE', 'DEMO', 'APP') FROM DUAL" {
		t.Fatalf("qualified DumpDDL SQL = %q", qualified)
	}

	escaped := spec.SchemaSQL.DumpDDL(cfg, "", "", "o'brien")
	if !strings.Contains(escaped, "'O''BRIEN'") {
		t.Fatalf("DumpDDL SQL %q does not escape a single quote", escaped)
	}
}
