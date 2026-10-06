@echo off
rem Launcher for Windows Task Scheduler: runs the v2 pipeline independently of any terminal or app.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1
set SMOKE=
"..\.venv\Scripts\python.exe" run_all.py --no-shutdown >> "..\results_v2\run_all.out.log" 2>> "..\results_v2\run_all.err.log"
