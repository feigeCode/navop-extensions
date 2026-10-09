@echo off
set "GEMINI_CMD=gemini --experimental-acp"

if not "%GEMINI_EXECUTABLE%"=="" (
  set "GEMINI_CMD=%GEMINI_EXECUTABLE% --experimental-acp"
)

where gemini >nul 2>nul
if errorlevel 1 (
  if "%GEMINI_EXECUTABLE%"=="" (
    echo gemini was not found. Install the Gemini CLI before starting the Gemini ACP agent. 1>&2
    exit /b 127
  )
)

%GEMINI_CMD% %*
