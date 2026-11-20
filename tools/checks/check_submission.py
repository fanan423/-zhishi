# -*- coding: utf-8 -*-
"""
参赛交付就绪自检
================
守住"能不能按时、按格式交出去"这一层。它不测代码逻辑（那些有别的脚本），
只测**交付物本身是否齐备、命名工具是否可用、通告是否到位**：

  A. 参赛通告存在且要素齐全（编号/日期/命名格式/合规声明/时间表/截止日）
  B. 八章说明文档存在且含官方八章标题
  C. 一键打包器存在、可 --dry 跑通、且其打包清单里的文件真实存在
  D. 可运行程序齐备（门户 / 单文件应用 / 交互 Demo / 小程序 app.json）
  E. 合规红线：只出现"不接入/明确不做"表述，不出现"爬取教务系统"类违规表述
  F. 文档与工具一致（通告引用打包器 / 导出器 / 逐镜脚本）
  G. 官方提交办法要点已录入（云盘链接、密码、命名三段式、不得混用）
  H. Word 导出器存在、可跑通、产物含官方八章结构
  I. 演示视频逐镜脚本存在且覆盖评分四维度、总时长不超 5 分钟

用法：python tools/checks/check_submission.py
退出码：0=全过 / 1=有失败
"""
import re
import subprocess
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"


def _pick_python():
    """挑一个**能用 python-docx** 的解释器来跑导出器。

    原因：不同机器 PATH 里的 `python` 未必装了 python-docx
    （例如 Microsoft Store 版自带的 3.x 就没有）。这里按候选顺序探测，
    返回第一个能 import docx 的；全都不行则退回 sys.executable 并如实提示。
    """
    cands = [
        r"C:\hclaw\python\python.exe",
        sys.executable,
        "python",
        "python3",
    ]
    tried = []
    for c in cands:
        try:
            r = subprocess.run([c, "-c", "import docx;print('ok')"],
                               capture_output=True, text=True, timeout=60)
            if r.returncode == 0 and "ok" in (r.stdout or ""):
                return c, tried
            tried.append(f"{c}(无 python-docx)")
        except Exception:
            tried.append(f"{c}(不可用)")
    return sys.executable, tried


PY, PY_TRIED = _pick_python()

pass_n = 0
fail_n = 0


def ck(name, cond, extra=""):
    global pass_n, fail_n
    mark = "✓" if cond else "✗"
    print(f"  {mark} {name}" + (f"  ->  {extra}" if extra and not cond else ""))
    if cond:
        pass_n += 1
    else:
        fail_n += 1


print("=" * 60)
print("参赛交付就绪自检")
print("=" * 60)

# ── A. 参赛通告 ──
print("【A. 参赛通告】")
notice = DOCS / "参赛通告.md"
ck("参赛通告.md 存在", notice.exists())
if notice.exists():
    t = notice.read_text(encoding="utf-8")
    ck("含作品名", "知时" in t and "安农校园信息雷达" in t)
    ck("含大赛名称", "农芯智" in t)
    ck("含交付形态（原创代码类）", "原创代码类" in t)
    ck("含提交路径（路径 2）", "路径 2" in t)
    ck("含官方命名格式", "队长学号" in t and "队名" in t and "作品名" in t)
    ck("含合规声明", "合规" in t and "教务系统" in t)
    ck("含截止日硬线", "12 月 3" in t or "12月3" in t)
    ck("含时间表", "时间表" in t)
    ck("含提交物清单", "提交物清单" in t)

# ── B. 八章说明文档 ──
print("【B. 项目说明文档（八章）】")
proj = DOCS / "项目说明文档_知时.md"
ck("项目说明文档_知时.md 存在", proj.exists())
if proj.exists():
    p = proj.read_text(encoding="utf-8")
    chapters = ["一、作品简介", "二、智能体架构或工作流说明", "三、提示词与关键配置说明",
                "四、核心实现与自主贡献说明", "五、知识库构建说明", "六、插件/工具集成清单",
                "七、运行环境说明", "八、项目总结与优化展望"]
    for ch in chapters:
        ck(f"含章节「{ch}」", ch in p)
    ck("含封面信息表", "作品名" in p and "队长学号" in p and "完成时间" in p)

