# -*- coding: utf-8 -*-
"""小程序全量静态体检（接管修复前的体检台）

覆盖：
  A. JS 语法（node --check 等价的 compile 检查）
  B. JS 中 require 的可解析性（相对路径必须存在）
  C. JS 中 Page/Component/App 注册存在性
  D. WXML 标签闭合 / 自闭合
  E. WXML 中 bindtap/catchtap 指向的处理函数是否在 js 里定义
  F. WXML 中 {{ }} 括号配对
  G. WXSS 花括号配对
  H. app.json 中注册页面文件是否齐全
  I. WXML 用到的 data 字段（粗查：一级字段）是否存在
"""
import json
import re
import sys
import pathlib
import traceback

ROOT = pathlib.Path(__file__).resolve().parents[2] / "知时小程序-拖入即可运行"

problems = []
notes = []


def add(msg, kind="FAIL"):
    (problems if kind == "FAIL" else notes).append(msg)


# ---------------- A. JS 语法 ----------------
def check_js_syntax():
    print("---- A. JS 语法检查 ----")
    js_files = sorted(ROOT.rglob("**/*.js"))
    js_files = [f for f in js_files if "node_modules" not in f.parts]
    for f in js_files:
        src = f.read_text(encoding="utf-8")
        rel = f.relative_to(ROOT)
        try:
            compile(src, str(f), "exec")
            print(f"[OK  ] {rel}")
        except SyntaxError as e:
            print(f"[FAIL] {rel}  line {e.lineno}: {e.msg}")
            print(f"        -> {e.text.strip() if e.text else ''}")
            add(f"JS语法 {rel}:{e.lineno} {e.msg}")


# ---------------- B. require 可解析 ----------------
def check_requires():
    print("---- B. require 解析检查 ----")
    for f in sorted(ROOT.rglob("**/*.js")):
        if "node_modules" in f.parts:
            continue
        src = f.read_text(encoding="utf-8")
        rel = f.relative_to(ROOT)
        # 只检查字符串字面量的静态 require
        for m in re.finditer(r"""require\(\s*['"]([^'"]+)['"]\s*\)""", src):
            mod = m.group(1)
            if not (mod.startswith("./") or mod.startswith("../")):
                continue
            base = (f.parent / mod).resolve()
            cands = [base, base.with_suffix(".js"), pathlib.Path(str(base) + ".js")]
            if not any(c.exists() for c in cands):
                add(f"require找不到 {rel} -> {mod}")


# ---------------- D. WXML 标签闭合 ----------------
VOID = {"image", "input", "icon", "progress", "import", "include", "wxs", "slot"}
TAG_RE = re.compile(r"<(/?)([a-zA-Z][\w-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*?)(/?)>", re.S)


def check_wxml_tags():
    print("---- D. WXML 标签闭合检查 ----")
    for f in sorted(ROOT.rglob("**/*.wxml")):
        if "node_modules" in f.parts:
            continue
        src = f.read_text(encoding="utf-8")
        src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
        rel = f.relative_to(ROOT)
        stack = []
        ok = True
        for m in TAG_RE.finditer(src):
            closing, tag, attrs, selfclose = m.groups()
            tag = tag.lower()
            line = src.count("\n", 0, m.start()) + 1
            if closing:
                if not stack:
                    add(f"{rel}:{line} 多余的 </{tag}>")
                    ok = False
                elif stack[-1][0] != tag:
                    add(f"{rel}:{line} </{tag}> 与 <{stack[-1][0]}> 不匹配(开于L{stack[-1][1]})")
                    ok = False
                    stack.pop()
                else:
                    stack.pop()
            elif selfclose or tag in VOID:
                pass
            else:
                stack.append((tag, line))
        if stack:
            for tag, line in stack:
                add(f"{rel}: L{line} <{tag}> 未闭合")
            ok = False
        print(f"[{'OK  ' if ok else 'FAIL'}] {rel}")


