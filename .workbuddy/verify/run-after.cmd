@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
echo [run-after] node = %NODE%
echo [run-after] 在普通终端（非 DSH 沙箱）运行，约 30-60 秒...
echo.
"%NODE%" run.js --out after
set "CODE=%ERRORLEVEL%"
echo.
echo [run-after] 退出码 = %CODE%   （产物目录 .workbuddy\verify\after）
echo [run-after] 下一步：运行 compare.cmd 或 node compare.js
pause
exit /b %CODE%
