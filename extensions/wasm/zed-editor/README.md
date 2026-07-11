# Zed External Editor

This static composite extension contributes Zed as an external editor for
OnetCli SFTP remote files. The host application owns the SFTP connection,
temporary file, change watcher, conflict prompt, and upload workflow.

The extension contains no executable code and receives no credentials. It uses
the standard Zed application executable on macOS and the `zed` PATH command on
Linux.

After installation, right-click a remote file and choose **Edit With Zed**. For
a non-standard installation, configure the executable path in OnetCli Settings
under **Remote File Editor**.
