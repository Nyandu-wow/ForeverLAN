@echo off
REM Hard restart Forever LAN host + local collector (the host PC).
REM Use when the board freezes or /health stops answering.
setlocal EnableExtensions
cd /d "%~dp0.."

echo Stopping Forever LAN host/collector...
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'host[/\\]server\.js|collector[/\\]index\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('killed ' + $_.ProcessId) }"

REM Wait for port 8765 to free
ping -n 3 127.0.0.1 >nul

echo Starting host...
start "ForeverLAN-host" /MIN node host\server.js
ping -n 3 127.0.0.1 >nul

echo Starting collector...
start "ForeverLAN-collector" /MIN node collector\index.js

echo.
echo Restarted. Board: http://127.0.0.1:8765/
echo Health:  http://127.0.0.1:8765/health
exit /b 0
