package dm

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"navop-db-ipc-drivers/internal/dbipc"
)

func ConfigFromWire(raw map[string]any) (dbipc.Config, error) {
	return dbipc.ConfigFromWire(raw, 5236)
}

func Spec() dbipc.DriverSpec {
	return dbipc.DriverSpec{
		ID:                   "dm",
		Name:                 "Dameng DM",
		SQLDriverName:        "dm",
		DefaultPort:          5236,
		IdentifierQuoteLeft:  `"`,
		IdentifierQuoteRight: `"`,
		SupportsComments:     true,
		BuildDSN:             buildDSN,
		SchemaSQL: dbipc.SchemaSQL{
			Databases:      dmDatabasesSQL,
			Schemas:        dmSchemasSQL,
			Objects:        dmObjectsSQL,
			Columns:        dmColumnsSQL,
			Indexes:        dmIndexesSQL,
			ForeignKeys:    dmForeignKeysSQL,
			Views:          dmViewsSQL,
			Functions:      dmFunctionsSQL,
			ViewDefinition: dmViewDefinitionSQL,
			DumpDDL:        dmDumpDDL,
		},
	}
}

func buildDSN(cfg dbipc.Config) (string, error) {
	if err := dbipc.RequireConfig(cfg, "host", "port", "username"); err != nil {
		return "", err
	}
	extra := dbipc.CopyDriverExtra(cfg.Extra)
	if cfg.Database != "" && extra["schema"] == "" {
		extra["schema"] = cfg.Database
	}

	// Dameng's Go driver parses the DSN with string splitting and does not URL-decode
	// credentials. Keep auth text raw so passwords like p@ss are sent as p@ss.
	address := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	dsn := fmt.Sprintf("dm://%s:%s@%s", cfg.Username, cfg.Password, address)
	query := dbipc.QueryString(extra)
	if query == "" {
		if strings.Contains(cfg.Username, "?") || strings.Contains(cfg.Password, "?") {
			return dsn + "?", nil
		}
		return dsn, nil
	}
	return dsn + "?" + query, nil
}

func dmDatabasesSQL(cfg dbipc.Config) string {
	return "SELECT NAME FROM (SELECT USER AS NAME FROM DUAL UNION SELECT USERNAME AS NAME FROM ALL_USERS UNION SELECT OWNER AS NAME FROM ALL_TABLES) WHERE NAME IS NOT NULL ORDER BY NAME"
}

func dmSchemasSQL(cfg dbipc.Config, database string) string {
	return "SELECT USERNAME, USERNAME FROM (SELECT USER AS USERNAME FROM DUAL UNION SELECT USERNAME FROM ALL_USERS UNION SELECT OWNER AS USERNAME FROM ALL_TABLES) WHERE USERNAME IS NOT NULL ORDER BY USERNAME"
}

func dmObjectsSQL(cfg dbipc.Config, database, schema string, kinds []string) string {
	ownerFilter := ""
	if owner := dmOwner(database, schema); owner != "" {
		ownerFilter = fmt.Sprintf(" AND OWNER = '%s'", upperEscapeSQL(owner))
	}
	return "SELECT OBJECT_NAME, KIND, COMMENTS, OWNER FROM (" +
		"SELECT t.OWNER, t.TABLE_NAME AS OBJECT_NAME, 'table' AS KIND, NVL(c.COMMENTS, '') AS COMMENTS FROM ALL_TABLES t LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = t.OWNER AND c.TABLE_NAME = t.TABLE_NAME " +
		"UNION ALL " +
		"SELECT v.OWNER, v.VIEW_NAME AS OBJECT_NAME, 'view' AS KIND, NVL(c.COMMENTS, '') AS COMMENTS FROM ALL_VIEWS v LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = v.OWNER AND c.TABLE_NAME = v.VIEW_NAME" +
		") WHERE 1 = 1" + ownerFilter + dmKindFilter(kinds) + " ORDER BY OWNER, OBJECT_NAME"
}

func dmColumnsSQL(cfg dbipc.Config, database, schema, table string) string {
	owner, table := dmOwnerAndTable(database, schema, table)
	ownerFilter := ""
	if owner != "" {
		ownerFilter = fmt.Sprintf(" AND c.OWNER = '%s'", upperEscapeSQL(owner))
	}
	return fmt.Sprintf("SELECT c.COLUMN_ID, c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT, NVL(cc.COMMENTS, '') FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS cc ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME WHERE c.TABLE_NAME = '%s'%s ORDER BY c.COLUMN_ID", upperEscapeSQL(table), ownerFilter)
}

