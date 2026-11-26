@echo off
REM Double-click to set up and start VoiceAgent AI.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_and_run.ps1" %*
