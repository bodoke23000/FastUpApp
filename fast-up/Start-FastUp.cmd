@echo off
setlocal
if not exist "%~dp0scripts\launch.js" goto incomplete
if not exist "%~dp0server\index.js" goto incomplete
if not exist "%~dp0server\startup.js" goto incomplete
if not exist "%~dp0public\index.html" goto incomplete
if not exist "%~dp0package.json" goto incomplete
if not exist "%~dp0package-lock.json" goto incomplete
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% equ 0 (
  node scripts\launch.js
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\launch.js
  ) else (
    goto missing_node
  )
)
set "fastUpExitCode=%errorlevel%"
pause
exit /b %fastUpExitCode%

:missing_node
echo Install Node.js 24 or newer, then run this launcher again.
pause
exit /b 1

:incomplete
echo.
echo FAST UP - EXTRACT THE ZIP FIRST
echo This folder does not contain the complete application.
echo.
echo 1. Close this window.
echo 2. Right-click the downloaded ZIP and choose Extract All.
echo 3. Open the extracted FastUpApp-main or fast-up folder.
echo 4. Run Start-FastUp.cmd beside package.json and the scripts folder.
echo.
echo If the ZIP was already extracted, download the complete project again.
echo.
pause
exit /b 1