func dmIndexesSQL(cfg dbipc.Config, database, schema, table string) string {
	owner, table := dmOwnerAndTable(database, schema, table)
	ownerFilter := ""
	pkOwnerFilter := ""
	if owner != "" {
		ownerFilter = fmt.Sprintf(" AND c.TABLE_OWNER = '%s'", upperEscapeSQL(owner))
		pkOwnerFilter = fmt.Sprintf(" AND pk.OWNER = '%s'", upperEscapeSQL(owner))
	}
	// 注意：不要改回 “ALL_INDEXES 驱动 + LEFT JOIN ALL_CONSTRAINTS” 的写法。
	// 达梦无法把 TABLE_NAME/TABLE_OWNER 下推到 ALL_INDEXES，单表索引查询实测 20s 以上
	// （同一实例 23.7s），会直接撞上上层 30s 请求超时，表现为树节点加载很慢/偶发失败。
	// 现改为由 ALL_IND_COLUMNS（自带上表名/表所有者，字典层可直接过滤）驱动，
	// 再在小结果集上判定主键约束，实测同样结果 <1s。
	return fmt.Sprintf("SELECT i.INDEX_NAME, LISTAGG(c.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY c.COLUMN_POSITION), CASE WHEN i.UNIQUENESS = 'UNIQUE' THEN 'YES' ELSE 'NO' END, CASE WHEN i.INDEX_NAME IN (SELECT pk.INDEX_NAME FROM ALL_CONSTRAINTS pk WHERE pk.CONSTRAINT_TYPE = 'P' AND pk.TABLE_NAME = '%s'%s) THEN 'YES' ELSE 'NO' END, i.INDEX_TYPE FROM ALL_IND_COLUMNS c JOIN ALL_INDEXES i ON i.OWNER = c.INDEX_OWNER AND i.INDEX_NAME = c.INDEX_NAME AND i.TABLE_OWNER = c.TABLE_OWNER AND i.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_NAME = '%s'%s GROUP BY i.INDEX_NAME, i.UNIQUENESS, i.INDEX_TYPE ORDER BY i.INDEX_NAME", upperEscapeSQL(table), pkOwnerFilter, upperEscapeSQL(table), ownerFilter)
}

func dmForeignKeysSQL(cfg dbipc.Config, database, schema, table string) string {
	owner, table := dmOwnerAndTable(database, schema, table)
	ownerFilter := ""
	if owner != "" {
		ownerFilter = fmt.Sprintf(" AND fk.OWNER = '%s'", upperEscapeSQL(owner))
	}
	return fmt.Sprintf("SELECT fk.CONSTRAINT_NAME, LISTAGG(fkc.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY fkc.POSITION), pk.OWNER, pk.TABLE_NAME, LISTAGG(pkc.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY fkc.POSITION), 'NO ACTION', fk.DELETE_RULE FROM ALL_CONSTRAINTS fk JOIN ALL_CONS_COLUMNS fkc ON fkc.OWNER = fk.OWNER AND fkc.CONSTRAINT_NAME = fk.CONSTRAINT_NAME JOIN ALL_CONSTRAINTS pk ON pk.OWNER = fk.R_OWNER AND pk.CONSTRAINT_NAME = fk.R_CONSTRAINT_NAME JOIN ALL_CONS_COLUMNS pkc ON pkc.OWNER = pk.OWNER AND pkc.CONSTRAINT_NAME = pk.CONSTRAINT_NAME AND pkc.POSITION = fkc.POSITION WHERE fk.CONSTRAINT_TYPE = 'R' AND fk.TABLE_NAME = '%s'%s GROUP BY fk.CONSTRAINT_NAME, pk.OWNER, pk.TABLE_NAME, fk.DELETE_RULE ORDER BY fk.CONSTRAINT_NAME", upperEscapeSQL(table), ownerFilter)
}

func dmViewsSQL(cfg dbipc.Config, database, schema string) string {
	ownerFilter := ""
	if owner := dmOwner(database, schema); owner != "" {
		ownerFilter = fmt.Sprintf(" AND v.OWNER = '%s'", upperEscapeSQL(owner))
	}
	return "SELECT v.VIEW_NAME, v.OWNER, NVL(c.COMMENTS, ''), 'NO', NVL(v.TEXT, '') FROM ALL_VIEWS v LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = v.OWNER AND c.TABLE_NAME = v.VIEW_NAME WHERE 1 = 1" + ownerFilter + " ORDER BY v.OWNER, v.VIEW_NAME"
}

