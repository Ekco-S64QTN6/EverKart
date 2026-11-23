@echo off
rem EverKart - Windows installer. Double-click this file: it runs install.ps1, which builds
rem EverKart from your EverQuest files (copy them into the Everquest folder first) and installs it.
title EverKart installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
