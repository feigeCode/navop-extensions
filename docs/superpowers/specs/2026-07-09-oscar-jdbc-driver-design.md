# Oscar JDBC IPC Driver Design

## Goal

Add an Oscar database IPC driver implemented in Java/JDBC, packaged as an OnetCli database driver extension. The first version should match the existing GBase 8s Java driver shape closely enough that packaging, manifest validation, connection lifecycle, query execution, and basic schema browsing work through the current host contract.

The driver must be conservative about Oscar JDBC version differences. It will provide common defaults, but users can override the JDBC URL, driver class, and JDBC jar from the connection form.

## Non-Goals

- Do not replace or refactor the existing GBase 8s driver.
- Do not introduce ODBC for Oscar in this iteration.
- Do not build a shared Java JDBC driver framework before Oscar works.
- Do not claim unsupported schema features in `driver.json`.

## Existing Pattern

The repository already has a Java/JDBC IPC driver for GBase 8s:

- Java source under `java/gbase8s-ipc-driver`
- Extension manifest under `extensions/ipc/gbase8s`
- Java build metadata in `extension.build.json`
- Universal Java packaging through `scripts/build-java-driver.sh`
- Driver package assembly through `scripts/package-driver.sh`

Oscar will follow the same repository layout:

- `java/oscar-ipc-driver`
- `extensions/ipc/oscar`
- `extensions/ipc/oscar/driver.json`
- `extensions/ipc/oscar/extension.build.json`
- `extensions/ipc/oscar/locales`
- `extensions/ipc/oscar/icons`

## Connection Configuration

The connection form will have a normal tab and an advanced tab.

General fields:

- `name`
- `host`
- `port`
- `username`
- `password`
- `database`

Advanced fields:

- `jdk_home`
- `jdbc_url`
- `jdbc_jar`
- `driver_class`

Defaults:

- `port`: `2003`
- `driver_class`: `com.oscar.Driver`
- `jdbc_url`: empty by default

When `jdbc_url` is provided, the driver uses it directly. When it is empty, the driver builds:

```text
jdbc:oscar://{host}:{port}/{database}
```

The default URL is intentionally overridable because Oscar JDBC packaging and URL conventions can vary by version or deployment.

## Runtime Architecture

The Oscar driver will be a Java 8 shaded jar plus shell and Windows launchers. The launchers will mirror the GBase 8s launcher pattern:

- Resolve bundled `lib/oscar-ipc-driver.jar`
- Add user-provided or bundled Oscar JDBC jar to the runtime classpath when configured
- Use `OSCAR_JDK_HOME` from `entry.env_from_config` when the user sets `extra_params.jdk_home`
- Connect to the host transport using the same Unix socket and Windows named pipe bridge pattern as GBase 8s

Core Java components:

- `OscarDriverMain`: process entry point and transport loop wiring
- `OscarConfig`: parse and validate wire config
- `OscarJdbcUrl`: build the default URL and validate unsafe URL parts
- `DriverLoader`: load the selected JDBC class from a user or bundled jar
- `OscarJdbcConnectionFactory`: open JDBC connections with username/password
- `OscarIpcServer`: route JSON-RPC methods to connection, query, transaction, import/export, and schema handlers
- `OscarSchemaSql`: SQL helpers for Oscar-specific catalog queries where JDBC metadata is not enough

## Manifest Contract

`extensions/ipc/oscar/driver.json` will declare:

- `id`: `oscar`
- `category`: `domestic_database`
- Java launcher entry with default and Windows command variants
- `entry.env_from_config.OSCAR_JDK_HOME`: `extra_params.jdk_home`
- `transport.name`: `oscar-driver.sock`
- `ui.default_port`: `2003`

The method surface will start from the existing full Java/GBase 8s surface only if the Oscar server implements those routes. Methods that are implemented generically but not rich for Oscar, such as triggers, sequences, types, view definition, and dump DDL, may return empty values or a typed unsupported shape rather than failing with method-not-found.

