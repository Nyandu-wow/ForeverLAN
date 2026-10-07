@echo off
REM Remote friend beta — push-only over Cloudflare Tunnel.
REM Friends POST events to https://foreverlan-ingest.example.com (lanToken).
REM Watch the board on this PC: http://127.0.0.1:8765/
REM Tear down: close the tunnel window when done.
setlocal
cd /d "%~dp0.."

echo.
echo  FOREVER LAN — REMOTE BETA (push-only)
echo  Ingest WAN:  https://foreverlan-ingest.example.com
echo  Dashboard:   http://127.0.0.1:8765/   (local only — not on the tunnel)
echo.

if not exist "run.mjs" (
  echo Missing run.mjs — run from repo root\
  pause
  exit /b 1
)

if not exist "cloudflare\config.yml" (
  echo Missing cloudflare\config.yml
  echo See cloudflare\README.md
  pause
  exit /b 1
)

start "Forever LAN" cmd /k "node run.mjs"

timeout /t 4 /nobreak >nul

start "ForeverLAN Tunnel" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\cloudflare\start-tunnel.ps1"

echo.
echo Host + tunnel starting.
echo Tests: node scripts\test-remote-security.mjs
echo        node scripts\test-remote-security.mjs --live-wan
echo.
pause
