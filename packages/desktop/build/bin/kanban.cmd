@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESOURCES_DIR=%SCRIPT_DIR%.."
set "CLI_ENTRY=%RESOURCES_DIR%\app.asar.unpacked\cli\cli.js"

if not exist "%CLI_ENTRY%" (
  echo error: Kanban CLI not found at %CLI_ENTRY% >&2
  endlocal
  exit /b 1
)

node "%CLI_ENTRY%" %*
set "NODE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %NODE_EXIT%
