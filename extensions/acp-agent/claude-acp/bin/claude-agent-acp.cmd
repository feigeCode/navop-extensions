@echo off
set "PACKAGE=%CLAUDE_AGENT_ACP_PACKAGE%"
if "%PACKAGE%"=="" set "PACKAGE=@agentclientprotocol/claude-agent-acp@0.52.0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js/npm before starting the Claude Code ACP agent. 1>&2
  exit /b 127
)

if "%CLAUDE_CODE_EXECUTABLE%"=="" (
  for /f "delims=" %%i in ('where claude 2^>nul') do (
    set "CLAUDE_CODE_EXECUTABLE=%%i"
    goto run_claude_acp
  )
)

:run_claude_acp
npm exec --yes -- %PACKAGE% %*
