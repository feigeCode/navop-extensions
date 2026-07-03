@echo off
set "PACKAGE=%CODEX_ACP_PACKAGE%"
if "%PACKAGE%"=="" set "PACKAGE=@agentclientprotocol/codex-acp@1.0.1"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js/npm before starting the Codex ACP agent. 1>&2
  exit /b 127
)

if "%CODEX_EXECUTABLE%"=="" (
  for /f "delims=" %%i in ('where codex 2^>nul') do (
    set "CODEX_EXECUTABLE=%%i"
    goto run_codex_acp
  )
)

:run_codex_acp
npm exec --yes -- %PACKAGE% %*
