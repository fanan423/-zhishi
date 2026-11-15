@echo off
chcp 65001 >nul
title 知时 · 注册后台主动推送
cd /d "%~dp0.."

echo.
echo ================================================
echo   知时 · 后台主动推送  一键注册
echo ================================================
echo.
echo   注册后，系统会每天 08:00 和 20:00 自动：
echo     1. 读取你的档案（学院/年级/专业/关注标签）
echo     2. 检查安农公开通知里哪些和你有关、哪些快截止了
echo     3. 有紧急的就弹一条系统通知提醒你
echo     4. 同时写一份「今日推送.txt」放在 push_out 目录
echo.
echo   这一切不需要打开任何页面，关着电脑也一样（开机状态下）。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 没找到 Node.js，无法注册。
  echo     请先安装 Node.js，或改用「开始推送.bat」手动模式。
  echo.
  pause
  exit /b 1
)

node "tools\push_daemon.js" --install

echo.
echo ------------------------------------------------
echo   注册完成。下面可以立刻试跑一次看看效果：
echo ------------------------------------------------
echo.
set /p TRY=现在就跑一次并弹通知吗？(y/n)：
if /i "%TRY%"=="y" (
  echo.
  node "tools\push_daemon.js"
  echo.
  echo 推送记录已生成：push_out\今日推送.txt
)

echo.
pause
