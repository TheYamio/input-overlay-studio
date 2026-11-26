@echo off
setlocal

set "APP=%~dp0ws-server\src-tauri\target\debug\input-overlay-ws.exe"
if not exist "%APP%" (
  echo The local 0.8.0.1_elembor application has not been built yet.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq input-overlay-ws.exe" 2>NUL | find /I "input-overlay-ws.exe" >NUL
if not errorlevel 1 (
  goto already_running
)
tasklist /FI "IMAGENAME eq Input Overlay Studio.exe" 2>NUL | find /I "Input Overlay Studio.exe" >NUL
if not errorlevel 1 (
  goto already_running
)

set "INPUT_OVERLAY_STUDIO_DATA_DIR=%~dp0.dev-data"
start "Input Overlay Studio 0.8.0.1_elembor" "%APP%"
exit /b 0

:already_running
echo Input Overlay Studio is already running.
echo Exit it from the system tray, then run this file again.
pause
exit /b 1