func dmFunctionsSQL(cfg dbipc.Config, database, schema string) string {
	ownerFilter := ""
	if owner := dmOwner(database, schema); owner != "" {
		ownerFilter = fmt.Sprintf(" AND o.OWNER = '%s'", upperEscapeSQL(owner))
	}
	// 注意：达梦的 ALL_PROCEDURES 没有 DATA_TYPE 列，旧写法引用 p.DATA_TYPE 会直接
	// 报错 -2207「无法解析的成员访问表达式[p.DATA_TYPE]」，导致“函数”节点加载失败。
	// 返回类型改从 ALL_ARGUMENTS 中取（ARGUMENT_NAME 为空、DATA_LEVEL=0 的行为返回类型）。
	return "SELECT o.OBJECT_NAME, o.OWNER, NVL(a.DATA_TYPE, ''), 'SQL', '' FROM ALL_OBJECTS o LEFT JOIN ALL_ARGUMENTS a ON a.OWNER = o.OWNER AND a.OBJECT_NAME = o.OBJECT_NAME AND a.PACKAGE_NAME IS NULL AND a.DATA_LEVEL = 0 AND a.ARGUMENT_NAME IS NULL WHERE o.OBJECT_TYPE = 'FUNCTION'" + ownerFilter + " GROUP BY o.OBJECT_NAME, o.OWNER, a.DATA_TYPE ORDER BY o.OWNER, o.OBJECT_NAME"
}

func dmViewDefinitionSQL(cfg dbipc.Config, database, schema, view string) string {
	owner, view := dmOwnerAndTable(database, schema, view)
	ownerFilter := ""
	if owner != "" {
		ownerFilter = fmt.Sprintf(" AND OWNER = '%s'", upperEscapeSQL(owner))
	}
	return fmt.Sprintf("SELECT TEXT, 'NO' FROM ALL_VIEWS WHERE VIEW_NAME = '%s'%s", upperEscapeSQL(view), ownerFilter)
}

// dmDumpDDL asks the server for the official CREATE TABLE text via
// DBMS_METADATA, which Dameng DM implements with the Oracle-compatible
// signature. The owner argument is omitted when unknown so the provider uses
// the connected user's schema.
func dmDumpDDL(cfg dbipc.Config, database, schema, table string) string {
	owner, table := dmOwnerAndTable(database, schema, table)
	if owner == "" {
		return fmt.Sprintf("SELECT DBMS_METADATA.GET_DDL('TABLE', '%s') FROM DUAL", upperEscapeSQL(table))
	}
	return fmt.Sprintf("SELECT DBMS_METADATA.GET_DDL('TABLE', '%s', '%s') FROM DUAL", upperEscapeSQL(table), upperEscapeSQL(owner))
}

func dmOwner(database, schema string) string {
	if strings.TrimSpace(schema) != "" {
		return schema
	}
	return database
}

func dmOwnerAndTable(database, schema, table string) (string, string) {
	owner := dmOwner(database, schema)
	name := strings.TrimSpace(table)
	if owner == "" {
		if parts := strings.SplitN(name, ".", 2); len(parts) == 2 {
			owner = parts[0]
			name = parts[1]
		}
	}
	return stripIdentifierQuotes(owner), stripIdentifierQuotes(name)
}

func dmKindFilter(kinds []string) string {
	if len(kinds) == 0 {
		return ""
	}
	seen := map[string]bool{}
	for _, kind := range kinds {
		switch strings.ToLower(strings.TrimSpace(kind)) {
		case "table", "base_table":
			seen["table"] = true
		case "view":
			seen["view"] = true
		}
	}
	if len(seen) == 0 {
		return " AND 1 = 0"
	}
	values := make([]string, 0, len(seen))
	if seen["table"] {
		values = append(values, "'table'")
	}
	if seen["view"] {
		values = append(values, "'view'")
	}
	return " AND KIND IN (" + strings.Join(values, ",") + ")"
}

func stripIdentifierQuotes(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"`)
}

func escapeSQL(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func upperEscapeSQL(value string) string {
	return escapeSQL(strings.ToUpper(strings.TrimSpace(value)))
}
