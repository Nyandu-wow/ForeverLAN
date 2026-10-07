@echo off
REM Start Forever LAN collector pointing at friend-pack config.
REM Requires Node 20+ and this repo's collector.
setlocal
set ROOT=%~dp0..
set FOREVERLAN_CONFIG=%~dp0config.friend.json
if not exist "%FOREVERLAN_CONFIG%" (
  echo Create config.friend.json from config.friend.example.json first.
  echo Copy: config.friend.example.json -^> config.friend.json
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node 20+ and retry.
  exit /b 1
)
cd /d "%ROOT%"
echo Config: %FOREVERLAN_CONFIG%
node collector\index.js
