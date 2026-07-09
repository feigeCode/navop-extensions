# Oscar JDBC IPC Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Java/JDBC Oscar IPC database driver extension with configurable JDBC URL, driver class, and jar.

**Architecture:** Create an independent `oscar` Java driver by copying the existing GBase 8s Java IPC driver shape, then applying Oscar-specific config, URL, manifest, locale, and schema behavior. Keep GBase 8s untouched; package Oscar as a Java `universal` driver through the existing build scripts.

**Tech Stack:** Java 8, Maven Shade, Jackson, JNA, JUnit 4, OnetCli IPC JSON-RPC protocol, existing `scripts/build-java-driver.sh` and `scripts/package-driver.sh`.

---

## File Structure

- Create `java/oscar-ipc-driver/pom.xml`: Maven project for the shaded Oscar IPC jar.
- Create `java/oscar-ipc-driver/bin/oscar-ipc-driver`: POSIX launcher.
- Create `java/oscar-ipc-driver/bin/oscar-ipc-driver.cmd`: Windows launcher.
- Create `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/**`: Java IPC runtime copied from GBase 8s and renamed.
- Create `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/**`: JUnit tests for config, URL, connection factory, launcher, and server routing.
- Create `extensions/ipc/oscar/driver.json`: Oscar database driver manifest.
- Create `extensions/ipc/oscar/extension.build.json`: Java build metadata.
- Create `extensions/ipc/oscar/locales/{en,zh-CN,zh-HK}.yml`: connection form labels.
- Create `extensions/ipc/oscar/icons/oscar.svg`: driver icon.
- Modify `tests/scripts.test.mjs`: assert Oscar Java manifest/build metadata and release routing.
- Modify `manifest.json`: register the Oscar extension in the top-level extension catalog.

## Task 1: Add Failing Manifest and Script Tests

**Files:**
- Modify: `tests/scripts.test.mjs`
- Test: `tests/scripts.test.mjs`

- [ ] **Step 1: Add failing script tests for Oscar metadata**

Add this test after the existing GBase 8s Java manifest test:

```js
test("Oscar Java IPC driver manifest exposes configurable JDBC settings", () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "extensions/ipc/oscar/extension.build.json"), "utf8"),
  );
  assert.equal(metadata.language, "java");
  assert.equal(metadata.package, "java/oscar-ipc-driver");
  assert.equal(metadata.binary, "oscar-ipc-driver");
  assert.equal(metadata.jar, "oscar-ipc-driver.jar");
  assert.deepEqual(metadata.targets, ["universal"]);

  const driverJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "extensions/ipc/oscar/driver.json"), "utf8"),
  );
  assert.equal(driverJson.id, "oscar");
  assert.equal(driverJson.category, "domestic_database");
  assert.equal(driverJson.entry.command, "./oscar-ipc-driver");
  assert.equal(driverJson.entry.commands.windows, "./oscar-ipc-driver.cmd");
  assert.equal(driverJson.entry.env_from_config.OSCAR_JDK_HOME, "extra_params.jdk_home");
  assert.equal(driverJson.transport.name, "oscar-driver.sock");
  assert.equal(driverJson.ui.default_port, 2003);
  assert.equal(driverJson.dialect.identifier_quote_left, "\"");
  assert.equal(driverJson.dialect.identifier_quote_right, "\"");

  const connectionForm = driverJson.ui.form.forms.find((form) => form.kind === "Connection");
  const advancedTab = connectionForm.tabs.find((tab) => tab.id === "advanced");
  assert.ok(advancedTab, "oscar connection form should expose an advanced tab");
  assert.deepEqual(
    advancedTab.fields.map((field) => field.id),
    ["jdk_home", "jdbc_url", "jdbc_jar", "driver_class"],
  );
  assert.equal(
    advancedTab.fields.find((field) => field.id === "driver_class").default_value,
    "com.oscar.Driver",
  );
});
```

- [ ] **Step 2: Update Java metadata test expectations**

Change the existing `go ipc driver metadata excludes GBase8s` test name and assertion so Java drivers are excluded from Go metadata:

