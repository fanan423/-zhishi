# -*- coding: utf-8 -*-
"""
由 data/notices_real.json 自动生成 web/rawdata.html
——「原始数据」页：把采集器真实抓到的公开通知原文全部摊开，
   每一条都带来源 URL、抓取时间、正文字数，供评委当场核对。

重跑采集脚本后再跑本文件，页面即自动更新（不手写数据）。
"""
import json, pathlib, html, datetime
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "notices_real.json"
OUT = ROOT / "web" / "rawdata.html"

data = json.loads(SRC.read_text(encoding="utf-8"))
items = data["items"]
generated = data["generated_at"]
count = data["count"]


def esc(s):
    return html.escape(s or "", quote=False)


def domain(u):
    try:
        return u.split("//", 1)[1].split("/", 1)[0]
    except Exception:
        return u


rows = []
for i, it in enumerate(items, 1):
    body = it.get("body", "")
    # 正文里保留换行，做一个可滚动的原文块
    body_esc = esc(body).replace("\r\n", "\n").replace("\r", "\n")
    rows.append(f"""
    <div class="item">
      <div class="ih">
        <div class="num">#{i:02d}</div>
        <div class="it">
          <div class="title">{esc(it.get('title',''))}</div>
          <div class="meta">
            <span class="mtag site">{esc(it.get('source_site',''))}</span>
            <span class="mtag">{esc(it.get('date') or '日期待解析')}</span>
            <span class="mtag">{it.get('body_len',0)} 字</span>
            <span class="mtag real">真实抓取</span>
          </div>
          <div class="url">
            <span class="ulabel">来源</span>
            <a href="{esc(it.get('url',''))}" target="_blank" rel="noopener">{esc(it.get('url',''))}</a>
          </div>
        </div>
      </div>
      <div class="rawbox"><pre>{body_esc}</pre></div>
      <div class="foot">抓取时间：{esc(it.get('fetched_at',''))}　·　采集方式：公开页 GET → 解析正文 → 入库（无登录、无鉴权）</div>
    </div>""")

rows_html = "\n".join(rows)

