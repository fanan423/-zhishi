# 知时 · 智能体自动调度安装器（Windows）
# ============================================
# 作用：把"知时·智能体"注册成 Windows 计划任务，让它**不问任何人、自己按点跑**，
#       每天把"该主动送达的通知"写进 push_out\，实现真·主动送达闭环。
#
# 【为什么用计划任务，而不是常驻进程】
#   常驻进程要一直开着窗口；计划任务由系统按时拉起、跑完即退，
#   笔记本合盖/重启后依然有效 —— 更符合"它自己会管好自己"的产品定位。
#
# 【用法】（在本目录下，右键"使用 PowerShell 运行"，或先 cd 过来）
#   .\tools\install_agent_task.ps1                 # 默认：每天 07:30 跑一轮（含大模型）
#   .\tools\install_agent_task.ps1 -At 08:10,21:00 # 自定义时间（可多个）
#   .\tools\install_agent_task.ps1 -NoLlm          # 不调大模型（纯规则，零额度）
#   .\tools\install_agent_task.ps1 -Remove         # 卸载任务
#
# 【它到底做了什么】
#   注册计划任务 "ZhishiAgent" →
#     node <项目>\tools\agent.js --llm --limit 12 --quiet
#   结果落盘：push_out\agent_run.json（机器可读）+ push_out\今日推送.txt（人可读）
#
# 【诚实声明】
#   本脚本只注册"在你本机跑一轮"的定时任务；它**不会**替你发微信/短信。
#   真·触达的最后一公里（把清单送到你手上）见 docs/参赛作品说明.md 的触达闭环章节。

[CmdletBinding()]
param(
  [string[]]$At = @('07:30'),
  [switch]$NoLlm,
  [switch]$Remove,
  [int]$Limit = 12
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 兼容通过 -File 调用时 "07:30,21:00" 被当成单个字符串的情况
$At = @($At | ForEach-Object { $_ -split '\s*,\s*' } | Where-Object { $_ })

$TaskName = 'ZhishiAgent'
$Root     = Split-Path -Parent $PSScriptRoot
$Agent    = Join-Path $Root 'tools\agent.js'

if (-not (Test-Path $Agent)) {
  throw "找不到智能体入口：$Agent（请在项目根目录下的 tools\ 里运行本脚本）"
}

# ── 卸载 ──────────────────────────────────────────────
if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[知时] 已卸载计划任务：$TaskName" -ForegroundColor Green
  } else {
    Write-Host "[知时] 本机没有名为 $TaskName 的计划任务，无需卸载。" -ForegroundColor Yellow
  }
  return
}

# ── 找 node.exe（优先项目旁的真 node，不用 Microsoft Store 版）──────
function Find-Node {
  $cands = @()
  $cands += (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
  $cands += "$env:LOCALAPPDATA\Microsoft\WindowsApps\node.exe"
  $cands += 'C:\Program Files\nodejs\node.exe'
  foreach ($c in $cands) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  # 兜底：扫 workbuddy 自带的 node
  $wb = Get-ChildItem -Path "$env:USERPROFILE\.workbuddy\binaries\node\versions" -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
  if ($wb) { return $wb }
  throw '找不到 node.exe，请先安装 Node.js 或把 node 加入 PATH。'
}

$NodeExe = Find-Node

# ── 组装命令行 ─────────────────────────────────────────
$llmArg   = if ($NoLlm) { '' } else { '--llm' }
$argsLine = "`"$Agent`" $llmArg --limit $Limit --quiet"
$action   = New-ScheduledTaskAction -Execute $NodeExe -Argument $argsLine -WorkingDirectory $Root

# 每天在指定时刻触发（支持多个时刻）
$triggers = @()
foreach ($t in $At) {
  if ($t -notmatch '^\d{1,2}:\d{2}$') { throw "时间格式应为 HH:MM，收到：$t" }
  $triggers += New-ScheduledTaskTrigger -Daily -At $t
}

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$settings.Hidden = $false

# 注册（覆盖同名任务）
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
  -Description '知时·智能体：自动跑一轮，输出今日该主动送达的校园通知（不问任何人）' | Out-Null

# ── 汇报 ──────────────────────────────────────────────
$t = Get-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host '[知时] 智能体已注册为计划任务，从此它自己会跑。' -ForegroundColor Green
Write-Host "  任务名 ：$TaskName"
Write-Host "  执行体 ：$NodeExe"
Write-Host "  参数   ：$argsLine"
Write-Host "  触发   ：每天 $($At -join ' / ')"
Write-Host "  状态   ：$($t.State)"
Write-Host ''
Write-Host '  立即试跑一次：' -ForegroundColor Cyan
Write-Host "    Start-ScheduledTask -TaskName $TaskName"
Write-Host '  看结果：' -ForegroundColor Cyan
Write-Host "    Get-Content `"$Root\push_out\今日推送.txt`" -Encoding UTF8"
Write-Host '  卸载：' -ForegroundColor Cyan
Write-Host "    .\tools\install_agent_task.ps1 -Remove"
Write-Host ''
