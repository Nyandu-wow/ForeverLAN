@echo off
cd /d "%~dp0.."
node scripts\weekend-status.mjs
echo.
if /i not "%1"=="nopause" pause