The dialect will use conservative SQL defaults:

- Identifier quote left/right: `"`
- Pagination: `limit_offset` unless implementation evidence requires another form
- Boolean literals: `1` and `0`

Capabilities will start conservative and can be expanded when backed by tested metadata behavior.

## Schema Behavior

The first implementation will prioritize a usable database tree:

- `schema/databases`: current configured database when Oscar does not expose a stronger current catalog query
- `schema/schemas`: JDBC metadata schemas or Oscar catalog SQL
- `schema/objects`: tables and views
- `schema/columns`: column names, ordinals, raw types, nullability, defaults, primary key flag
- `schema/indexes`: indexes with column ordering where available
- `schema/foreign_keys`: imported key metadata where available
- `schema/checks`: empty result if Oscar catalog support is not confirmed
- `schema/functions` and `schema/procedures`: metadata-backed lists where available

Schema methods must preserve database, schema, and object name fields separately. The driver must not hardcode UI labels as catalog truth.

## Query, Cursor, and Data Flow

Query and execution behavior will reuse the GBase 8s JDBC pattern:

- `conn/test` opens and closes a JDBC connection and returns latency
- `conn/open` stores a live connection and returns `conn_id`
- `query/start` executes SQL and returns buffered rows or cursor information
- `cursor/fetch`, `cursor/close`, and `cursor/cancel` manage query cursors
- `exec/run` and `exec/batch` execute SQL statements and return update counts
- Transaction methods toggle auto-commit and manage JDBC savepoints
- Import/export stream methods use SQL generated against the selected table

Result values will go through structured JSON serialization. The driver will avoid building JSON by string concatenation.

## Error Handling

The server will follow the existing IPC error model:

- Invalid config becomes `INVALID_PARAMS`
- Unknown connection or cursor ids become typed protocol errors
- SQL exceptions become SQL errors with the JDBC message
- Missing or unavailable JDBC driver jars produce a clear invalid configuration or internal startup error

Connection test should report `ok: false` only if the protocol expects that shape; otherwise the server returns the same typed error response style as existing Java drivers.

## Testing

Use TDD for implementation. First tests:

- `OscarConfigTest`: defaults, required fields, custom `jdbc_url`, custom `driver_class`, port validation
- `OscarJdbcUrlTest`: default URL generation and invalid URL part rejection
- `OscarJdbcConnectionFactoryTest`: driver class loading and URL selection with a recording JDBC driver
- `OscarIpcServerTest`: `init`, `conn/open`, `conn/test`, query routing, unknown connection errors, unsupported/empty schema methods
- `LauncherScriptTest`: shell and Windows launchers reference the Oscar jar and JDK env var correctly
- `tests/scripts.test.mjs`: Oscar manifest, build metadata, universal target, category, form fields, Java package routing

Verification commands:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
node --test tests/scripts.test.mjs
bash scripts/build-java-driver.sh oscar universal
bash scripts/package-driver.sh oscar universal artifacts 0.1.0
bash scripts/verify-package.sh artifacts/oscar-driver-universal.tar.gz
```

## Packaging

`extension.build.json` will declare:

- `language`: `java`
- `package`: `java/oscar-ipc-driver`
- `binary`: `oscar-ipc-driver`
- `jar`: `oscar-ipc-driver.jar`
- `targets`: `["universal"]`
- `releaseTagPrefix`: `oscar-v`
- `r2Prefix`: `extensions/oscar`

If an official Oscar JDBC jar is available in the repository, it can be copied to `java/oscar-ipc-driver/bin/lib` and referenced as the default `jdbc_jar`. If not, the connection form leaves `jdbc_jar` empty and requires the user to provide the vendor jar path.

## Open Constraint

The exact Oscar JDBC jar filename and distribution license are not confirmed. The implementation must not assume that a redistributable Oscar JDBC jar is present unless it exists in the repository.
