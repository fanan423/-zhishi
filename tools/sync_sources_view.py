# -*- coding: utf-8 -*-
"""
知时 · 把「信息来源」这一块从实装版同步到网页版
==============================================
实装版（知时_实装版.html）是母版，知时_web/index.html 是发布用的网页版，
两者 99% 相同，只差一段手机全屏样式。手工改两份必然走样，所以这里做一次
结构同步：只搬「信息来源」这一块（样式 + 视图 + 入口 + 路由），可重复执行。

跑法：
    python tools/sync_sources_view.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "知时_实装版.html"
DST = ROOT / "知时_web" / "index.html"

CSS_START = "/* ============ 信息来源 · 每个站在不在 ============ */"
CSS_END = ".srcrow .l2 i{font-style:normal;color:var(--gold-ink)}"
JS_START = "/* ================================================================\n * 视图：信息来源 · 每个站在不在"
JS_END = "function selRow(label, field, opts){"
ROUTE_ANCHOR = "  if(STATE.sub === 'push') return viewPushSettings();"
TITLE_OLD = "      : (STATE.sub==='push' ? '推送设置' : '我的档案'));"
TITLE_NEW = ("      : (STATE.sub==='push' ? '推送设置'\n"
             "      : (STATE.sub==='sources' ? '信息来源' : '我的档案')));")
CARD_ANCHOR = "不可靠的直接剔除，可疑的如实标注，全部留痕。</div></div>';"
CARD_HEAD = "  /* 信息来源：把「这些通知是从哪几个站抓的"
CARD_TAIL = "某个站连不上也不牵连其他站。</div></div>';"


def cut(html, start, end_mark, keep_end=True):
    i = html.find(start)
    if i < 0:
        return ""
    j = html.find(end_mark, i)
    if j < 0:
        return ""
    j += len(end_mark) if keep_end else 0
    return html[i:j]


def main():
    if not SRC.exists() or not DST.exists():
        print("[FATAL] 源或目标文件不存在")
        return 2
    src = SRC.read_text(encoding="utf-8")
    dst = DST.read_text(encoding="utf-8")
    changed = []

    # ---- 1. 样式 ----
    css = cut(src, CSS_START, CSS_END)
    if not css:
        print("[FATAL] 母版里找不到信息来源样式块")
        return 2
    if CSS_START not in dst:
        k = dst.find(".sec .seclink{")
        k = dst.find("\n", k) + 1
        dst = dst[:k] + "\n" + css + "\n" + dst[k:]
        changed.append("样式")

    # ---- 2. 视图函数 ----
    js = cut(src, JS_START, JS_END, keep_end=False)
    if not js:
        print("[FATAL] 母版里找不到 viewSources")
        return 2
    if JS_START not in dst:
        k = dst.find(JS_END)
        dst = dst[:k] + js + dst[k:]
        changed.append("视图函数 viewSources")

    # ---- 3. 路由 ----
    if "STATE.sub === 'sources'" not in dst:
        if ROUTE_ANCHOR not in dst:
            print("[WARN] 路由锚点没找到，跳过")
        else:
            dst = dst.replace(ROUTE_ANCHOR, ROUTE_ANCHOR + "\n  if(STATE.sub === 'sources') return viewSources();", 1)
            changed.append("路由")

    # ---- 4. 标题 ----
    if "STATE.sub==='sources' ? '信息来源'" not in dst:
        if TITLE_OLD in dst:
            dst = dst.replace(TITLE_OLD, TITLE_NEW, 1)
            changed.append("页面标题")
        else:
            print("[WARN] 标题锚点没找到，跳过")

    # ---- 5. 「我的」页入口卡片 ----
    if "APP.goSub(\\'sources\\')" not in dst:
        card = cut(src, CARD_HEAD, CARD_TAIL)
        if not card:
            print("[WARN] 母版里找不到入口卡片，跳过")
        elif CARD_ANCHOR in dst:
            i = dst.find(CARD_ANCHOR)
            j = dst.find("';", i) + 2
            dst = dst[:j] + "\n\n" + card + dst[j:]
            changed.append("我的页入口")
        else:
            print("[WARN] 入口卡片锚点没找到，跳过")

    if not changed:
        print("已是最新，无需同步")
        return 0
    DST.write_text(dst, encoding="utf-8")
    print("同步完成：" + "、".join(changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
