package iotdb

import (
	"encoding/json"
	"fmt"
	"strings"
)

type tableSpec struct {
	Name     string      `json:"name"`
	Database string      `json:"database,omitempty"`
	Schema   string      `json:"schema,omitempty"`
	Columns  []columnDef `json:"columns,omitempty"`
}

type columnDef struct {
	Name    string `json:"name"`
	TypeStr string `json:"type,omitempty"`
	Type    string `json:"type_str,omitempty"`
}

type databaseSpec struct {
	Name         string `json:"name,omitempty"`
	Database     string `json:"database,omitempty"`
	DatabaseName string `json:"database_name,omitempty"`
	Schema       string `json:"schema,omitempty"`
}

func buildCreateDatabaseFromRaw(raw json.RawMessage) (string, error) {
	name, err := databasePathFromRaw(raw)
	if err != nil {
		return "", err
	}
	return "SET STORAGE GROUP TO " + name, nil
}

func buildDropDatabaseFromRaw(raw json.RawMessage) (string, error) {
	name, err := databasePathFromRaw(raw)
	if err != nil {
		return "", err
	}
	return "DELETE STORAGE GROUP " + name, nil
}

func databasePathFromRaw(raw json.RawMessage) (string, error) {
	var spec databaseSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return "", err
	}
	name := firstNonEmpty(spec.DatabaseName, spec.Name, spec.Database, spec.Schema)
	if name == "" {
		return "", fmt.Errorf("database name is required")
	}
	return qualifyPath(defaultDB, name), nil
}

func buildCreateTableFromRaw(raw json.RawMessage, ifNotExists bool) ([]string, []string, error) {
	var spec tableSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return nil, nil, err
	}
	statements, warnings := buildCreateTimeseriesStatements(spec, ifNotExists)
	return statements, warnings, nil
}

func buildCreateTimeseriesStatements(spec tableSpec, ifNotExists bool) ([]string, []string) {
	device := tableDevicePath(spec)
	statements := []string{}
	warnings := []string{}
	for _, column := range spec.Columns {
		if strings.EqualFold(column.Name, "time") {
			warnings = append(warnings, "IoTDB timestamp column is implicit; `Time` is not created as a timeseries")
			continue
		}
		statements = append(statements, buildCreateTimeseries(device, column, ifNotExists))
	}
	return statements, warnings
}

func tableDevicePath(spec tableSpec) string {
	prefix := strings.TrimSpace(spec.Schema)
	if prefix == "" {
		prefix = strings.TrimSpace(spec.Database)
	}
	return qualifyPath(prefix, spec.Name)
}

func buildCreateTimeseries(device string, column columnDef, ifNotExists bool) string {
	clause := ""
	if ifNotExists {
		clause = " IF NOT EXISTS"
	}
	return fmt.Sprintf(
		"CREATE TIMESERIES%s %s.%s WITH DATATYPE=%s, ENCODING=PLAIN, COMPRESSOR=SNAPPY",
		clause,
		device,
		column.Name,
		iotdbType(columnType(column)),
	)
}

func buildDropFromRaw(raw json.RawMessage) (string, error) {
	var p struct {
		Kind     string `json:"kind"`
		Name     string `json:"name"`
		Database string `json:"database,omitempty"`
		Schema   string `json:"schema,omitempty"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", err
	}
	if p.Kind != "" && !strings.EqualFold(p.Kind, "table") {
		return "", fmt.Errorf("IoTDB DDL builder does not support dropping `%s`", p.Kind)
	}
	prefix := strings.TrimSpace(p.Schema)
	if prefix == "" {
		prefix = strings.TrimSpace(p.Database)
	}
	return "DELETE TIMESERIES " + qualifyPath(prefix, p.Name) + ".**", nil
}

func columnType(column columnDef) string {
	if strings.TrimSpace(column.TypeStr) != "" {
		return column.TypeStr
	}
	return column.Type
}

func iotdbType(typeStr string) string {
	switch strings.ToUpper(strings.TrimSpace(typeStr)) {
	case "BOOL", "BOOLEAN":
		return "BOOLEAN"
	case "INT", "INTEGER", "INT32":
		return "INT32"
	case "BIGINT", "INT64", "LONG":
		return "INT64"
	case "FLOAT", "REAL":
		return "FLOAT"
	case "DOUBLE", "FLOAT64":
		return "DOUBLE"
	case "TEXT", "STRING", "VARCHAR", "CHAR":
		return "TEXT"
	default:
		return "TEXT"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return strings.Trim(trimmed, "`\"")
		}
	}
	return ""
}