```js
test("go ipc driver metadata excludes Java drivers", () => {
  const ids = fs
    .readdirSync(path.join(repoRoot, "extensions/ipc"))
    .filter((id) => {
      const metadataPath = path.join(repoRoot, "extensions/ipc", id, "extension.build.json");
      if (!fs.existsSync(metadataPath)) return false;
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      return metadata.language === "go";
    })
    .sort();

  assert.deepEqual(ids, ["dm", "iotdb", "kingbase", "oceanbase", "oracle-go"]);
});
```

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
node --test tests/scripts.test.mjs
```

Expected: FAIL because `extensions/ipc/oscar/extension.build.json` does not exist.

- [ ] **Step 4: Do not implement yet**

Leave the failure in place for Task 2.

## Task 2: Add Oscar Extension Manifests and Assets

**Files:**
- Create: `extensions/ipc/oscar/extension.build.json`
- Create: `extensions/ipc/oscar/driver.json`
- Create: `extensions/ipc/oscar/locales/en.yml`
- Create: `extensions/ipc/oscar/locales/zh-CN.yml`
- Create: `extensions/ipc/oscar/locales/zh-HK.yml`
- Create: `extensions/ipc/oscar/icons/oscar.svg`
- Modify: `manifest.json`
- Test: `tests/scripts.test.mjs`

- [ ] **Step 1: Create build metadata**

Create `extensions/ipc/oscar/extension.build.json`:

```json
{
  "id": "oscar",
  "kind": "database_driver",
  "language": "java",
  "package": "java/oscar-ipc-driver",
  "binary": "oscar-ipc-driver",
  "jar": "oscar-ipc-driver.jar",
  "path": "extensions/ipc/oscar",
  "source_paths": [
    "java/oscar-ipc-driver"
  ],
  "targets": [
    "universal"
  ],
  "releaseTagPrefix": "oscar-v",
  "r2Prefix": "extensions/oscar"
}
```

- [ ] **Step 2: Create initial driver manifest**

Create `extensions/ipc/oscar/driver.json` by copying the GBase 8s field structure and replacing the driver-specific values:

```json
{
  "id": "oscar",
  "name": "Oscar",
  "description": "使用 Java 开发的神通 Oscar 数据库 IPC 驱动",
  "category": "domestic_database",
  "version": "0.1.0",
  "entry": {
    "command": "./oscar-ipc-driver",
    "commands": {
      "default": "./oscar-ipc-driver",
      "windows": "./oscar-ipc-driver.cmd"
    },
    "args": [],
    "working_dir": null,
    "env_from_config": {
      "OSCAR_JDK_HOME": "extra_params.jdk_home"
    }
  },
  "transport": {
    "name": "oscar-driver.sock",
    "connect_timeout_ms": 5000
  },
  "methods": [
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
    "tx/begin",
    "tx/commit",
    "tx/rollback",
    "tx/savepoint",
    "tx/release",
    "ddl/build",
    "ddl/build_create_table",
    "ddl/build_alter_table",
    "ddl/build_drop",
    "data/export",
    "data/import_begin",
    "data/import_chunk",
    "data/import_commit",
    "data/import_abort",
    "stream/read",
    "stream/close",
    "schema/object_view",
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
    "schema/dump_ddl"
  ],
  "dialect": {
    "identifier_quote_left": "\"",
    "identifier_quote_right": "\"",
    "limit_style": "limit_offset",
    "bool_true": "1",
    "bool_false": "0"
  },
  "connection": {
    "single_file": false,
    "single_connection": false,
    "close_on_release": false,
    "path_fields": []
  },
  "capabilities": {
    "supports_schema": true,
    "uses_schema_as_database": false,
    "supports_sequences": false,
    "supports_functions": true,
    "supports_procedures": true,
    "supports_triggers": false,
    "supports_table_engine": false,
    "supports_table_charset": false,
    "supports_table_collation": false,
    "supports_auto_increment": false,
    "supports_tablespace": false,
    "supports_unsigned": false,
    "supports_enum_values": false,
    "show_charset_in_column_detail": false,
    "show_collation_in_column_detail": false,
    "table_engines": []
  },
  "ui": {
    "icon": "icons/oscar.svg",
    "icon_color": "icons/oscar.svg",
    "locales_dir": "locales",
    "default_port": 2003,
    "form": {
      "schema_version": 1,
      "forms": [
        {
          "kind": "Connection",
          "title_i18n_key": "database.oscar.connection.title",
          "submit_i18n_key": "common.connect",
          "tabs": []
        }
      ],
      "actions": {
        "actions": []
      }
    }
  }
}
```

Then copy the GBase 8s `general`, `ssh`, `remark`, and action definitions into the Oscar manifest. Replace only `advanced` with fields `jdk_home`, `jdbc_url`, `jdbc_jar`, and `driver_class`.

- [ ] **Step 3: Create locale keys**

Create `extensions/ipc/oscar/locales/en.yml` with:

```yaml
"database.oscar.connection.title": "New Oscar Connection"
"database.oscar.field.jdk_home": "JDK Home"
"database.oscar.field.jdk_home.help": "Used by the host before starting the Java IPC driver. Leave empty to use JAVA_HOME or PATH."
"database.oscar.field.jdbc_url": "JDBC URL"
"database.oscar.field.jdbc_url.help": "Leave empty to build jdbc:oscar://host:port/database from the general fields."
"database.oscar.field.jdbc_jar": "JDBC Driver JAR"
"database.oscar.field.jdbc_jar.help": "Optional path to the Oscar JDBC driver jar. Required when the driver is not bundled."
"database.oscar.field.driver_class": "JDBC Driver Class"
"database.oscar.field.driver_class.help": "Defaults to the common Oscar JDBC driver class."
```

Create Chinese locale files with equivalent keys:

```yaml
"database.oscar.connection.title": "新建 Oscar 连接"
"database.oscar.field.jdk_home": "JDK 路径"
"database.oscar.field.jdk_home.help": "宿主会在启动 Java IPC 驱动前使用该路径。留空时使用 JAVA_HOME 或 PATH。"
"database.oscar.field.jdbc_url": "JDBC URL"
"database.oscar.field.jdbc_url.help": "留空时根据常规字段生成 jdbc:oscar://host:port/database。"
"database.oscar.field.jdbc_jar": "JDBC 驱动 JAR"
"database.oscar.field.jdbc_jar.help": "Oscar JDBC 驱动 jar 路径。未随扩展打包时需要填写。"
"database.oscar.field.driver_class": "JDBC 驱动类"
"database.oscar.field.driver_class.help": "默认使用常见 Oscar JDBC 驱动类。"
```

- [ ] **Step 4: Create icon**

Create a small SVG at `extensions/ipc/oscar/icons/oscar.svg` with the text `O` and restrained colors.

- [ ] **Step 5: Register top-level manifest entry**

Add an `oscar` entry to `manifest.json` with `kind: "database_driver"`, the same Java description language marker required by `tests/scripts.test.mjs`, and the same extension path metadata style as the other IPC drivers.

- [ ] **Step 6: Run test to verify manifest work**

Run:

```bash
node --test tests/scripts.test.mjs
```

Expected: PASS for the Oscar manifest test, or FAIL only on missing Java package files that Task 3 will create.

- [ ] **Step 7: Commit manifest work**

Run:

```bash
git add tests/scripts.test.mjs extensions/ipc/oscar manifest.json
git commit -m "feat: add Oscar driver manifest"
```

## Task 3: Add Java Project Skeleton and Failing Unit Tests

**Files:**
- Create: `java/oscar-ipc-driver/pom.xml`
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/jdbc/OscarConfigTest.java`
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/jdbc/OscarJdbcUrlTest.java`
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/jdbc/OscarJdbcConnectionFactoryTest.java`
- Test: `java/oscar-ipc-driver`

