# -*- coding: utf-8 -*-
"""
参赛交付包一键打包器
====================
按第一届「农芯智」AI 智能体创新大赛《作品提交说明》的命名与内容要求，
把一个**完整可运行的程序 + 参赛通告 + 项目说明文档**打成 zip。

命名格式（官方硬约束）：
    队长学号 + 队名 + 作品名 + 演示视频 / 项目说明文档 / 访问入口

用法：
    # 1) 先看会打哪些东西（不落盘），并给出缺件提示
    python tools/pack_submission.py --dry

    # 2) 真打包（必须给队长学号与队名，否则无法按格式命名）
    python tools/pack_submission.py --sid 20231234 --team "知时小队"

    # 2b) 个人参赛：队名位置填个人标识即可（如"张三"或"张三-知时"）
    python tools/pack_submission.py --sid 20231234 --team "张三"

    # 3) 可选用参数
    --out  dist            # 输出目录（默认 <项目根>/dist）
    --video path\to.mp4    # 演示视频（未提供则如实标注"缺演示视频"）
    --zip                  # 额外再打一个总包 zip（默认就是 zip）

产出：
    dist/<队长学号>+<队名>+<作品名>+访问入口.zip        —— 可运行程序 + 通告 + 文档
    dist/<队长学号>+<队名>+<作品名>+项目说明文档.pdf/md  —— 说明文档（有则一并放入）
    dist/<队长学号>+<队名>+<作品名>+演示视频.mp4         —— 演示视频（--video 提供时）
    dist/提交清单.md                                     —— 本次打包的逐项清单与缺件提示

设计原则：
    * 不伪造——缺演示视频就如实写"缺"，不假装有；
    * 只打"该交的"——源码、数据、文档、可运行程序；不打 node_modules、临时文件、缓存；
    * 命名严格对齐官方格式，避免上传时手滑改错。
"""
import argparse
import datetime
import pathlib
import shutil
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORK_NAME = "知时·安农校园信息雷达"   # 作品名（用于命名，注意官方允许带·）

# ── 打包内容分两类 ───────────────────────────────────────────
# A. 可运行程序（"访问入口"）：单文件 + 小程序 + 网页版
PROGRAM_ITEMS = [
    # 两版交付：演示版（评委/录视频）与 可用版（真正能用）
    "知时_演示版.html",
    "知时_可用版.html",
    "知时_在线版.html",
    "知时门户.html",
    "知时.html",
    "交互Demo.html",
    "小程序预览.html",
    "打开总览.html",
    "打开小程序预览.html",
    "一键运行.bat",
    "一键启动_AI版.bat",
    "web",
    "miniprogram",
]
# B. 说明与通告（文档 · md 源，必须存在）
DOC_ITEMS = [
    "docs/参赛通告.md",
    "docs/项目说明文档_知时.md",
    "docs/参赛作品说明.md",
    "docs/大赛提交要求.md",
    "docs/农芯智_提交总表.md",         # 权威一页纸：官方要求↔三件套↔状态↔待办
    "docs/演示视频脚本.md",
    "docs/小程序运行说明.md",
    "docs/信息源接入与推送测试.md",
    "docs/多信息源抓取与推送验证报告.md",
    "docs/智能体接入与部署.md",
    # 本次优化新增的工程契约与举证材料
    "docs/大模型理解层_接入与验证.md",
    "docs/数据血缘与单一事实来源.md",
    "docs/两版交付说明.md",
    "docs/实用版实时AI_使用说明.md",
    "docs/在线真后端_使用说明.md",
    "docs/GitHub借鉴与优化说明.md",
    "docs/功能成熟度.md",
]
# B2. 说明文档的**导出产物**（由 tools/export_docx.py 生成；缺了不算"缺件"，
#     但会在清单里如实提示"跑导出器"——它们是可再生的，不是源材料）
DOC_EXPORTS = [
    "docs/项目说明文档_知时.docx",
    "docs/项目说明文档_知时.pdf",
]
# C. 工具与数据（可复现，选放）
TOOL_ITEMS = [
    "tools/README.md",
    "tools/export_docx.py",
    "tools/pack_submission.py",
    "tools/make_submission.py",         # 一键交互式生成官方三件套
    "一键生成_提交包.bat",              # 上面脚本的双击入口
    # ── 智能体实现集（核心引擎 / CLI / HTTP 服务 / 两端客户端）──
    "tools/agent.js",
    "tools/agent",                     # core.js + server.js + prompt.js + 回流器（目录整体带走）
    "tools/agent_profile.json",
    "tools/install_agent_task.ps1",
    "tools/sync_promo_kpi.js",
    "tools/build_presentation.js",
    "tools/build_usable.js",
    "tools/build_online.js",           # 在线真后端构建器（独立产物，不污染前两版）
    "tools/build_two_versions.js",     # 两版通用命名 zip 打包器
    "tools/lib",                       # zip_writer.js（纯 Node 零依赖 ZIP 写入器）
    "tools/checks",                    # 全量自检 + 两版 zip 交叉守卫（可复跑举证）
    "config/cloud.example.json",       # 只带模板，不带 cloud.local.json
    "config/cloud.service.json",       # 在线真后端公开配置（endpoint / publishableKey，无密钥）
    "config/llm.example.json",         # 自备模型配置模板（不带 llm.local.json）
    "CHANGELOG.md",
    "README.md",
    ".gitignore",
    "data",
]

