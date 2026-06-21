package iotdb

import (
	"fmt"
	"strconv"
	"strings"
)

func normalizeSQL(prefix, sql string) string {
	result := normalizeDatabaseStatement(prefix, sql)
	result = normalizeFromClause(prefix, result)
	result = normalizeUpdateStatement(prefix, result)
	result = normalizeInsertStatement(prefix, result)
	return result
}

func normalizeDatabaseStatement(prefix, sql string) string {
	trimmed := strings.TrimSpace(sql)
	withoutSemicolon := trimTrailingSemicolon(trimmed)
	lower := strings.ToLower(withoutSemicolon)
	switch {
	case strings.HasPrefix(lower, "create database "):
		name, ok := databaseNameAfterKeyword(withoutSemicolon, "create database")
		if !ok {
			return sql
		}
		return "SET STORAGE GROUP TO " + qualifyPath(prefix, name)
	case strings.HasPrefix(lower, "drop database "):
		name, ok := databaseNameAfterKeyword(withoutSemicolon, "drop database")
		if !ok {
			return sql
		}
		return "DELETE STORAGE GROUP " + qualifyPath(prefix, name)
	default:
		return sql
	}
}

func normalizeFromClause(prefix, sql string) string {
	start, end, table, ok := findKeywordTable(sql, "from")
	if !ok {
		return sql
	}
	qualified := qualifyPath(prefix, table)
	if qualified == table {
		return sql
	}
	return sql[:start] + qualified + sql[end:]
}

func normalizeInsertStatement(prefix, sql string) string {
	trimmed := strings.TrimSpace(sql)
	if !strings.HasPrefix(strings.ToLower(trimmed), "insert into ") {
		return sql
	}
	afterInto := len("insert into ")
	openColsRel := strings.Index(trimmed[afterInto:], "(")
	if openColsRel < 0 {
		return sql
	}
	openCols := afterInto + openColsRel
	table := strings.TrimSpace(trimmed[afterInto:openCols])
	closeCols, ok := matchingParen(trimmed, openCols)
	if !ok {
		return sql
	}
	afterCols := strings.TrimSpace(trimmed[closeCols+1:])
	if !strings.HasPrefix(strings.ToLower(afterCols), "values") {
		return sql
	}
	afterValues := strings.TrimSpace(afterCols[len("values"):])
	if !strings.HasPrefix(afterValues, "(") {
		return sql
	}
	openValues := len(trimmed) - len(afterValues)
	closeValues, ok := matchingParen(trimmed, openValues)
	if !ok {
		return sql
	}
	columns := splitCSV(trimmed[openCols+1 : closeCols])
	values := splitCSV(trimmed[openValues+1 : closeValues])
	if len(columns) == 0 || len(columns) != len(values) {
		return sql
	}
	for idx, column := range columns {
		columns[idx] = normalizeInsertColumn(column)
		values[idx] = normalizeInsertValue(values[idx])
	}
	return fmt.Sprintf("INSERT INTO %s(%s) VALUES (%s)", qualifyPath(prefix, table), strings.Join(columns, ", "), strings.Join(values, ", "))
}

func normalizeUpdateStatement(prefix, sql string) string {
	trimmed := strings.TrimSpace(sql)
	if !strings.HasPrefix(strings.ToLower(trimmed), "update ") {
		return sql
	}
	setIdx, ok := findKeywordOutsideString(trimmed, "set")
	if !ok {
		return sql
	}
	whereIdx, ok := findKeywordOutsideString(trimmed, "where")
	if !ok || whereIdx <= setIdx {
		return sql
	}
	table := strings.TrimSpace(trimmed[len("update "):setIdx])
	setClause := strings.TrimSpace(trimmed[setIdx+len("set") : whereIdx])
	whereClause := trimTrailingSemicolon(strings.TrimSpace(trimmed[whereIdx+len("where"):]))
	timestampValue, ok := extractTimestampPredicate(whereClause)
	if !ok {
		return sql
	}
	columns := []string{"timestamp"}
	values := []string{normalizeInsertValue(timestampValue)}
	for _, assignment := range splitCSV(setClause) {
		eqIdx := strings.Index(assignment, "=")
		if eqIdx < 0 {
			return sql
		}
		column := normalizeInsertColumn(assignment[:eqIdx])
		if strings.EqualFold(column, "timestamp") {
			continue
		}
		columns = append(columns, column)
		values = append(values, normalizeInsertValue(assignment[eqIdx+1:]))
	}
	if len(columns) <= 1 {
		return sql
	}
	return fmt.Sprintf("INSERT INTO %s(%s) VALUES (%s)", qualifyPath(prefix, table), strings.Join(columns, ", "), strings.Join(values, ", "))
}

func normalizeInsertColumn(column string) string {
	column = shortColumnName(strings.TrimSpace(strings.Trim(column, "`\"")))
	if strings.EqualFold(column, "time") || strings.EqualFold(column, "timestamp") {
		return "timestamp"
	}
	return column
}

func normalizeInsertValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if unquoted, ok := stripSQLString(trimmed); ok {
		normalized := strings.TrimSpace(unquoted)
		if strings.EqualFold(normalized, "true") ||
			strings.EqualFold(normalized, "false") ||
			isInt(normalized) ||
			isFloat(normalized) {
			return strings.ToLower(normalized)
		}
		return "'" + strings.ReplaceAll(normalized, "'", "''") + "'"
	}
	return trimmed
}

