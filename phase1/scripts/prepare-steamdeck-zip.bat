@echo off
REM the host: rebuild Steam Deck zip (Linux Node + LF shell + Unix ZIP paths).
cd /d "%~dp0.."
node scripts\prepare-steamdeck-pack.mjs
if errorlevel 1 exit /b 1
echo.
echo Copy this file to the Steam Deck:
echo   %CD%\dist\ForeverLAN-SteamDeck.zip
echo.
echo On Deck (Desktop Mode / Konsole), after unzip:
echo   bash install-steamdeck.sh
pause
