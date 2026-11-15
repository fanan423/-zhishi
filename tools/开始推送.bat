@echo off
chcp 65001 >nul
title 知时 · 主动推送（手动模式）
cd /d "%~dp0.."

echo.
echo ================================================
echo   知时 · 主动推送  手动跑一次
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 没找到 Node.js。可改用系统自带推送：
  echo     双击「推送通知.vbs」
  echo.
  pause
  exit /b 1
)

node "tools\push_daemon.js"

echo.
echo ------------------------------------------------
echo   推送记录：push_out\今日推送.txt
echo   打开这个文件就能看到「推了什么、为什么推」。
echo ------------------------------------------------
echo.

set /p OPEN=现在打开推送记录吗？(y/n)：
if /i "%OPEN%"=="y" start "" "push_out\今日推送.txt"

echo.
pause
