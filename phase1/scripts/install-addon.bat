@echo off
REM Deploy ForeverLAN from phase1/addon into the Forever client (+ friend-pack mirror).
REM Interface ceiling is already set in the TOC; collector also auto-fixes on start.
set SRC=%~dp0..\addon\ForeverLAN
set DEST=C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\ForeverLAN
set FRIEND=%~dp0..\friend-pack\ForeverLAN
if not exist "%SRC%\ForeverLAN.toc" (
  echo Expected addon at %SRC%
  exit /b 1
)
node "%~dp0sync-addon-interface.mjs" >nul 2>&1
mkdir "%DEST%" 2>nul
xcopy /E /Y /I /Q "%SRC%\*" "%DEST%\" >nul
if errorlevel 1 (
  echo Failed to install to %DEST%
  exit /b 1
)
mkdir "%FRIEND%" 2>nul
xcopy /E /Y /I /Q "%SRC%\*" "%FRIEND%\" >nul
echo Installed ForeverLAN to %DEST%
findstr /B /C:"## Interface:" "%DEST%\ForeverLAN.toc"
echo In-game: /reload