func extractTimestampPredicate(whereClause string) (string, bool) {
	for _, predicate := range splitAnd(whereClause) {
		eqIdx := strings.Index(predicate, "=")
		if eqIdx < 0 {
			continue
		}
		left := normalizeInsertColumn(predicate[:eqIdx])
		if strings.EqualFold(left, "timestamp") {
			return trimTrailingSemicolon(strings.TrimSpace(predicate[eqIdx+1:])), true
		}
	}
	return "", false
}

func databaseNameAfterKeyword(sql, keyword string) (string, bool) {
	rest := strings.TrimSpace(sql[len(keyword):])
	restLower := strings.ToLower(rest)
	if strings.HasPrefix(restLower, "if not exists ") {
		rest = strings.TrimSpace(rest[len("if not exists "):])
	} else if strings.HasPrefix(restLower, "if exists ") {
		rest = strings.TrimSpace(rest[len("if exists "):])
	}
	if rest == "" {
		return "", false
	}
	fields := strings.Fields(rest)
	if len(fields) != 1 {
		return "", false
	}
	name := strings.Trim(fields[0], "`\"")
	if name == "" {
		return "", false
	}
	return name, true
}

func findKeywordTable(sql, keyword string) (int, int, string, bool) {
	lower := strings.ToLower(sql)
	keyword = strings.ToLower(keyword)
	search := keyword + " "
	keywordStart := strings.Index(lower, search)
	if keywordStart < 0 {
		return 0, 0, "", false
	}
	if keywordStart > 0 && isIdentifierChar(rune(lower[keywordStart-1])) {
		return 0, 0, "", false
	}
	tableStart := keywordStart + len(keyword)
	for tableStart < len(sql) && isSpace(rune(sql[tableStart])) {
		tableStart++
	}
	tableEnd := tableStart
	for tableEnd < len(sql) && !isSpace(rune(sql[tableEnd])) && sql[tableEnd] != ';' {
		tableEnd++
	}
	table := strings.TrimSpace(sql[tableStart:tableEnd])
	if table == "" {
		return 0, 0, "", false
	}
	return tableStart, tableEnd, table, true
}

func matchingParen(input string, open int) (int, bool) {
	inString := false
	depth := 0
	for idx := open; idx < len(input); idx++ {
		ch := input[idx]
		if inString {
			if ch == '\'' {
				if idx+1 < len(input) && input[idx+1] == '\'' {
					idx++
				} else {
					inString = false
				}
			}
			continue
		}
		switch ch {
		case '\'':
			inString = true
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return idx, true
			}
		}
	}
	return 0, false
}

func splitCSV(input string) []string {
	parts := []string{}
	inString := false
	start := 0
	for idx := 0; idx < len(input); idx++ {
		ch := input[idx]
		if inString {
			if ch == '\'' {
				if idx+1 < len(input) && input[idx+1] == '\'' {
					idx++
				} else {
					inString = false
				}
			}
			continue
		}
		switch ch {
		case '\'':
			inString = true
		case ',':
			parts = append(parts, strings.TrimSpace(input[start:idx]))
			start = idx + 1
		}
	}
	parts = append(parts, strings.TrimSpace(input[start:]))
	return parts
}

func splitAnd(input string) []string {
	parts := []string{}
	inString := false
	start := 0
	lower := strings.ToLower(input)
	for idx := 0; idx < len(input); idx++ {
		ch := input[idx]
		if inString {
			if ch == '\'' {
				if idx+1 < len(input) && input[idx+1] == '\'' {
					idx++
				} else {
					inString = false
				}
			}
			continue
		}
		if ch == '\'' {
			inString = true
			continue
		}
		if strings.HasPrefix(lower[idx:], " and ") {
			parts = append(parts, strings.TrimSpace(input[start:idx]))
			start = idx + len(" and ")
		}
	}
	parts = append(parts, strings.TrimSpace(input[start:]))
	return parts
}

func findKeywordOutsideString(input, keyword string) (int, bool) {
	inString := false
	lower := strings.ToLower(input)
	keyword = strings.ToLower(keyword)
	for idx := 0; idx < len(input); idx++ {
		ch := input[idx]
		if inString {
			if ch == '\'' {
				if idx+1 < len(input) && input[idx+1] == '\'' {
					idx++
				} else {
					inString = false
				}
			}
			continue
		}
		if ch == '\'' {
			inString = true
			continue
		}
		end := idx + len(keyword)
		if end <= len(input) &&
			lower[idx:end] == keyword &&
			(idx == 0 || !isIdentifierChar(rune(input[idx-1]))) &&
			(end == len(input) || !isIdentifierChar(rune(input[end]))) {
			return idx, true
		}
	}
	return 0, false
}

func stripSQLString(value string) (string, bool) {
	if len(value) < 2 || value[0] != '\'' || value[len(value)-1] != '\'' {
		return "", false
	}
	return strings.ReplaceAll(value[1:len(value)-1], "''", "'"), true
}

func trimTrailingSemicolon(value string) string {
	return strings.TrimSpace(strings.TrimRight(strings.TrimSpace(value), ";"))
}

func isIdentifierChar(ch rune) bool {
	return ch == '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
}

func isSpace(ch rune) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

func isInt(value string) bool {
	_, err := strconv.ParseInt(value, 10, 64)
	return err == nil
}

func isFloat(value string) bool {
	_, err := strconv.ParseFloat(value, 64)
	return err == nil
}
