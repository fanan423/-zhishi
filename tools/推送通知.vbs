' ============================================================
' 知时 · 系统自带推送（无 Node 也能弹）
' ------------------------------------------------------------
' 为什么有这个文件：
'   tools\开始推送.bat 在"本机没装 Node.js"时，会引导用户双击本文件。
'   它零依赖 —— 只用 Windows 自带的 WScript（脚本宿主）+ PowerShell，
'   不装任何东西也能弹一条原生气泡通知。
'
' 它做什么：
'   1) 读 tools\push_out\今日推送.txt（后台任务或上一次推送留下的记录）
'   2) 把"今天要办什么"浓缩成一句，用 PowerShell 的 NotifyIcon 弹出气泡
'   3) 记录不存在时，如实告知"还没生成记录，请先装 Node 跑一次"——
'      绝不静默失败，也绝不编造不存在的推送内容。
'
' 注意：本文件只负责"弹"，不负责"算"。推送评分排序需要 Node（push_daemon.js）。
'       没装 Node 时先弹上次的记录，装了 Node 后走完整链路。
'
' 实现要点（踩过的坑）：
'   生成的临时 .ps1 若内嵌中文，必须带 UTF-16LE BOM，否则 PowerShell
'   按 ANSI 读，中文会把字符串引号"吃掉"直接语法报错。
'   因此这里让 PS 脚本**只含 ASCII**，中文一律由它自己去读记录文件 —— 
'   从根上绕开编码问题。
'
' 用法：双击本文件即可。
' ============================================================

Option Explicit

Dim fso, shell, here, recordPath, txt, stream, body, title, tmpPs

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' 本文件所在目录（tools\）
here = fso.GetParentFolderName(WScript.ScriptFullName)
recordPath = fso.BuildPath(here, "push_out\今日推送.txt")

' ---------- 记录不存在：如实告知，不静默 ----------
If Not fso.FileExists(recordPath) Then
  MsgBox "还没生成推送记录。" & vbCrLf & vbCrLf & _
         "本机可能没装 Node.js。" & vbCrLf & _
         "装好 Node 后，双击 tools\开始推送.bat 跑一次，" & vbCrLf & _
         "之后本文件就能直接弹上次的记录。" & vbCrLf & vbCrLf & _
         "（本工具只聚合安农公网公开通知，不碰教务系统。）", _
         64, "知时 · 主动推送"
  WScript.Quit 0
End If

' ---------- 读记录（仅用于"没有 PS 时"的降级消息框；正常路径由 PS 自己读） ----------
Set stream = fso.OpenTextFile(recordPath, 1, False, -2) ' -2 = 系统默认编码
txt = stream.ReadAll
stream.Close

body = Condense(txt)
title = "知时 · 今日要办"

' ---------- 生成"纯 ASCII"的临时 .ps1 ----------
' 中文内容由 PS 自己从记录文件读（用 UTF8 读），脚本本身零中文 → 无编码风险。
' 连"记录文件路径"也不写进脚本（路径含中文会破坏 ANSI 脚本），改由环境变量传入。
Dim ts
shell.Environment("PROCESS")("ZHISHI_RECORD") = recordPath

Dim arrLines
arrLines = Array( _
  "Add-Type -AssemblyName System.Windows.Forms", _
  "$ErrorActionPreference = 'Stop'", _
  "$p = $env:ZHISHI_RECORD", _
  "$lines = [System.IO.File]::ReadAllLines($p, [System.Text.Encoding]::UTF8)", _
  "$hit = ''; $gen = ''", _
  "foreach ($ln in $lines) {", _
  "  $ln = $ln.Trim()", _
  "  if ($ln.StartsWith([char]0x751F + [char]0x6210)) { $gen = $ln }", _
  "  elseif ($ln.StartsWith([char]0x547D + [char]0x4E2D)) { $hit = $ln }", _
  "}", _
  "$body = ''", _
  "if ($hit) { $body += $hit + [char]10 }", _
  "if ($gen) { $body += ('(' + $gen + ')') }", _
  "if (-not $body.Trim()) { $body = 'see push_out' }", _
  "$n = New-Object System.Windows.Forms.NotifyIcon", _
  "$n.Icon = [System.Drawing.SystemIcons]::Information", _
  "$n.BalloonTipTitle = [char]0x77E5 + [char]0x65F6 + ' - push'", _
  "$n.BalloonTipText = $body", _
  "$n.Visible = $true", _
  "$n.ShowBalloonTip(10000)", _
  "Start-Sleep -Seconds 6", _
  "$n.Dispose()" _
)

tmpPs = fso.BuildPath(shell.ExpandEnvironmentStrings("%TEMP%"), "zhishi_toast.ps1")
Set ts = fso.CreateTextFile(tmpPs, True, False)   ' True=覆盖, False=ANSI（脚本纯 ASCII，安全）
ts.Write Join(arrLines, vbCrLf)
ts.Close

' ---------- 弹（失败就降级消息框，绝不静默） ----------
On Error Resume Next
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & tmpPs & """", 0, True
If Err.Number <> 0 Then
  Err.Clear
  MsgBox title & vbCrLf & vbCrLf & body, 64, "知时 · 主动推送"
End If
On Error GoTo 0

' 收尾：删掉临时脚本、清掉环境变量
On Error Resume Next
fso.DeleteFile tmpPs, True
shell.Environment("PROCESS")("ZHISHI_RECORD") = ""
On Error GoTo 0

WScript.Quit 0

' ============================================================
' 把推送记录浓缩成一句（供降级消息框用；正常路径由 PS 读原文）
' ============================================================
Function Condense(raw)
  Dim lines, i, ln, genTime, hitLine, firstTitle, p1, p2
  lines = Split(raw, vbLf)
  genTime = "": hitLine = "": firstTitle = ""

  For i = 0 To UBound(lines)
    ln = Trim(Replace(lines(i), vbCr, ""))
    If Left(ln, 5) = "生成时间：" And genTime = "" Then genTime = Mid(ln, 6)
    If Left(ln, 5) = "命中总数：" And hitLine = "" Then hitLine = Mid(ln, 6)
    If Left(ln, 4) = "· [" And firstTitle = "" Then
      p1 = InStr(ln, "]")
      If p1 > 0 Then
        p2 = Trim(Mid(ln, p1 + 1))
        If Len(p2) > 0 Then firstTitle = p2
      End If
    End If
  Next

  Dim outStr
  outStr = ""
  If hitLine <> "" Then outStr = hitLine & vbCrLf
  If firstTitle <> "" Then
    outStr = outStr & "首要：" & firstTitle
  Else
    outStr = outStr & "本次没有需要打扰你的事，都静默进流了。"
  End If
  If genTime <> "" Then outStr = outStr & vbCrLf & "（记录生成于 " & genTime & "）"
  Condense = outStr
End Function
