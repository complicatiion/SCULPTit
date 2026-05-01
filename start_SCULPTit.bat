@echo off
setlocal
set "PORT=8000"
set "URL=http://localhost:%PORT%"

title SCULPTit Local Server v1.2.0
cd /d "%~dp0"

echo ==========================================
echo   SCULPTit v1.2.0 - Local Web App Server
echo ==========================================
echo.
echo Starting local server on %URL%
echo Keep this window open while using SCULPTit.
echo.

start "SCULPTit Browser Launcher" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process '%URL%'"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server %PORT%
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
  node tools\local_server.js %PORT%
  goto :end
)

echo ERROR: No supported local server runtime found.
echo Install Python 3 or Node.js, then start this file again.
pause

:end
endlocal
REM sksdesign (c) 2026