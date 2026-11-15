@echo off
chcp 65001 >nul
title 知时 · 一键加固（电源 + 防火墙 + 更新）
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   请右键本文件，选择「以管理员身份运行」
  echo.
  pause
  exit /b 1
)

echo [1/4] 关闭睡眠 / 休眠 / 硬盘休眠 ...
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
powercfg /change disk-timeout-ac 0
powercfg /change disk-timeout-dc 0

echo [2/4] 合盖 / 唤醒定时器 不触发睡眠 ...
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 0
powercfg /setactive SCHEME_CURRENT

echo [3/4] 防火墙放行 8787 端口 ...
netsh advfirewall firewall delete rule name="知时服务-8787" >nul 2>&1
netsh advfirewall firewall add rule name="知时服务-8787" dir=in action=allow protocol=TCP localport=8787

echo [4/4] 禁止 Windows 更新后自动重启 ...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul

echo.
echo   加固完成：不会再自动睡眠/关机，手机可稳定连接。
echo.
pause
