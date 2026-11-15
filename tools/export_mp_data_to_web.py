# -*- coding: utf-8 -*-
"""
把小程序的 notices.js 数据 + app.js 画像，导出成网页版可用的数据文件。

为什么这么做：
    "完全一致"意味着网页版和小程序必须用**同一份数据**。
    手工维护两份迟早会漂移。所以这里做一件事：
      小程序 data/notices.js  →  web/zhishi-data.js
    网页版只认这份，改数据只改小程序那一份，重跑本脚本即可。

输出结构：
    window.ZS_DATA = { NOTICES: [...], PROFILE: {...}, TAGS_META: [...] }
    注意：TAGS 词表来自 zhishi-core.js（同源），这里只导出数据。
"""
import re
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MP_NOTICES = ROOT / "miniprogram" / "data" / "notices.js"
MP_APP = ROOT / "miniprogram" / "app.js"
OUT = ROOT / "web" / "zhishi-data.js"


def extract_array_literal(src, name):
    """从 JS 源码里抠出 `const NAME = [ ... ];` 的数组字面量（按括号配对）"""
    m = re.search(r"const\s+" + name + r"\s*=\s*\[", src)
    if not m:
        raise SystemExit(f"找不到 {name} 数组")
    i = src.index("[", m.start())
    depth = 0
    in_str = None
    esc = False
    for j in range(i, len(src)):
        ch = src[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in "\"'":
            in_str = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    raise SystemExit(f"{name} 数组括号不配对")


def extract_object_literal(src, name):
    """从 JS 源码里抠出 `NAME: { ... }` 的对象字面量"""
    m = re.search(r"[\"']?" + name + r"[\"']?\s*:\s*\{", src)
    if not m:
        raise SystemExit(f"找不到 {name} 对象")
    i = src.index("{", m.start())
    depth = 0
    in_str = None
    esc = False
    for j in range(i, len(src)):
        ch = src[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in "\"'":
            in_str = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    raise SystemExit(f"{name} 对象括号不配对")


def js_obj_to_json(literal):
    """
    把 JS 对象/数组字面量转成 Python 对象。
    我们的数据是纯 JSON 子集（只有引号字符串、数字、null、true/false、嵌套），
    所以直接当 JSON 解析即可 —— 但键可能不带引号，需要补上。
    """
    s = literal
    # 去掉 JS 注释（/* ... */ 和行首 // ...）—— 通知数据块的首尾可能带说明注释
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"(?m)^\s*//.*$", "", s)
    # 给裸键补引号： { id: "x" }  →  { "id": "x" }
    s = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', s)
    # 单引号 → 双引号（数据里应该没有，稳妥起见）
    s = re.sub(r"'([^'\\]*)'", r'"\1"', s)
    # 去掉 JS 尾随逗号： [1,2,] 或 {a:1,}
    s = re.sub(r",(\s*[\]}])", r"\1", s)
    return json.loads(s)


def build_meta(notices):
    """从数据里现算"数据总览"元信息（单位/标签/年份分布、真实/演示拆分）。
    不读外部文件，保证网页版看到的分布一定与通知池本身一致，不会漂移。"""
    from collections import Counter
    real = [n for n in notices if n.get("real")]
    demo = [n for n in notices if not n.get("real")]
    unit = Counter((n.get("source") or "未标注") for n in real)
    tag = Counter((n.get("event") or "校内通知") for n in real)
    year = Counter((n.get("publish") or "")[:4] or "未知" for n in real)
    linked = sum(1 for n in real if n.get("url"))
    with_ddl = sum(1 for n in real if n.get("deadline"))
    return {
        "total": len(notices),
        "real": len(real),
        "demo": len(demo),
        "linked": linked,
        "withDeadline": with_ddl,
        "unitDist": [{"k": k, "v": v} for k, v in unit.most_common()],
        "tagDist": [{"k": k, "v": v} for k, v in tag.most_common()],
        "yearDist": [{"k": k, "v": v} for k, v in sorted(year.items())],
    }


def main():
    notices_src = MP_NOTICES.read_text(encoding="utf-8")
    app_src = MP_APP.read_text(encoding="utf-8")

    arr = extract_array_literal(notices_src, "NOTICES")
    notices = js_obj_to_json(arr)

    prof = extract_object_literal(app_src, "profile")
    profile = js_obj_to_json(prof)

    meta = build_meta(notices)

    # 统计
    real_cnt = meta["real"]
    understood = sum(1 for n in notices if n.get("digestPoints"))
    print(f"读取通知 {len(notices)} 条（真实公开页 {real_cnt} 条 / 已浓缩 {understood} 条）")
    print(f"读取画像：{profile.get('grade')} · {profile.get('college')} · "
          f"关注 {len(profile.get('interests', []))} 项")
    print(f"数据总览：带链接 {meta['linked']} 条 / 有截止 {meta['withDeadline']} 条 / "
          f"来源单位 {len(meta['unitDist'])} 个")

    # 生成 web 数据文件（JSON.stringify 保真，含中文不转义）
    data_json = json.dumps(
        {"NOTICES": notices, "PROFILE": profile, "META": meta},
        ensure_ascii=False, indent=0
    )
    # JSON 不能直接放在 JS 里做对象字面量赋值？可以，JSON 是 JS 子集
    out = (
        "/**\n"
        " * 知时 · 网页版数据（自动生成，请勿手改）\n"
        " * =============================================\n"
        " * 由 tools/export_mp_data_to_web.py 从 miniprogram/data/notices.js 导出。\n"
        " * 改数据请改小程序那一份，然后重跑脚本，保证网页版与小程序**完全一致**。\n"
        f" * 当前：{len(notices)} 条通知（真实 {real_cnt} 条）\n"
        " */\n"
        "window.ZS_DATA = " + data_json + ";\n"
    )
    OUT.write_text(out, encoding="utf-8")
    print(f"已写出 → {OUT}（{len(out)} 字符）")


if __name__ == "__main__":
    main()
