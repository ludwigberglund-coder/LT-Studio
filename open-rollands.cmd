@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js saknas pa denna dator.
  echo Be foretagets IT-avdelning installera eller tillata Node.js 20 eller senare.
  pause
  exit /b 1
)

start "Rollands Ekonomi" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4173/#/website"
echo Rollands ar oppen i webblasaren.
echo Lat detta fonster vara oppet sa lange du anvander sidan.
pause
