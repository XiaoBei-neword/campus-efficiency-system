@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "LABEL=%~1"
if "%LABEL%"=="" set "LABEL=before"
echo [static-check] label = %LABEL%   （纯静态，不需要 Edge，沙箱内也能跑）
"%NODE%" static-check.js --label %LABEL%
set "CODE=%ERRORLEVEL%"
echo.
echo [static-check] 退出码 = %CODE%
pause
exit /b %CODE%
