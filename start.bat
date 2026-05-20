@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
    echo ERROR: electron not found. Run "npm install" first.
    pause
    exit /b 1
)
"node_modules\electron\dist\electron.exe" .
