@echo off
REM Kanban CLI shim — bundled with the desktop app.
REM
REM Prefers the bundled Electron binary (via ELECTRON_RUN_AS_NODE=1) so
REM we don't depend on the user having a system `node` on PATH. Falls
REM back to system `node` if the local Electron binary isn't found —
REM e.g. when invoked outside the packaged-app layout.
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESOURCES_DIR=%SCRIPT_DIR%.."
set "CLI_ENTRY=%RESOURCES_DIR%\app.asar.unpacked\cli\cli.js"

REM Windows packaged layout:
REM   Kanban\resources\bin\kanban.cmd     (this file)
REM   RESOURCES_DIR = Kanban\resources
REM   APP_ROOT      = Kanban
REM   electron exec = Kanban\Kanban.exe
set "APP_ROOT=%RESOURCES_DIR%\.."
set "ELECTRON_BIN=%APP_ROOT%\Kanban.exe"

if not exist "%CLI_ENTRY%" (
  echo error: Kanban CLI not found at %CLI_ENTRY% >&2
  endlocal
  exit /b 1
)

if exist "%ELECTRON_BIN%" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%ELECTRON_BIN%" "%CLI_ENTRY%" %*
  set "EXIT_CODE=%ERRORLEVEL%"
  endlocal & exit /b %EXIT_CODE%
)

REM Fallback: system node.
node "%CLI_ENTRY%" %*
set "NODE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %NODE_EXIT%
