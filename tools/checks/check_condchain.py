# -*- coding: utf-8 -*-
"""WXML if/elif/else 链合法性检查（按标签嵌套层级真判定）

规则（微信小程序编译器要求）：
  同一父节点下，wx:elif / wx:else 必须紧跟在紧邻的同层级 wx:if / wx:elif 元素之后。
  中间不能隔着其他元素（注释与空白可以忽略）。
  跨过闭合标签（</block> / </view>）去接 wx:else => 断裂，非法。
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "知时小程序-拖入即可运行"

TAG_RE = re.compile(r"<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>", re.S)
COND_RE = re.compile(r"\bwx:(if|elif|else)\b")

VOID = {"image", "input", "icon", "progress", "import", "include", "wxs", "slot"}


def strip_comments(s):
    return re.sub(r"<!--.*?-->", "", s, flags=re.S)


def tokens(s):
    """产出 ('open'|'close'|'self', tag, attrs_text, pos)"""
    for m in TAG_RE.finditer(s):
        closing, tag, attrs, selfclose = m.groups()
        tag = tag.lower()
        if closing:
            yield ("close", tag, attrs, m.start())
        elif selfclose or tag in VOID:
            yield ("self", tag, attrs, m.start())
        else:
            yield ("open", tag, attrs, m.start())


def check_file(path):
    raw = path.read_text(encoding="utf-8")
    s = strip_comments(raw)
    problems = []

    # 记录每个元素的父节点标识
    stack = []            # 上层元素 id
    last_child = {}       # parent_id -> (cond_kind, cond_value, elem_id, tag)
    elem_id = 0

    for kind, tag, attrs, pos in tokens(s):
        if kind == "close":
            if stack:
                stack.pop()
            continue

        parent_id = stack[-1] if stack else "ROOT"
        m = COND_RE.search(attrs)
        cond = m.group(1) if m else None

        if cond in ("elif", "else"):
            prev = last_child.get(parent_id)
            if not prev or prev[0] not in ("if", "elif"):
                line = s.count("\n", 0, pos) + 1
                problems.append(
                    f"L{line}: wx:{cond} 前一个同层级兄弟不是 wx:if/wx:elif"
                    f"（实际: {'无' if not prev else 'wx:' + prev[0]}）"
                )
            elif cond == "elif" and prev[0] == "else":
                line = s.count("\n", 0, pos) + 1
                problems.append(f"L{line}: wx:elif 出现在 wx:else 之后")

        # 记录本元素（若它带条件）
        elem_id += 1
        if cond:
            last_child[parent_id] = (cond, None, elem_id, tag, attrs)
        else:
            # 遇到无条件的普通元素时，不打断链（注释/空白已剥离）；
            # 但链只对「带 cond 的兄弟」有效，普通元素会重置链
            last_child[parent_id] = ("plain", None, elem_id, tag, attrs)

        if kind == "open":
            stack.append(elem_id)

    return problems


def main():
    targets = sorted(ROOT.rglob("pages/**/*.wxml")) + sorted(ROOT.glob("*.wxml"))
    targets = [f for f in targets if f.is_file()]
    total = 0
    print("=" * 68)
    print("WXML if/elif/else 链合法性检查")
    print("=" * 68)
    for f in targets:
        probs = check_file(f)
        rel = f.relative_to(ROOT)
        if probs:
            total += len(probs)
            print(f"[FAIL] {rel}")
            for p in probs:
                print(f"        - {p}")
        else:
            print(f"[OK  ] {rel}")
    print("=" * 68)
    if total:
        print(f"发现 {total} 处非法条件链")
        sys.exit(1)
    print("全部通过：无非法 wx:elif / wx:else 链")
    sys.exit(0)


if __name__ == "__main__":
    main()
