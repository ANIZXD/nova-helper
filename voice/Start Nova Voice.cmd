@echo off
rem Double-click this to open the Nova Voice app.
rem It starts the Nova engine if needed, then opens the talk window.
setlocal
cd /d "%~dp0.."
if not exist "%USERPROFILE%\.nova" mkdir "%USERPROFILE%\.nova"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0voice-app.ps1"
endlocal
