@echo off
chcp 65001 >nul
title 知时 · 安农校园信息雷达  ——  一键运行
cd /d "%~dp0"

echo.
echo  ============================================================
echo   知时 · 安农校园信息雷达
echo   校园公开信息的智能聚合与个性化提醒智能体
echo  ============================================================
echo.
echo   【首选】直接双击项目根目录的「知时.html」
echo            —— 单文件可用应用，零依赖，双击即用。
echo            手机壳界面里：通知(主动推送) / 日程 / 汇总(自动整合) / 我的(自主完善档案)
echo            外加「推送设置」（可解释评分 + 打扰级别）与「数据自查」（三条铁律）
echo.
echo   【要关掉页面也收提醒】双击 tools\注册后台推送.bat
echo            —— 每天 08:00 / 20:00 自动检查并弹系统通知（零依赖）
echo.
echo   【想看全部演示入口】双击项目根目录的「知时门户.html」
echo            —— 统一门户：左导航列 13 个入口（可用应用 / 交互 Demo / 主链路 / 浓缩溯源 /
echo            理解层 / 数据从哪来 / 数据源 / 小程序形态 / 原始数据 / 数据体检 / 预览 / 总览）。
echo.
echo   下面启动的是「统一门户 + 项目总览 + 技术链路演示」本地预览服务...
echo.

set PORT=8420

REM 优先用 python（本机已装），起一个静态服务器指向项目根目录（门户与 web/ 都在其下）
where python >nul 2>nul
if %errorlevel%==0 (
    start "" /min python -m http.server %PORT% --bind 127.0.0.1 --directory "%~dp0"
    goto opened
)

REM 退路：用 node 起一个极简静态服务器（指向根目录，首页为知时门户.html）
where node >nul 2>nul
if %errorlevel%==0 (
    start "" /min node "%~dp0tools\serve.js" %PORT% "%~dp0" 知时门户.html
    goto opened
)

echo   [提示] 没找到 python 或 node，改为直接打开本地文件。
echo           （直接打开也能用，就是部分浏览器会限制本地文件加载）
start "" "%~dp0知时门户.html"
goto end

:opened
REM 等服务起来
ping -n 3 127.0.0.1 >nul
start "" "http://127.0.0.1:%PORT%/知时门户.html"
echo   已打开浏览器。若没有自动跳转，请手动访问：
echo.
echo      http://127.0.0.1:%PORT%/知时门户.html
echo.
echo   关闭这个窗口不会停止服务；要停止请关掉那个 python/node 窗口。
echo.

:end
echo  ------------------------------------------------------------
echo   小程序预览：用「微信开发者工具」打开 miniprogram 目录即可
echo               （已配 touristappid 游客模式，无需自己的 AppID）
echo  ------------------------------------------------------------
echo.
pause
