@echo off
REM Kanban CLI shim — bundled with the desktop app.
REM Uses node from PATH to run the CLI entry point in app resources.
set "SCRIPT_DIR=%~dp0"
set "CLI_ENTRY=%SCRIPT_DIR%..\app.asar.unpacked\node_modules\kanban\dist\cli.js"
if not exist "%CLI_ENTRY%" (
  echo error: Kanban CLI not found at %CLI_ENTRY% >&2
  exit /b 1
)
node "%CLI_ENTRY%" %*
