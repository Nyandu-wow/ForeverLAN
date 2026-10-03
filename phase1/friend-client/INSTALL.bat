@echo off
REM Forever LAN — one double-click install for friends.
REM Asks where WoW: Forever is installed (folder picker). No CMD typing required.
setlocal EnableExtensions
title Forever LAN Setup

set "PACK=%~dp0"
set "HOME=%LOCALAPPDATA%\ForeverLAN"
set "WOW="

echo.
echo  Forever LAN Setup
echo  =================
echo.

if not exist "%PACK%party.json" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('This pack was not prepared correctly (missing party.json). Ask the host for a fresh Forever LAN zip.','Forever LAN',0,16)"
  exit /b 1
)

if not exist "%PACK%runtime\node.exe" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Missing runtime\node.exe. Ask the host to re-build the friend pack.','Forever LAN',0,16)"
  exit /b 1
)

if not exist "%PACK%pick-wow.ps1" (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Missing pick-wow.ps1 in the pack. Ask the host for a fresh zip.','Forever LAN',0,16)"
  exit /b 1
)

echo Opening folder picker for WoW: Forever...
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%PACK%pick-wow.ps1"`) do set "WOW=%%I"

if "%WOW%"=="" (
  exit /b 1
)

echo Using: %WOW%

set "ADDON_DEST=%WOW%\Interface\AddOns\ForeverLAN"
mkdir "%ADDON_DEST%" 2>nul
xcopy /E /Y /I /Q "%PACK%addon\ForeverLAN\*" "%ADDON_DEST%\" >nul
if errorlevel 1 (
  powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Could not copy the addon into AddOns. Try running Setup as Administrator.','Forever LAN',0,16)"
  exit /b 1
)

REM Install silent agent under LocalAppData
mkdir "%HOME%" 2>nul
mkdir "%HOME%\data" 2>nul
mkdir "%HOME%\runtime" 2>nul
mkdir "%HOME%\collector" 2>nul
mkdir "%HOME%\addon\ForeverLAN" 2>nul

xcopy /E /Y /I /Q "%PACK%runtime\*" "%HOME%\runtime\" >nul
xcopy /E /Y /I /Q "%PACK%collector\*" "%HOME%\collector\" >nul
xcopy /E /Y /I /Q "%PACK%addon\ForeverLAN\*" "%HOME%\addon\ForeverLAN\" >nul
copy /Y "%PACK%agent.js" "%HOME%\agent.js" >nul
copy /Y "%PACK%discover.js" "%HOME%\discover.js" >nul
copy /Y "%PACK%party.json" "%HOME%\party.json" >nul
copy /Y "%PACK%Uninstall.bat" "%HOME%\Uninstall.bat" >nul
copy /Y "%PACK%stamp-wow.mjs" "%HOME%\stamp-wow.mjs" >nul
copy /Y "%PACK%pick-wow.ps1" "%HOME%\pick-wow.ps1" >nul

REM Stamp wow path into party.json via node
"%PACK%runtime\node.exe" "%PACK%stamp-wow.mjs" "%HOME%\party.json" "%WOW%"
if errorlevel 1 (
  echo Failed to stamp WoW path.
)

REM Desktop shortcut to uninstall (easy to find after the weekend)
set "DESKTOP=%USERPROFILE%\Desktop"
(
  echo Set sh = CreateObject("WScript.Shell"^)
  echo Set sc = sh.CreateShortcut("%DESKTOP%\Uninstall Forever LAN.lnk"^)
  echo sc.TargetPath = "%HOME%\Uninstall.bat"
  echo sc.WorkingDirectory = "%HOME%"
  echo sc.Description = "Remove Forever LAN and restore this PC"
  echo sc.Save
) > "%TEMP%\flan-uninst-shortcut.vbs"
cscript //nologo "%TEMP%\flan-uninst-shortcut.vbs" >nul 2>&1
del "%TEMP%\flan-uninst-shortcut.vbs" >nul 2>&1

REM Hidden launcher with restart loop (agent crash → back up in a few seconds).
REM Exit code 0 = clean/duplicate agent — idle longer so we don't thrash.
(
  echo Set sh = CreateObject("WScript.Shell"^)
  echo sh.Environment("PROCESS"^)("FOREVERLAN_HOME"^) = "%HOME%"
  echo sh.Environment("PROCESS"^)("FOREVERLAN_FRIEND_AGENT"^) = "1"
  echo Do
  echo   code = sh.Run("""%HOME%\runtime\node.exe"" ""%HOME%\agent.js""", 0, True^)
  echo   If code = 0 Then
  echo     WScript.Sleep 60000
  echo   Else
  echo     WScript.Sleep 5000
  echo   End If
  echo Loop
) > "%HOME%\Start-ForeverLAN.vbs"

REM Startup folder shortcut so it comes back after reboot
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo Set sh = CreateObject("WScript.Shell"^)
  echo Set sc = sh.CreateShortcut("%STARTUP%\ForeverLAN.lnk"^)
  echo sc.TargetPath = "%HOME%\Start-ForeverLAN.vbs"
  echo sc.WorkingDirectory = "%HOME%"
  echo sc.Save
) > "%TEMP%\flan-shortcut.vbs"
cscript //nologo "%TEMP%\flan-shortcut.vbs" >nul 2>&1
del "%TEMP%\flan-shortcut.vbs" >nul 2>&1

REM Start agent now
wscript "%HOME%\Start-ForeverLAN.vbs"

powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Forever LAN is installed.`n`nGame folder:`n%WOW%`n`n1. In WoW, enable the ForeverLAN addon`n2. That is all — collection runs in the background.`n`nOptional in-game: /combatlog once, and Push LAN after sessions.`n`nAfter the LAN: double-click \"Uninstall Forever LAN\" on your Desktop to remove everything.','Forever LAN',0,64)"

exit /b 0
