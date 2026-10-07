@echo off
REM Start Forever LAN host if healthy. If port is open but board is dead, heal it.
setlocal EnableExtensions
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-stack.ps1"
exit /b %ERRORLEVEL%
