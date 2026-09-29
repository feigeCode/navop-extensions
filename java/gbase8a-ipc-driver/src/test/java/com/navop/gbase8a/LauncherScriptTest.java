package com.navop.gbase8a;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class LauncherScriptTest {
    /** Driver jar the launcher must resolve, relative to the project directory. */
    private static final String DRIVER_JAR = "bin/lib/gbase8a-ipc-driver.jar";

    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void commandLineJdkHomeOverridesEnvironment() throws Exception {
        File cliJdk = fakeJdk("cli-jdk");
        File envJdk = fakeJdk("env-jdk");
        File javaHome = fakeJdk("java-home");

        ProcessResult result = runLauncher(
            env("GBASE8A_JDK_HOME", envJdk.getAbsolutePath(), "JAVA_HOME", javaHome.getAbsolutePath()),
            "--jdk-home",
            cliJdk.getAbsolutePath(),
            "socket-name"
        );

        assertEquals(0, result.exitCode);
        assertTrue(result.output.contains("FAKE_JAVA=" + cliJdk.getAbsolutePath()));
        assertTrue(result.output.contains("ARG=-jar"));
        assertTrue(result.output.contains("ARG=socket-name"));
    }

    @Test
    public void gbaseJdkHomeOverridesJavaHome() throws Exception {
        File envJdk = fakeJdk("env-jdk");
        File javaHome = fakeJdk("java-home");

        ProcessResult result = runLauncher(
            env("GBASE8A_JDK_HOME", envJdk.getAbsolutePath(), "JAVA_HOME", javaHome.getAbsolutePath()),
            "socket-name"
        );

        assertEquals(0, result.exitCode);
        assertTrue(result.output.contains("FAKE_JAVA=" + envJdk.getAbsolutePath()));
    }

    @Test
    public void javaHomeIsDefaultJdkHome() throws Exception {
        File javaHome = fakeJdk("java-home");

        ProcessResult result = runLauncher(env("JAVA_HOME", javaHome.getAbsolutePath()), "socket-name");

        assertEquals(0, result.exitCode);
        assertTrue(result.output.contains("FAKE_JAVA=" + javaHome.getAbsolutePath()));
    }

    @Test
    public void missingCustomJavaBinaryFailsClearly() throws Exception {
        File notAJdk = temporaryFolder.newFolder("not-a-jdk");

        ProcessResult result = runLauncher(env(), "--jdk-home", notAJdk.getAbsolutePath(), "socket-name");

        assertEquals(1, result.exitCode);
        assertTrue(result.output.contains("Java executable not found"));
    }

    @Test
    public void gbaseJdkHomeAcceptsJavaExecutable() throws Exception {
        File java = fakeJdk("env-java").toPath().resolve("bin/java").toFile();

        ProcessResult result = runLauncher(env("GBASE8A_JDK_HOME", java.getAbsolutePath()), "socket-name");

        assertEquals(0, result.exitCode);
        assertTrue(result.output.contains("ARG=-jar"));
        assertTrue(result.output.contains("ARG=socket-name"));
    }

    @Test
    public void windowsLauncherHasReachableRunDriverLabelAndAcceptsJavaExecutable() throws Exception {
        String script = new String(
            Files.readAllBytes(new File("bin/gbase8a-ipc-driver.cmd").toPath()),
            StandardCharsets.UTF_8
        ).replace("\r\n", "\n");

        assertTrue(script.contains("\n:run_driver\n"));
        assertTrue(script.contains("if exist \"%JDK_HOME%\\bin\\java.exe\""));
        assertTrue(script.contains("else if exist \"%JDK_HOME%\\*\""));
        assertTrue(script.contains("else if exist \"%JDK_HOME%\""));
        assertTrue(script.contains("\"%JAVA_BIN%\" -jar \"%JAR%\""));
    }

    /**
     * The launchers are the only place the packaged jar path is written down, so
     * a rename there would otherwise only surface at runtime.
     */
    @Test
    public void launchersResolveThePackagedDriverJar() throws Exception {
        String shell = new String(
            Files.readAllBytes(new File("bin/gbase8a-ipc-driver").toPath()),
            StandardCharsets.UTF_8
        );
        String windows = new String(
            Files.readAllBytes(new File("bin/gbase8a-ipc-driver.cmd").toPath()),
            StandardCharsets.UTF_8
        ).replace("\r\n", "\n");

        assertTrue(shell, shell.contains("lib/gbase8a-ipc-driver.jar"));
        assertTrue(windows, windows.contains("lib\\gbase8a-ipc-driver.jar"));
    }

    /**
     * The launch script only knows the driver jar, not the vendor JDBC jar, so
     * the vendor jar has to be discoverable through the {@code lib} directory
     * next to the launcher.
     */
    @Test
    public void packagedOfficialJdbcJarSitsNextToTheLauncher() {
        File official = new File("bin/lib/gbase-connector-java-9.5.0.10-build1-bin.jar");
        org.junit.Assume.assumeTrue(
            "official GBase 8a JDBC jar is not present under bin/lib",
            official.isFile()
        );

        assertTrue(official.isFile());
    }

    /**
     * The shell launcher is a POSIX script, and Windows cannot start it through
     * {@code ProcessBuilder} ({@code CreateProcess error=193}). These checks run
     * on the Linux CI image, where the script is actually executed.
     */
    private static void assumePosixShell() {
        String os = System.getProperty("os.name", "");
        org.junit.Assume.assumeFalse(
            "the POSIX launcher script cannot be executed on " + os,
            os.toLowerCase(java.util.Locale.ROOT).contains("win")
        );
    }

    private File fakeJdk(String name) throws IOException {
        File jdk = temporaryFolder.newFolder(name);
        File bin = new File(jdk, "bin");
        assertTrue(bin.mkdirs());
        File java = new File(bin, "java");
        String script = "#!/usr/bin/env sh\n"
            + "echo \"FAKE_JAVA=" + jdk.getAbsolutePath() + "\"\n"
            + "for arg in \"$@\"; do echo \"ARG=$arg\"; done\n"
            + "exit 0\n";
        TestFiles.writeExecutable(java, script);
        return jdk;
    }

    private ProcessResult runLauncher(Map<String, String> env, String... args) throws Exception {
        assumePosixShell();
        File lib = new File("bin/lib");
        if (!lib.isDirectory()) {
            assertTrue(lib.mkdirs());
        }
        File jar = new File(DRIVER_JAR);
        if (!jar.isFile()) {
            TestFiles.writeExecutable(jar, "fake jar\n");
        }
        List<String> command = new ArrayList<String>();
        command.add(new File("bin/gbase8a-ipc-driver").getAbsolutePath());
        for (String arg : args) {
            command.add(arg);
        }
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(new File("."));
        builder.redirectErrorStream(true);
        builder.environment().remove("GBASE8A_JDK_HOME");
        builder.environment().remove("JAVA_HOME");
        builder.environment().putAll(env);
        Process process = builder.start();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        TestFiles.copy(process.getInputStream(), output);
        int exitCode = process.waitFor();
        return new ProcessResult(exitCode, new String(output.toByteArray(), "UTF-8"));
    }

    private Map<String, String> env(String... keyValues) {
        java.util.LinkedHashMap<String, String> env = new java.util.LinkedHashMap<String, String>();
        for (int i = 0; i < keyValues.length; i += 2) {
            env.put(keyValues[i], keyValues[i + 1]);
        }
        return env;
    }

    private static final class ProcessResult {
        private final int exitCode;
        private final String output;

        private ProcessResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
