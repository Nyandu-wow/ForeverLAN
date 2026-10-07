@echo off
REM Restart Forever LAN *host* only (dashboard + ingest).
REM Friend PCs keep their agents running; they queue to outbox while :8765 is down,
REM then catch up when this host returns. Does NOT change the WoW addon.
REM
REM Safe mid-weekend if lanToken and CLIENT_CONTRACT stay the same.
setlocal EnableExtensions
cd /d "%~dp0.."

echo Stopping Forever LAN host on :8765...
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'host[/\\]server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('killed ' + $_.ProcessId) }"

ping -n 3 127.0.0.1 >nul

echo Starting host...
start "ForeverLAN-host" /MIN node host\server.js
ping -n 3 127.0.0.1 >nul

echo.
echo Host restarted. Board: http://127.0.0.1:8765/
echo Compat check: node scripts\smoke-host-compat.mjs
exit /b 0
