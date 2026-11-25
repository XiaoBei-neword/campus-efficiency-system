@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
echo [smoke] 环境自检：启动 Edge + 打开页面 + 截一张 _smoke.png
"%NODE%" smoke.js
set "CODE=%ERRORLEVEL%"
echo.
echo [smoke] 退出码 = %CODE%
pause
exit /b %CODE%
