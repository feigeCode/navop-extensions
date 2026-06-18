package dbipc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"onetcli-db-ipc-drivers/internal/ipc"
)

type Opener func(driverName, dsn string) (*sql.DB, error)

type Server struct {
	spec        DriverSpec
	opener      Opener
	initialized bool
	nextConnID  uint64
	nextCursor  uint64
	conns       map[uint64]*connectionState
	cursors     map[string]*cursorState
	mu          sync.Mutex
}

type connectionState struct {
	config Config
	db     *sql.DB
}

type cursorState struct {
	connID      uint64
	rows        *sql.Rows
	columnCount int
	maxRows     *uint64
	fetched     uint64
	done        bool
}

func NewServer(spec DriverSpec, opener Opener) *Server {
	if opener == nil {
		opener = sql.Open
	}
	return &Server{
		spec:       spec,
		opener:     opener,
		nextConnID: 1,
		nextCursor: 1,
		conns:      map[uint64]*connectionState{},
		cursors:    map[string]*cursorState{},
	}
}

func DeclaredMethods() []string {
	return []string{
		"$/ping",
		"shutdown",
		"conn/test",
		"conn/open",
		"conn/close",
		"conn/ping",
		"conn/use",
		"query/start",
		"cursor/fetch",
		"cursor/close",
		"cursor/cancel",
		"exec/run",
		"exec/batch",
		"schema/databases",
		"schema/schemas",
		"schema/objects",
		"schema/columns",
		"schema/indexes",
		"schema/foreign_keys",
		"schema/checks",
		"schema/views",
		"schema/functions",
		"schema/procedures",
		"schema/triggers",
		"schema/sequences",
		"schema/types",
		"schema/view_definition",
		"schema/dump_ddl",
	}
}

func (s *Server) Handle(ctx context.Context, req ipc.Message) ipc.Message {
	s.mu.Lock()
	defer s.mu.Unlock()

	if req.JSONRPC != "" && req.JSONRPC != ipc.JSONRPCVersion {
		return s.err(req.ID, ErrInvalidRequest, "jsonrpc must be 2.0")
	}
	if len(req.ID) == 0 {
		req.ID = json.RawMessage(`null`)
	}

	if req.Method != "init" && req.Method != "$/ping" && req.Method != "shutdown" && !s.initialized {
		return s.err(req.ID, ErrNotInitialized, "init must be called first")
	}

	switch req.Method {
	case "init":
		s.initialized = true
		return s.ok(req.ID, map[string]any{
			"extension_version": "0.1.0",
			"api_used":          map[string]string{"database": "1.0"},
			"features":          []string{"streaming", "schema_introspection", "rich_errors"},
			"drivers_ready":     []string{s.spec.ID},
			"methods":           DeclaredMethods(),
			"name":              s.spec.Name + " IPC Driver",
		})
	case "$/ping":
		return s.ok(req.ID, map[string]bool{"pong": true})
	case "shutdown":
		s.closeAll()
		return s.ok(req.ID, nil)
	case "conn/test":
		return s.handleConnTest(ctx, req)
	case "conn/open":
		return s.handleConnOpen(ctx, req)
	case "conn/close":
		return s.handleConnClose(req)
	case "conn/ping":
		return s.handleConnPing(ctx, req)
	case "conn/use":
		return s.handleConnUse(req)
	case "query/start":
		return s.handleQueryStart(ctx, req)
	case "cursor/fetch":
		return s.handleCursorFetch(req)
	case "cursor/close":
		return s.handleCursorClose(req)
	case "cursor/cancel":
		return s.handleCursorCancel(req)
	case "exec/run":
		return s.handleExecRun(ctx, req)
	case "exec/batch":
		return s.handleExecBatch(ctx, req)
	case "schema/databases":
		return s.handleSchemaDatabases(ctx, req)
	case "schema/schemas":
		return s.handleSchemaSchemas(ctx, req)
	case "schema/objects":
		return s.handleSchemaObjects(ctx, req)
	case "schema/columns":
		return s.handleSchemaColumns(ctx, req)
	case "schema/indexes":
		return s.handleSchemaIndexes(ctx, req)
	case "schema/foreign_keys":
		return s.handleSchemaForeignKeys(ctx, req)
	case "schema/checks":
		return s.handleEmptySchemaList(req)
	case "schema/views":
		return s.handleSchemaViews(ctx, req)
	case "schema/functions":
		return s.handleSchemaFunctions(ctx, req)
	case "schema/procedures", "schema/triggers", "schema/sequences", "schema/types":
		return s.handleEmptySchemaList(req)
	case "schema/view_definition":
		return s.handleSchemaViewDefinition(ctx, req)
	case "schema/dump_ddl":
		return s.handleEmptyDumpDDL(req)
	default:
		return s.err(req.ID, ErrMethodNotFound, fmt.Sprintf("method `%s` is not implemented", req.Method))
	}
}

