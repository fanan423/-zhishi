# -*- coding: utf-8 -*-
"""
生成「知时 · 交互 Demo」单文件 HTML
==================================
把 web/zhishi-core.js（同源逻辑）与 web/zhishi-data.js（导出数据）内联进
一个自包含 HTML，双击即开、无需任何服务与工具。

为什么要有这个脚本：
  同源红线不能破。Demo 里的算法必须与小程序/网页版**逐字一致**，
  所以这里不是"手抄一份逻辑"，而是每次生成时**把真源文件原样读进来内联**。
  改了 zhishi-core.js 或重导了数据，重跑本脚本即可，Demo 自动跟上。

用法：
  python tools/build_demo.py
产出：
  交互Demo.html（项目根目录）
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(ROOT, "交互Demo.html")

CORE = os.path.join(WEB, "zhishi-core.js")
DATA = os.path.join(WEB, "zhishi-data.js")


def read(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return f.read()


def esc_script(js):
    """内联进 <script> 时，防止内容里的 </script> 提前闭合标签"""
    return js.replace("</script>", "<\\/script>")


def build_html(core_js, data_js):
    return HTML_TMPL.replace("/*__CORE__*/", esc_script(core_js)) \
                    .replace("/*__DATA__*/", esc_script(data_js))


HTML_TMPL = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>知时 · 交互 Demo（数字安农信息雷达）</title>
<style>
  :root{
    --bg:#0d0f13; --panel:#161a21; --panel2:#1d222b; --line:#2a303b;
    --text:#e8eaed; --sub:#95a0ae; --faint:#5f6a78;
    --ac:#2fae7a; --ac2:#4f93f0; --warn:#e09b2d; --danger:#e0545b; --amber:#d9a33a;
    --hi:#e0545b; --md:#e09b2d; --lo:#4a5464;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{height:100%;}
  body{
    background:radial-gradient(1200px 700px at 20% -10%,#16324a 0%,transparent 60%),
               radial-gradient(900px 600px at 110% 10%,#123a2c 0%,transparent 55%),
               var(--bg);
    color:var(--text);
    font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;
    padding:24px;min-height:100%;
  }
  .wrap{display:flex;gap:34px;align-items:flex-start;flex-wrap:wrap;justify-content:center;}

  /* ---------- 左侧说明 ---------- */
  .side{max-width:330px;padding-top:8px;}
  .side h1{font-size:23px;letter-spacing:.5px;margin-bottom:6px;}
  .side h1 span{color:var(--ac);}
  .side .ver{color:var(--faint);font-size:12px;margin-bottom:18px;letter-spacing:.3px;}
  .side p{color:var(--sub);font-size:13px;margin-bottom:14px;}
  .feat{list-style:none;display:flex;flex-direction:column;gap:9px;margin:14px 0 20px;}
  .feat li{display:flex;gap:9px;align-items:flex-start;color:var(--sub);font-size:12.5px;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 11px;}
  .feat li b{color:var(--text);font-weight:600;}
  .feat li i{font-style:normal;font-size:15px;line-height:1.3;}
  .tip{color:var(--faint);font-size:11.5px;border-left:2px solid var(--line);padding-left:10px;line-height:1.7;}
  .tip kbd{background:var(--panel2);border:1px solid var(--line);border-radius:4px;
    padding:1px 5px;font-size:11px;color:var(--sub);}

  /* ---------- 手机外壳 ---------- */
  .phone{
    width:390px;height:800px;background:#000;border-radius:42px;padding:11px;
    box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px #232a33 inset;
    position:relative;flex:0 0 auto;
  }
  .screen{
    width:100%;height:100%;background:#f4f7f4;border-radius:32px;overflow:hidden;
    position:relative;display:flex;flex-direction:column;color:#1c2320;
  }
  .notch{position:absolute;top:9px;left:50%;transform:translateX(-50%);
    width:120px;height:24px;background:#000;border-radius:14px;z-index:60;}

  /* 状态栏 + 导航栏 */
  .statusbar{height:30px;background:#00653e;color:#dff3e8;display:flex;align-items:center;
    justify-content:space-between;padding:0 20px;font-size:11px;flex:0 0 auto;
    padding-top:6px;}
  .navbar{background:#00653e;color:#fff;height:44px;display:flex;align-items:center;
    padding:0 14px;font-size:16px;font-weight:600;flex:0 0 auto;gap:8px;}
  .navbar .nb-sub{font-size:11px;font-weight:400;color:#b9e0cd;margin-left:auto;}

  /* 内容滚动区 */
  .body{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
    position:relative;}
  .body::-webkit-scrollbar{width:0;}

  /* tabbar */
  .tabbar{flex:0 0 auto;height:56px;background:#fff;border-top:1px solid #e6ece7;
    display:flex;box-shadow:0 -2px 12px rgba(0,0,0,.04);}
  .tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:2px;color:#93a096;font-size:10px;cursor:pointer;user-select:none;}
  .tab .ti{font-size:19px;line-height:1;}
  .tab.on{color:#00653e;font-weight:700;}
  .tab.on .ti{transform:translateY(-1px);}

  /* ---------- 通用卡片 ---------- */
  .pad{padding:12px 13px 22px;}
  .sec-k{font-size:12px;color:#7c8a80;letter-spacing:.4px;margin:4px 0 9px;
    display:flex;align-items:center;gap:7px;}
  .sec-k::before{content:"";width:3px;height:12px;background:#00653e;border-radius:2px;}
  /* 首屏收敛：展开其余 N 条 */
  .morebtn{display:block;width:100%;margin:2px 0 10px;padding:11px;border-radius:11px;
    background:#fff;border:1px dashed #cdd9d2;color:#00653e;font-size:12.5px;font-weight:600;
    cursor:pointer;text-align:center;font-family:inherit;}
  .morebtn:active{background:#f2f8f4;}

  .card{background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:12px 13px;
    margin-bottom:10px;box-shadow:0 1px 3px rgba(20,40,30,.05);position:relative;
    transition:transform .12s ease,box-shadow .12s ease,opacity .2s;}
  .card.tap{cursor:pointer;}
  .card.tap:active{transform:scale(.985);}
  .card.read{opacity:.5;filter:saturate(.6);}
  .card.hidden{display:none;}
  /* 已过期：灰化 + 斜纹底，一眼区分"这不是待办，只是可回看" */
  .card.expired{background:#f7f8f7;border-color:#e6eae7;opacity:.72;
    background-image:repeating-linear-gradient(45deg,transparent,transparent 9px,rgba(0,0,0,.016) 9px,rgba(0,0,0,.016) 18px);}
  .card.expired .ctitle{color:#5f6a64;font-weight:500;}

  .ctop{display:flex;align-items:flex-start;gap:8px;}
  .cicon{font-size:17px;line-height:1.2;flex:0 0 auto;}
  .ctitle{font-size:14px;font-weight:600;line-height:1.4;color:#182220;flex:1;}
  .cdot{width:7px;height:7px;border-radius:50%;background:var(--hi);flex:0 0 auto;margin-top:5px;}

  .cmeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px;
    font-size:11px;color:#7c8a80;}
  .tg{display:inline-flex;align-items:center;gap:3px;border-radius:6px;padding:1px 7px;
    font-size:10.5px;line-height:1.6;font-weight:600;}
  .tg.hi{background:#fdecec;color:#c0392b;}
  .tg.md{background:#fdf3e2;color:#a8761a;}
  .tg.lo{background:#eef1f0;color:#66756c;}
  .tg.ev{background:#e9f6ef;color:#1d7a55;}
  .tg.r{background:#e8f0fd;color:#2b6fc9;}
  .cd{font-weight:700;}
  .cd.hi{color:#c0392b;} .cd.md{color:#a8761a;} .cd.lo{color:#66756c;}
  .cd.exp{color:#8a958d;font-weight:600;}

  .score{margin-left:auto;font-size:10px;color:#9aa4a0;}

  /* 主次梯度 */
  .hero{background:linear-gradient(135deg,#00704a,#00563a);color:#eafff5;border-radius:16px;
    padding:14px 15px;margin-bottom:12px;box-shadow:0 6px 20px rgba(0,86,58,.28);}
  .hero.tap{cursor:pointer;transition:transform .12s ease,box-shadow .12s ease;}
  .hero.tap:active{transform:scale(.985);box-shadow:0 3px 12px rgba(0,86,58,.24);}
  .hero .hk{font-size:11px;color:#a8dcc2;letter-spacing:.5px;}
  .hero .ht{font-size:15.5px;font-weight:700;margin:6px 0 4px;line-height:1.4;}
  .hero .hm{font-size:11px;color:#b6e3cb;}
  .hero .hgo{float:right;color:#d6f2e2;font-weight:600;}

  .vsb{display:flex;align-items:center;gap:9px;margin:2px 0 11px;font-size:12px;color:#7c8a80;}
  .vsb .vsb-n{background:#e0545b;color:#fff;border-radius:20px;padding:0 7px;font-size:10.5px;
    font-weight:700;line-height:17px;}
  .vsb .lk{margin-left:auto;color:#2b6fc9;cursor:pointer;}

  /* ---------- 搜索页 ---------- */
  .searchbox{display:flex;gap:8px;padding:11px 13px 3px;}
  .searchbox input{flex:1;border:1px solid #dfe6e1;border-radius:11px;padding:9px 13px;
    font-size:13.5px;outline:none;background:#fff;color:#182220;}
  .searchbox input:focus{border-color:#00653e;}
  .searchbox button{background:#00653e;color:#fff;border:none;border-radius:11px;
    padding:0 15px;font-size:13px;cursor:pointer;font-weight:600;}
  .hotw{display:flex;flex-wrap:wrap;gap:6px;padding:9px 13px 2px;}
  .hotw span{background:#eef3f0;border-radius:20px;padding:3px 11px;font-size:11.5px;
    color:#4c5a52;cursor:pointer;}
  .hotw span:hover{background:#e0ebe4;color:#00653e;}
  mark{background:#fff3b0;color:#8a6d00;border-radius:3px;padding:0 1px;}
  .hitinfo{font-size:10.5px;color:#8a958d;margin-top:6px;}

  /* ---------- 详情页 ---------- */
  .dhead{background:#fff;border-bottom:1px solid #e8eee9;padding:14px 14px 12px;}
  .dtitle{font-size:16px;font-weight:700;line-height:1.45;color:#16201d;}
  .dacts{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap;}
  .dbtn{border:1px solid #dfe6e1;background:#fff;border-radius:20px;padding:4px 13px;
    font-size:12px;color:#4c5a52;cursor:pointer;}
  .dbtn.on{background:#e9f6ef;border-color:#bfe3d0;color:#1d7a55;font-weight:600;}
  .dbtn.del.on{background:#fdecec;border-color:#f2c9c9;color:#c0392b;}
  .dsec{background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:12px 13px;margin:10px 13px;}
  .dsec .sk{font-size:11.5px;color:#7c8a80;margin-bottom:8px;letter-spacing:.3px;}
  .dsec ul{list-style:none;display:flex;flex-direction:column;gap:7px;}
  .dsec li{font-size:12.5px;color:#33413a;line-height:1.6;padding-left:16px;position:relative;}
  .dsec li::before{content:"•";position:absolute;left:4px;color:#00653e;}
  .quote{font-size:11.5px;color:#5f6a64;background:#f6f9f7;border-left:3px solid #cfe0d6;
    border-radius:0 8px 8px 0;padding:8px 11px;line-height:1.7;margin-top:6px;}
  .kv{display:flex;gap:8px;font-size:12px;margin-bottom:6px;}
  .kv .k{color:#8a958d;flex:0 0 62px;}
  .kv .v{color:#2a3630;flex:1;}
  .dbtn-link{display:inline-block;margin-top:8px;color:#2b6fc9;font-size:12px;text-decoration:none;}

  /* ---------- 档案 / 千人千面 ---------- */
  .pf-head{background:linear-gradient(135deg,#00704a,#00563a);color:#eafff5;
    padding:16px 15px 18px;border-radius:0 0 20px 20px;margin-bottom:12px;}
  .pf-head .pt{font-size:16px;font-weight:700;}
  .pf-head .ps{font-size:12px;color:#b6e3cb;margin-top:4px;}
  .pf-row{margin-bottom:14px;}
  .pf-row .pl{font-size:12px;color:#7c8a80;margin-bottom:7px;}
  .chips{display:flex;flex-wrap:wrap;gap:7px;}
  .chip{border:1px solid #dfe6e1;background:#fff;border-radius:20px;padding:5px 13px;
    font-size:12px;color:#4c5a52;cursor:pointer;transition:all .13s;}
  .chip:hover{border-color:#9cc9b2;}
  .chip.on{background:#00653e;border-color:#00653e;color:#fff;font-weight:600;}
  .seg{display:flex;background:#eef1f0;border-radius:11px;padding:3px;gap:3px;}
  .seg div{flex:1;text-align:center;padding:6px 0;font-size:12px;border-radius:9px;
    cursor:pointer;color:#5f6a64;}
  .seg div.on{background:#fff;color:#00653e;font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.06);}
  .pf-note{font-size:11px;color:#8a958d;background:#f6f9f7;border-radius:10px;padding:9px 11px;line-height:1.7;}

  /* ---- 我的关键词（自定义订阅） ---- */
  .kwin{display:flex;align-items:center;gap:9px;margin:4px 0 8px;}
  .kwin input{flex:1;height:34px;padding:0 13px;font-size:12.5px;border-radius:17px;
    border:1px solid #dfe6e1;background:#fff;color:#1c2320;font-family:inherit;outline:none;}
  .kwin input:focus{border-color:#00653e;}
  .kwadd{flex-shrink:0;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;
    background:#00653e;padding:8px 18px;border-radius:17px;}
  .kwchips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:8px;}
  .kwchip{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:5px 6px 5px 12px;
    border-radius:18px;background:#e8f4ee;border:1px solid #00653e;color:#00653e;}
  .kwchip.empty{background:#fff;border-color:#dfe6e1;color:#8a958d;}
  .kwchip .kwt{font-weight:700;}
  .kwchip .kwn{font-size:11px;opacity:.72;}
  .kwchip .kwhot{font-size:11px;background:#e77844;color:#fff;padding:1px 6px;border-radius:9px;}
  .kwchip .kwx{font-size:15px;line-height:1;opacity:.55;cursor:pointer;padding:0 6px 0 2px;}
  .kwchip .kwx:hover{opacity:1;}
  .kwsug{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:6px;}
  .kwsug-l{font-size:11.5px;color:#8a958d;}
  .kwsug-w{font-size:12px;color:#00653e;background:#e8f4ee;padding:4px 11px;border-radius:14px;cursor:pointer;}
  .kwsug-w:hover{background:#00653e;color:#fff;}

  /* ---------- 问知时 / 日历 ---------- */
  .qa{background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:12px 13px;margin-bottom:10px;}
  .qa .q{font-size:12.5px;color:#00653e;font-weight:600;margin-bottom:7px;}
  .qa .a{font-size:13.5px;color:#1c2320;line-height:1.6;}
  .qa .basis{font-size:10.5px;color:#8a958d;margin-top:8px;border-top:1px dashed #edf1ee;padding-top:7px;line-height:1.6;}
  .qa .a.alert{color:#c0392b;} .qa .a.busy{color:#a8761a;} .qa .a.calm{color:#1d7a55;}
  .qbtn{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e8eee9;
    border-radius:11px;padding:10px 13px;margin-bottom:8px;font-size:12.5px;color:#33413a;
    cursor:pointer;transition:all .12s;}
  .qbtn:hover{border-color:#9cc9b2;background:#f8fcf9;}
  .qbtn .hint{color:#9aa4a0;font-size:11px;margin-top:2px;}

  .cal-hd{display:flex;align-items:center;justify-content:space-between;
    background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:11px 13px;margin-bottom:10px;}
  .cal-hd .cm{font-size:14px;font-weight:700;}
  .cal-nav{display:flex;gap:8px;}
  .cal-nav button{border:1px solid #dfe6e1;background:#fff;border-radius:9px;width:32px;height:30px;
    cursor:pointer;font-size:14px;color:#4c5a52;}
  .cal-nav button:hover{background:#eef3f0;}
  .cal-grid{background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:11px;}
  .cal-wk{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px;}
  .cal-wk div{text-align:center;font-size:10.5px;color:#9aa4a0;padding:3px 0;}
  .cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
  .cal-cell{aspect-ratio:1;border-radius:9px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;font-size:12px;color:#33413a;position:relative;
    cursor:default;gap:2px;}
  .cal-cell.blank{color:transparent;}
  .cal-cell.today{box-shadow:0 0 0 2px #00653e inset;font-weight:700;color:#00653e;}
  .cal-cell.past{color:#c3cbc6;}
  .cal-cell.has{cursor:pointer;font-weight:700;}
  .cal-cell.now{background:#fdecec;color:#c0392b;}
  .cal-cell.hot{background:#fdf3e2;color:#a8761a;}
  .cal-cell.soon{background:#eaf7f0;color:#1d7a55;}
  .cal-cell.plan{background:#eef4fb;color:#2b6fc9;}
  .cal-cell .cn{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.7;}
  .cal-sum{margin-top:10px;font-size:12px;color:#7c8a80;}
  .cal-list{margin-top:10px;}

  /* ---------- toast / 弹层 ---------- */
  .toast{position:absolute;left:50%;bottom:88px;transform:translateX(-50%) translateY(10px);
    background:rgba(20,30,26,.93);color:#fff;font-size:12.5px;border-radius:22px;
    padding:8px 18px;opacity:0;pointer-events:none;transition:all .22s;z-index:80;white-space:nowrap;}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  .sheet-mask{position:absolute;inset:0;background:rgba(10,20,15,.45);z-index:70;
    opacity:0;pointer-events:none;transition:opacity .2s;}
  .sheet-mask.show{opacity:1;pointer-events:auto;}
  .sheet{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;
    padding:8px 12px 20px;transform:translateY(100%);transition:transform .24s cubic-bezier(.3,.9,.4,1);z-index:75;}
  .sheet.show{transform:translateY(0);}
  .sheet .st{text-align:center;font-size:12px;color:#8a958d;padding:8px 0 10px;
    border-bottom:1px solid #eef1f0;margin-bottom:6px;}
  .sheet button{display:block;width:100%;background:none;border:none;padding:13px 0;
    font-size:14.5px;color:#1c2320;cursor:pointer;border-bottom:1px solid #f4f7f4;}
  .sheet button:last-child{border-bottom:none;}
  .sheet button.warn{color:#c0392b;}
  .sheet button.ok{color:#1d7a55;}
  .sheet button.cancel{color:#7c8a80;margin-top:6px;border-radius:12px;background:#f4f7f4;}

  .empty{text-align:center;color:#9aa4a0;font-size:12.5px;padding:40px 20px;line-height:1.8;}
  .empty .ei{font-size:30px;display:block;margin-bottom:8px;opacity:.6;}

  /* ---------- 数据源 / 总览 ---------- */
  .kpi{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px;}
  .kpi .k{background:linear-gradient(150deg,#f0f7f3,#e7f2eb);border:1px solid #dbeae1;
    border-radius:13px;padding:11px 12px;position:relative;overflow:hidden;}
  .kpi .k.blue{background:linear-gradient(150deg,#eef4fc,#e4eefb);border-color:#d7e5f7;}
  .kpi .k.amber{background:linear-gradient(150deg,#fdf7ec,#fbf1de);border-color:#f2e6cd;}
  .kpi .k .kv{font-size:24px;font-weight:800;color:#0b5f41;line-height:1.1;letter-spacing:-.5px;}
  .kpi .k.blue .kv{color:#1f5fae;}
  .kpi .k.amber .kv{color:#9c6c14;}
  .kpi .k .kl{font-size:11px;color:#6d7b72;margin-top:4px;}
  .kpi .k .ki{position:absolute;right:9px;top:8px;font-size:17px;opacity:.35;}

  .bars{background:#fff;border:1px solid #e8eee9;border-radius:13px;padding:12px 13px;margin-bottom:11px;}
  .bars .bh{font-size:11.5px;color:#7c8a80;margin-bottom:9px;display:flex;align-items:center;gap:6px;}
  .bars .bh b{color:#1d6b4b;font-weight:700;}
  .bar{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:11.5px;}
  .bar .bl{flex:0 0 92px;color:#4c5a52;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .bar .bt{flex:1;height:16px;background:#f1f5f2;border-radius:8px;overflow:hidden;position:relative;}
  .bar .bf{height:100%;border-radius:8px;background:linear-gradient(90deg,#1d9c6e,#2fae7a);
    transition:width .5s cubic-bezier(.2,.8,.3,1);}
  .bar .bv{flex:0 0 30px;text-align:right;color:#7c8a80;font-weight:700;}
  .bar .bf.b2{background:linear-gradient(90deg,#2b6fc9,#4f93f0);}
  .bar .bf.b3{background:linear-gradient(90deg,#c98a1a,#e0a52d);}

  .yearline{display:flex;align-items:flex-end;gap:3px;height:74px;padding-top:8px;}
  .yearline .yc{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;
    justify-content:flex-end;}
  .yearline .yb{width:100%;background:linear-gradient(180deg,#4f93f0,#2b6fc9);border-radius:3px 3px 0 0;
    min-height:2px;transition:height .5s cubic-bezier(.2,.8,.3,1);}
  .yearline .yb.z{background:#d8e2da;}
  .yearline .yl{font-size:8px;color:#a8b2ac;transform:rotate(-45deg);white-space:nowrap;}

  .sitegrid{display:flex;flex-direction:column;gap:7px;}
  .site{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #e8eee9;
    border-radius:11px;padding:9px 11px;font-size:12px;}
  .site .sd{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
  .site.ok .sd{background:#2fae7a;box-shadow:0 0 0 3px rgba(47,174,122,.16);}
  .site.blocked .sd{background:#e0545b;box-shadow:0 0 0 3px rgba(224,84,91,.14);}
  .site .sn{flex:1;color:#2a3630;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .site .sv{color:#7c8a80;font-size:11px;font-weight:700;}
  .site.blocked .sn{color:#7c8a80;}

  .srcstrip{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-2px 0 10px;
    font-size:10.5px;color:#8a958d;}
  .srcstrip .sp{background:#e9f6ef;color:#1d7a55;border-radius:20px;padding:1px 8px;font-weight:600;}
  .badge-real{display:inline-flex;align-items:center;gap:3px;background:#e9f6ef;color:#1d7a55;
    border-radius:5px;padding:0 6px;font-size:9.5px;font-weight:700;line-height:16px;vertical-align:middle;}

  /* ---------- 详情时间线 ---------- */
  .tl{display:flex;flex-direction:column;gap:0;}
  .tl-n{display:flex;align-items:center;gap:9px;font-size:12.5px;color:#33413a;}
  .tl-n b{flex:0 0 30px;font-weight:600;color:#5f6a64;}
  .tl-n .tl-t{color:#2a3630;}
  .tl-d{width:11px;height:11px;border-radius:50%;flex:0 0 auto;background:#cfe0d6;
    box-shadow:0 0 0 3px rgba(47,174,122,.12);}
  .tl-d.pub{background:#4f93f0;box-shadow:0 0 0 3px rgba(79,147,240,.14);}
  .tl-d.now{background:#2fae7a;box-shadow:0 0 0 3px rgba(47,174,122,.16);}
  .tl-d.hi{background:#e0545b;box-shadow:0 0 0 3px rgba(224,84,91,.14);}
  .tl-d.md{background:#e09b2d;box-shadow:0 0 0 3px rgba(224,155,45,.14);}
  .tl-d.exp{background:#9aa4a0;box-shadow:0 0 0 3px rgba(154,164,160,.14);}
  .tl-line{width:2px;height:12px;background:#e3ebe6;margin-left:4.5px;}
  .tl-g{margin-left:auto;font-size:11px;font-weight:700;border-radius:20px;padding:1px 9px;}
  .tl-g.hi{background:#fdecec;color:#c0392b;}
  .tl-g.md{background:#fdf3e2;color:#a8761a;}
  .tl-g.exp{background:#eef1f0;color:#7c8a80;}

  @media (max-width:820px){
    body{padding:0;}
    .wrap{gap:0;}
    .side{display:none;}
    .phone{width:100vw;height:100vh;border-radius:0;padding:0;}
    .screen{border-radius:0;}
    .notch{display:none;}
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="side">
    <h1>知时 · <span>数字安农信息雷达</span></h1>
    <div class="ver">交互 Demo · 数据与算法同源于小程序</div>
    <p>一部能真正点开、搜索、追问的手机模拟器。左边这台"手机"里跑的就是小程序的逻辑，只是换了壳。</p>
    <ul class="feat">
      <li><i>📡</i><div><b>推送流 + 定点排序</b><br>只推和你身份、关注相符的通知，主次分层，可已读/删除</div></li>
      <li><i>🔍</i><div><b>搜索 + 溯源</b><br>关键词检索、命中来源说明、点进详情看官网原文</div></li>
      <li><i>🎫</i><div><b>切换档案看千人千面</b><br>换学院/年级/关注标签，推送流实时重排</div></li>
      <li><i>💬</i><div><b>问知时 + 办事日历</b><br>自然语言问答，今天/本周要办一目了然</div></li>
      <li><i>📊</i><div><b>数据源总览</b><br>百余条真实公开通知的采集来源与分布，逐条可回官网核对</div></li>
    </ul>
    <div class="tip">
      试试这些：<br>
      · 长按任意推送卡 → 标记已读 / 删除<br>
      · 在「订阅」页把年级从 2025级 换成 2022级，回「雷达」看排序变化<br>
      · 搜索框输入「科技文化节」回车，点结果看原文出处<br>
      · 切到「数据源」看百余条通知从哪来、怎么分布<br>
      · 「问知时」问一句"今天有什么非要办的？"
    </div>
  </div>

  <div class="phone">
    <div class="notch"></div>
    <div class="screen">
      <div class="statusbar">
        <span id="clock">9:41</span>
        <span>安农 · 5G · 100%</span>
      </div>
      <div class="navbar">
        <span id="navTitle">雷达</span>
        <span class="nb-sub" id="navSub"></span>
      </div>
      <div class="body" id="view"></div>
      <div class="tabbar" id="tabbar">
        <div class="tab on" data-tab="index"><span class="ti">📡</span>雷达</div>
        <div class="tab" data-tab="search"><span class="ti">🔍</span>搜索</div>
        <div class="tab" data-tab="ask"><span class="ti">💬</span>问知时</div>
        <div class="tab" data-tab="data"><span class="ti">📊</span>数据源</div>
        <div class="tab" data-tab="me"><span class="ti">👤</span>订阅</div>
      </div>
      <div class="toast" id="toast"></div>
      <div class="sheet-mask" id="sheetMask"></div>
      <div class="sheet" id="sheet"></div>
    </div>
  </div>
</div>

<script>
/*__CORE__*/
</script>
<script>
/*__DATA__*/
</script>
<script>
/* ============================================================
 * 交互 Demo 的界面层（不是逻辑层）
 * 逻辑一律走 ZS.*，数据一律走 ZS_DATA —— 与小程序/网页同源。
 * 这里只做：状态管理 + DOM 渲染 + 交互绑定。
 * ============================================================ */
(function(){
  'use strict';
  var ZS = window.ZS, DATA = window.ZS_DATA;
  var NOTICES = DATA.NOTICES || [];
  var META = DATA.META || null;

  /* ---------- 应用状态 ---------- */
  var S = {
    tab: 'index',
    dt: null,            /* 当前详情条目 */
    q: '',               /* 搜索词 */
    cal: null,           /* { y, m } */
    readIds: {},         /* 已读 */
    hiddenIds: {},       /* 已删除 */
    folds: {},           /* 折叠展开状态：{ foldMajor:true, foldLater:true } */
    seen: {},            /* 展示过的（非新） */
    profile: JSON.parse(JSON.stringify(DATA.PROFILE)),
    /* 可切换的档案维度 */
    opts: {
      identity: ['本科生', '研究生'],
      grade: ['2026级 · 大一', '2025级 · 大二', '2024级 · 大三', '2023级 · 大四', '2022级 · 研一'],
      college: ['信息与人工智能学院', '资源与环境学院', '农学院', '工学院', '经济管理学院'],
      interests: ZS.TAG_KEYS
    }
  };

  function notify(m){ var t=document.getElementById('toast'); t.textContent=m;
    t.classList.add('show'); clearTimeout(notify._t);
    notify._t=setTimeout(function(){ t.classList.remove('show'); },1500); }

  /* 关键词订阅推荐词候选：都是安农通知里真实出现、且固定标签盖不住的具体名词。
   * ★ 与 miniprogram/pages/me/me.js 的 KW_SUGGEST_CANDIDATES 同源。 */
  var KW_SUGGEST = ['正大杯','挑战杯','数学建模','蓝桥杯','节能减排','大学生创新创业',
    '四六级','普通话','计算机等级','教资','志愿服务','社会实践','招聘会','考研','保研','交换生'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  /* 高亮渲染：ZS.highlight 返回 [{text,hl}] 段数组，转成安全 HTML */
  function hl(text, words){
    var segs = ZS.highlight(String(text==null?'':text), words||[]);
    return segs.map(function(s){ return s.hl? '<mark>'+esc(s.text)+'</mark>' : esc(s.text); }).join('');
  }
  function visible(items){ return (items||[]).filter(function(n){ return !S.hiddenIds[n.id]; }); }
  function decorate(items){ return (items||[]).map(function(n){
    var o={}; for(var k in n) if(Object.prototype.hasOwnProperty.call(n,k)) o[k]=n[k];
    o.read=!!S.readIds[n.id]; return o; }); }

  /* 按 profile 现算的全量池（倒计时实时刷新，同小程序 refreshCountdowns） */
  function pool(){ return ZS.refreshCountdowns(NOTICES); }

  /* ---------- 页面渲染 ---------- */
  function render(){
    var v = document.getElementById('view');
    /* 详情页优先：只要 S.dt 有值就盖在 tab 之上（返回时清掉） */
    if (S.dt){
      document.getElementById('navTitle').textContent='通知详情';
      document.getElementById('navSub').textContent='';
      v.innerHTML = pageDetail(S.dt);
      [].forEach.call(document.querySelectorAll('.tab'),function(el){ el.classList.remove('on'); });
      v.scrollTop=0; return;
    }
    document.getElementById('navTitle').textContent =
      ({index:'雷达', search:'搜索', ask:'问知时', data:'数据源', me:'订阅'})[S.tab];
    if (S.tab==='index') { document.getElementById('navSub').textContent='数字安农'; v.innerHTML=pageIndex(); }
    else if (S.tab==='search'){ document.getElementById('navSub').textContent=''; v.innerHTML=pageSearch(); }
    else if (S.tab==='ask'){ document.getElementById('navSub').textContent=''; v.innerHTML=pageAsk(); }
    else if (S.tab==='data'){ document.getElementById('navSub').textContent='公开采集'; v.innerHTML=pageData(); }
    else { document.getElementById('navSub').textContent=''; v.innerHTML=pageMe(); }
    v.scrollTop=0;
    [].forEach.call(document.querySelectorAll('.tab'),function(el){
      el.classList.toggle('on', el.getAttribute('data-tab')===S.tab); });
  }

  /* ---------- ① 雷达（推送流） ---------- */
  /* 中卡阈值直接取逻辑层的常量，不写死 —— 逻辑层调阈值，Demo 自动跟上 */
  var MAJOR = (typeof ZS.PUSH_MAJOR_SCORE === 'number') ? ZS.PUSH_MAJOR_SCORE : 35;
  function pageIndex(){
    var p = pool();
    var r = ZS.buildPush(p, { profile:S.profile, limit:40, seenIds:Object.keys(S.seen) });
    var stats = zstats(r.cards);

    var vis = visible(r.cards);
    var cards = decorate(vis);
    /* 主次梯度：三天内 或 高分 → 中卡；其余 → 小卡。
     * 过期条目一律进"稍后看"（它们不再是待办）。 */
    var major = cards.filter(function(c){
      if (typeof c.countdown==='number' && c.countdown<0) return false;
      return (typeof c.countdown==='number' && c.countdown>=0 && c.countdown<=3) || c.pushScore>=MAJOR; });
    var minor = cards.filter(function(c){ return major.indexOf(c)<0; });

    var hero = ZS.askHeadline({ notices:p, profile:S.profile });
    var unread = stats.unread;
    /* 已过期条数：用于在推送条上提示"含 N 条已截止可回看" */
    var expiredCnt = cards.filter(function(c){ return typeof c.countdown==='number' && c.countdown<0; }).length;

    var h = '';
    /* 头条（今日一问 + 最紧急那条）：只在有未过期条目时出现 */
    h += '<div class="pad">';
    var lead = null;
    for (var i=0;i<cards.length;i++){ if (!(typeof cards[i].countdown==='number' && cards[i].countdown<0)){ lead=cards[i]; break; } }
    if (lead){
      h += '<div class="hero tap" data-id="'+esc(lead.id)+'" data-open="1">'
        + '<div class="hk">今日头条 · 最要紧的一件事</div>'
        + '<div class="ht">'+esc(lead.title)+'</div>'
        + '<div class="hm">'+esc(lead.source)+' · '+esc(lead.deadline||'无截止')+'<span class="hgo">点开看详情 ›</span></div>'
        + '</div>';
    }
    /* 推送条 */
    h += '<div class="vsb">推送流'
      + (unread? '<span class="vsb-n">'+unread+'</span>' : '')
      + (stats.hidden? '<span class="lk" data-act="hidden">已删除 '+stats.hidden+' ›</span>' : '')
      + '</div>';
    /* 来源条：让用户一眼看到"这些是从哪采来的" */
    var realCnt = p.filter(function(n){ return n.real; }).length;
    h += '<div class="srcstrip"><span class="sp">✓ 官网可核 '+realCnt+' 条</span>'
      + '<span>共 '+p.length+' 条在池 · 坏消息不隐藏</span>'
      + '<span class="lk" data-tab="data">看数据源 ›</span></div>';
    h += '<div style="font-size:12px;color:#7c8a80;margin:-4px 0 10px;line-height:1.6">'
      + esc(r.summary.line)
      + (expiredCnt? '（另有 '+expiredCnt+' 条已截止，排在最下方可回看）' : '')
      + '</div>';

    if (!cards.length){
      h += '<div class="empty"><span class="ei">📭</span>当前档案下没有匹配的通知<br>去「订阅」调整关注标签或身份试试</div>';
    } else {
      /* 三段：优先办（三天内/高分）· 稍后看（更远）· 已截止（可回看）。
       * 过期条目单列，不跟"稍后看"混在一起 —— 语义不同：一个是"还来得及"，
       * 一个是"已经过去了"。
       * 首屏收敛：优先办只展开前 3 条，其余折叠；后两段整体折叠 —— 别一屏刷不完。 */
      var minorAlive = minor.filter(function(c){ return !(typeof c.countdown==='number' && c.countdown<0); });
      var expired = minor.filter(function(c){ return typeof c.countdown==='number' && c.countdown<0; });
      var OPEN = 3;
      var majorHead = major.slice(0, OPEN), majorRest = major.slice(OPEN);
      var F = S.folds || {};
      var majorOpen = !!F.foldMajor;
      var laterOpen = !!F.foldLater;
      h += '<div class="sec-k">优先办（'+major.length+'）</div>';
      h += major.length
        ? majorHead.map(cardHtml).join('')
          + (majorRest.length ? '<div class="fold" id="foldMajor"'
              + (majorOpen?'':' style="display:none;"') + '>'
              + majorRest.map(cardHtml).join('') + '</div>' : '')
        : '<div class="empty" style="padding:14px">暂无三天内或高优先级事项</div>';
      if (majorRest.length){
        h += '<div class="morebtn" data-act="fold" data-target="foldMajor">'
          + (majorOpen ? '收起 ∧' : '展开其余 '+majorRest.length+' 条优先办 ∨') + '</div>';
      }
      var laterCnt = minorAlive.length + expired.length;
      if (laterCnt){
        h += '<div class="sec-k" style="margin-top:14px">稍后看与已截止（'+laterCnt+'）'
          + '<span class="lk" data-act="fold" data-target="foldLater"'
          + ' style="margin-left:auto;font-weight:400">'
          + (laterOpen ? '收起 ∧' : '展开 ∨') + '</span></div>';
        h += '<div class="fold" id="foldLater"' + (laterOpen?'':' style="display:none;"') + '>';
        if (minorAlive.length){
          h += minorAlive.map(smallHtml).join('');
        }
        if (expired.length){
          h += '<div style="font-size:11px;color:#9aa4a0;margin:4px 0 8px;line-height:1.6">'
            + '已截止的条目已过办理时间，不再计入待办；留着方便回看结果或补交材料。</div>';
          h += expired.map(smallHtml).join('');
        }
        h += '</div>';
      }
    }
    h += '</div>';
    return h;
  }
  function cardHtml(c){
    var cd = cdHtml(c);
    var exp = (typeof c.countdown==='number' && c.countdown<0);
    return '<div class="card tap'+(c.read?' read':'')+(exp?' expired':'')+'" data-id="'+esc(c.id)+'" data-open="1">'
      + '<div class="ctop"><span class="cicon">'+ZS.tagMeta(c.event).icon+'</span>'
      + '<span class="ctitle">'+esc(c.title)+'</span>'
      + (c.read||exp? '' : '<span class="cdot"></span>') +'</div>'
      + '<div class="cmeta">'+cd
      + '<span class="tg ev">'+esc(c.event)+'</span>'
      + (c.real? '<span class="badge-real">✓ 官网可核</span>' : '')
      + (exp? '<span class="tg lo">仅供回看</span>' : '')
      + (c.read? '<span class="tg r">✓ 已读</span>' : '')
      + '<span style="margin-left:auto" class="score">'+c.pushScore+' 分</span></div>'
      + '</div>';
  }
  function smallHtml(c){
    var exp = (typeof c.countdown==='number' && c.countdown<0);
    return '<div class="card tap'+(c.read?' read':'')+(exp?' expired':'')+'" data-id="'+esc(c.id)+'" data-open="1" style="padding:10px 12px">'
      + '<div class="ctop"><span class="cicon">'+ZS.tagMeta(c.event).icon+'</span>'
      + '<span class="ctitle" style="font-weight:500;font-size:13px">'+esc(c.title)+'</span>'
      + (c.read||exp? '' : '<span class="cdot"></span>')+'</div>'
      + '<div class="cmeta">'+cdHtml(c)+'<span class="tg ev">'+esc(c.event)+'</span>'
      + (exp? '<span class="tg lo">仅供回看</span>' : '')
      + '<span style="margin-left:auto" class="score">'+c.pushScore+' 分</span></div></div>';
  }
  function cdHtml(c){
    if (typeof c.countdown!=='number') return '<span class="tg lo">无截止</span>';
    if (c.countdown < 0) return '<span class="cd exp">已截止 '+Math.abs(c.countdown)+' 天</span>';
    var cls = c.countdown===0?'hi': c.countdown<=3?'hi': c.countdown<=7?'md':'lo';
    var t = c.countdown===0? '今天截止': '还剩 '+c.countdown+' 天';
    return '<span class="cd '+cls+'">'+t+'</span>';
  }
  function zstats(items){
    var read=0, hidden=0, total=(items||[]).length;
    (items||[]).forEach(function(n){ if(S.readIds[n.id])read++; if(S.hiddenIds[n.id])hidden++; });
    return { read:read, hidden:hidden, total:total, unread:total-read-hidden };
  }

  /* ---------- ② 搜索 ---------- */
  function pageSearch(){
    var h = '<div class="searchbox">'
      + '<input id="sq" placeholder="搜通知：转专业 / 奖学金 / 竞赛…" value="'+esc(S.q)+'">'
      + '<button data-act="dosearch">搜索</button></div>'
      + '<div class="hotw">'+ ZS.hotWords(pool()).map(function(w){
          return '<span data-hot="'+esc(w)+'">'+esc(w)+'</span>'; }).join('') +'</div>'
      + '<div class="pad" style="padding-top:6px">';
    if (!S.q.trim()){
      h += '<div class="empty"><span class="ei">🔍</span>输入关键词，或点上面的热词<br>结果会告诉你"在哪命中的"，点进可看官网原文</div>';
      return h + '</div>';
    }
    var words = ZS.splitQuery(S.q);
    var res = ZS.search(pool(), S.q, {});
    if (!res.length){ h += '<div class="empty"><span class="ei">🤷</span>没有匹配「'+esc(S.q)+'」的通知</div>'; return h+'</div>'; }
    h += '<div class="sec-k">命中 '+res.length+' 条</div>';
    res.forEach(function(n){
      h += '<div class="card tap" data-id="'+esc(n.id)+'" data-open="1">'
        + '<div class="ctop"><span class="cicon">'+n.icon+'</span>'
        + '<span class="ctitle">'+hl(n.title, words)+'</span></div>'
        + '<div class="cmeta"><span class="cd '+(n.level==='hi'?'hi':n.level==='md'?'md':'lo')+'">'
        + (typeof n.countdown==='number'? (n.countdown===0?'今天截止':n.countdown<0?'已过期':'还剩 '+n.countdown+' 天') : '无截止')
        + '</span><span class="tg ev">'+esc(n.event)+'</span></div>';
      if (n.snippet) h += '<div class="quote">'+hl(n.snippet, words)+'</div>';
      h += '<div class="hitinfo">命中：'+ (n.hitSources&&n.hitSources.length? n.hitSources.join(' / ') : '标签')
        + (n.needExplain? '（标题与原文无可见高亮，靠标签命中）':'') +'</div>';
      h += '</div>';
    });
    return h + '</div>';
  }

  /* ---------- ③ 问知时 + 日历 ---------- */
  function pageAsk(){
    var p = pool();
    var h = '<div class="pad">';
    /* 今日一问 */
    var head = ZS.askHeadline({ notices:p, profile:S.profile });
    h += '<div class="qa"><div class="q">今日一问 · '+esc(head.q)+'</div>'
      + '<div class="a '+(head.tone||'')+'">'+esc(head.answer)+'</div></div>';
    /* 问题清单 */
    h += '<div class="sec-k">想知道什么，点一下</div>';
    ZS.askQuestionGroups().forEach(function(g){
      h += '<div style="font-size:11px;color:#9aa4a0;margin:8px 0 6px">'+g.icon+' '+esc(g.label)+'</div>';
      g.questions.forEach(function(q){
        h += '<button class="qbtn" data-ask="'+esc(q.id)+'">'+esc(q.q)
          + '<div class="hint">'+esc(q.hint)+'</div></button>';
      });
    });
    /* 上次答案 */
    if (S.askResult){
      var a = S.askResult;
      h += '<div class="sec-k" style="margin-top:14px">回答</div>';
      h += '<div class="qa"><div class="q">'+esc(a.q)+'</div>'
        + '<div class="a '+(a.tone||'')+'">'+esc(a.answer)+'</div>'
        + (a.basis? '<div class="basis">依据：'+esc(a.basis)+'</div>' : '') +'</div>';
      if (a.items && a.items.length){
        h += '<div class="sec-k">相关条目（'+a.items.length+'）</div>';
        a.items.slice(0,8).forEach(function(n){
          h += '<div class="card tap" data-id="'+esc(n.id)+'" data-open="1" style="padding:10px 12px">'
            + '<div class="ctop"><span class="cicon">'+ZS.tagMeta(n.event).icon+'</span>'
            + '<span class="ctitle" style="font-weight:500;font-size:13px">'+esc(n.title)+'</span></div>'
            + '<div class="cmeta">'+cdHtml(n)+'</div></div>';
        });
      }
    }
    /* 日历 */
    h += '<div class="sec-k" style="margin-top:14px">办事日历</div>';
    h += calHtml(p);
    return h + '</div>';
  }
  function calHtml(p){
    var t = new Date();
    if (!S.cal) S.cal = { y:t.getFullYear(), m:t.getMonth()+1 };
    var c = ZS.buildCalendar(p, S.cal.y, S.cal.m, S.profile);
    S.cal = { y:c.year, m:c.month };
    var h = '<div class="cal-hd"><span class="cm">'+c.year+' 年 '+c.month+' 月</span>'
      + '<span class="cal-nav"><button data-cal="-1">‹</button><button data-cal="1">›</button></span></div>';
    h += '<div class="cal-grid"><div class="cal-wk">'
      + c.weekdays.map(function(w){return '<div>'+w+'</div>';}).join('') +'</div>';
    c.weeks.forEach(function(wk){
      h += '<div class="cal-week">';
      wk.forEach(function(cell){
        if (cell.blank){ h += '<div class="cal-cell blank"></div>'; return; }
        var cls = 'cal-cell';
        if (cell.isToday) cls+=' today';
        if (cell.isPast) cls+=' past';
        if (cell.hasItem){ cls+=' has '+cell.level; }
        h += '<div class="'+cls+'" data-day="'+cell.day+'" data-has="'+(cell.hasItem?1:0)+'">'
          + cell.day + (cell.hasItem? '<span class="cn"></span>':'') +'</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    h += '<div class="cal-sum">'+esc(c.summary)+'</div>';
    if (S.calDay){
      var items = [];
      c.weeks.forEach(function(wk){ wk.forEach(function(cell){
        if (!cell.blank && cell.day===S.calDay) items = cell.items||[]; }); });
      if (items.length){
        h += '<div class="cal-list"><div class="sec-k">'+c.month+' 月 '+S.calDay+' 日</div>';
        items.forEach(function(n){
          h += '<div class="card tap" data-id="'+esc(n.id)+'" data-open="1" style="padding:10px 12px">'
            + '<div class="ctop"><span class="cicon">'+ZS.tagMeta(n.event).icon+'</span>'
            + '<span class="ctitle" style="font-weight:500;font-size:13px">'+esc(n.title)+'</span></div>'
            + '<div class="cmeta">'+cdHtml(n)+'</div></div>';
        });
        h += '</div>';
      }
    }
    return h;
  }

  /* ---------- ⑤ 数据源 / 总览 ---------- */
  /* 这一页回答的是"你的通知到底从哪来、可信不可信"。
   * 全部数字现算自通知池本身（或导出的 META），不写死 —— 数据一变，页面跟着变。 */
  function pageData(){
    var p = pool();
    var real = p.filter(function(n){ return n.real; });
    var linked = real.filter(function(n){ return !!n.url; });
    var withDdl = real.filter(function(n){ return !!n.deadline; });
    /* 单位分布：优先用导出的 META（保证与导出同刻一致），否则现算 */
    var unitDist = META && META.unitDist ? META.unitDist : tally(real, function(n){ return n.source||'未标注'; });
    var tagDist  = META && META.tagDist  ? META.tagDist  : tally(real, function(n){ return n.event||'校内通知'; });
    var yearDist = META && META.yearDist ? META.yearDist : tally(real, function(n){ return (n.publish||'').slice(0,4)||'未知'; });

    var h = '<div class="pad">';

    /* 概览：四条 KPI */
    h += '<div class="sec-k">采集概览</div>';
    h += '<div class="kpi">'
      + kpi('真实公开通知', (META&&META.real)||real.length, '📄', '')
      + kpi('带官网链接', linked.length, '🔗', 'blue')
      + kpi('含明确截止', withDdl.length, '⏰', 'amber')
      + kpi('来源单位', unitDist.length, '🏛', '')
      + '</div>';
    h += '<div style="font-size:11px;color:#8a958d;margin:-4px 0 12px;line-height:1.7">'
      + '采集自安徽农业大学各二级单位公网公开通知栏（示教楼/图书馆/工会/保卫处等）。'
      + '每条都留了 <b>官网原文链接</b>，点详情可一键跳回原文页逐字核对。'
      + '不碰任何登录态系统。</div>';

    /* 单位分布 */
    h += '<div class="sec-k">来源单位分布（'+unitDist.length+'）</div>';
    h += '<div class="bars"><div class="bh">📚 按公开栏目归集 · 共 <b>'+real.length+'</b> 条</div>';
    var maxU = Math.max.apply(null, unitDist.map(function(x){ return x.v; }).concat([1]));
    unitDist.forEach(function(x){
      h += bar(shortUnit(x.k), x.v, maxU, '');
    });
    h += '</div>';

    /* 标签分布 */
    h += '<div class="sec-k">内容标签分布</div>';
    h += '<div class="bars"><div class="bh">🏷 理解层自动归类 · 9 类统一词表</div>';
    var maxT = Math.max.apply(null, tagDist.map(function(x){ return x.v; }).concat([1]));
    tagDist.forEach(function(x){
      h += bar((ZS.tagMeta ? ZS.tagMeta(x.k).icon+' ' : '') + x.k, x.v, maxT, 'b2');
    });
    h += '</div>';

    /* 年份分布 */
    h += '<div class="sec-k">发布年份跨度</div>';
    h += '<div class="bars"><div class="bh">🗓 从 '+(yearDist[0]&&yearDist[0].k||'—')
      +' 年到 '+(yearDist[yearDist.length-1]&&yearDist[yearDist.length-1].k||'—')
      +'，可回看历年通知</div>';
    h += '<div class="yearline">';
    var maxY = Math.max.apply(null, yearDist.map(function(x){ return x.v; }).concat([1]));
    yearDist.forEach(function(x){
      var pct = Math.round(x.v / maxY * 100);
      h += '<div class="yc"><div class="yb'+(x.v===0?' z':'')+'" style="height:'+(x.v?Math.max(3,pct):3)+'%" '
        + 'title="'+esc(x.k)+' 年 '+x.v+' 条"></div>'
        + '<div class="yl">'+esc(String(x.k).slice(2))+'</div></div>';
    });
    h += '</div></div>';

    /* 站点接入状态（如实记录） */
    h += '<div class="sec-k">站点接入状态（如实记录）</div>';
    h += '<div class="sitegrid">';
    /* 已接入（有数据的单位） */
    unitDist.forEach(function(x){
      var ok = x.v > 0;
      h += '<div class="site '+(ok?'ok':'blocked')+'"><span class="sd"></span>'
        + '<span class="sn">'+esc(x.k)+'</span>'
        + '<span class="sv">'+(ok? x.v+' 条' : '0 条')+'</span></div>';
    });
    /* 被 WAF 拦截的站点：如实告知，不粉饰 */
    SITES_BLOCKED.forEach(function(name){
      h += '<div class="site blocked"><span class="sd"></span>'
        + '<span class="sn">'+esc(name)+'</span>'
        + '<span class="sv">安全拦截</span></div>';
    });
    h += '</div>';
    h += '<div style="font-size:11px;color:#9aa4a0;margin-top:9px;line-height:1.7">'
      + '标"安全拦截"的站点是校方安全设备（WAF）返回 503，非我方技术问题，'
      + '已如实记录并跳过，不做任何绕过。</div>';

    h += '</div>';
    return h;
  }
  /* 被 WAF 拦截的站点名单（与 tools/collect_notices.py 的 BLOCKED_SITES 对齐） */
  var SITES_BLOCKED = ['学生工作处', '招生办', '就业指导中心', '校团委', '农学院', '林学与园林学院'];
  function tally(list, keyFn){
    var m = {};
    list.forEach(function(n){ var k = keyFn(n); m[k] = (m[k]||0) + 1; });
    return Object.keys(m).map(function(k){ return { k:k, v:m[k] }; })
      .sort(function(a,b){ return b.v - a.v; });
  }
  function shortUnit(k){
    if (!k) return '未标注';
    /* 「图书馆 · 新闻公告」「xx学院 · 通知公告」→ 取 · 前的单位名 */
    var s = String(k).split('·')[0].trim();
    return s.length > 12 ? s.slice(0,12)+'…' : s;
  }
  function kpi(label, val, icon, cls){
    return '<div class="k '+(cls||'')+'"><span class="ki">'+(icon||'')+'</span>'
      + '<div class="kv">'+esc(val)+'</div><div class="kl">'+esc(label)+'</div></div>';
  }
  function bar(label, val, max, cls){
    var pct = max>0 ? Math.round(val/max*100) : 0;
    return '<div class="bar"><span class="bl" title="'+esc(label)+'">'+esc(label)+'</span>'
      + '<span class="bt"><span class="bf '+(cls||'')+'" style="width:'+pct+'%"></span></span>'
      + '<span class="bv">'+val+'</span></div>';
  }

  /* ---------- ④ 订阅（档案 / 千人千面） ---------- */
  function pageMe(){
    var pf = S.profile;
    var h = '<div class="pf-head"><div class="pt">'+esc(pf.identityType)+' · '+esc(pf.grade)+'</div>'
      + '<div class="ps">'+esc(pf.college)+' · '+esc(pf.campus||'')+'</div></div><div class="pad" style="padding-top:0">';
    h += '<div class="pf-note">改下面的选项，回「雷达」看推送流实时重排 —— 这就是千人千面。'
      + '当前命中 <b>'+ZS.getStats(pool(), pf.interests).matched+'</b> 条。</div>';

    h += '<div class="pf-row" style="margin-top:14px"><div class="pl">身份类型</div><div class="seg">';
    S.opts.identity.forEach(function(id){
      h += '<div class="'+(pf.identityType===id?'on':'')+'" data-set="identityType" data-v="'+esc(id)+'">'+esc(id)+'</div>'; });
    h += '</div></div>';

    h += '<div class="pf-row"><div class="pl">年级</div><div class="chips">';
    S.opts.grade.forEach(function(g){
      h += '<span class="chip'+(pf.grade===g?' on':'')+'" data-set="grade" data-v="'+esc(g)+'">'+esc(g)+'</span>'; });
    h += '</div></div>';

    h += '<div class="pf-row"><div class="pl">学院</div><div class="chips">';
    S.opts.college.forEach(function(c){
      h += '<span class="chip'+(pf.college===c?' on':'')+'" data-set="college" data-v="'+esc(c)+'">'+esc(c)+'</span>'; });
    h += '</div></div>';

    h += '<div class="pf-row"><div class="pl">关注标签（点一下开关）</div><div class="chips">';
    ZS.TAGS.forEach(function(t){
      var on = pf.interests.indexOf(t.key)>=0, cnt = ZS.tagCounts(pool())[t.key]||0;
      h += '<span class="chip'+(on?' on':'')+'" data-tag="'+esc(t.key)+'">'+t.icon+' '+esc(t.key)+' '+cnt+'</span>'; });
    h += '</div></div>';

    /* 我的关键词：输入具体名词（如"正大杯"），命中就推给你 —— 与小程序 me 页同源 */
    var kws = Array.isArray(pf.keywords) ? pf.keywords : [];
    h += '<div class="pf-row"><div class="pl">我的关键词（输入具体名词，命中就推给你）</div>'
      + '<div class="note" style="font-size:12px;color:#7a8b82;line-height:1.6;margin:2px 0 8px">'
      + '标签是"我们替你分好的类"；关键词是"你自己敲进去的词"——订了「正大杯」，凡是有它出现的通知都会主动推给你。</div>'
      + '<div class="kwin"><input id="inKw" placeholder="如：正大杯 / 挑战杯 / 数学建模"></input>'
      + '<span class="kwadd" data-act="addkw">添加</span></div>';
    if (kws.length){
      h += '<div class="kwchips">';
      kws.forEach(function(kw){
        var key = ZS.normKeyword(kw);
        var hits = key ? pool().filter(function(n){
          return ZS.noticeHaystack(n).indexOf(key)>=0 && ZS.passesIdentity(n, pf); }) : [];
        var urgent = hits.filter(function(n){ return n.countdown!==null && n.countdown<=3; }).length;
        h += '<span class="kwchip'+(hits.length?'':' empty')+'">'
          + '<span class="kwt">'+esc(kw)+'</span>'
          + (hits.length?'<span class="kwn">'+hits.length+' 条</span>':'<span class="kwn">暂无命中</span>')
          + (urgent?'<span class="kwhot">'+urgent+' 紧急</span>':'')
          + '<span class="kwx" data-rmkw="'+esc(kw)+'">×</span></span>';
      });
      h += '</div>';
    }
    /* 推荐词：池里真命中、还没订的 */
    var sugs = KW_SUGGEST.filter(function(w){
      if (kws.some(function(k){ return ZS.normKeyword(k)===ZS.normKeyword(w); })) return false;
      return pool().some(function(n){ return ZS.hitKeyword(n, {keywords:[w]}) && ZS.passesIdentity(n, pf); });
    }).slice(0,6);
    if (sugs.length){
      h += '<div class="kwsug"><span class="kwsug-l">你可能还关心：</span>';
      sugs.forEach(function(w){ h += '<span class="kwsug-w" data-addkw="'+esc(w)+'">+ '+esc(w)+'</span>'; });
      h += '</div>';
    }
    h += '</div>';

    if (S.hiddenCount() ){
      h += '<div class="pf-note" style="background:#fdf3e2;color:#a8761a">已删除 '+S.hiddenCount()+' 条通知。'
        + '<span style="color:#2b6fc9;cursor:pointer" data-act="restoreall">全部找回</span></div>';
    }
    h += '</div>';
    return h;
  }
  S.hiddenCount = function(){ return Object.keys(S.hiddenIds).length; };

  /* ---------- ⑤ 详情（溯源） ---------- */
  function pageDetail(id){
    var n = null;
    pool().forEach(function(x){ if(x.id===id) n=x; });
    if (!n) return '<div class="empty">找不到这条通知</div>';
    var read = !!S.readIds[id], hidden = !!S.hiddenIds[id];
    var h = '<div class="dhead">';
    h += '<div class="dtitle">'+esc(n.title)+'</div>';
    h += '<div class="cmeta" style="margin-top:8px">'+cdHtml(n)
      + '<span class="tg ev">'+esc(n.event)+'</span>'
      + (n.real? '<span class="badge-real">✓ 官网可核</span>' : '')+'</div>';
    h += '<div class="dacts">'
      + '<span class="dbtn '+(read?'on':'')+'" data-act="togread">'+(read?'✓ 已读':'● 标记已读')+'</span>'
      + '<span class="dbtn del '+(hidden?'on':'')+'" data-act="togdel">'+(hidden?'↩ 找回':'🗑 删除')+'</span>'
      + '<span class="dbtn" data-act="back">‹ 返回</span></div></div>';

    /* 来源卡：谁发布的、什么时候、能不能核对 —— 一条通知的"身份证" */
    h += '<div class="dsec" style="border-left:3px solid #2fae7a">'
      + '<div class="sk">来源 · 可核对</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      + '<span class="tg ev">'+esc(n.source||'未标注单位')+'</span>'
      + (n.publish? '<span style="font-size:11.5px;color:#7c8a80">发布 '+esc(n.publish)+'</span>' : '')
      + (n.real? '<span class="badge-real">✓ 真实公开采集</span>' : '<span class="tg lo">演示样例</span>')
      + '</div>'
      + (n.url? '<a class="dbtn-link" href="'+esc(n.url)+'" target="_blank" rel="noopener">🔗 去官网看原文（'+esc(hostOf(n.url))+'）›</a>'
              : '<div style="font-size:11px;color:#9aa4a0;margin-top:6px">本条未留存官网链接（已在数据源页如实标注）</div>')
      + '</div>';

    /* 时间轴：发布 → 今天 → 截止 */
    h += timelineHtml(n);

    /* 浓缩要点 + 原文出处 */
    h += '<div class="dsec"><div class="sk">浓缩要点（点可核对出处）</div><ul>';
    (n.digestPoints||[]).forEach(function(pt){
      h += '<li>'+esc(pt.text)+'</li>';
      if (pt.quote){
        var i = ZS.locateQuote(n.raw, pt.quote);
        h += '<div class="quote">原文：'+ esc(pt.quote.slice(0,110)) + (pt.quote.length>110?'…':'')
          + (i>=0? ' <span style="color:#1d7a55">✓ 已定位</span>' : ' <span style="color:#a8761a">≈ 近似</span>') +'</div>';
      }
    });
    if (!(n.digestPoints||[]).length) h += '<li style="color:#9aa4a0">这条暂无浓缩要点</li>';
    h += '</ul></div>';

    h += '<div class="dsec"><div class="sk">原文关键信息</div>'
      + kv('受众', n.audience||'—') + kv('截止', n.deadline||'无') + kv('材料', n.materials||'—')
      + kv('办理入口', n.entry||'—') + kv('置信度', (n.confidence!=null? n.confidence : '—'))
      + '</div>';

    /* 大模型理解（构建期离线预计算 · 如实标注「非实时调用」）
     * 与 知时.html / 小程序详情页同源：产物来自 export_llm_fields.js 注入的 n.llm。
     * 断网可演；每条带模型 / 提示词版本 / 引文定位等级，可逐条回原文核对。 */
    if(n.llm && n.llm.fields){
      var lf = n.llm.fields;
      h += '<div class="dsec" style="border-left:3px solid #0A6B4B">'
        + '<div class="sk">大模型理解 · 构建期离线预计算，非实时调用</div>'
        + kv('事件类型', lf.event_type||'原文未明确说明')
        + kv('谁该看', lf.who||'原文未明确说明')
        + kv('要做什么', lf.what||'原文未明确说明')
        + kv('在哪办', lf.where||'原文未明确说明')
        + kv('截止时间', lf.deadline||'原文未明确说明')
        + kv('所需材料', lf.materials||'原文未明确说明')
        + (lf.summary? '<div style="font-size:12px;color:#33413a;line-height:1.6;margin-top:8px">· '+esc(lf.summary)+'</div>' : '')
        + (lf.source_quote? '<div class="quote" style="margin-top:8px">模型依据原文：「'+esc(lf.source_quote)+'」</div>' : '')
        + '<div style="font-size:10.5px;color:#9aa4a0;margin-top:8px">模型 '+esc(n.llm.model||'auto')
        + ' · 提示词 '+esc(n.llm.promptVersion||'unknown')
        + ' · 引文定位 '+esc(n.llm.quoteMatch||'none')
        + ' · 生成于 '+esc(String(n.llm.at||'').slice(0,10))+'</div>'
        + '</div>';
    }

    h += '<div class="dsec"><div class="sk">原文（可逐字核对）</div>'
      + '<div class="quote" style="max-height:180px;overflow:auto">'+esc(n.raw||'（本条无原文收录）')+'</div></div>';
    return '<div class="pad" style="padding-top:0">'+h+'</div>';
  }

  function hostOf(u){
    try { return String(u).replace(/^https?:\/\//,'').split('/')[0]; } catch(e){ return '官网'; }
  }

  /* 时间轴：发布 · 今天 · 截止（三点一线，一眼看出"还差多久"） */
  function timelineHtml(n){
    if (!n.deadline) return '';
    var pub = n.publish || '', ddl = n.deadline;
    var cd = n.countdown;
    var ddlTxt = (typeof cd === 'number')
      ? (cd < 0 ? '已过 ' + Math.abs(cd) + ' 天' : (cd === 0 ? '今天' : '还差 ' + cd + ' 天'))
      : '';
    var ddlCls = (typeof cd === 'number' && cd < 0) ? 'exp' : (typeof cd === 'number' && cd <= 3 ? 'hi' : 'md');
    return '<div class="dsec"><div class="sk">时间线</div>'
      + '<div class="tl">'
      + '<div class="tl-n"><span class="tl-d pub"></span><b>发布</b><span class="tl-t">'+esc(pub||'—')+'</span></div>'
      + '<div class="tl-line"></div>'
      + '<div class="tl-n"><span class="tl-d now"></span><b>今天</b><span class="tl-t">'+new Date().getFullYear()+'-'+pad2(new Date().getMonth()+1)+'-'+pad2(new Date().getDate())+'</span></div>'
      + '<div class="tl-line"></div>'
      + '<div class="tl-n"><span class="tl-d '+ddlCls+'"></span><b>截止</b><span class="tl-t">'+esc(ddl)+'</span>'
      + (ddlTxt? '<span class="tl-g '+ddlCls+'">'+esc(ddlTxt)+'</span>' : '')+'</div>'
      + '</div></div>';
  }
  function pad2(n){ return n<10 ? '0'+n : ''+n; }

  function kv(k,v){ return '<div class="kv"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>'; }

  /* ---------- 事件委托 ---------- */
  document.addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('[data-open],[data-act],[data-tab],[data-hot],[data-ask],[data-cal],[data-day],[data-set],[data-tag],[data-addkw],[data-rmkw]') : null;
    if (!el) return;

    /* 自定义关键词订阅：添加 / 删除（与小程序同源，只是演示态不入库） */
    if (el.hasAttribute('data-addkw')){
      var w=el.getAttribute('data-addkw');
      S.profile.keywords = S.profile.keywords || [];
      if (S.profile.keywords.some(function(k){return ZS.normKeyword(k)===ZS.normKeyword(w);})){ notify('这个词已经订过了'); return; }
      if (S.profile.keywords.length >= ZS.MAX_KEYWORDS){ notify('最多订阅 '+ZS.MAX_KEYWORDS+' 个关键词'); return; }
      S.profile.keywords.push(w); render(); notify('已订阅「'+w+'」'); return;
    }
    if (el.hasAttribute('data-rmkw')){
      var rw=el.getAttribute('data-rmkw');
      S.profile.keywords = (S.profile.keywords||[]).filter(function(k){return ZS.normKeyword(k)!==ZS.normKeyword(rw);});
      render(); notify('已取消订阅'); return;
    }
    if (el.getAttribute('data-act')==='addkw'){
      var inp=document.getElementById('inKw');
      var raw=inp?String(inp.value||'').replace(/\s+/g,''):'';
      if(!raw){ notify('请输入关键词'); return; }
      if(raw.length>20){ notify('关键词最多 20 个字'); return; }
      S.profile.keywords = S.profile.keywords || [];
      if (S.profile.keywords.some(function(k){return ZS.normKeyword(k)===ZS.normKeyword(raw);})){ notify('这个词已经订过了'); return; }
      if (S.profile.keywords.length >= ZS.MAX_KEYWORDS){ notify('最多订阅 '+ZS.MAX_KEYWORDS+' 个关键词'); return; }
      S.profile.keywords = ZS.sanitizeKeywords(S.profile.keywords.concat([raw]));
      render(); notify('已订阅「'+raw+'」'); return;
    }

    /* tab 切换 */
    if (el.hasAttribute('data-tab')){ S.tab=el.getAttribute('data-tab'); S.dt=null; render(); return; }
    /* 打开详情 */
    if (el.hasAttribute('data-open') && !el.hasAttribute('data-act')){
      S.dt = el.getAttribute('data-id'); S.readIds[S.dt]=true; render(); return;
    }
    var act = el.getAttribute('data-act');
    if (act==='back'){ S.dt=null; render(); return; }
    /* 展开/收起：状态存 S.folds，render 后不丢 */
    if (act==='fold'){
      var tg = el.getAttribute('data-target');
      S.folds = S.folds || {};
      S.folds[tg] = !S.folds[tg];
      render(); return;
    }
    if (act==='hidden'){ S.tab='me'; render(); notify('已删除条目可在「订阅」页找回'); return; }
    if (act==='restoreall'){ S.hiddenIds={}; render(); notify('已全部找回'); return; }
    if (act==='dosearch'){ var q=document.getElementById('sq'); S.q=q?q.value:''; render(); return; }
    if (act==='togread'){ var id=S.dt; if(S.readIds[id]) delete S.readIds[id]; else S.readIds[id]=true; render(); return; }
    if (act==='togdel'){ var d=S.dt;
      if (S.hiddenIds[d]){ delete S.hiddenIds[d]; notify('已找回'); } else { S.hiddenIds[d]=true; S.dt=null; notify('已删除，可在订阅页找回'); }
      render(); return; }
    /* 热词 */
    if (el.hasAttribute('data-hot')){ S.q=el.getAttribute('data-hot'); render(); return; }
    /* 问一句 */
    if (el.hasAttribute('data-ask')){
      var a = ZS.askAnswer(el.getAttribute('data-ask'), { notices:pool(), profile:S.profile });
      S.askResult = a; render(); return; }
    /* 日历翻月 / 选日 */
    if (el.hasAttribute('data-cal')){ var del=+el.getAttribute('data-cal');
      var nm=ZS.shiftMonth(S.cal.y,S.cal.m,del); S.cal={y:nm.year,m:nm.month}; S.calDay=null; render(); return; }
    if (el.hasAttribute('data-day') && el.getAttribute('data-has')==='1'){
      S.calDay=+el.getAttribute('data-day'); render(); return; }
    /* 档案维度 */
    if (el.hasAttribute('data-set')){ S.profile[el.getAttribute('data-set')]=el.getAttribute('data-v'); render(); notify('档案已更新，去雷达看看'); return; }
    if (el.hasAttribute('data-tag')){ var k=el.getAttribute('data-tag'), i=S.profile.interests.indexOf(k);
      if (i>=0) S.profile.interests.splice(i,1); else S.profile.interests.push(k); render(); return; }
  });

  /* 搜索框回车 */
  document.addEventListener('keydown', function(e){
    if (e.key==='Enter' && e.target && e.target.id==='sq'){ S.q=e.target.value; render(); }
  });

  /* 长按推送卡 → ActionSheet */
  var lpTimer=null;
  document.addEventListener('pointerdown', function(e){
    var card = e.target.closest ? e.target.closest('.card[data-open]') : null;
    if (!card) return;
    lpTimer = setTimeout(function(){ openSheet(card.getAttribute('data-id')); }, 520);
  });
  document.addEventListener('pointerup', function(){ clearTimeout(lpTimer); });
  document.addEventListener('pointermove', function(){ clearTimeout(lpTimer); });
  document.addEventListener('pointercancel', function(){ clearTimeout(lpTimer); });
  document.addEventListener('contextmenu', function(e){
    var card = e.target.closest ? e.target.closest('.card[data-open]') : null;
    if (card){ e.preventDefault(); openSheet(card.getAttribute('data-id')); }
  });

  function openSheet(id){
    var read = !!S.readIds[id];
    var sheet = document.getElementById('sheet'), mask=document.getElementById('sheetMask');
    sheet.innerHTML = '<div class="st">这条通知</div>'
      + '<button class="ok" data-sheet="togread">'+(read?'标记为未读':'标记为已读')+'</button>'
      + '<button class="warn" data-sheet="del">删除这条</button>'
      + '<button class="cancel" data-sheet="close">取消</button>';
    sheet.classList.add('show'); mask.classList.add('show');
    sheet.onclick = function(ev){
      var b = ev.target.closest('[data-sheet]'); if(!b) return;
      var k = b.getAttribute('data-sheet');
      if (k==='togread'){ if(read) delete S.readIds[id]; else S.readIds[id]=true; notify(read?'已标为未读':'已标为已读'); }
      else if (k==='del'){ S.hiddenIds[id]=true; notify('已删除，可在订阅页找回'); }
      closeSheet(); render();
    };
    mask.onclick = closeSheet;
  }
  function closeSheet(){ document.getElementById('sheet').classList.remove('show');
    document.getElementById('sheetMask').classList.remove('show'); }

  /* ---------- 时钟 ---------- */
  function tick(){ var d=new Date();
    var el=document.getElementById('clock'); if(el) el.textContent=d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); }
  tick(); setInterval(tick, 20000);

  /* ---------- 首屏 ---------- */
  render();
  window.__ZS_DEMO__ = { state:S, render:render };
})();
</script>
</body>
</html>
"""


def main():
    core = read(CORE)
    data = read(DATA)
    if "global.ZS = {" not in core:
        print("✗ web/zhishi-core.js 未找到 global.ZS 挂载，源文件可能已改结构")
        sys.exit(1)
    if "window.ZS_DATA" not in data:
        print("✗ web/zhishi-data.js 未找到 window.ZS_DATA，先跑 export_mp_data_to_web.py")
        sys.exit(1)
    html = build_html(core, data)
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(OUT)
    n = data.count('"id":')
    print("[OK] 已生成：%s" % OUT)
    print("     字节数：%d（内联 core %d 行 + data %d 行，约 %d 条通知）"
          % (size, core.count("\n") + 1, data.count("\n") + 1, n))


if __name__ == "__main__":
    main()
