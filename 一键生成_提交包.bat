@echo off
chcp 65001 >nul
title 知时 · 一键生成官方提交包
cd /d "%~dp0"

echo.
echo  ============================================================
echo   知时 · 安农校园信息雷达  ——  一键生成官方提交包
echo  ============================================================
echo.
echo   将依次提示填入 4 项实名信息 + 演示视频路径，然后自动：
echo     1^) 导出带实名信息的说明文档（官方模板套版）
echo     2^) 按官方命名打三件套 + 提交清单
echo.
echo   命名格式：^<学号^>+^<标识^>+知时·安农校园信息雷达+^<类别^>
echo   缺信息会如实标注，绝不伪造。
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    python "%~dp0tools\make_submission.py"
    goto end
)

where py >nul 2>nul
if %errorlevel%==0 (
    py "%~dp0tools\make_submission.py"
    goto end
)

echo   [提示] 没找到 Python，请把 4 项实名信息和视频路径发给助手，由助手代跑。
echo.

:end
pause
