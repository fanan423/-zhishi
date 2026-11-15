"""
入口结构检查 —— 针对**当前真实入口**。

历史说明：
  早期版本有一个「流水线演示页」web/index.html（v0），本脚本原本检查它。
  该页已被 web/overview.html + 根目录「知时.html」取代。

  为了不留下"无人维护的假绿灯/假红灯"，这里改为检查当前真实入口：
    · 根目录 知时.html      —— 单文件可运行应用（主入口）
    · web/zhishi-data.js     —— 同源数据
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

errors = []
warns = []


def read(p):
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        errors.append(f"无法读取 {p.name}: {e}")
        return ""


app_html = read(ROOT / "知时.html")
data_js = read(ROOT / "web" / "zhishi-data.js")

# 1. 主入口必须是完整、零依赖的单文件
for tag in ["<!DOCTYPE html>", "</html>", "<script", "</script>", "<style", "</style>"]:
    if tag not in app_html:
        errors.append(f"知时.html 缺少结构: {tag}")
if app_html.count("<script") != app_html.count("</script>"):
    errors.append("知时.html script 标签不配对")
if re.search(r"<script[^>]+src=", app_html) or re.search(r"<link[^>]+stylesheet", app_html):
    errors.append("知时.html 含外部资源（应真单文件、零依赖）")
if 'charset="UTF-8"' not in app_html:
    errors.append("知时.html 缺 UTF-8 声明")

# 2. 六项能力在入口里必须都有落点
caps = {
    "① 自主完善档案": ["保存我的档案", "inMajor"],
    "② 按档案自动推送": ["自动推送", "与我有关"],
    "③ 自动整合信息": ["一句话总结", "知时指数"],
    "④ 贴明出处": ["原文出处", "可核对原文"],
    "⑤ 主动推送引擎": ["pushScore", "推送设置", "打扰策略"],
    "⑥ 自查自纠": ["出处可举证", "链接不伪造", "引文可定位"],
}
for name, needles in caps.items():
    miss = [n for n in needles if n not in app_html]
    if miss:
        errors.append(f"知时.html 缺能力[{name}]标记: {miss}")

# 3. 入口内联数据必须与同源数据一致（同源不变式）
ID_RE = re.compile(r"""["']?id["']?\s*:\s*["']((?:t2026|real)-[0-9A-Za-z\-]+)["']""")
inline_ids = set(ID_RE.findall(app_html))
src_ids = set(ID_RE.findall(data_js))
print(f"[数据条数] 入口内联 {len(inline_ids)} 条 / 同源数据 {len(src_ids)} 条")
if len(inline_ids) < 6:
    warns.append(f"入口内联通知条数偏少({len(inline_ids)})")
if src_ids and inline_ids != src_ids:
    errors.append(
        f"入口内联数据与 web/zhishi-data.js 不一致（入口 {len(inline_ids)} / 源 {len(src_ids)}）")

# 4. 敏感表述红线
sensitive = ["爬取教务系统", "爬取教务平台", "教务系统爬", "破解", "登录教务后台"]
for s in sensitive:
    if s in app_html:
        errors.append(f"出现敏感表述: {s}")

# 5. 合规声明
if "ahau.edu.cn" not in app_html:
    errors.append("知时.html 缺少安农官网域名说明")
if "公网公开" not in app_html and "公开通知" not in app_html:
    errors.append("知时.html 缺少合规说明")

print("\n[检查结果]")
if errors:
    print("❌ 错误:")
    for e in errors:
        print("  -", e)
else:
    print("✅ 当前入口结构完整，无致命错误")

if warns:
    print("⚠ 提示:")
    for w in warns:
        print("  -", w)

sys.exit(1 if errors else 0)
