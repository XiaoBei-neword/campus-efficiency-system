@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
echo [run-before] node = %NODE%
echo [run-before] 在普通终端（非 DSH 沙箱）运行，约 30-60 秒...
echo.
"%NODE%" run.js --out before
set "CODE=%ERRORLEVEL%"
echo.
echo [run-before] 退出码 = %CODE%   （产物目录 .workbuddy\verify\before）
pause
exit /b %CODE%
