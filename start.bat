@echo off
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"

if not exist "client\dist\index.html" (
  echo Building MCServerManager frontend, backend, and tray app...
  call npm.cmd run build
)

if not exist "MCServerManager.exe" (
  echo Building MCServerManager Windows tray executable...
  call npm.cmd run build:tray
)

echo Launching MCServerManager (http://localhost:3001)...
start "" "MCServerManager.exe"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3001"