page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>原始数据 · 真实抓取的公开通知 | 知时</title>
<style>
  :root{{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--line:#2a2f3a;
    --text:#e8eaed;--sub:#9aa4b2;--accent:#4dd6a8;--accent2:#5b9cf8;
    --warn:#f5a524;--danger:#f2565b;--radius:14px;}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:radial-gradient(1200px 600px at 20% -10%,#1a2432 0%,var(--bg) 55%);
    color:var(--text);font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.75;min-height:100vh;padding:26px 20px 60px}}
  .wrap{{max-width:1080px;margin:0 auto}}
  h1{{font-size:20px;letter-spacing:.5px}}
  .sub{{font-size:13px;color:var(--sub);margin-top:5px}}
  .sub b{{color:var(--accent)}}

  .stat{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0 8px}}
  .st{{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
    padding:16px 18px;position:relative;overflow:hidden}}
  .st::before{{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent)}}
  .st .n{{font-size:26px;font-weight:700;color:var(--accent);line-height:1.2}}
  .st .l{{font-size:12px;color:var(--sub);margin-top:4px}}

  .sec{{margin-top:30px;font-size:12.5px;color:var(--sub);letter-spacing:2.5px;
    border-bottom:1px solid var(--line);padding-bottom:9px;display:flex;
    justify-content:space-between;align-items:flex-end}}
  .sec small{{font-size:11px;color:#5f6a78;letter-spacing:0}}

  .item{{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
    padding:18px 20px;margin-top:14px}}
  .ih{{display:flex;gap:14px;align-items:flex-start}}
  .num{{flex:0 0 auto;font-size:12px;color:var(--accent);font-weight:700;
    background:rgba(77,214,168,.1);border:1px solid rgba(77,214,168,.3);
    border-radius:8px;padding:3px 9px;margin-top:2px}}
  .it{{flex:1;min-width:0}}
  .title{{font-size:15px;font-weight:600;line-height:1.55}}
  .meta{{margin-top:8px;display:flex;flex-wrap:wrap;gap:7px}}
  .mtag{{font-size:11px;color:var(--sub);background:var(--panel2);
    border:1px solid var(--line);border-radius:20px;padding:2px 10px}}
  .mtag.site{{color:var(--accent2);border-color:rgba(91,156,248,.32)}}
  .mtag.real{{color:var(--accent);border-color:rgba(77,214,168,.32);
    background:rgba(77,214,168,.1);font-weight:600}}
  .url{{margin-top:9px;font-size:11.5px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}}
  .ulabel{{color:#5f6a78;flex:0 0 auto}}
  .url a{{color:var(--accent2);text-decoration:none;word-break:break-all}}
  .url a:hover{{text-decoration:underline}}

  .rawbox{{margin-top:12px;background:#0d1014;border:1px solid var(--line);
    border-radius:10px;max-height:260px;overflow:auto}}
  .rawbox pre{{white-space:pre-wrap;word-break:break-word;font-family:"Consolas",
    "Courier New",monospace;font-size:12.5px;color:#c8d0db;padding:14px 16px;line-height:1.7}}
  .foot{{margin-top:10px;font-size:11px;color:#5f6a78}}

  .note{{margin-top:18px;background:var(--panel2);border:1px solid var(--line);
    border-left:3px solid var(--accent);border-radius:12px;padding:16px 18px;font-size:13px}}
  .note h3{{font-size:13.5px;color:var(--accent);margin-bottom:8px;letter-spacing:.5px}}
  .note p{{color:#c8d0db;margin-bottom:8px}}
  .note p:last-child{{margin-bottom:0}}
  .note b{{color:var(--accent)}}
  .note em{{color:var(--warn);font-style:normal}}

  .back{{display:inline-block;margin-top:20px;font-size:13px;color:var(--accent);text-decoration:none}}
  .back:hover{{text-decoration:underline}}
  @media(max-width:800px){{.stat{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<div class="wrap">
  <h1>原始数据 · 真实抓取的公开通知</h1>
  <div class="sub">本页所有内容均为采集器从<b>公网公开页</b>真实抓取，未做任何改写——供当场核对</div>

  <div class="stat">
    <div class="st"><div class="n">{count}</div><div class="l">真实抓取条数</div></div>
    <div class="st"><div class="n">{sum(it.get('body_len',0) for it in items)}</div><div class="l">原文总字数</div></div>
    <div class="st"><div class="n">0</div><div class="l">涉及登录态/私域数据</div></div>
  </div>

  <div class="note">
    <h3>这些数据是怎么来的</h3>
    <p>采集脚本（<b>tools/collect_notices.py</b>）对公开通知页发起普通 GET 请求 → 用站点解析规则抠出标题/正文/日期 → 原样入库。</p>
    <p>全过程<b>不登录、不鉴权、不碰任何后台</b>——等同于"人工打开官网、把通知复制下来"的自动化，只是更快、更不会漏。</p>
    <p>数据生成时间：<b>{generated}</b>。重跑采集脚本后本页会同步更新。</p>
  </div>

  <div class="sec">逐条原文 <small>点来源链接可跳官网核对</small></div>
{rows_html}

  <div class="note" style="border-left-color:var(--warn)">
    <h3>为什么要把"原始数据"单做一页</h3>
    <p>因为"我们抓到了真实数据"这句话，<em>说出来和看得见，是两个分量</em>。</p>
    <p>这一页让评委能亲眼看到：每一条通知的<b>官网原文、来源 URL、抓取时间、正文字数</b>。不是截图、不是转述，是可以当场去官网核对的东西。</p>
    <p><b>可信度不是靠说的，是靠能查的。</b></p>
  </div>

  <a class="back" href="inspect.html">← 返回 Demo 索引</a>
</div>
</body>
</html>
"""

OUT.write_text(page, encoding="utf-8")
print(f"已生成 {OUT}")
print(f"真实数据 {count} 条，共 {len(page)} 字符")
