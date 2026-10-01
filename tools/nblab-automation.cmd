@echo off
rem NBLAB dispatch automation - starts the agent in the background.
rem Keep this file next to nblab-automation.ps1. To start it at every sign-in,
rem put a shortcut to this file in the Startup folder (Win+R, then: shell:startup).
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0nblab-automation.ps1"
