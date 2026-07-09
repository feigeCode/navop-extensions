@echo off
if not "%OPENCODE_EXECUTABLE%"=="" (
  if exist "%OPENCODE_EXECUTABLE%" (
    "%OPENCODE_EXECUTABLE%" acp %*
    exit /b %ERRORLEVEL%
  )
)

where opencode >nul 2>nul
if errorlevel 1 (
  echo opencode was not found. Install OpenCode before starting the OpenCode ACP agent. 1>&2
  exit /b 127
)

opencode acp %*
