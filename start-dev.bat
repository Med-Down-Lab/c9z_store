@echo off
title C9Z Web - Secure Local Server
cd /d "%~dp0"
echo ========================================================
echo   Starting C9Z Web - Secure Local Development Server
echo ========================================================
echo.

if not exist node_modules (
    echo [INFO] Installing required dependencies...
    call npm install
    echo.
)

echo [INFO] Launching server...
echo [INFO] Open your browser at: http://localhost:3000
echo.
call npm start
pause
