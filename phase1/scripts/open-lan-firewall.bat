@echo off
REM Allow Forever LAN host traffic from Private LAN profiles only.
REM Run as Administrator on the HOST PC once.
REM   TCP 8765 — dashboard + POST /events + GET /discover
REM   UDP 8766 — optional (not required for discover scan; beacon is outbound)
net session >nul 2>&1
if errorlevel 1 (
  echo Run this script as Administrator.
  exit /b 1
)
netsh advfirewall firewall delete rule name="Forever LAN 8765" >nul 2>&1
netsh advfirewall firewall delete rule name="Forever LAN beacon 8766" >nul 2>&1
netsh advfirewall firewall add rule name="Forever LAN 8765" dir=in action=allow protocol=TCP localport=8765 profile=private
if errorlevel 1 (
  echo Failed to add TCP 8765 rule.
  exit /b 1
)
REM Outbound beacon uses ephemeral ports; inbound UDP is unused by the host.
REM Keep a named rule doc-only: friends find the host via /discover scan if UDP is blocked.
echo OK: inbound TCP 8765 allowed on Private profile.
echo Friends auto-discover via GET /discover (and UDP beacon when allowed).
echo.
ipconfig | findstr /i "IPv4"
echo.
echo Next: start-weekend.bat, then prepare-friend-zip.bat
