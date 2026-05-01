@echo off
REM Windows counterpart to `kanban-dev`. Resolves the repo-root CLI so
REM `npm run dev` on Windows can spawn the in-tree sources instead of the
REM packaged app.asar layout.

setlocal

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%..\..\..\.." >nul
set "REPO_ROOT=%CD%"
popd >nul

set "CLI_ENTRY=%REPO_ROOT%\dist\cli.js"

if not exist "%CLI_ENTRY%" (
  echo error: Kanban CLI not found at %CLI_ENTRY% >&2
  echo hint: Run 'npm run build' at the repo root first >&2
  endlocal
  exit /b 1
)

node "%CLI_ENTRY%" %*
set "NODE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %NODE_EXIT%