- [ ] **Step 1: Create Maven project**

Create `pom.xml` with artifact id `oscar-ipc-driver`, version `0.1.0`, Java 8 target, Jackson, JNA, JUnit 4, H2 test dependency, and Maven Shade main class `com.onetcli.oscar.OscarDriverMain`.

- [ ] **Step 2: Write config failing tests**

Create `OscarConfigTest` with tests for:

```java
assertEquals(2003, OscarConfig.fromWire(baseConfig()).getPort());
assertEquals("com.oscar.Driver", OscarConfig.fromWire(baseConfig()).getDriverClass());
assertEquals("jdbc:oscar://custom:2003/demo", OscarConfig.fromWire(withJdbcUrl()).getJdbcUrl());
```

Also assert missing `host`, `username`, and `database` throw `IllegalArgumentException`.

- [ ] **Step 3: Write JDBC URL failing tests**

Create `OscarJdbcUrlTest` with:

```java
OscarConfig config = OscarConfig.fromWire(baseConfig());
assertEquals("jdbc:oscar://127.0.0.1:2003/demo", OscarJdbcUrl.build(config));
```

Add invalid host/database cases with `;`, `\n`, and `\r`.

- [ ] **Step 4: Write connection factory failing tests**

Create a recording JDBC `Driver` in the test package and assert:

