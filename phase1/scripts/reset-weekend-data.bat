@echo off
REM Clear the weekend dataset on the HOST after a backup.
REM Use before the real LAN if you want a clean log, or after archiving a finished weekend.
REM Requires the host to be STOPPED (port 8765 free) so sqlite is not locked.
setlocal EnableExtensions
cd /d "%~dp0.."

powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; $r=[System.Windows.MessageBox]::Show('Clear ALL Forever LAN weekend data on this PC?`n`nA backup will be written first under phase1\backups\.`n`nThis cannot be undone except by restoring the backup.`n`nStop the host first if it is running.','Forever LAN — Reset data',4,48); if ($r -ne 'Yes') { exit 2 }"
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 0

netstat -ano | findstr ":8765" | findstr "LISTENING" >nul
if not errorlevel 1 (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Host is still running on port 8765.`n`nStop it first (close the ForeverLAN-host window, or run restart-host.bat and then close), then run Reset again.','Forever LAN',0,16)"
  exit /b 1
)

echo Backing up...
call "%~dp0backup-weekend-data.bat"
if errorlevel 1 (
  echo Backup failed — aborting reset.
  exit /b 1
)

echo Clearing live dataset...
del /f /q "data\host-events.jsonl" >nul 2>&1
del /f /q "data\foreverlan.sqlite" >nul 2>&1
del /f /q "data\foreverlan.sqlite-wal" >nul 2>&1
del /f /q "data\foreverlan.sqlite-shm" >nul 2>&1
del /f /q "data\lan-state.json" >nul 2>&1
del /f /q "data\party-state.json" >nul 2>&1
REM Keep collector outbox/state — only host board data is wiped
echo. > "data\host-events.jsonl"

powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Weekend data cleared.`n`nBackup is under phase1\backups\.`nStart the host again with scripts\start-host.bat or start-weekend.bat.','Forever LAN',0,64)"
exit /b 0
