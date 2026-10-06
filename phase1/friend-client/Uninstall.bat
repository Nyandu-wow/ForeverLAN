@echo off
REM Forever LAN — full uninstall. Restores the PC to pre-LAN state for this product.
REM Removes: silent agent, Startup entry, WoW addon, local agent data, ForeverLAN SavedVariables.
REM Does NOT remove: WoW itself, combat logs, other addons, Node.js you installed yourself.
setlocal EnableExtensions EnableDelayedExpansion
title Forever LAN Uninstall

set "HOME=%LOCALAPPDATA%\ForeverLAN"
set "STARTUP_LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ForeverLAN.lnk"
set "PACK=%~dp0"

powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; $r=[System.Windows.MessageBox]::Show('Remove Forever LAN completely from this PC?`n`nThis deletes the background agent, Startup entry, the ForeverLAN WoW addon, and local Forever LAN data.`n`nWoW itself and other addons are left alone.','Forever LAN Uninstall',4,32); if ($r -ne 'Yes') { exit 2 }"
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 0

echo Stopping Forever LAN agent...

REM Kill only the agent we started (PID file) — never blanket-kill all node.exe
if exist "%HOME%\data\agent.pid" (
  set /p AGENT_PID=<"%HOME%\data\agent.pid"
  if defined AGENT_PID (
    taskkill /F /PID !AGENT_PID! >nul 2>&1
  )
)

REM Stop the Startup watchdog (wscript looping Start-ForeverLAN.vbs)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |" ^
  " Where-Object { $_.Name -match '^(wscript|cscript)\.exe$' -and $_.CommandLine -and ($_.CommandLine -like '*Start-ForeverLAN.vbs*') } |" ^
  " ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

REM Fallback: kill node whose command line is our ForeverLAN home (agent + collector)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$homePath = $env:LOCALAPPDATA + '\ForeverLAN';" ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue |" ^
  " Where-Object { $_.CommandLine -and ($_.CommandLine -like ('*' + $homePath + '*')) } |" ^
  " ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

del /f /q "%STARTUP_LNK%" >nul 2>&1
del /f /q "%USERPROFILE%\Desktop\Uninstall Forever LAN.lnk" >nul 2>&1

REM Resolve WoW path from stamped party.json, else search common locations
set "WOW="
if exist "%HOME%\party.json" (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "try { $p=Get-Content -Raw '%HOME%\party.json'|ConvertFrom-Json; if ($p.wowRoot -and $p.clientFolder) { Join-Path $p.wowRoot $p.clientFolder } } catch {}"`) do set "WOW=%%I"
)
if "%WOW%"=="" (
  for %%D in (
    "C:\Games\FOREVER\World of Warcraft\_classic_beta_"
    "C:\Program Files (x86)\World of Warcraft\_classic_beta_"
    "C:\Program Files\World of Warcraft\_classic_beta_"
  ) do (
    if exist "%%~D\WowB.exe" set "WOW=%%~D"
    if exist "%%~D\Wow.exe" set "WOW=%%~D"
  )
)

if not "%WOW%"=="" (
  echo Removing addon from WoW...
  if exist "%WOW%\Interface\AddOns\ForeverLAN" (
    rmdir /s /q "%WOW%\Interface\AddOns\ForeverLAN"
  )
  echo Removing ForeverLAN SavedVariables...
  if exist "%WOW%\WTF\Account" (
    for /r "%WOW%\WTF\Account" %%F in (ForeverLAN.lua) do del /f /q "%%F" >nul 2>&1
    for /r "%WOW%\WTF\Account" %%F in (ForeverLAN.lua.bak) do del /f /q "%%F" >nul 2>&1
  )
) else (
  echo WoW folder not found — skipped addon / SavedVariables cleanup.
)

echo Removing local Forever LAN files...
cd /d "%TEMP%"
if exist "%HOME%" (
  rmdir /s /q "%HOME%"
)

REM If uninstall was run from the zip after HOME is gone, still fine
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Forever LAN has been removed.`n`nThis PC is back to how it was before the LAN install (for Forever LAN).`n`nIf WoW is open, reload UI or restart the game so the addon list refreshes.','Forever LAN',0,64)"

exit /b 0
