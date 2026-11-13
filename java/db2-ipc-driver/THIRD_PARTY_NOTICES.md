# Third-party notices

## IBM Data Server Driver for JDBC and SQLJ (JCC)

- File: `bin/lib/jcc-11.5.9.0.jar`
- Version: 11.5.9.0 (JCC 4.33.31)
- Source: Maven Central, `com.ibm.db2:jcc:11.5.9.0`
- License: IBM International Program License Agreement (IPLA). IBM permits
  redistribution of the JCC driver for the purpose of accessing Db2 servers;
  see the license text published with the artifact.

The driver is bundled so that the DB2 extension works out of the box. Users can
override it per connection with the `jdbc_jar` advanced field or the
`DB2_JDBC_JAR` environment variable.