func (s *Server) handleConnTest(ctx context.Context, req ipc.Message) ipc.Message {
	cfg, dsn, err := s.parseConfig(req.Params)
	if err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	start := time.Now()
	db, err := s.opener(s.spec.SQLDriverName, dsn)
	if err != nil {
		return s.err(req.ID, ErrConnectionFailed, err.Error())
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		return s.err(req.ID, ErrConnectionFailed, err.Error())
	}
	return s.ok(req.ID, map[string]any{
		"ok":             true,
		"latency_ms":     uint32(time.Since(start).Milliseconds()),
		"warnings":       []string{},
		"server_version": cfg.Database,
	})
}

func (s *Server) handleConnOpen(ctx context.Context, req ipc.Message) ipc.Message {
	cfg, dsn, err := s.parseConfig(req.Params)
	if err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	db, err := s.opener(s.spec.SQLDriverName, dsn)
	if err != nil {
		return s.err(req.ID, ErrConnectionFailed, err.Error())
	}
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return s.err(req.ID, ErrConnectionFailed, err.Error())
	}

	connID := s.nextConnID
	s.nextConnID++
	s.conns[connID] = &connectionState{config: cfg, db: db}
	return s.ok(req.ID, map[string]any{
		"conn_id": connID,
		"server_info": map[string]any{
			"version":  s.spec.Name,
			"features": []string{"database_sql"},
		},
	})
}

func (s *Server) handleConnClose(req ipc.Message) ipc.Message {
	var p struct {
		ConnID uint64 `json:"conn_id"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	s.closeCursorsForConn(p.ConnID)
	conn.db.Close()
	delete(s.conns, p.ConnID)
	return s.ok(req.ID, nil)
}

func (s *Server) handleConnPing(ctx context.Context, req ipc.Message) ipc.Message {
	conn, errResp := s.connFromParams(req)
	if errResp != nil {
		return *errResp
	}
	start := time.Now()
	if err := conn.db.PingContext(ctx); err != nil {
		return s.err(req.ID, ErrConnectionFailed, err.Error())
	}
	return s.ok(req.ID, map[string]any{"latency_ms": uint32(time.Since(start).Milliseconds())})
}

func (s *Server) handleConnUse(req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
		Role     string `json:"role,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if p.Database != "" {
		conn.config.Database = p.Database
	}
	return s.ok(req.ID, nil)
}

func (s *Server) handleQueryStart(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID  uint64      `json:"conn_id"`
		SQL     string      `json:"sql"`
		Params  []cellValue `json:"params,omitempty"`
		MaxRows *uint64     `json:"max_rows,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	args, err := paramsFromWire(p.Params)
	if err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	columns, rows, err := startQuery(ctx, conn.db, p.SQL, args)
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	cursorID := fmt.Sprintf("%s-cursor-%d", s.spec.ID, s.nextCursor)
	s.nextCursor++
	s.cursors[cursorID] = &cursorState{
		connID:      p.ConnID,
		rows:        rows,
		columnCount: len(columns),
		maxRows:     p.MaxRows,
	}
	return s.ok(req.ID, map[string]any{
		"cursor_id":       cursorID,
		"columns":         columns,
		"row_count_known": false,
	})
}

func (s *Server) handleCursorFetch(req ipc.Message) ipc.Message {
	var p struct {
		CursorID string  `json:"cursor_id"`
		N        *uint32 `json:"n,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	cursor, ok := s.cursors[p.CursorID]
	if !ok {
		return s.err(req.ID, ErrUnknownCursorID, fmt.Sprintf("unknown cursor_id `%s`", p.CursorID))
	}
	n := 500
	if p.N != nil && *p.N > 0 {
		n = int(*p.N)
	}
	if cursor.done || cursor.rows == nil {
		return s.ok(req.ID, map[string]any{"rows": [][]cellValue{}, "done": true})
	}
	rows, done, fetched, err := fetchRows(cursor.rows, cursor.columnCount, n, cursor.maxRows, cursor.fetched)
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	cursor.fetched = fetched
	if done {
		cursor.done = true
		if err := cursor.rows.Close(); err != nil {
			return s.err(req.ID, ErrSQLSyntax, err.Error())
		}
		cursor.rows = nil
	}
	return s.ok(req.ID, map[string]any{"rows": rows, "done": done})
}