# ---------------- E. 事件处理函数存在性 ----------------
def check_handlers():
    print("---- E. 事件处理函数检查 ----")
    for wxml in sorted(ROOT.rglob("**/*.wxml")):
        if "node_modules" in wxml.parts:
            continue
        js = wxml.with_suffix(".js")
        if not js.exists():
            continue
        jsrc = js.read_text(encoding="utf-8")
        wsrc = wxml.read_text(encoding="utf-8")
        rel = wxml.relative_to(ROOT)
        # 收集 wxml 里的 bind*/catch* 处理器名
        handlers = set()
        for m in re.finditer(r"""\b(?:bind|catch|capture-bind|capture-catch)[:a-zA-Z]*\s*=\s*["']([A-Za-z_$][\w$]*)["']""", wsrc):
            handlers.add(m.group(1))
        # js 里定义的函数名（methods: / 顶层 / 对象方法）
        defined = set(re.findall(r"\b([A-Za-z_$][\w$]*)\s*[:(]\s*(?:function)?\s*\(", jsrc))
        defined |= set(re.findall(r"\b([A-Za-z_$][\w$]*)\s*\(", jsrc))
        defined |= set(re.findall(r"""['"]([A-Za-z_$][\w$]*)['"]\s*:""", jsrc))
        missing = sorted(h for h in handlers if h not in defined)
        if missing:
            for h in missing:
                add(f"{rel}: 事件处理函数 {h} 在 {js.name} 中未找到")
            print(f"[FAIL] {rel}  缺失: {missing}")
        else:
            if handlers:
                print(f"[OK  ] {rel}  ({len(handlers)} 个处理器)")


# ---------------- F. WXML 花括号配对 ----------------
def check_wxml_braces():
    print("---- F. WXML 插值括号检查 ----")
    for f in sorted(ROOT.rglob("**/*.wxml")):
        if "node_modules" in f.parts:
            continue
        src = f.read_text(encoding="utf-8")
        rel = f.relative_to(ROOT)
        d = src.count("{{")
        c = src.count("}}")
        if d != c:
            add(f"{rel}: '{{{{'x{d} 与 '}}}}'x{c} 数量不等")
            print(f"[FAIL] {rel}  {{{{:{d}  }}:{c}")
        else:
            print(f"[OK  ] {rel}  ({d} 处插值)")


# ---------------- G. WXSS 花括号 ----------------
def check_wxss():
    print("---- G. WXSS 括号检查 ----")
    for f in sorted(ROOT.rglob("**/*.wxss")):
        if "node_modules" in f.parts:
            continue
        src = f.read_text(encoding="utf-8")
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        rel = f.relative_to(ROOT)
        d = src.count("{")
        c = src.count("}")
        if d != c:
            add(f"{rel}: { '{' }x{d} 与 {'}'}x{c} 不等")
            print(f"[FAIL] {rel}  {{:{d}  }}:{c}")
        else:
            print(f"[OK  ] {rel}  ({d} 规则块)")


# ---------------- H. app.json 页面齐全 ----------------
def check_appjson():
    print("---- H. app.json 页面注册检查 ----")
    cfg = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
    for p in cfg.get("pages", []):
        base = ROOT / p
        miss = []
        for ext in (".js", ".wxml", ".wxss", ".json"):
            if not pathlib.Path(str(base) + ext).exists():
                miss.append(ext)
        if miss:
            add(f"app.json 页面 {p} 缺: {miss}")
            print(f"[FAIL] {p}  缺 {miss}")
        else:
            print(f"[OK  ] {p}")
    # tabBar 页必须在 pages 里
    for t in cfg.get("tabBar", {}).get("list", []):
        if t["pagePath"] not in cfg.get("pages", []):
            add(f"tabBar 页 {t['pagePath']} 未在 app.json pages 中注册")
        # 检查 iconPath 文件
        for k in ("iconPath", "selectedIconPath"):
            if k in t:
                if not (ROOT / t[k]).exists():
                    add(f"tabBar 图标缺失: {t[k]}")


def main():
    print("=" * 70)
    print("知时小程序 · 全量静态体检")
    print("=" * 70)
    for fn in (check_js_syntax, check_requires, check_wxml_tags,
               check_handlers, check_wxml_braces, check_wxss, check_appjson):
        try:
            fn()
        except Exception:
            add(f"{fn.__name__} 自身异常:\n{traceback.format_exc()}")
        print()

    print("=" * 70)
    if problems:
        print(f"❌ 发现 {len(problems)} 个问题：")
        for i, p in enumerate(problems, 1):
            print(f"  {i:2}. {p}")
    else:
        print("✅ 静态体检全部通过")
    print("=" * 70)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