# 明确排除（就算在目录里也不打）
EXCLUDE_DIRS = {"node_modules", "__pycache__", ".git", "push_out", "dist", "_archive",
                "_原始材料", "_extract", "_backups"}
EXCLUDE_SUFFIX = {".pyc", ".log", ".zip", ".tmp"}
EXCLUDE_NAMES = {
    "push_state.json", "_tmpl.docx",
    # 真实凭证：只分发 example 模板，绝不进提交包
    "cloud.local.json",
    "llm.local.json",
    # 本地诊断/评估留痕，不进提交包
    "_probe.js", "_probe2.js", "_probe3.js", "_probe4.js", "_probe5.js",
    "_probe6.js", "_probe7.js", "_diag.js",
    # 本地自检留痕日志（.log 已由 EXCLUDE_SUFFIX 排除，此处再明确一次）
    "_接管_checks.log", "_checks_final.log", "_checks_v5.log",
    # 内部评估材料（含未对外表述的风险判断）
    "项目评估报告_2026-11-15.md",
    "扣分点优化复核_2026-11-15.md",
}


def human(nbytes):
    for unit in ("B", "KB", "MB", "GB"):
        if nbytes < 1024:
            return f"{nbytes:.1f}{unit}"
        nbytes /= 1024
    return f"{nbytes:.1f}TB"


def iter_files(base: pathlib.Path):
    """列出一个目录下要打包的所有文件（已排除）。"""
    out = []
    for p in base.rglob("*"):
        if not p.is_file():
            continue
        rel_parts = set(p.relative_to(base).parts)
        if rel_parts & EXCLUDE_DIRS:
            continue
        if p.suffix.lower() in EXCLUDE_SUFFIX:
            continue
        if p.name in EXCLUDE_NAMES:
            continue
        out.append(p)
    return out


