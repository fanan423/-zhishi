@echo off
chcp 65001 >nul
title 知时 · 智能体服务
cd /d "%~dp0"

if not exist "tools\agent\server.js" (
  echo [错误] 没找到 tools\agent\server.js
  echo 请把本文件放在「校园信息雷达」工程根目录下再双击运行。
  pause
  exit /b 1
)

rem 规则模式起步：不依赖大模型额度，服务一定起得来。
rem 想启用大模型理解层，把下一行改成 set AGENT_LLM_DEFAULT=1
set AGENT_LLM_DEFAULT=0

echo.
echo   ==================================================
echo      知时 · 智能体服务    http://127.0.0.1:8787
echo   ==================================================
echo.
echo   [1] 保持本窗口开启，服务就一直在后台替你跑
echo   [2] 微信开发者工具：详情 → 本地设置 →
echo       勾选「不校验合法域名、web-view、TLS版本以及HTTPS证书」
echo   [3] 重新编译，小程序「我的」页会显示「已连接智能体服务」
echo.
echo   真机预览：把 app.js 里的 127.0.0.1 改成电脑局域网 IP，
echo             并把下面命令的 --host 127.0.0.1 改成 --host 0.0.0.0
echo.
echo   按 Ctrl+C 可停止服务
echo.

node tools\agent\server.js --port 8787 --host 127.0.0.1

echo.
echo   服务已退出。
pause
