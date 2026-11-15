@echo off
chcp 65001 >nul
title 知时 · 服务守护（别关这个窗口，关了手机就断连）
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\z'y'f\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

if not exist "tools\agent\server.js" (
  echo [错误] 找不到 tools\agent\server.js，请确认本文件放在项目根目录。
  pause
  exit /b 1
)

rem 端口已被占用则直接退出，避免重复启动打架
netstat -ano | findstr /R /C:"LISTENING" | findstr ":8787" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   知时服务已经在运行了（8787 端口已监听），无需重复启动。
  echo   手机访问： http://192.168.1.104:8787
  echo.
  timeout /t 6 >nul
  exit /b 0
)

:loop
echo ============================================================
echo [%date% %time%] 启动 知时服务  0.0.0.0:8787
echo    手机访问： http://192.168.1.104:8787
echo ============================================================
"%NODE%" "tools\agent\daemon.js"
echo.
echo [%date% %time%] 守护进程退出，3 秒后自动重启...
timeout /t 3 /nobreak >nul
goto loop