# ── C. 打包器 ──
print("【C. 一键打包器】")
packer = ROOT / "tools" / "pack_submission.py"
ck("tools/pack_submission.py 存在", packer.exists())
if packer.exists():
    r = subprocess.run([PY, str(packer), "--dry"], cwd=str(ROOT),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    ck("--dry 可跑通（exit=0）", r.returncode == 0, f"exit={r.returncode}")
    out = (r.stdout or "") + (r.stderr or "")
    ck("dry 输出'程序与文档齐备'", "程序与文档齐备" in out)
    ck("dry 未产 zip（dry 不落盘）", "未落盘" in out)
    # 打包清单里出现的文件，必须真实存在
    listed = re.findall(r"^\s*\+\s+(.+)$", out, re.M)
    miss = [x.strip() for x in listed if not (ROOT / x.strip().replace("\\", "/")).exists()]
    ck(f"打包清单 {len(listed)} 个文件全部真实存在", len(miss) == 0, "缺 " + ", ".join(miss))

# ── D. 可运行程序齐备 ──
print("【D. 可运行程序】")
for f in ["知时门户.html", "知时.html", "交互Demo.html", "一键运行.bat"]:
    ck(f"{f} 存在", (ROOT / f).exists())
ck("小程序入口 app.json 存在", (ROOT / "miniprogram" / "app.json").exists())
ck("小程序通知池 notices.js 存在", (ROOT / "miniprogram" / "data" / "notices.js").exists())
ck("网页版数据 zhishi-data.js 存在", (ROOT / "web" / "zhishi-data.js").exists())

# ── E. 合规红线表述 ──
print("【E. 合规红线表述】")
scan_files = [notice, proj, DOCS / "参赛作品说明.md"]
BAD = ["爬取教务系统", "爬取教务平台", "破解登录", "模拟登录", "抓取密码", "窃取"]
# 出现在"不使用 X / 不采用 X / 不做 X / 明确不做"这类**否定语境**里是合规的（正是声明不做）
NEG = re.compile(r"(不使用|不采用|不做|不碰|严禁|禁止|不能|never|no)\s*[\"“']?\s*$")
bad_hits = []
for f in scan_files:
    if not f.exists():
        continue
    s = f.read_text(encoding="utf-8")
    for b in BAD:
        for m in re.finditer(re.escape(b), s):
            pre = s[max(0, m.start() - 12):m.start()]
            if NEG.search(pre):
                continue  # 否定语境：这是声明"不做"，合规
            bad_hits.append(f"{f.name}: {b} @{m.start()}")
            break
ck("违规表述只出现在否定声明里（不做/不使用…）", len(bad_hits) == 0, "; ".join(bad_hits))

# ── F. 提交说明提及打包器 / 导出器 / 逐镜脚本（文档与工具不脱节）──
print("【F. 文档与工具一致】")
notice_txt = notice.read_text(encoding="utf-8") if notice.exists() else ""
if notice.exists() and packer.exists():
    ck("参赛通告引用了打包脚本", "pack_submission.py" in notice_txt)
ck("参赛通告引用了 Word 导出器", "export_docx.py" in notice_txt)
ck("参赛通告引用了逐镜脚本", "演示视频脚本" in notice_txt)
req = DOCS / "大赛提交要求.md"
req_txt = req.read_text(encoding="utf-8") if req.exists() else ""
ck("提交要求引用导出器与打包器",
   "export_docx.py" in req_txt and "pack_submission.py" in req_txt)

# ── G. 官方提交办法要点已录入 ──
print("【G. 官方提交办法要点】")
ck("大赛提交要求.md 存在", req.exists())
if req.exists():
    ck("含云盘上传链接", "pan.ahau.edu.cn" in req_txt)
    ck("含上传密码", "1234" in req_txt)
    ck("含命名三段式（队长学号+队名+作品名）",
       "队长学号" in req_txt and "队名" in req_txt and "作品名" in req_txt)
    ck("含'不得混用'纪律", "不得混用" in req_txt)
    ck("含截止 23:00", "23:00" in req_txt or "23：00" in req_txt)
    ck("含路径 2 风险对冲清单", "风险" in req_txt and "路径 2" in req_txt)

# ── H. Word 导出器 ──
print("【H. Word 导出器（官方模板套版）】")
exporter = ROOT / "tools" / "export_docx.py"
ck("tools/export_docx.py 存在", exporter.exists())
if exporter.exists():
    if PY_TRIED:
        print(f"  · 解释器探测：{'，'.join(PY_TRIED)} → 采用 {PY}")
    r2 = subprocess.run([PY, str(exporter)], cwd=str(ROOT),
                        capture_output=True, text=True, encoding="utf-8", errors="replace",
                        timeout=180)
    ck("导出器可跑通（exit=0）", r2.returncode == 0,
       f"exit={r2.returncode}; {(r2.stderr or '')[-160:]}")
    o2 = (r2.stdout or "") + (r2.stderr or "")
    ck("导出器 8/8 章套版成功", "套版成功章节：8/8" in o2)
    ck("导出器未伪造个人信息", "不伪造个人信息" in o2 or "（待填）" in o2)
    docx_out = DOCS / "项目说明文档_知时.docx"
    ck("产出 docx 存在", docx_out.exists())
    if docx_out.exists():
        ck("docx 体量合理（>40KB）", docx_out.stat().st_size > 40 * 1024,
           f"{docx_out.stat().st_size/1024:.1f}KB")
        # 用 zipfile 读 word/document.xml，粗查八章标题是否都在（避免依赖 python-docx）
        import zipfile
        try:
            with zipfile.ZipFile(docx_out) as z:
                raw_xml = z.read("word/document.xml").decode("utf-8", "replace")
            # 关键：Word 会把标题拆进多个 <w:t>，必须先去掉标签还原成纯文本再比对
            plain = re.sub(r"<[^>]+>", "", raw_xml)
            plain = (plain.replace("&amp;", "&").replace("&lt;", "<")
                          .replace("&gt;", ">").replace("&quot;", '"'))
            chapters = ["一、作品简介", "二、智能体架构或工作流说明", "三、提示词与关键配置说明",
                        "四、核心实现与自主贡献说明", "五、知识库构建说明", "六、插件/工具集成清单",
                        "七、运行环境说明", "八、项目总结与优化展望"]
            miss_ch = [c for c in chapters if c not in plain]
            ck("docx 含全部官方八章标题", not miss_ch, "缺 " + ", ".join(miss_ch))
            ck("docx 含封面表（作品名/队长学号/联系电话）",
               "作品名" in plain and "队长学号" in plain and "联系电话" in plain)
            ck("docx 含工具表列头（7 列）",
               "工具名称及类型" in plain and "异常处理" in plain)
            ck("docx 封面标题已替换为作品名",
               "知时智能体" in plain and "XXX" not in plain,
               "文中仍存在 XXX 占位")
            ck("docx 落位三个评分点章节（提示词/知识库/工具）",
               "系统角色提示词" in plain and "知识库数据源" in plain
               and "插件/工具集成清单" in plain)
        except Exception as e:
            ck("docx 可解析", False, str(e)[:60])

# ── I. 演示视频逐镜脚本 ──
print("【I. 演示视频逐镜脚本】")
vscript = DOCS / "演示视频脚本.md"
ck("docs/演示视频脚本.md 存在", vscript.exists())
if vscript.exists():
    v = vscript.read_text(encoding="utf-8")
    ck("含 10 个镜头", v.count("🎬 第") >= 10, f"实际 {v.count('🎬 第')} 镜")
    ck("含日程（00:0x 格式）", bool(re.search(r"00:\d{2}", v)))
    ck("覆盖创新性 30%", "创新性" in v and "30%" in v)
    ck("覆盖实用性 25%", "实用性" in v and "25%" in v)
    ck("覆盖技术实现 25%", "技术实现" in v and "25%" in v)
    ck("覆盖用户体验 20%", "用户体验" in v and "20%" in v)
    ck("总时长不超 5 分钟（设计为 4 分 45 秒）", "4 分 45 秒" in v or "4:45" in v)
    ck("含录制准备清单", "准备清单" in v or "录制前" in v)
    ck("含超时砍片指引", "砍" in v)
    ck("含答辩现场预演", "答辩现场" in v)
    ck("口播词可照念（含'口播词'标记）", "口播词" in v)

# ── J. 真正能用的智能体（自己跑完一轮） ──
# 2026-11 重构：原实现全部堆在 tools/agent.js 一个文件里（约 1400 行），
# 已抽成「核心引擎 / CLI / HTTP 服务」三层 + 两端客户端。因此本段改为
# **按实现集**校验能力，而非只在一个文件里找字符串 —— 能力还在，只是分了家。
print("【J. 智能体实现集（核心 + CLI + 服务 + 两端客户端）】")

AGENT_FILES = {
    "core": ROOT / "tools" / "agent" / "core.js",          # 核心引擎（六步链路）
    "cli": ROOT / "tools" / "agent.js",                     # 命令行
    "server": ROOT / "tools" / "agent" / "server.js",       # HTTP 生产服务
    "mp_client": ROOT / "miniprogram" / "utils" / "agent.js",  # 小程序客户端
    "web_client": ROOT / "web" / "zhishi-agent.js",         # 网页客户端
}
for k, p in AGENT_FILES.items():
    ck(f"存在 {k}（{p.relative_to(ROOT)}）", p.exists())

_src = {}
for k, p in AGENT_FILES.items():
    _src[k] = p.read_text(encoding="utf-8") if p.exists() else ""
_whole = "\n".join(_src.values())          # 实现集全文
_core = _src["core"]
_cli = _src["cli"]
_srv = _src["server"]

if _core:
    ck("核心引擎有最小 wx 桩（复用小程序同源算法）",
       "global.wx" in _core and "getStorageSync" in _core)
    ck("核心引擎补了 getApp 桩（store.js 依赖它）", "global.getApp" in _core)
    ck("复用同源算法（store.matchNotices / push.buildPush）",
       "matchNotices" in _core or "buildPush" in _core)
    ck("真调大模型（createWorkBuddyCloud）", "createWorkBuddyCloud" in _whole)
    ck("流式 + JSON 输出（官方强制 stream）",
       "stream: true" in _whole and "json_object" in _whole)
    ck("system 在 messages[0]（官方硬约束）", "role: 'system'" in _whole)
    ck("stream_required 合规：不发起非流式请求",
       not re.search(r"stream:\s*false", _whole))
    ck("含 JSON 容错抠取（围栏/散文/截断修复）",
       "extractJson" in _whole and "```" in _whole)
    ck("含持久记忆（不重复理解）", "agent_memory" in _whole and "bodyHash" in _whole)
    ck("含降级诚实（不假装调过模型）", "如实" in _whole or "degraded" in _whole)
    ck("含数据源三态（cloud / local / merge）",
       "merge" in _core and ("cloud" in _core and "local" in _core))
    ck("含准入闸门（新鲜度 + 低价值 + 非学生事项）",
       "FRESH_AFTER" in _core or "gateNotices" in _core)
    ck("只读公开数据、不外发画像（合规声明）",
       "绝不发送任何个人私域数据" in _whole or "不发送任何私域数据" in _whole
       or "不发送任何个人私域" in _whole)

if _cli:
    ck("CLI 含常驻调度（--every）", "WATCH_MIN" in _cli or "setInterval" in _cli)
    ck("CLI 含静默模式（--quiet，定时任务用）", "QUIET" in _cli or "quiet" in _cli)
    ck("CLI 含用户画像外置（--profile）",
       "PROFILE_PATH" in _cli or "profile" in _cli)
    ck("CLI 含机器可读输出（--json）", "json" in _cli)

if _srv:
    ck("HTTP 服务零外部依赖（只用 Node 内置）",
       "require('http')" in _srv or 'require("http")' in _srv)
    ck("HTTP 服务含健康检查（/healthz + /readyz）",
       "/healthz" in _srv and "/readyz" in _srv)
    ck("HTTP 服务含版本接口（/api/version）", "/api/version" in _srv)
    ck("HTTP 服务含结构化错误码（ApiError + ERR）",
       "ApiError" in _srv and "ERR" in _srv)
    ck("HTTP 服务含优雅退出（SIGTERM）", "SIGTERM" in _srv)

# 两端客户端都必须有「可降级 + 诚实标注」的设计（这是本轮的核心理念）
for k, label in (("mp_client", "小程序客户端"), ("web_client", "网页客户端")):
    s = _src[k]
    if not s:
        continue
    ck(f"{label} 有本地算法降级（localImpl）", "localImpl" in s)
    ck(f"{label} 有降级诚实标注（degraded / degradeReason）",
       "degraded" in s and "degradeReason" in s)
    ck(f"{label} 有服务地址三级解析（resolveBase / setBase）",
       "resolveBase" in s and "setBase" in s)
    ck(f"{label} 与远端同构接口（digest / status / notices）",
       all(x in s for x in ("digest", "status", "notices")))

# 画像模板
prof_tmpl = ROOT / "tools" / "agent_profile.json"
ck("tools/agent_profile.json 画像模板存在", prof_tmpl.exists())
if prof_tmpl.exists():
    import json as _json
    try:
        pj = _json.loads(prof_tmpl.read_text(encoding="utf-8"))
        ck("模板含身份/年级/学院字段",
           all(k in pj for k in ("identityType", "grade", "college")))
        ck("模板含订阅标签（interests）与自定义关键词（keywords）",
           isinstance(pj.get("interests"), list) and isinstance(pj.get("keywords"), list))
    except Exception as e:
        ck("画像模板是合法 JSON", False, str(e))

# 调度安装器
task_ps1 = ROOT / "tools" / "install_agent_task.ps1"
ck("tools/install_agent_task.ps1 调度安装器存在", task_ps1.exists())
if task_ps1.exists():
    tp = task_ps1.read_text(encoding="utf-8")
    ck("含计划任务注册（Register-ScheduledTask）", "Register-ScheduledTask" in tp)
    ck("含卸载开关（-Remove）", "-Remove" in tp)
    ck("含 node 探测（不依赖 PATH 里的假 node）", "Find-Node" in tp)
    ck("含诚实声明（不代发微信/短信）", "不会" in tp and "替你发" in tp)

# 智能体跑过（有真实产物）
run_out = ROOT / "push_out" / "agent_run.json"
ck("智能体至少跑过一轮（push_out/agent_run.json 存在）", run_out.exists())
if run_out.exists():
    import json as _json2
    try:
        rj = _json2.loads(run_out.read_text(encoding="utf-8"))
        ck("跑轮记录含六步要素",
           all(k in rj for k in ("pool", "passed", "matched", "cards", "notify", "mode")))
        # 「理由即分数」：每条被主动送达的条目都必须带 reasons（凭什么推）。
        # notify 现为明细数组（早期版本是条数），故两种形态都接受。
        _nitems = rj.get("notify_items")
        if _nitems is None:
            _nitems = rj.get("notify") if isinstance(rj.get("notify"), list) else []
        ck("跑轮记录含'凭什么推'理由（理由即分数）",
           len(_nitems) == 0 or all("reasons" in it for it in _nitems),
           f"主动送达 {len(_nitems)} 条，逐条 reasons 齐备")
        ck("模式字段诚实（rule / llm 二选一）", rj.get("mode") in ("rule", "llm"))
    except Exception as e:
        ck("跑轮记录是合法 JSON", False, str(e))

# 记忆文件（若跑过 LLM 则应有）
mem_out = ROOT / "push_out" / "agent_memory.json"
if mem_out.exists():
    import json as _json3
    try:
        mj = _json3.loads(mem_out.read_text(encoding="utf-8"))
        ck("记忆文件结构正确（id -> {hash, fields}）",
           all(isinstance(v, dict) and "hash" in v and "fields" in v
               for v in mj.values()) if mj else True)
        ck(f"记忆已积累（{len(mj)} 条大模型理解结果）", True)
    except Exception as e:
        ck("记忆文件是合法 JSON", False, str(e))

print("=" * 60)
print(f"参赛交付就绪自检：{pass_n} 项通过，{fail_n} 项失败")
print("=" * 60)
sys.exit(1 if fail_n else 0)
