@echo off
REM Start the host's local collector (his own WoW client → host).
REM Skips if a Forever LAN collector is already running (avoids connection storms).
setlocal EnableExtensions
cd /d "%~dp0.."

powershell -NoProfile -Command ^
  "if (Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'collector[/\\]index\.js' }) { Write-Output 'Collector already running.'; exit 2 } else { exit 0 }"
if errorlevel 2 (
  echo Collector already running — not starting a second one.
  exit /b 0
)

echo Starting Forever LAN collector...
start "ForeverLAN-collector" /MIN node collector\index.js
echo Collector started minimized. Leave it running while you play.
exit /b 0
