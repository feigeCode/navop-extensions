package com.navop.gbase8a.jdbc;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.sql.Driver;
import java.util.List;

import static org.junit.Assume.assumeTrue;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class DriverLoaderTest {
    /** Official GBase 8a JDBC jar shipped next to the launcher. */
    private static final String OFFICIAL_JAR = "gbase-connector-java-9.5.0.10-build1-bin.jar";
    private static final String OFFICIAL_DRIVER_CLASS = "com.gbase.jdbc.Driver";

    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void candidateJarsIncludeSortedLibJarsAndExplicitEnvPaths() throws Exception {
        File workDir = temporaryFolder.newFolder("driver");
        File lib = new File(workDir, "lib");
        assertTrue(lib.mkdirs());
        File z = new File(lib, "z-driver.jar");
        File a = new File(lib, "a-driver.jar");
        File ignored = new File(lib, "notes.txt");
        assertTrue(z.createNewFile());
        assertTrue(a.createNewFile());
        assertTrue(ignored.createNewFile());
        File explicit = temporaryFolder.newFile("official.jar");

        List<File> jars = DriverLoader.candidateJars(
            workDir,
            explicit.getAbsolutePath() + File.pathSeparator + new File(workDir, "missing.jar").getAbsolutePath()
        );

        assertEquals(3, jars.size());
        assertEquals("a-driver.jar", jars.get(0).getName());
        assertEquals("z-driver.jar", jars.get(1).getName());
        assertEquals("official.jar", jars.get(2).getName());
    }

    @Test
    public void candidateJarsResolveRelativeExplicitPathsAgainstWorkingDir() throws Exception {
        File workDir = temporaryFolder.newFolder("driver-relative");
        File lib = new File(workDir, "lib");
        assertTrue(lib.mkdirs());
        File official = new File(lib, OFFICIAL_JAR);
        assertTrue(official.createNewFile());

        List<File> jars = DriverLoader.candidateJars(workDir, "lib/" + OFFICIAL_JAR);

        assertEquals(1, jars.size());
        assertEquals(official.getAbsolutePath(), jars.get(0).getAbsolutePath());
    }

    /**
     * An explicit path that is not a jar and a blank value must both be ignored
     * so a stale config entry cannot break an otherwise valid classpath.
     */
    @Test
    public void candidateJarsIgnoreNonJarAndBlankExplicitPaths() throws Exception {
        File workDir = temporaryFolder.newFolder("driver-blank");
        File lib = new File(workDir, "lib");
        assertTrue(lib.mkdirs());
        File notAJar = temporaryFolder.newFile("jdbc.conf");

        assertEquals(0, DriverLoader.candidateJars(workDir, notAJar.getAbsolutePath()).size());
        assertEquals(0, DriverLoader.candidateJars(workDir, "   ").size());
        assertEquals(0, DriverLoader.candidateJars(workDir, null).size());
    }

    @Test
    public void loadDriverUsesExistingClasspathBeforeExternalJars() throws Exception {
        Driver driver = DriverLoader.loadDriver("org.h2.Driver", temporaryFolder.newFolder("empty"), "");

        assertEquals("org.h2.Driver", driver.getClass().getName());
    }

    /**
     * Guards the packaged official jar and the driver class the manifest
     * defaults to. Skipped when the repository jar is not present, which keeps
     * the test meaningful in a source-only checkout.
     */
    @Test
    public void loadDriverUsesOfficialGBase8aJarFromLibWhenPresent() throws Exception {
        File workDir = new File(".");
        File officialJar = new File(workDir, "lib/" + OFFICIAL_JAR);
        assumeTrue("official GBase 8a JDBC jar is not present under lib/", officialJar.isFile());

        Driver driver = DriverLoader.loadDriver(OFFICIAL_DRIVER_CLASS, workDir, "");

        assertEquals(OFFICIAL_DRIVER_CLASS, driver.getClass().getName());
    }

    @Test
    public void jdbcJarEnvironmentVariableIsDriverScoped() {
        assertEquals("GBASE8A_JDBC_JAR", DriverLoader.JDBC_JAR_ENV);
    }
}
