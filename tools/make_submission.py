# -*- coding: utf-8 -*-
"""
一键生成官方提交包 · 知时 · 安农校园信息雷达
============================================
交互式收集 4 项实名信息 + 演示视频路径，然后自动完成：
  1) tools/export_docx.py   —— 官方模板套版导出带实名信息的说明文档
  2) tools/pack_submission.py —— 按官方命名格式打三件套 + 提交清单

官方硬约束（docs/大赛提交要求.md）：
  命名 = 队长学号 + 队名 + 作品名 + 类别（用 + 连接）
  三件套 = 项目说明文档.docx / 演示视频.mp4 / 访问入口.zip

设计原则：缺信息就明确提示，绝不伪造实名；不联网、不改源码、可重复运行。
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORK_NAME = "知时·安农校园信息雷达"


def ask(prompt, default=""):
    """读取一行输入；留空时返回 default。"""
    try:
        raw = input(prompt).strip()
    except EOFError:
        raw = ""
    return raw or default


def main():
    print("=" * 64)
    print("一键生成官方提交包 · " + WORK_NAME)
    print("=" * 64)
    print("按提示填入 4 项实名信息与演示视频路径；留空可跳过（但会标注缺件）。")
    print("三件套命名格式：<学号>+<标识>+" + WORK_NAME + "+<类别>")
    print("-" * 64)

    sid = ask("① 队长学号（个人参赛填本人学号）      ： ")
    team = ask("② 队名 / 个人标识（群内回复也用这个）  ： ")
    name = ask("③ 姓名（封面『队长』行）              ： ")
    phone = ask("④ 联系电话                            ： ")
    video = ask("⑤ 演示视频路径（MP4，≤5分钟；可留空） ： ")

    print("-" * 64)
    if not sid or not team:
        print("[!] 学号或标识为空——无法按官方硬约束命名，打包器将拒绝产出官方命名文件。")
        print("    官方格式：队长学号+队名+作品名+类别。请至少补齐学号与标识后重跑。")
    if not name or not phone:
        print("[!] 姓名或电话为空——说明文档封面将以「（待填）」占位，不伪造个人信息。")
    if not video:
        print("[!] 未提供视频路径——三件套中的『演示视频.mp4』将标为待补，请录制后用 --video 重打。")
    else:
        vp = pathlib.Path(video.strip().strip('"'))
        if not vp.is_absolute():
            vp = ROOT / vp
        video = str(vp)
        if not vp.exists():
            print(f"[!] 视频文件不存在：{vp}  —— 将按未提供处理。")
            video = ""

    print("-" * 64)
    print("即将执行：")
    print("  1) 导出带实名信息的说明文档（docx）")
    print("  2) 按官方命名打三件套 + 提交清单")
    print("-" * 64)

    py = sys.executable
    export = ROOT / "tools" / "export_docx.py"
    pack = ROOT / "tools" / "pack_submission.py"

    cmd_export = [py, str(export)]
    if sid:
        cmd_export += ["--sid", sid]
    if team:
        cmd_export += ["--team", team]
    if name:
        cmd_export += ["--name", name]
    if phone:
        cmd_export += ["--phone", phone]

    cmd_pack = [py, str(pack)]
    if sid:
        cmd_pack += ["--sid", sid]
    if team:
        cmd_pack += ["--team", team]
    if video:
        cmd_pack += ["--video", video]

    rc1 = subprocess.run(cmd_export, cwd=str(ROOT)).returncode
    rc2 = subprocess.run(cmd_pack, cwd=str(ROOT)).returncode

    print("=" * 64)
    if rc1 == 0 and rc2 == 0 and sid and team and video:
        print("[完成] 三件套已按官方命名生成，见 dist/ 与 dist/提交清单.md")
        print("下一步：核对提交清单 → 上传云盘（密码 1234）→ 群内回复「标识 + 已提交」")
    else:
        print("[部分完成] 请按上面 [!] 提示补齐缺项后重跑本脚本；或把实名信息与视频路径发给助手代跑。")
    print("=" * 64)
    try:
        input("按回车键关闭...")
    except EOFError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
