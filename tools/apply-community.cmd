@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 exit /b 2
if defined CONDA_PREFIX goto conda_python
where py >nul 2>nul
if not errorlevel 1 goto launcher_python
where python >nul 2>nul
if not errorlevel 1 goto path_python
echo Python 3.10+ with Tcl/Tk is required. See README.md.
set "RESULT=2"
goto finished
:conda_python
if not exist "%CONDA_PREFIX%\python.exe" goto broken_conda
"%CONDA_PREFIX%\python.exe" "%~dp0apply_community.py" %*
set "RESULT=%ERRORLEVEL%"
goto finished
:broken_conda
echo Active conda Python was not found. Reactivate the environment in CMD.
set "RESULT=2"
goto finished
:launcher_python
py -3 "%~dp0apply_community.py" %*
set "RESULT=%ERRORLEVEL%"
goto finished
:path_python
python "%~dp0apply_community.py" %*
set "RESULT=%ERRORLEVEL%"
:finished
if "%~1"=="" pause
exit /b %RESULT%
