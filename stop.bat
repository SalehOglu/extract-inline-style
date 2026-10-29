@echo off
title Stop Extract Inline Style Server
echo Stopping Extract Inline Style server...

set "stopped=0"

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo [OK] Stopped server PID %%a on port 3001.
    set "stopped=1"
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo [OK] Stopped server PID %%a on port 3002.
    set "stopped=1"
)

if "%stopped%"=="1" (
    echo.
    echo Server stopped successfully!
) else (
    echo.
    echo No active server found on port 3001 or 3002.
)

echo.
timeout /t 3 >nul 2>&1
