@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0.."
if errorlevel 1 exit /b 2
if not defined CONDA_PREFIX goto no_conda
if not exist "%CONDA_PREFIX%\python.exe" goto no_conda
"%CONDA_PREFIX%\python.exe" tools\check_cmd_environment.py
if errorlevel 1 exit /b 2
if not exist node_modules\acorn\package.json goto no_dependencies
call npm.cmd run learn:check
if errorlevel 1 exit /b 3
call npm.cmd run learn:lab
if errorlevel 1 exit /b 4
call npm.cmd test
if errorlevel 1 exit /b 5
"%CONDA_PREFIX%\python.exe" -m unittest discover -s tests -q
if errorlevel 1 exit /b 6
echo ALL_LEARNING_CHECKS_PASSED - no installed application was modified.
exit /b 0
:no_conda
echo Activate your conda environment in this CMD window first. See docs\WINDOWS_CMD_CONDA.md.
exit /b 2
:no_dependencies
echo Run npm.cmd ci --ignore-scripts --no-audit --no-fund in the repository root first.
exit /b 2
