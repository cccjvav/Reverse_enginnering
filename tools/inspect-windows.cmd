@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 windows_inspect.py
    goto finished
)
python --version >nul 2>nul
if not errorlevel 1 (
    python windows_inspect.py
    goto finished
)
echo Python 3 is required. Install Python 3.10 or later from python.org.
echo Include tkinter and the Python launcher during installation.
echo Then double-click this file again.
:finished
pause