func (s *Server) handleCursorClose(req ipc.Message) ipc.Message {
	var p struct {
		CursorID string `json:"cursor_id"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	if _, ok := s.cursors[p.CursorID]; !ok {
		return s.err(req.ID, ErrUnknownCursorID, fmt.Sprintf("unknown cursor_id `%s`", p.CursorID))
	}
	if err := s.closeCursor(p.CursorID); err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	delete(s.cursors, p.CursorID)
	return s.ok(req.ID, nil)
}

func (s *Server) handleCursorCancel(req ipc.Message) ipc.Message {
	var p struct {
		CursorID string `json:"cursor_id"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	cursor, ok := s.cursors[p.CursorID]
	if !ok {
		return s.err(req.ID, ErrUnknownCursorID, fmt.Sprintf("unknown cursor_id `%s`", p.CursorID))
	}
	if err := s.closeCursor(p.CursorID); err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	cursor.done = true
	return s.ok(req.ID, nil)
}

func (s *Server) handleExecRun(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID uint64      `json:"conn_id"`
		SQL    string      `json:"sql"`
		Params []cellValue `json:"params,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	args, err := paramsFromWire(p.Params)
	if err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	res, err := conn.db.ExecContext(ctx, p.SQL, args...)
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	affected, _ := res.RowsAffected()
	return s.ok(req.ID, map[string]any{"affected_rows": uint64(affected), "warnings": []string{}})
}

func (s *Server) handleExecBatch(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID        uint64   `json:"conn_id"`
		Statements    []string `json:"statements"`
		StopOnError   bool     `json:"stop_on_error"`
		InTransaction bool     `json:"in_transaction"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}

	var execer interface {
		ExecContext(context.Context, string, ...any) (sql.Result, error)
	} = conn.db
	var tx *sql.Tx
	if p.InTransaction {
		var err error
		tx, err = conn.db.BeginTx(ctx, nil)
		if err != nil {
			return s.err(req.ID, ErrSQLSyntax, err.Error())
		}
		execer = tx
	}

	results := make([]map[string]any, 0, len(p.Statements))
	errorsOut := make([]map[string]any, 0)
	for index, statement := range p.Statements {
		res, err := execer.ExecContext(ctx, statement)
		if err != nil {
			errorsOut = append(errorsOut, map[string]any{
				"index":   index,
				"sql":     statement,
				"code":    ErrSQLSyntax,
				"message": err.Error(),
			})
			if p.StopOnError {
				break
			}
			continue
		}
		affected, _ := res.RowsAffected()
		results = append(results, map[string]any{"affected_rows": uint64(affected), "warnings": []string{}})
	}

	if tx != nil {
		if len(errorsOut) > 0 {
			_ = tx.Rollback()
		} else if err := tx.Commit(); err != nil {
			return s.err(req.ID, ErrSQLSyntax, err.Error())
		}
	}

	return s.ok(req.ID, map[string]any{"results": results, "errors": errorsOut})
}

