@echo off
REM Backup Forever LAN weekend data on the host PC (jsonl + sqlite + lan state).
setlocal
set "ROOT=%~dp0.."
set "DATA=%ROOT%\data"
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%I"
set "OUT=%ROOT%\backups\weekend-%STAMP%"
mkdir "%OUT%" 2>nul
if exist "%DATA%\host-events.jsonl" copy /Y "%DATA%\host-events.jsonl" "%OUT%\" >nul
if exist "%DATA%\foreverlan.sqlite" copy /Y "%DATA%\foreverlan.sqlite" "%OUT%\" >nul
if exist "%DATA%\lan-state.json" copy /Y "%DATA%\lan-state.json" "%OUT%\" >nul
if exist "%DATA%\party-state.json" copy /Y "%DATA%\party-state.json" "%OUT%\" >nul
if exist "%DATA%\outbox.jsonl" copy /Y "%DATA%\outbox.jsonl" "%OUT%\" >nul
echo Backup written to:
echo   %OUT%
dir /b "%OUT%"