```java
Connection connection = new OscarJdbcConnectionFactory().open(config);
assertNotNull(connection);
assertEquals("jdbc:oscar://127.0.0.1:2003/demo", RecordingDriver.lastUrl);
assertEquals("SYSDBA", RecordingDriver.lastProperties.getProperty("user"));
```

Add a case where `jdbc_url` is set and assert the factory uses it directly.

- [ ] **Step 5: Run tests to verify failure**

Run:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
```

Expected: FAIL because `OscarConfig`, `OscarJdbcUrl`, and `OscarJdbcConnectionFactory` do not exist.

## Task 4: Implement Oscar Config, URL, and Connection Factory

**Files:**
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/jdbc/OscarConfig.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/jdbc/OscarJdbcUrl.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/jdbc/DriverLoader.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/jdbc/OscarJdbcConnectionFactory.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/server/JdbcConnectionFactory.java`
- Test: `java/oscar-ipc-driver`

- [ ] **Step 1: Implement `OscarConfig` minimally**

Implement `fromWire(Map<String,Object>)` with:

- `DEFAULT_PORT = 2003`
- `DEFAULT_DRIVER_CLASS = "com.oscar.Driver"`
- `host`, `port`, `username`, `password`, `database`
- `jdbcUrl`, `jdbcJar`, `driverClass`
- support both direct keys and `extra_params` keys for `jdbc_url`, `jdbc_jar`, `driver_class`

- [ ] **Step 2: Implement URL builder**

Implement `OscarJdbcUrl.build(OscarConfig)` so it returns `config.getJdbcUrl()` when non-empty, otherwise `jdbc:oscar://host:port/database`.

- [ ] **Step 3: Implement driver loading**

Implement `DriverLoader.load(String driverClass, String jdbcJar)` so an empty `jdbcJar` uses `Class.forName(driverClass)`, and a non-empty jar uses a `URLClassLoader` and registers a JDBC driver shim with `DriverManager`.

- [ ] **Step 4: Implement connection factory**

Implement `OscarJdbcConnectionFactory.open(OscarConfig)` using `DriverLoader`, `OscarJdbcUrl.build(config)`, and JDBC properties `user` and `password`.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
```

Expected: PASS for config, URL, and connection factory tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add java/oscar-ipc-driver
git commit -m "feat: add Oscar JDBC config"
```

## Task 5: Add IPC Server, Transport, Query, and Launcher Tests

**Files:**
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/server/OscarIpcServerTest.java`
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/GBaseEquivalentLauncherScriptTest.java`
- Create: `java/oscar-ipc-driver/src/test/java/com/onetcli/oscar/db/JdbcQueryRunnerTest.java`
- Test: `java/oscar-ipc-driver`

- [ ] **Step 1: Copy server and query tests from GBase 8s and rename packages**

Use the existing GBase 8s tests as the source, replacing:

- `com.onetcli.gbase8s` with `com.onetcli.oscar`
- `GBase8s` with `Oscar`
- `gbase8s` with `oscar`
- expected driver name with `Oscar IPC Driver`
- expected backend version with `Oscar`

- [ ] **Step 2: Add Oscar-specific assertions**

In `OscarIpcServerTest`, assert:

```java
assertEquals("oscar", init.get("result").get("drivers_ready").get(0).asText());
assertEquals("Oscar IPC Driver", init.get("result").get("name").asText());
```

For `conn/open`, assert:

```java
assertEquals("Oscar", open.get("result").get("server_info").get("version").asText());
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
```

Expected: FAIL because the server, query runner, transport, socket, launcher, and schema classes do not exist.

## Task 6: Implement Oscar IPC Runtime by Renaming the Java Driver Template

