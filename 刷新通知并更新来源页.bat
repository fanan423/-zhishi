@echo off
chcp 65001 >nul
title 知时 · 刷新通知 + 更新「信息来源」页
cd /d "%~dp0"

echo ============================================================
echo   1/3  抓一遍安农公开通知（只抓公网公开页，不动任何登录态）
echo ============================================================
python -c "import requests, bs4" >nul 2>nul
if errorlevel 1 (
  echo   缺依赖，先装一下 requests / beautifulsoup4 ...
  python -m pip install -q requests beautifulsoup4
  if errorlevel 1 (
    echo   [错误] 依赖装不上，检查网络或 Python。
    pause
    exit /b 1
  )
)
python tools\collect_notices.py
if errorlevel 1 (
  echo   [错误] 采集没跑完，下面的步骤跳过。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   2/3  生成来源健康度（每个站在不在、抓了几条、为什么抓不到）
echo ============================================================
python tools\rebuild_source_health.py

echo.
echo ============================================================
echo   3/3  写进网页（实装版 + 发布用的网页版）
echo ============================================================
python tools\export_sources_to_web.py
python tools\sync_sources_view.py

echo.
echo 全部完成。打开 知时_实装版.html 看「我的 → 信息来源」。
pause