func (s *Server) handleSchemaDatabases(ctx context.Context, req ipc.Message) ipc.Message {
	conn, errResp := s.connFromParams(req)
	if errResp != nil {
		return *errResp
	}
	sqlText := ""
	if s.spec.SchemaSQL.Databases != nil {
		sqlText = s.spec.SchemaSQL.Databases(conn.config)
	}
	if sqlText == "" {
		return s.ok(req.ID, []map[string]any{{"name": conn.config.Database}})
	}
	rows, err := queryObjects(ctx, conn.db, sqlText, func(cols []any) map[string]any {
		return map[string]any{"name": stringCell(cols, 0)}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaSchemas(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if s.spec.SchemaSQL.Schemas == nil {
		return s.ok(req.ID, []map[string]any{{"name": conn.config.Username}})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Schemas(conn.config, p.Database), func(cols []any) map[string]any {
		return map[string]any{"name": stringCell(cols, 0), "owner": stringCell(cols, 1)}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaObjects(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64   `json:"conn_id"`
		Database string   `json:"database,omitempty"`
		Schema   string   `json:"schema,omitempty"`
		Kinds    []string `json:"kinds,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if s.spec.SchemaSQL.Objects == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Objects(conn.config, p.Database, p.Schema, p.Kinds), func(cols []any) map[string]any {
		return map[string]any{"name": stringCell(cols, 0), "kind": stringCell(cols, 1), "comment": stringCell(cols, 2)}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaColumns(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
		Table    string `json:"table"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if p.Table == "" {
		return s.err(req.ID, ErrInvalidParams, "missing required parameter `table`")
	}
	if s.spec.SchemaSQL.Columns == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Columns(conn.config, p.Database, p.Schema, p.Table), func(cols []any) map[string]any {
		return map[string]any{
			"ordinal":    uint32(intCell(cols, 0)),
			"name":       stringCell(cols, 1),
			"type":       stringCell(cols, 2),
			"raw_type":   stringCell(cols, 2),
			"nullable":   boolCell(cols, 3),
			"default":    nullableString(cols, 4),
			"is_primary": false,
			"is_unique":  false,
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaIndexes(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
		Table    string `json:"table"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if p.Table == "" {
		return s.err(req.ID, ErrInvalidParams, "missing required parameter `table`")
	}
	if s.spec.SchemaSQL.Indexes == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Indexes(conn.config, p.Database, p.Schema, p.Table), func(cols []any) map[string]any {
		return map[string]any{
			"name":       stringCell(cols, 0),
			"columns":    splitListCell(cols, 1),
			"is_unique":  boolCell(cols, 2),
			"is_primary": boolCell(cols, 3),
			"type":       stringCell(cols, 4),
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaForeignKeys(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
		Table    string `json:"table"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if p.Table == "" {
		return s.err(req.ID, ErrInvalidParams, "missing required parameter `table`")
	}
	if s.spec.SchemaSQL.ForeignKeys == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.ForeignKeys(conn.config, p.Database, p.Schema, p.Table), func(cols []any) map[string]any {
		return map[string]any{
			"name":               stringCell(cols, 0),
			"columns":            splitListCell(cols, 1),
			"referenced_schema":  stringCell(cols, 2),
			"referenced_table":   stringCell(cols, 3),
			"referenced_columns": splitListCell(cols, 4),
			"on_update":          stringCell(cols, 5),
			"on_delete":          stringCell(cols, 6),
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaViews(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if s.spec.SchemaSQL.Views == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Views(conn.config, p.Database, p.Schema), func(cols []any) map[string]any {
		return map[string]any{
			"name":            stringCell(cols, 0),
			"schema":          stringCell(cols, 1),
			"comment":         stringCell(cols, 2),
			"is_materialized": boolCell(cols, 3),
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaFunctions(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if s.spec.SchemaSQL.Functions == nil {
		return s.ok(req.ID, []map[string]any{})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.Functions(conn.config, p.Database, p.Schema), func(cols []any) map[string]any {
		return map[string]any{
			"name":     stringCell(cols, 0),
			"schema":   stringCell(cols, 1),
			"returns":  stringCell(cols, 2),
			"language": stringCell(cols, 3),
			"comment":  stringCell(cols, 4),
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	return s.ok(req.ID, rows)
}

func (s *Server) handleSchemaViewDefinition(ctx context.Context, req ipc.Message) ipc.Message {
	var p struct {
		ConnID   uint64 `json:"conn_id"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
		View     string `json:"view"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		return s.err(req.ID, ErrInvalidParams, err.Error())
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		return s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
	}
	if p.View == "" {
		return s.err(req.ID, ErrInvalidParams, "missing required parameter `view`")
	}
	if s.spec.SchemaSQL.ViewDefinition == nil {
		return s.ok(req.ID, map[string]any{"sql": "", "is_materialized": false})
	}
	rows, err := queryObjects(ctx, conn.db, s.spec.SchemaSQL.ViewDefinition(conn.config, p.Database, p.Schema, p.View), func(cols []any) map[string]any {
		return map[string]any{
			"sql":             stringCell(cols, 0),
			"is_materialized": boolCell(cols, 1),
		}
	})
	if err != nil {
		return s.err(req.ID, ErrSQLSyntax, err.Error())
	}
	if len(rows) == 0 {
		return s.ok(req.ID, map[string]any{"sql": "", "is_materialized": false})
	}
	var sqlText string
	isMaterialized := false
	for _, row := range rows {
		if part, ok := row["sql"].(string); ok {
			sqlText += part
		}
		if materialized, ok := row["is_materialized"].(bool); ok && materialized {
			isMaterialized = true
		}
	}
	return s.ok(req.ID, map[string]any{"sql": sqlText, "is_materialized": isMaterialized})
}

func (s *Server) handleEmptySchemaList(req ipc.Message) ipc.Message {
	if _, errResp := s.connFromParams(req); errResp != nil {
		return *errResp
	}
	return s.ok(req.ID, []map[string]any{})
}

func (s *Server) handleEmptyDumpDDL(req ipc.Message) ipc.Message {
	if _, errResp := s.connFromParams(req); errResp != nil {
		return *errResp
	}
	return s.ok(req.ID, map[string]any{"statements": []string{}})
}

func (s *Server) parseConfig(params json.RawMessage) (Config, string, error) {
	var p struct {
		DriverID string         `json:"driver_id"`
		Config   map[string]any `json:"config"`
	}
	if err := decodeParams(params, &p); err != nil {
		return Config{}, "", err
	}
	if p.DriverID != "" && p.DriverID != s.spec.ID {
		return Config{}, "", fmt.Errorf("unsupported driver_id `%s`", p.DriverID)
	}
	cfg, err := ConfigFromWire(p.Config, s.spec.DefaultPort)
	if err != nil {
		return Config{}, "", err
	}
	dsn, err := s.spec.BuildDSN(cfg)
	return cfg, dsn, err
}

func (s *Server) connFromParams(req ipc.Message) (*connectionState, *ipc.Message) {
	var p struct {
		ConnID uint64 `json:"conn_id"`
	}
	if err := decodeParams(req.Params, &p); err != nil {
		resp := s.err(req.ID, ErrInvalidParams, err.Error())
		return nil, &resp
	}
	conn, ok := s.conns[p.ConnID]
	if !ok {
		resp := s.err(req.ID, ErrUnknownConnID, fmt.Sprintf("unknown conn_id %d", p.ConnID))
		return nil, &resp
	}
	return conn, nil
}

func (s *Server) closeAll() {
	for id := range s.cursors {
		_ = s.closeCursor(id)
		delete(s.cursors, id)
	}
	for id, conn := range s.conns {
		conn.db.Close()
		delete(s.conns, id)
	}
}

func (s *Server) closeCursorsForConn(connID uint64) {
	for cursorID, cursor := range s.cursors {
		if cursor.connID == connID {
			_ = s.closeCursor(cursorID)
			delete(s.cursors, cursorID)
		}
	}
}

func (s *Server) closeCursor(cursorID string) error {
	cursor, ok := s.cursors[cursorID]
	if !ok || cursor.rows == nil {
		if ok {
			cursor.done = true
		}
		return nil
	}
	err := cursor.rows.Close()
	cursor.rows = nil
	cursor.done = true
	return err
}

func (s *Server) ok(id json.RawMessage, result any) ipc.Message {
	raw, err := json.Marshal(result)
	if err != nil {
		return s.err(id, ErrInternalError, err.Error())
	}
	return ipc.Message{JSONRPC: ipc.JSONRPCVersion, ID: id, Result: raw}
}

func (s *Server) err(id json.RawMessage, code int32, message string) ipc.Message {
	return ipc.Message{
		JSONRPC: ipc.JSONRPCVersion,
		ID:      id,
		Error:   &ipc.ProtocolError{Code: code, Message: message},
	}
}

func decodeParams(raw json.RawMessage, out any) error {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	return json.Unmarshal(raw, out)
}
