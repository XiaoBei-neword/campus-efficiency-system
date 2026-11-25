@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
echo [compare] before -> after
"%NODE%" compare.js
set "CODE=%ERRORLEVEL%"
echo.
echo [compare] 退出码 = %CODE%   （0 = PASS 无回归，1 = FAIL）
pause
exit /b %CODE%