**Files:**
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/OscarDriverMain.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/db/JdbcQueryRunner.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/db/QueryResult.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/ipc/FramedJsonTransport.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/schema/OscarSchemaSql.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/server/OscarIpcServer.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/server/ProtocolError.java`
- Create: `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar/socket/**`
- Create: `java/oscar-ipc-driver/bin/oscar-ipc-driver`
- Create: `java/oscar-ipc-driver/bin/oscar-ipc-driver.cmd`
- Test: `java/oscar-ipc-driver`

- [ ] **Step 1: Copy Java runtime files**

Copy the existing `java/gbase8s-ipc-driver/src/main/java/com/onetcli/gbase8s` tree to `java/oscar-ipc-driver/src/main/java/com/onetcli/oscar`.

- [ ] **Step 2: Rename package and class identifiers**

Apply these replacements across copied Oscar files:

- `package com.onetcli.gbase8s` -> `package com.onetcli.oscar`
- `com.onetcli.gbase8s` -> `com.onetcli.oscar`
- `GBase8sDriverMain` -> `OscarDriverMain`
- `GBase8sIpcServer` -> `OscarIpcServer`
- `GBase8sConfig` -> `OscarConfig`
- `GBase8sJdbcUrl` -> `OscarJdbcUrl`
- `GBase8sJdbcConnectionFactory` -> `OscarJdbcConnectionFactory`
- `GBase8sSchemaSql` -> `OscarSchemaSql`
- `GBase 8s` -> `Oscar`
- `gbase8s` -> `oscar`

Do not overwrite the Oscar config, URL, connection factory, or driver loader implemented in Task 4; merge only missing methods when needed.

- [ ] **Step 3: Replace GBase-specific schema SQL**

In `OscarSchemaSql`, implement conservative generic queries for tests:

- `databasesSql()` returns a single configured/current database where possible.
- `schemasSql(database)` queries schema names through JDBC metadata fallback in the server if catalog SQL is not reliable.
- object, column, index, and key methods may use H2-compatible SQL in tests but must keep result shapes stable.

- [ ] **Step 4: Update server constants**

In `OscarIpcServer`:

```java
private static final String DRIVER_ID = "oscar";
```

Ensure `initResult()` returns:

```java
result.put("extension_version", "0.1.0");
result.put("name", "Oscar IPC Driver");
```

Ensure `conn/test` and `conn/open` report server version `"Oscar"`.

- [ ] **Step 5: Create launchers**

Create POSIX launcher with:

```bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
JAR="$DIR/lib/oscar-ipc-driver.jar"
if [ -n "${OSCAR_JDK_HOME:-}" ] && [ -x "$OSCAR_JDK_HOME/bin/java" ]; then
  JAVA="$OSCAR_JDK_HOME/bin/java"
else
  JAVA="${JAVA_HOME:+$JAVA_HOME/bin/java}"
  JAVA="${JAVA:-java}"
fi
exec "$JAVA" -jar "$JAR" "$@"
```

Create Windows launcher using `OSCAR_JDK_HOME`, then `JAVA_HOME`, then `java`.

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add java/oscar-ipc-driver
git commit -m "feat: add Oscar Java IPC runtime"
```

## Task 7: Verify Build Scripts and Package Shape

**Files:**
- Modify only if tests expose a script assumption: `scripts/build-java-driver.sh`, `scripts/package-driver.sh`
- Test: package archive

- [ ] **Step 1: Run script tests**

Run:

```bash
node --test tests/scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Build Java universal driver**

Run:

```bash
bash scripts/build-java-driver.sh oscar universal
```

Expected: `target/universal/release/lib/oscar-ipc-driver.jar`, `target/universal/release/oscar-ipc-driver`, and `target/universal/release/oscar-ipc-driver.cmd` exist.

- [ ] **Step 3: Package driver**

Run:

```bash
mkdir -p artifacts
bash scripts/package-driver.sh oscar universal artifacts 0.1.0
```

Expected: `artifacts/oscar-driver-universal.tar.gz`.

- [ ] **Step 4: Verify package**

Run:

```bash
bash scripts/verify-package.sh artifacts/oscar-driver-universal.tar.gz
```

Expected: PASS and archive contains `driver.json`, launchers, `lib/oscar-ipc-driver.jar`, `locales`, and `icons`.

- [ ] **Step 5: Commit verification fixes**

If script or manifest fixes were needed, run:

```bash
git add scripts extensions/ipc/oscar tests/scripts.test.mjs manifest.json
git commit -m "test: verify Oscar driver packaging"
```

Skip this commit if no files changed.

## Task 8: Final Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run Java tests**

Run:

```bash
mvn -q -f java/oscar-ipc-driver/pom.xml test
```

Expected: PASS.

- [ ] **Step 2: Run repository script tests**

Run:

```bash
node --test tests/scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run package verification**

Run:

```bash
bash scripts/build-java-driver.sh oscar universal
mkdir -p artifacts
bash scripts/package-driver.sh oscar universal artifacts 0.1.0
bash scripts/verify-package.sh artifacts/oscar-driver-universal.tar.gz
```

Expected: PASS.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
```

Expected: no unexpected changes except pre-existing user files such as `connection.ncx`.
