@echo off
REM Copy ForeverLAN addon into Forever client AddOns folder.
set SRC=%~dp0ForeverLAN
set DEST=C:\Games\FOREVER\World of Warcraft\_classic_beta_\Interface\AddOns\ForeverLAN
if not exist "%SRC%\ForeverLAN.toc" (
  echo Expected addon at %SRC%
  exit /b 1
)
mkdir "%DEST%" 2>nul
xcopy /E /Y /I "%SRC%\*" "%DEST%\"
echo Installed ForeverLAN to %DEST%
