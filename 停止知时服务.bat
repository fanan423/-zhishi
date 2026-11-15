@echo off
chcp 65001 >nul
title 知时 · 停止服务
echo 正在停止 知时服务 ...
for /f "tokens=2 delims==" %%i in ('wmic process where "name='node.exe' and commandline like '%%daemon.js%%'" get processid /value 2^>nul ^| find "="') do taskkill /f /pid %%i >nul 2>&1
for /f "tokens=2 delims==" %%i in ('wmic process where "name='node.exe' and commandline like '%%agent\\server.js%%'" get processid /value 2^>nul ^| find "="') do taskkill /f /pid %%i >nul 2>&1
echo 已停止。
pause
