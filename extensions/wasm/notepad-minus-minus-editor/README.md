# Notepad-- External Editor

This static composite extension contributes Notepad-- as an external editor for
OnetCli SFTP remote files. The host application owns the SFTP connection,
temporary file, change watcher, conflict prompt, and upload workflow.

The extension contains no executable code and receives no credentials. It only
declares the standard macOS Notepad-- executable and the `{file}` argument.

After installation, right-click a remote file and choose **Edit With Notepad--**.
For a non-standard installation, configure the executable path in OnetCli
Settings under **Remote File Editor**.
