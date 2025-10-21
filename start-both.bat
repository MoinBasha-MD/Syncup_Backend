@echo off
echo ========================================
echo Starting Sync-Up Backend Servers
echo ========================================
echo.

REM Check if NVM is installed
where nvm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: NVM is not installed!
    echo Please install NVM from: https://github.com/coreybutler/nvm-windows/releases
    pause
    exit /b 1
)

echo Starting servers in separate terminals...
echo.

REM Start main server with Node.js v24
start "Main Server (Node v24)" cmd /k "nvm use 24 && cd /d %~dp0 && npm run dev"

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Start admin server with Node.js v20
start "Admin Panel (Node v20)" cmd /k "nvm use 20 && cd /d %~dp0 && npm run admin:dev"

echo.
echo ========================================
echo Both servers are starting!
echo ========================================
echo Main Server (Node v24): http://localhost:5000
echo Admin Panel (Node v20): http://localhost:5001/admin
echo ========================================
echo.
echo Press any key to exit this window...
pause >nul
