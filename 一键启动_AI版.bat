@echo off
chcp 65001 >nul
title 知时 · 实用版（实时 AI）一键启动
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================================
echo   知时 · 实用版（实时 AI 推荐） 一键启动
echo ============================================================
echo.

rem ── 1. 前置检查 ──
if not exist "tools\agent\server.js" (
  echo [错误] 找不到 tools\agent\server.js，请把本文件放在项目根目录。
  pause & exit /b 1
)
if not exist "知时_可用版.html" (
  echo [错误] 找不到 知时_可用版.html，请先运行 node tools\build_usable.js。
  pause & exit /b 1
)

rem ── 2. 检查是否已配置大模型凭证 ──
set "HASKEY="
if exist "config\llm.local.json" (
  findstr /C:"\"apiKey\": \"sk" "config\llm.local.json" >nul 2>&1 && set "HASKEY=1"
  findstr /C:"\"apiKey\":\"sk" "config\llm.local.json" >nul 2>&1 && set "HASKEY=1"
)
if not defined HASKEY (
  echo [提示] 还没配置大模型密钥。实时 AI 推荐需要在服务端配一次密钥。
  echo.
  echo   两种方式（任选其一）：
  echo   A. 自备模型（推荐，不依赖 WorkBuddy 登录）：
  echo      1) 复制 config\llm.example.json 为 config\llm.local.json
  echo      2) 把 apiKey 填成你的密钥（DeepSeek / 通义 / Kimi / 智谱 / OpenAI 均可）
  echo      3) 保存后重新双击本文件
  echo.
  echo   B. 已在本机登录 WorkBuddy 桌面端：无需配置，直接回车继续。
  echo.
  set /p "CONT=配置好后回车继续，或直接回车用 WorkBuddy 登录态： "
)

rem ── 3. 若 8787 未监听则后台起服务 ──
netstat -ano | findstr /R /C:"LISTENING" | findstr ":8787" >nul 2>&1
if errorlevel 1 (
  echo [启动] 正在启动智能体服务 127.0.0.1:8787 ...
  start "知时AI服务（请勿关闭）" /min "%NODE%" "tools\agent\server.js" --port 8787 --host 127.0.0.1 --quiet
  rem 等服务就绪（最多约 15 秒）
  set /a TRY=0
  :wait
  timeout /t 1 >nul
  curl -s http://127.0.0.1:8787/healthz >nul 2>&1 && goto ready
  set /a TRY+=1
  if %TRY% LSS 15 goto wait
  echo [警告] 服务未在预期时间内响应，仍会打开页面（可能显示降级规则推荐）。
  goto open
) else (
  echo [提示] 智能体服务已在运行，直接复用。
)

:ready
echo [就绪] 服务已响应，正在打开实用版...

:open
rem ── 4. 打开实用版并自动连接本机服务（?agent= 参数）──
start "" "知时_可用版.html?agent=http://127.0.0.1:8787"

echo.
echo ============================================================
echo   已打开「知时_可用版.html」，页面会自动连本机服务。
echo   到「汇总」页看 ✨ AI 推荐：
echo     · 标注「实时大模型 · 自备模型 xxx」= 真调成功
echo     · 标注「构建期预计算」= 离线快照（断网也能看）
echo     · 标注「规则推荐」= 未连上服务 / 未配密钥
echo.
echo   查看当前 AI 通道：浏览器打开 http://127.0.0.1:8787/api/llm/status
echo   关闭服务：运行「停止知时服务.bat」
echo ============================================================
echo.
echo 本窗口可以关闭；服务在后台最小化的「知时AI服务」窗口里运行。
timeout /t 8 >nul
exit /b 0