def collect():
    """收集全部要打包的 (源绝对路径, zip 内相对路径)，并报告缺件与可选产物。"""
    picked = []   # (abs, arcname)
    missing = []  # 必需项缺失
    optional_absent = []  # 可选产物缺失（可再生，不算缺件）
    for group in (PROGRAM_ITEMS, DOC_ITEMS, TOOL_ITEMS):
        for item in group:
            p = ROOT / item
            if not p.exists():
                missing.append(item)
                continue
            if p.is_dir():
                for f in iter_files(p):
                    picked.append((f, str(pathlib.Path(item) / f.relative_to(p))))
            else:
                picked.append((p, item))
    for item in DOC_EXPORTS:
        p = ROOT / item
        if p.exists():
            picked.append((p, item))
        else:
            optional_absent.append(item)
    return picked, missing, optional_absent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", default="", help="队长学号")
    ap.add_argument("--team", default="", help="队名")
    ap.add_argument("--out", default="dist", help="输出目录（默认 dist）")
    ap.add_argument("--video", default="", help="演示视频路径（可选）")
    ap.add_argument("--dry", action="store_true", help="只列出清单，不落盘")
    args = ap.parse_args()

    picked, missing, optional_absent = collect()
    total = sum(f.stat().st_size for f, _ in picked)

    print("=" * 62)
    print("参赛交付包打包器 · 知时 · 安农校园信息雷达")
    print("=" * 62)
    print(f"作品名    ：{WORK_NAME}")
    print(f"队长学号  ：{args.sid or '（未提供 → 无法按官方格式命名）'}")
    print(f"队名      ：{args.team or '（未提供 → 无法按官方格式命名）'}")
    print(f"打包文件数：{len(picked)} 个，合计 {human(total)}")
    print("-" * 62)
    print("将打入的文件：")
    for _, arc in sorted(picked):
        print("  +", arc)
    if missing:
        print("-" * 62)
        print(f"⚠ 缺件（{len(missing)} 项，如实列出，不伪造）：")
        for m in missing:
            print("  -", m)
    else:
        print("-" * 62)
        print("✅ 程序与文档齐备")
    if optional_absent:
        print("-" * 62)
        print(f"ℹ 可选导出件（{len(optional_absent)} 项；官方允许 docx 或 pdf 二选一，不算缺件）：")
        for m in optional_absent:
            print("  ·", m)
        print("  → 当前已交付 docx；如需 PDF，用 Word/WPS 打开 docx 后另存为 PDF。")

    if args.dry:
        print("=" * 62)
        print("（--dry 模式：未落盘。加 --sid 与 --team 真打包。）")
        return 0

    if not args.sid or not args.team:
        print("=" * 62)
        print("❌ 缺少 --sid（队长学号）或 --team（队名），无法按官方命名格式产出。")
        print("   用法：python tools/pack_submission.py --sid 20231234 --team \"知时小队\"")
        return 2

    prefix = f"{args.sid}+{args.team}+{WORK_NAME}"
    outdir = ROOT / args.out
    outdir.mkdir(exist_ok=True)

    # ── 1) 可运行程序 + 文档 → 主 zip（命名：+访问入口）──
    zip_name = f"{prefix}+访问入口.zip"
    zip_path = outdir / zip_name
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in picked:
            z.write(src, arc)
        # 附一份本次打包清单进去
    print("-" * 62)
    print(f"[OK] 已打主包：{zip_name}  （{human(zip_path.stat().st_size)}）")

    # ── 2) 说明文档：优先按官方格式命名的那一份，其次通用名 ──
    doc_candidates = [
        ROOT / "docs" / f"{prefix}+项目说明文档.docx",
        ROOT / "docs" / f"{prefix}+项目说明文档.pdf",
        ROOT / "docs" / "项目说明文档_知时.docx",
        ROOT / "docs" / "项目说明文档_知时.pdf",
    ]
    doc_note = ("（未发现导出的 Word/PDF 说明文档；请先跑 "
                "`python tools/export_docx.py --pdf` 再打包）")
    doc_found = []
    seen_suffix = set()   # 同名同格式只取一次：优先官方命名版，避免重复复制成 DOCX + DOCX
    for cand in doc_candidates:
        if cand.exists() and cand.suffix not in seen_suffix:
            dst = outdir / f"{prefix}+项目说明文档{cand.suffix}"
            shutil.copy2(cand, dst)
            print(f"[OK] 已复制说明文档：{dst.name}  （{human(dst.stat().st_size)}）")
            doc_found.append(dst.suffix)
            seen_suffix.add(cand.suffix)
            doc_note = ""
    if doc_found:
        print(f"[i] 本作品说明文档交付格式：{' + '.join(s.lstrip('.').upper() for s in doc_found)}")
    if doc_note:
        print("[!] " + doc_note)

    # ── 3) 演示视频（可选）──
    vid_note = ("（未提供演示视频；大赛要求 ≤5 分钟 MP4。"
                "录制请照 `docs/演示视频脚本.md` 逐镜脚本，跑完后用 "
                "--video <路径> 重新打包）")
    if args.video:
        vp = pathlib.Path(args.video)
        if vp.exists():
            dst = outdir / f"{prefix}+演示视频{vp.suffix or '.mp4'}"
            shutil.copy2(vp, dst)
            print(f"[OK] 已复制演示视频：{dst.name}  （{human(dst.stat().st_size)}）")
            vid_note = ""
        else:
            vid_note = f"（--video 指定的文件不存在：{args.video}）"
    if vid_note:
        print("[!] " + vid_note)

    # ── 4) 写提交清单 ──
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        "# 提交清单（自动生成）",
        "",
        f"- 作品名：{WORK_NAME}",
        f"- 队长学号：{args.sid}",
        f"- 队名：{args.team}",
        f"- 打包时间：{now}",
        f"- 命名前缀：`{prefix}`",
        "",
        "## 命名格式（官方硬约束）",
        "",
        "> 队长学号 + 队名 + 作品名 + 演示视频 / 项目说明文档 / 访问入口",
        "",
        "## 本次产出",
        "",
        f"- [x] `{zip_name}` —— 可运行程序 + 参赛通告 + 说明文档（{len(picked)} 个文件，{human(total)}）",
    ]
    if not doc_note:
        lines.append(f"- [x] `{prefix}+项目说明文档.*` —— 项目说明文档（{len(doc_found)} 种格式）")
    else:
        lines.append("- [ ] `" + prefix + "+项目说明文档.docx` —— **待导出**（跑 `python tools/export_docx.py --pdf`）")
    if not vid_note:
        lines.append(f"- [x] `{prefix}+演示视频.*` —— 完整演示视频（≤5 分钟）")
    else:
        lines.append("- [ ] `" + prefix + "+演示视频.mp4` —— **待录制**（≤5 分钟 MP4，照 `docs/演示视频脚本.md` 录）")
    lines += [
        "",
        "## 上传与确认（依官方《大赛作品提交说明》原文）",
        "",
        "1. 把上面这些材料（zip / 文档 / 视频）**一并上传云盘**：",
        "   `http://pan.ahau.edu.cn/cloudservice/outerLink/decode?c3Vnb24xNzkzNTIzNTcyMTE3c3Vnb24=`",
        "   **上传密码：1234**",
        "2. 上传后在**赛事 QQ 群 934927951** 回复：**" + args.team + " + 已提交**",
        "3. 截止：**2026-12-03 23:00**，逾期视为放弃参赛",
        "4. 后续：作品初选预计 **12/10 前**；入围后准备现场答辩（PPT + 视频 + 现场作答）",
        "",
        "> ⚠️ 命名格式（官方硬约束）：`队长学号 + 队名 + 作品名 + 演示视频 / 项目说明文档 / 访问入口`",
        "> 本次命名前缀：`" + prefix + "`",
        "",
        "## 打包内容明细",
        "",
    ]
    for _, arc in sorted(picked):
        lines.append(f"- `{arc}`")
    if missing:
        lines += ["", "## 缺件（如实列出）", ""]
        for m in missing:
            lines.append(f"- [ ] `{m}`")
    if optional_absent:
        lines += ["", "## 可选导出件（官方允许 docx / pdf 二选一）", "",
                  "当前已交付 docx；如需 PDF，用 Word/WPS 打开 docx 后另存为 PDF：", ""]
        for m in optional_absent:
            lines.append(f"- [ ] `{m}`")
    (outdir / "提交清单.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[OK] 已写提交清单：提交清单.md")

    print("=" * 62)
    print(f"产出目录：{outdir}")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
