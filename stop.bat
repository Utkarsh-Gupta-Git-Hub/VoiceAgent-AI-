@echo off
REM Double-click to stop VoiceAgent AI (backend, UI and tunnel).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_and_run.ps1" -Stop
pause
