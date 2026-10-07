@echo off
REM Host: rebuild friend zip to send (token baked from config.json).
cd /d "%~dp0.."
node scripts\prepare-friend-pack.mjs
if errorlevel 1 exit /b 1
echo.
echo Send this file privately:
echo   %CD%\dist\ForeverLAN-Friends.zip
pause
