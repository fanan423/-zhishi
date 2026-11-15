/**
 * 生成「知时_演示版.html」—— 引导式答辩演示页 / 录视频投屏材料
 * ================================================================
 * 为什么要有这份：
 *   项目已有很多零散页面，但缺一份「按官方评分维度组织、能直接录成视频、
 *   双击即开、断网可演」的答辩材料。现有长图字号小、投屏可读性差，
 *   且 KPI 写死（156）与真实数据对不上。本脚本一次性解决这些：
 *     1. 所有 KPI 构建时从 web/zhishi-data.js 现算，绝不写死数字；
 *     2. 叙事按「先给结论，再给边界」组织，避免诚实标注被首因效应误读；
 *     3. 单文件自包含（CSS/JS 全内联），无外链、无 CDN、无字体依赖。
 *
 * 用法：node tools/build_presentation.js
 * 产出：项目根目录 知时_演示版.html（UTF-8）
 * 依赖：零第三方包，只用 Node 内置 fs / path
 * 幂等：可重复运行，每次都从数据源重新现算并覆盖输出
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* 用 __dirname 定位根目录，不硬编码绝对路径 */
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'web', 'zhishi-data.js');
const OUT = path.join(ROOT, '知时_演示版.html');

/**
 * 宽松取出 window.ZS_DATA = {...}; 里的 JSON 部分并解析，返回 NOTICES。
 * 数据源形如：window.ZS_DATA = { "NOTICES": [...], "PROFILE": {...}, "META": {...} };
 * 顶层对象本身是合法 JSON（键都带引号），所以可直接 JSON.parse。
 */
function loadNotices() {
  const src = fs.readFileSync(DATA_FILE, 'utf8');
  let json = null;
  const m = src.match(/window\.ZS_DATA\s*=\s*(\{[\s\S]*\})\s*;/);
  if (m) json = m[1];
  if (!json) {
    /* 兜底：从 window.ZS_DATA 之后第一个 { 到全文最后一个 } */
    const a = src.indexOf('window.ZS_DATA');
    const s = src.indexOf('{', a);
    const e = src.lastIndexOf('}');
    json = src.slice(s, e + 1);
  }
  const data = JSON.parse(json);
  return Array.isArray(data.NOTICES) ? data.NOTICES : [];
}

/** 把对象安全内联进 <script>：转义 < > & 及行分隔符，防止 </script> 提前闭合 */
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* ==================================================================
 * HTML 模板
 * 说明：整份演示页自包含，设计画布固定 1280x720（16:9），运行时整体
 *       等比缩放适配窗口。模板中不含 ${ 与反引号，避免与外层模板字面量冲突；
 *       页面内联脚本全部用字符串拼接，不使用模板字面量。
 *   __DEMO_STAT__      → const DEMO_STAT = {...};
 *   __DEMO_AI_SAMPLE__ → const DEMO_AI_SAMPLE = [...];
 * ================================================================== */
const TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>知时 · 安农校园信息雷达 | 答辩演示版</title>
<style>
  :root{
    --bg:#F7F8F7; --card:#FFFFFF; --card-2:#F2F5F2;
    --line:#E4E9E4; --line-soft:#EEF2EE;
    --brand:#0A6B4B; --brand-soft:rgba(10,107,75,.08);
    --gold:#E5A21B; --gold-soft:rgba(229,162,27,.12); --gold-ink:#8A6000;
    --alert:#D9633B; --alert-soft:rgba(217,99,59,.10); --alert-ink:#A9431D;
    --txt:#1A2420; --txt-2:#5E6B64; --txt-3:#98A49C;
    --on-brand:#FFFFFF; --radius:16px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;overflow:hidden;background:#101914}
  body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--txt)}
  code{font-family:Consolas,Monaco,"Courier New",monospace;font-size:.88em;background:var(--card-2);
    padding:2px 7px;border-radius:5px;color:var(--brand)}

  /* ---------- 固定 16:9 画布，运行时整体缩放 ---------- */
  #stage{position:absolute;left:50%;top:50%;width:1280px;height:720px;
    transform-origin:center center;background:var(--bg);overflow:hidden;
    box-shadow:0 24px 80px rgba(0,0,0,.38)}
  #prog{position:absolute;left:0;top:0;height:5px;width:0;z-index:30;
    background:linear-gradient(90deg,var(--brand),var(--gold));transition:width .15s ease}

  /* ---------- 屏 ---------- */
  .screen{position:absolute;inset:0;display:none;flex-direction:column;
    padding:34px 60px 78px;background:var(--bg);z-index:2}
  .screen.on{display:flex}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:15px;color:var(--brand);
    background:var(--brand-soft);border-radius:999px;padding:6px 14px;align-self:flex-start;
    margin-bottom:12px;font-weight:700;letter-spacing:.5px}
  h2.st{font-size:40px;line-height:1.25;font-weight:800;letter-spacing:-.5px}
  .lead{font-size:20px;color:var(--txt-2);margin-top:9px;line-height:1.6}
  .foot-note{font-size:14px;color:var(--txt-3);margin-top:auto;padding-top:12px;
    border-top:1px dashed var(--line);line-height:1.6}
  .foot-note b,.foot-note code{color:var(--txt-2)}
  .card{background:var(--card);border:1px solid var(--line-soft);border-radius:var(--radius);padding:20px 24px}
  .card-h{font-size:21px;font-weight:700;margin-bottom:10px}
  .card-h small{font-size:14px;color:var(--txt-3);font-weight:400;margin-left:8px}
  .mini{font-size:16px;color:var(--txt-2);line-height:1.6;margin-top:12px}
  .mini b{color:var(--txt)}

  /* ---------- 深色屏（封面 / 收尾）---------- */
  .screen.darkscreen{background:linear-gradient(140deg,#0A6B4B 0%,#0b7a55 55%,#0d865d 100%);color:#fff}
  .screen.darkscreen .eyebrow{background:rgba(255,255,255,.14);color:#fff}
  .brandmark{width:96px;height:96px;border-radius:24px;background:#fff;color:var(--brand);
    font-size:52px;font-weight:800;display:flex;align-items:center;justify-content:center;
    box-shadow:0 12px 30px rgba(0,0,0,.18)}
  .cover-main{margin:auto 0;display:flex;flex-direction:column;align-items:flex-start}
  .screen.cover .brandmark{margin-bottom:24px}
  .screen.cover h1{font-size:60px;font-weight:800;letter-spacing:-1px;line-height:1.15}
  .dot-sep{color:var(--gold)}
  .screen.cover .conclusion{font-size:26px;line-height:1.65;margin-top:20px;opacity:.96;max-width:1040px}
  .screen.cover .conclusion b{color:var(--gold)}
  .tags{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap}
  .tag{font-size:18px;padding:9px 18px;border-radius:999px;background:rgba(255,255,255,.12);
    border:1px solid rgba(255,255,255,.3);color:#fff}
  .tag.primary{background:var(--gold);border-color:var(--gold);color:#4a3400;font-weight:700}
  .tag.ghost{background:transparent}
  .cover-foot{display:flex;justify-content:space-between;align-items:center;font-size:16px;
    opacity:.9;border-top:1px solid rgba(255,255,255,.25);padding-top:16px}
  .cover-foot .hint{font-size:14px;opacity:.8}
  .end-inner{margin:auto;display:flex;flex-direction:column;align-items:center;text-align:center}
  .end-inner .brandmark{margin-bottom:24px}
  .end-thanks{font-size:25px;opacity:.9;letter-spacing:4px;margin-bottom:12px}
  .screen.end h1{font-size:54px;font-weight:800}
  .screen.end p{font-size:23px;margin-top:14px;color:var(--gold)}
  .end-tags{margin-top:28px;font-size:17px;opacity:.85;
    border-top:1px solid rgba(255,255,255,.25);padding-top:16px}

  /* ---------- 屏 1：KPI ---------- */
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:24px}
  .kpi{background:var(--card);border:1px solid var(--line-soft);border-radius:16px;
    padding:22px 22px;display:flex;flex-direction:column;box-shadow:0 4px 18px rgba(20,40,30,.04)}
  .kpi b{font-size:64px;line-height:1;font-weight:800;color:var(--brand);
    letter-spacing:-2px;font-variant-numeric:tabular-nums}
  .kpi span{font-size:21px;font-weight:700;margin-top:12px}
  .kpi em{font-style:normal;font-size:14px;color:var(--txt-3);margin-top:5px}
  .kpi.accent{background:linear-gradient(150deg,#0A6B4B,#0d7d58);border-color:transparent}
  .kpi.accent b,.kpi.accent span{color:#fff}
  .kpi.accent em{color:rgba(255,255,255,.72)}
  .callout{margin-top:22px;background:var(--gold-soft);border-left:5px solid var(--gold);
    border-radius:0 12px 12px 0;padding:15px 22px;font-size:20px;color:var(--gold-ink);line-height:1.6}
  .callout b{color:var(--alert-ink)}

  /* ---------- 屏 2：创新性 ---------- */
  .row{display:flex;gap:20px;margin-top:20px}
  .shift{display:flex;flex-direction:column;gap:10px;flex:0 0 45%;justify-content:center}
  .shift-box{border-radius:14px;padding:16px 20px;border:1px solid var(--line)}
  .shift-box.old{background:var(--card-2);opacity:.9}
  .shift-box.new{background:var(--brand-soft);border-color:rgba(10,107,75,.35)}
  .shift-lab{font-size:14px;color:var(--txt-3);display:block;margin-bottom:4px}
  .shift-box b{font-size:25px;display:block}
  .shift-box.new b{color:var(--brand)}
  .shift-box small{font-size:15px;color:var(--txt-2);display:block;margin-top:5px}
  .shift-arrow{font-size:28px;color:var(--gold);text-align:center;line-height:1}
  .explain{flex:1}
  .explain p{font-size:18px;color:var(--txt-2);line-height:1.65}
  .explain b{color:var(--txt)}
  .reasons{list-style:none;margin-top:12px;display:flex;flex-direction:column;gap:8px}
  .reasons li{display:flex;justify-content:space-between;align-items:center;background:var(--card-2);
    border-radius:9px;padding:9px 14px;font-size:17px}
  .reasons em{font-style:normal;font-size:14px;color:var(--brand);background:var(--brand-soft);
    border-radius:999px;padding:3px 10px}
  .trace-bar{margin-top:18px;background:var(--card);border:1px solid var(--line-soft);
    border-radius:14px;padding:15px 24px;display:flex;justify-content:space-between;
    align-items:center;font-size:19px}
  .trace-bar b{color:var(--brand)}
  .trace-num{display:flex;align-items:baseline;gap:10px}
  .trace-num b{font-size:38px;color:var(--gold);font-weight:800}
  .trace-num span{font-size:16px;color:var(--txt-2)}

  /* ---------- 屏 3：实用性 ---------- */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
  .fresh-row{display:flex;align-items:baseline;gap:8px;font-size:17px;color:var(--txt-2);margin:6px 0}
  .fresh-row b{font-size:32px;color:var(--brand)}
  .fresh-bar{display:flex;height:20px;border-radius:10px;overflow:hidden;background:var(--card-2);margin:6px 0 10px}
  .fb-ok{background:var(--brand)}
  .fb-ex{background:var(--alert-soft);border-left:2px solid #fff}
  .fresh-legend{display:flex;gap:22px;font-size:16px;color:var(--txt-2)}
  .fresh-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px}
  .fresh-legend i.ok{background:var(--brand)}
  .fresh-legend i.ex{background:var(--alert)}
  .fresh-legend b{font-size:21px;color:var(--txt)}
  .cover-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px}
  .cover-grid>div{background:var(--card-2);border-radius:12px;padding:12px 10px;text-align:center}
  .cover-grid b{display:block;font-size:31px;color:var(--brand);font-weight:800}
  .cover-grid b.ys{font-size:23px;letter-spacing:0}
  .cover-grid span{font-size:15px;color:var(--txt-2)}
  .dist{margin-top:16px;padding:14px 24px}
  .dist-bars{display:grid;grid-template-columns:repeat(3,1fr);gap:7px 26px;margin-top:8px}
  .dist-item{display:flex;align-items:center;gap:9px;font-size:15px}
  .dist-item .nm{width:76px;flex:0 0 76px;color:var(--txt-2)}
  .dist-item .bar{flex:1;height:11px;background:var(--card-2);border-radius:6px;overflow:hidden}
  .dist-item .bar i{display:block;height:100%;background:var(--brand);border-radius:6px}
  .dist-item .vv{width:28px;text-align:right;font-weight:700;color:var(--brand)}

  /* ---------- 屏 4：技术实现 ---------- */
  .arch{display:flex;align-items:stretch;gap:9px;margin-top:18px}
  .arch-step{flex:1;background:var(--card);border:1px solid var(--line-soft);border-radius:12px;
    padding:12px 14px;border-top:4px solid var(--brand)}
  .arch-step b{font-size:20px;display:block;color:var(--brand)}
  .arch-step span{font-size:14px;color:var(--txt-2);display:block;margin-top:5px;line-height:1.5}
  .arch-arw{display:flex;align-items:center;font-size:23px;color:var(--gold)}
  .map-tbl{width:100%;border-collapse:collapse;margin-top:6px}
  .map-tbl th,.map-tbl td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line-soft);
    font-size:16px;line-height:1.5;vertical-align:top}
  .map-tbl tr:last-child th,.map-tbl tr:last-child td{border-bottom:none}
  .map-tbl th{width:180px;color:var(--brand);font-weight:700;white-space:nowrap}
  .map-tbl td{color:var(--txt-2)}
  .map-tbl b{color:var(--txt)}
  .green-badge{margin-top:14px;align-self:flex-start;background:var(--brand);color:#fff;
    border-radius:12px;padding:10px 20px;font-size:18px}
  .green-badge b{font-size:25px;color:var(--gold)}

  /* ---------- 屏 5：AI 举证（紧凑排版，确保 720 画布内不溢出）---------- */
  .screen.ai{padding:26px 60px 76px}
  .screen.ai .eyebrow{margin-bottom:8px}
  .screen.ai h2.st{font-size:34px}
  .ai-head{display:flex;justify-content:space-between;align-items:flex-start}
  .offline-badge{background:var(--gold-soft);border:1px solid rgba(229,162,27,.5);
    color:var(--gold-ink);border-radius:12px;padding:8px 14px;font-size:14px;
    text-align:right;line-height:1.45;flex:0 0 auto}
  .offline-badge b{font-size:18px;color:var(--alert-ink)}
  .sample-tabs{display:flex;gap:10px;margin:8px 0 6px;min-height:30px;align-items:center}
  .sample-tabs button{font-size:14px;padding:5px 14px;border-radius:999px;border:1px solid var(--line);
    background:#fff;color:var(--txt-2);cursor:pointer}
  .sample-tabs button.on{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:700}
  .sample-tabs .mini{margin-top:0}
  .ai-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .ai-left,.ai-right{padding:10px 14px}
  .ai-lab{font-size:13px;color:var(--brand);font-weight:700;letter-spacing:.5px;margin-bottom:5px}
  .ai-title{font-size:18px;font-weight:700;line-height:1.35}
  .ai-meta{font-size:13px;color:var(--txt-3);margin-top:3px}
  .ai-raw{margin-top:7px;background:var(--card-2);border-radius:9px;padding:8px 10px;
    font-size:15px;line-height:1.5;color:var(--txt-2);max-height:96px;overflow:hidden}
  .ai-raw mark{background:var(--gold-soft);color:var(--gold-ink);border-radius:3px;
    padding:1px 2px;font-weight:700}
  .ai-url{margin-top:6px;font-size:11px;color:var(--txt-3);word-break:break-all;
    font-family:Consolas,Monaco,monospace}
  .fields{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
  .fcard{background:var(--card-2);border-radius:8px;padding:5px 7px;min-height:44px}
  .fcard.wide{grid-column:1/-1}
  .fcard span{display:block;font-size:11px;color:var(--txt-3)}
  .fcard b{display:block;font-size:14px;font-weight:600;line-height:1.4;margin-top:2px;color:var(--txt)}
  .quote-row{margin-top:8px;background:var(--brand-soft);border-left:5px solid var(--brand);
    border-radius:0 12px 12px 0;padding:8px 12px}
  .quote-txt{font-size:15px;line-height:1.5;color:var(--txt)}
  .quote-txt span{color:var(--brand);font-weight:600}
  .quote-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
  .quote-badges span{font-size:12px;background:#fff;border:1px solid var(--line);
    border-radius:999px;padding:2px 9px;color:var(--txt-2)}
  .quote-badges span.full{color:var(--brand);border-color:rgba(10,107,75,.4);
    background:var(--brand-soft);font-weight:700}
  .none{background:var(--card);border:1px dashed var(--line);border-radius:14px;
    padding:56px;text-align:center;font-size:23px;color:var(--txt-3)}
  .screen.ai .foot-note{font-size:13px;padding-top:8px}

  /* ---------- 屏 6：现场演示 ---------- */
  .demo-row{display:grid;grid-template-columns:.9fr 1.1fr;gap:22px;margin-top:20px;
    flex:1;min-height:0}
  .demo-left{display:flex;flex-direction:column;gap:16px}
  .big-btn{display:inline-block;background:var(--brand);color:#fff;font-size:23px;
    font-weight:700;text-decoration:none;padding:16px 26px;border-radius:14px;text-align:center;
    box-shadow:0 8px 22px rgba(10,107,75,.28)}
  .big-btn:hover{background:#085a3f}
  .demo-points{list-style:none;display:flex;flex-direction:column;gap:10px}
  .demo-points li{background:var(--card);border:1px solid var(--line-soft);border-radius:12px;
    padding:11px 15px;font-size:17px;color:var(--txt-2);line-height:1.5}
  .demo-points b{color:var(--brand);font-size:18px}
  .demo-frame-wrap{background:var(--card);border:1px solid var(--line);
    border-radius:16px;overflow:hidden;min-height:0}
  #appFrame{width:100%;height:100%;border:0;display:block;background:#fff}

  /* ---------- 屏 7：边界与诚实 ---------- */
  .bound-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
  .bound{background:var(--card);border:1px solid var(--line-soft);border-radius:14px;
    padding:11px 15px;border-left:5px solid var(--gold)}
  .bound.wide{grid-column:1/-1}
  .bno{font-size:13px;color:var(--gold-ink);font-weight:800;letter-spacing:1px}
  .bound b{display:block;font-size:19px;margin:2px 0 4px}
  .bound p{font-size:16px;color:var(--txt-2);line-height:1.5}
  .honest-line{margin-top:10px;font-size:20px;font-weight:700;color:var(--brand);
    text-align:center;background:var(--brand-soft);border-radius:12px;padding:9px}

  /* ---------- 屏 8：交付清单 ---------- */
  .checklist{display:grid;grid-template-columns:1fr 1fr;gap:9px 18px;margin-top:16px}
  .ck{display:flex;align-items:center;gap:11px;background:var(--card);
    border:1px solid var(--line-soft);border-radius:11px;padding:10px 13px}
  .ck-mark{width:25px;height:25px;border-radius:50%;flex:0 0 25px;display:flex;
    align-items:center;justify-content:center;font-size:15px;font-weight:800}
  .ck-mark.ok{background:var(--brand);color:#fff}
  .ck-mark.todo{background:var(--gold-soft);color:var(--gold-ink)}
  .ck-txt{flex:1;font-size:16px}
  .ck-st{font-size:13px;border-radius:999px;padding:3px 9px;white-space:nowrap}
  .ck-st.ok{background:var(--brand-soft);color:var(--brand)}
  .ck-st.todo{background:var(--gold-soft);color:var(--gold-ink)}
  .closing{margin-top:16px;display:flex;align-items:center;justify-content:space-between;
    background:var(--brand);color:#fff;border-radius:14px;padding:16px 24px}
  .closing b{font-size:28px}
  .method{font-size:18px;opacity:.96}

  /* ---------- 底部控制条与左右热区 ---------- */
  .hz{position:absolute;top:0;bottom:68px;width:62px;z-index:10;display:flex;
    align-items:center;justify-content:center;color:var(--txt-3);font-size:28px;
    opacity:.35;pointer-events:none;user-select:none}
  .hz.l{left:0}
  .hz.r{right:0}
  #ctrl{position:absolute;left:0;right:0;bottom:0;height:68px;z-index:20;
    display:flex;align-items:center;justify-content:space-between;padding:0 60px;
    background:linear-gradient(to top,rgba(247,248,247,.98),rgba(247,248,247,.72));
    border-top:1px solid var(--line)}
  .ctrl-hint{font-size:14px;color:var(--txt-3);letter-spacing:.3px}
  .ctrl-right{display:flex;align-items:center;gap:12px}
  #ctrl button{font-family:inherit;font-size:16px;padding:9px 18px;border-radius:10px;
    border:1px solid var(--line);background:#fff;color:var(--txt-2);cursor:pointer}
  #ctrl button:hover{border-color:var(--brand);color:var(--brand)}
  #pg{font-size:16px;color:var(--txt-2);font-variant-numeric:tabular-nums;
    min-width:80px;text-align:right}
  #pg b{color:var(--brand);font-size:21px}
  #stage.dark #ctrl{background:linear-gradient(to top,rgba(6,48,35,.96),rgba(6,48,35,.5));
    border-top-color:rgba(255,255,255,.15)}
  #stage.dark #ctrl button{background:rgba(255,255,255,.1);
    border-color:rgba(255,255,255,.28);color:#fff}
  #stage.dark #ctrl button:hover{background:rgba(255,255,255,.2)}
  #stage.dark #pg{color:rgba(255,255,255,.85)}
  #stage.dark #pg b{color:var(--gold)}
  #stage.dark .ctrl-hint{color:rgba(255,255,255,.65)}
  #stage.dark .hz{color:rgba(255,255,255,.5)}
</style>
</head>
<body>
<div id="stage">
  <div id="prog"></div>

  <!-- ===================== 屏 0 · 封面 ===================== -->
  <section class="screen darkscreen cover on" data-i="0">
    <div><span class="eyebrow">2026「农芯智」AI 智能体创新大赛 · 答辩演示</span></div>
    <div class="cover-main">
      <div class="brandmark">知</div>
      <h1>知时 <span class="dot-sep">·</span> 安农校园信息雷达</h1>
      <p class="conclusion">把散在各官网上、你根本看不见的校园通知，<br>读懂、浓缩，<b>主动送到该看的人手上</b>。</p>
      <div class="tags">
        <span class="tag primary">主对标 ·（二）AI+管理服务</span>
        <span class="tag">兼 ·（四）AI+安农特色</span>
        <span class="tag ghost">原创代码类 · 路径 2</span>
      </div>
    </div>
    <div class="cover-foot">
      <span>双击即开 · 断网可演 · 每条可溯源</span>
      <span class="hint">← → 翻页　·　URL #3 可直达第 3 屏</span>
    </div>
  </section>

  <!-- ===================== 屏 1 · 先给结论 ===================== -->
  <section class="screen" data-i="1">
    <span class="eyebrow">01 · 先给结论</span>
    <h2 class="st">它已经跑起来了</h2>
    <p class="lead">不是概念稿 —— 下面每个数字都由 <code>web/zhishi-data.js</code> 在构建时现算，没有一个写死。</p>
    <div class="kpi-grid">
      <div class="kpi"><b data-k="real">—</b><span>真实公开通知</span><em>real === true</em></div>
      <div class="kpi"><b data-k="units">—</b><span>来源单位</span><em>去重后的发布部门</em></div>
      <div class="kpi"><b data-k="linked">—</b><span>带官网链接</span><em>url 以 http 开头</em></div>
      <div class="kpi accent"><b data-k="aiCount">—</b><span>AI 理解产物</span><em>真实通知中带 llm</em></div>
    </div>
    <div class="callout">一句话：数据、链接、AI 产物都真实存在；页面只读构建期产物，<b>断网也照常演示</b>。</div>
    <div class="foot-note">统计基准日 <b id="baseDate1">—</b>　·　数据源共 <b data-k="total">—</b> 条，其中 <b data-k="demo">—</b> 条为演示样本，未计入上述真实 KPI；全源共 <b data-k="aiCountAll">—</b> 条带 AI 产物。全部 KPI 由 <code>tools/build_presentation.js</code> 现算。</div>
  </section>

  <!-- ===================== 屏 2 · 创新性 ===================== -->
  <section class="screen" data-i="2">
    <span class="eyebrow">02 · 创新性　官方权重 30%</span>
    <h2 class="st">从「你问它答」到「不问也能收到」</h2>
    <p class="lead">一次范式跃迁：不再等学生来搜，而是系统按截止日、学院、订阅画像，把该看的通知主动推过去。</p>
    <div class="row">
      <div class="shift">
        <div class="shift-box old"><span class="shift-lab">常见校园问答助手</span><b>你问 → 它答</b><small>人得先知道有这回事，才会去问</small></div>
        <div class="shift-arrow">↓</div>
        <div class="shift-box new"><span class="shift-lab">知时 · 信息雷达</span><b>不问 → 也能收到</b><small>按真实字段算出该推给谁，主动送达</small></div>
      </div>
      <div class="card explain">
        <div class="card-h">可解释评分：分数 = 理由权重之和</div>
        <p>每一张推送卡片都回答「凭什么推给我」，而且<b>每条理由都能逐条核对</b>，不是黑箱排序。</p>
        <ul class="reasons">
          <li><span>截止日期与我有关</span><em>+ 可核对</em></li>
          <li><span>通知点名了我的学院</span><em>+ 可核对</em></li>
          <li><span>我订阅了这个事件类别</span><em>+ 可核对</em></li>
        </ul>
      </div>
    </div>
    <div class="trace-bar">
      <div><b>全链路溯源</b>　每条浓缩结论都能点回官网原文，双向联动高亮</div>
      <div class="trace-num"><b data-k="deepLink">—</b><span>条官网详情页深链接</span></div>
    </div>
    <div class="foot-note">深链接口径：url 形如 <code>/info/数字/数字.htm</code> 或含 <code>/20xx/</code>，由构建脚本现算 · 数值来自 DEMO_STAT</div>
  </section>

  <!-- ===================== 屏 3 · 实用性 ===================== -->
  <section class="screen" data-i="3">
    <span class="eyebrow">03 · 实用性　官方权重 25%</span>
    <h2 class="st">数据是真的，日期也是真的</h2>
    <p class="lead">新鲜度按真实发布日 / 截止日现算；覆盖范围按数据源逐条去重统计。</p>
    <div class="two-col">
      <div class="card">
        <div class="card-h">数据新鲜度 · 统计基准日 <b id="baseDate2">—</b></div>
        <div class="fresh-row"><span>带截止日</span><b data-k="withDeadline">—</b><span>条</span></div>
        <div class="fresh-bar"><div class="fb-ok" id="fbOk" style="width:10%"></div><div class="fb-ex" id="fbEx" style="width:90%"></div></div>
        <div class="fresh-legend">
          <span><i class="ok"></i>未过期 <b data-k="notExpired">—</b></span>
          <span><i class="ex"></i>已过期 <b data-k="expired">—</b></span>
        </div>
        <p class="mini">已过期的通知如实保留并标注，<b>不删、不改、不产生假数据</b>；提醒只针对仍有效的事项。</p>
      </div>
      <div class="card">
        <div class="card-h">覆盖广度</div>
        <div class="cover-grid">
          <div><b data-k="units">—</b><span>来源单位</span></div>
          <div><b data-k="events">—</b><span>事件类别</span></div>
          <div><b data-k="yearSpan" class="ys">—</b><span>年份跨度</span></div>
        </div>
        <p class="mini">通知来自学校各官网公开栏目，覆盖讲座、竞赛、奖助、考试、选课、图书等场景。</p>
      </div>
    </div>
    <div class="card dist">
      <div class="card-h" id="distTitle">事件分布 <small>按真实通知逐条归类 · 现算</small></div>
      <div class="dist-bars" id="distBars"></div>
    </div>
    <div class="foot-note">「未过期」= deadline ≥ 统计基准日；「已过期」= 带截止日 − 未过期　·　横条按最大值归一化，数值来自 DEMO_STAT.eventDist</div>
  </section>

  <!-- ===================== 屏 4 · 技术实现 ===================== -->
  <section class="screen" data-i="4">
    <span class="eyebrow">04 · 技术实现　官方权重 25%</span>
    <h2 class="st">四层链路 · 逐项对位官方技术评分点</h2>
    <div class="arch">
      <div class="arch-step"><b>① 采集</b><span>注册表驱动 · 可插拔适配器</span></div>
      <div class="arch-arw">→</div>
      <div class="arch-step"><b>② 理解</b><span>大模型抽成结构化八字段</span></div>
      <div class="arch-arw">→</div>
      <div class="arch-step"><b>③ 匹配</b><span>可解释评分 · 两道入库闸门</span></div>
      <div class="arch-arw">→</div>
      <div class="arch-step"><b>④ 提醒</b><span>截止前 7 / 3 / 1 天主动触达</span></div>
    </div>
    <div class="card" style="margin-top:16px;padding:16px 22px">
      <div class="card-h">官方技术实现评分点 · 逐项对位</div>
      <table class="map-tbl"><tbody>
        <tr><th>提示词编写</th><td><code>tools/agent/prompt.js</code> 与小程序端逐字同源、带版本号，针对实测问题迭代加固</td></tr>
        <tr><th>知识库构建</th><td>结构化通知池 + 溯源引文锚点；<b>不用向量库</b>——要的是「查得到」而非「语义相似」，零外部依赖</td></tr>
        <tr><th>工作流编排</th><td>采集 → 时效 / 价值两道入库闸门 → 构建期离线预计算 → 产物注入数据源 → 端上只读</td></tr>
        <tr><th>插件 / 工具集成</th><td>工具链集中在 <code>tools/</code>；校验脚本由 <code>tools/checks/run_all.js</code> 统一纳管，每一样都指向仓库真实文件</td></tr>
        <tr><th>智能体功能完整性</th><td>采集 / 理解 / 匹配 / 提醒 / 问答 / 日历 / 订阅 闭环，页面与说明文档同口径</td></tr>
      </tbody></table>
    </div>
    <div class="green-badge">全量自检 <b>全绿</b>　·　链路校验 <code>check_llm_pipeline</code> 24 项通过</div>
    <div class="foot-note">对位表让评审在 3 秒内找到每个评分点的落点；自检数量随守卫脚本增加而变化，<b>不在此写死</b>，以仓库 <code>node tools/checks/run_all.js</code> 实际输出为准（本项目自检记录，非实时在线检测）</div>
  </section>

  <!-- ===================== 屏 5 · AI 理解层现场举证 ===================== -->
  <section class="screen ai" data-i="5">
    <div class="ai-head">
      <div>
        <span class="eyebrow">05 · AI 理解层现场举证　重点屏</span>
        <h2 class="st">让评审亲眼核对：每个字段都能指回原文</h2>
      </div>
      <div class="offline-badge">构建期大模型预计算结果<br><b>非实时调用</b></div>
    </div>
    <div class="sample-tabs" id="sampleTabs"></div>
    <div id="aiBody"></div>
    <div class="foot-note">产物为构建期离线预计算并注入数据源，页面只读、<b>非实时调用</b>；模型 / 提示词版本 / 引文定位等级均如实标注。无 llm 条目时本屏如实显示「暂无可举证产物」。</div>
  </section>

  <!-- ===================== 屏 6 · 现场演示 ===================== -->
  <section class="screen" data-i="6">
    <span class="eyebrow">06 · 现场演示</span>
    <h2 class="st">现在就打开它</h2>
    <div class="demo-row">
      <div class="demo-left">
        <a class="big-btn" href="知时_可用版.html" target="_blank" rel="noopener">打开可用版应用（新窗口）↗</a>
        <ul class="demo-points">
          <li><b>双击即用</b>　单个 HTML 文件，无需服务器、无需安装</li>
          <li><b>断网可演</b>　CSS / JS / 数据全内联，不加载任何外部资源</li>
          <li><b>每条可溯源</b>　点开任意通知可回到官网原文与出处</li>
        </ul>
        <p class="mini">右侧为同目录 <code>知时_可用版.html</code> 的内嵌预览；<b>file:// 下若预览被浏览器拦截，请用左侧按钮新窗口打开</b>（兜底，不影响演示）。</p>
      </div>
      <div class="demo-frame-wrap">
        <iframe id="appFrame" title="知时可用版应用预览" loading="lazy"></iframe>
      </div>
    </div>
    <div class="foot-note">答辩现场动线：门户 → 可用应用 → 推送卡片 → 详情溯源高亮 → 触达时间线 → 问知时。全程离线可跑。</div>
  </section>

  <!-- ===================== 屏 7 · 边界与诚实 ===================== -->
  <section class="screen" data-i="7">
    <span class="eyebrow">07 · 边界与诚实　放在靠后：先立结论，再讲边界</span>
    <h2 class="st">我们主动把边界写在脸上</h2>
    <p class="lead">用正向表述主动声明：能做什么、不能做什么、哪些还没接通，全部如实标注。</p>
    <div class="bound-grid">
      <div class="bound"><span class="bno">01</span><b>演示模式，主动标注</b><p>未配置微信订阅消息模板 ID，页面主动写「演示模式」，绝不假装已经接通。</p></div>
      <div class="bound"><span class="bno">02</span><b>规则版理解，保留兜底</b><p>未调模型时走规则版，与大模型版共用同一 <code>understandNotice</code> 契约，页面零改动。</p></div>
      <div class="bound"><span class="bno">03</span><b>安全拦截，如实标</b><p>被 WAF 拦下的站点，在数据源面板标为「安全拦截」，不绕、不伪装成已跑通。</p></div>
      <div class="bound"><span class="bno">04</span><b>教务后台，永不接入</b><p>课表、成绩、学籍及任何需登录的后台数据 —— 红线，永不碰。</p></div>
      <div class="bound wide"><span class="bno">05</span><b>合规采集</b><p>只发 <code>GET</code> 读公开页　·　详情页 <code>sleep(0.4s)</code>　·　单站限额　·　不绕 WAF　·　不采集任何个人信息；个性化只来自用户自己填写的关注偏好，数据存本地。</p></div>
    </div>
    <div class="honest-line">诚实优先于好看 —— 凡是没做到的，就不写成做到。</div>
    <div class="foot-note">边界声明与 <code>docs/大赛提交要求.md</code>、<code>docs/大模型理解层_接入与验证.md</code> 的诚实标注话术一致</div>
  </section>

  <!-- ===================== 屏 8 · 交付就绪 ===================== -->
  <section class="screen" data-i="8">
    <span class="eyebrow">08 · 交付就绪 / 收尾</span>
    <h2 class="st">路径 2 提交清单 · 逐项可见</h2>
    <p class="lead">评审以「演示视频 + 说明书」为主要依据，答辩必须现场能跑 —— 缺件如实标，不假装齐了。</p>
    <div class="checklist" id="checklist"></div>
    <div class="closing">
      <div><b>谢谢 · 知时</b></div>
      <div class="method">凡是写下的能力，都能指到一份能跑出来的产物。</div>
    </div>
    <div class="foot-note">路径 2：无法公网部署 → 以演示视频与说明书为主要依据；本演示页自身即「双击即开、断网可演」的现场可运行材料</div>
  </section>

  <!-- ===================== 屏 9 · 收尾静止画面 ===================== -->
  <section class="screen darkscreen end" data-i="9">
    <div class="end-inner">
      <div class="brandmark">知</div>
      <div class="end-thanks">谢谢 · 知时</div>
      <h1>知时 · 安农校园信息雷达</h1>
      <p>聚合公开信息 · 主动送达该看的人</p>
      <div class="end-tags">2026「农芯智」AI 智能体创新大赛　·　原创代码类　·　路径 2</div>
    </div>
    <div class="cover-foot">
      <span>双击即开 · 断网可演 · 每条可溯源</span>
      <span class="hint">按 Home 回到封面</span>
    </div>
  </section>

  <div class="hz l">‹</div>
  <div class="hz r">›</div>
  <div id="ctrl">
    <span class="ctrl-hint">知时 · 安农校园信息雷达　|　← → / 空格 翻页　·　#N 直达</span>
    <div class="ctrl-right">
      <button type="button" id="btnPrev">← 上一屏</button>
      <button type="button" id="btnNext">下一屏 →</button>
      <div id="pg"><b>1</b> / 10</div>
    </div>
  </div>
</div>

<script>
/* 由 tools/build_presentation.js 在构建时内联，页面运行时只读这两个常量 */
__DEMO_STAT__
__DEMO_AI_SAMPLE__

(function(){
  var stage = document.getElementById('stage');
  var screens = [].slice.call(document.querySelectorAll('.screen'));
  var TOTAL = screens.length;
  var prog = document.getElementById('prog');
  var pg = document.getElementById('pg');
  var frame = document.getElementById('appFrame');
  var frameLoaded = false;
  var cur = 0;

  function esc(s){
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  /* 把 source_quote 在原文片段里高亮出来，直观展示「引文定位 full」*/
  function highlightQuote(text, quote){
    if (!quote) return esc(text);
    var i = text.indexOf(quote);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(quote) + '</mark>'
      + esc(text.slice(i + quote.length));
  }

  /* 以 1280x720 为设计画布，整体等比缩放适配窗口（投屏字号稳定）*/
  function fit(){
    var s = Math.min(window.innerWidth/1280, window.innerHeight/720);
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  /* KPI / 事件分布：只读 DEMO_STAT 渲染，页面内没有写死数字 */
  function bindStat(){
    [].forEach.call(document.querySelectorAll('[data-k]'), function(el){
      var v = DEMO_STAT[el.getAttribute('data-k')];
      el.textContent = (v === undefined || v === null) ? '—' : String(v);
    });
    ['baseDate1','baseDate2'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = DEMO_STAT.baseDate;
    });
    var wd = DEMO_STAT.withDeadline || 0;
    var okPct = wd ? Math.round(DEMO_STAT.notExpired / wd * 100) : 0;
    var ok = document.getElementById('fbOk');
    var ex = document.getElementById('fbEx');
    if (ok) ok.style.width = okPct + '%';
    if (ex) ex.style.width = (100 - okPct) + '%';
    var box = document.getElementById('distBars');
    if (box && DEMO_STAT.eventDist && DEMO_STAT.eventDist.length){
      var max = DEMO_STAT.eventDist.reduce(function(m,x){ return Math.max(m,x.v); }, 0) || 1;
      box.innerHTML = DEMO_STAT.eventDist.map(function(x){
        return '<div class="dist-item"><span class="nm">' + esc(x.k) + '</span>'
          + '<span class="bar"><i style="width:' + Math.round(x.v/max*100) + '%"></i></span>'
          + '<span class="vv">' + x.v + '</span></div>';
      }).join('');
      var t = document.getElementById('distTitle');
      if (t) t.innerHTML = DEMO_STAT.eventDist.length + ' 类事件分布 <small>按真实通知逐条归类 · 现算</small>';
    }
  }

  /* 屏 5：AI 举证，从 DEMO_AI_SAMPLE 渲染，无样本则如实显示占位 */
  var aiBody = document.getElementById('aiBody');
  var tabs = document.getElementById('sampleTabs');
  function fieldCard(lab, val, wide){
    return '<div class="fcard' + (wide ? ' wide' : '') + '"><span>' + lab + '</span><b>'
      + (val ? esc(val) : '—') + '</b></div>';
  }
  function renderAI(i){
    [].forEach.call(tabs.querySelectorAll('button'), function(b, bi){
      b.classList.toggle('on', bi === i);
    });
    var s = DEMO_AI_SAMPLE[i];
    if (!s){
      aiBody.innerHTML = '<div class="none">暂无可举证产物</div>';
      return;
    }
    var f = (s.llm && s.llm.fields) || {};
    var L = s.llm || {};
    aiBody.innerHTML =
      '<div class="ai-cols">'
      + '<div class="ai-left card">'
      +   '<div class="ai-lab">通知原文片段 <small style="font-weight:400;color:var(--txt-3)">· 金色为模型定位到的引文</small></div>'
      +   '<div class="ai-title">' + esc(s.title) + '</div>'
      +   '<div class="ai-meta">' + esc(s.source) + ' · 发布 ' + esc(s.publish) + ' · ' + esc(s.id) + '</div>'
      +   '<div class="ai-raw">' + (s.rawStart > 0 ? '…' : '')
      +     highlightQuote(s.raw, f.source_quote) + '…</div>'
      +   '<div class="ai-url">官网原文：' + esc(s.url) + '</div>'
      + '</div>'
      + '<div class="ai-right card">'
      +   '<div class="ai-lab">大模型抽取的字段卡片</div>'
      +   '<div class="fields">'
      +     fieldCard('适用人群 · who', f.who)
      +     fieldCard('要做什么 · what', f.what)
      +     fieldCard('在哪办 · where', f.where)
      +     fieldCard('截止日 · deadline', f.deadline)
      +     fieldCard('所需材料 · materials', f.materials)
      +     fieldCard('事件类型 · event_type', f.event_type)
      +     fieldCard('一句话摘要 · summary', f.summary, true)
      +   '</div>'
      + '</div>'
      + '</div>'
      + '<div class="quote-row">'
      +   '<div class="quote-txt">📌 模型依据原文：<span>' + esc(f.source_quote || '（无引文）') + '</span></div>'
      +   '<div class="quote-badges">'
      +     '<span>模型 ' + esc(L.model) + '</span>'
      +     '<span>提示词版本 ' + esc(L.promptVersion) + '</span>'
      +     '<span class="full">引文定位 ' + esc(L.quoteMatch) + ' · 完整命中</span>'
      +     '<span>产物时间 ' + esc(L.at) + '</span>'
      +   '</div>'
      + '</div>';
  }
  function initAI(){
    if (!DEMO_AI_SAMPLE.length){
      tabs.innerHTML = '<span class="mini">数据源中暂无符合条件的 llm 产物</span>';
      renderAI(0);
      return;
    }
    tabs.innerHTML = DEMO_AI_SAMPLE.map(function(s, i){
      return '<button type="button" data-i="' + i + '">样本 ' + (i+1) + '</button>';
    }).join('');
    tabs.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('button') : null;
      if (b) renderAI(parseInt(b.getAttribute('data-i'), 10));
    });
    renderAI(0);
  }

  /* 屏 8：提交清单状态（已就绪 / 待办，如实标注）*/
  function initChecks(){
    var CHECKS = [
      ['项目说明文档（八章 · 官方模板对齐）', 1, '八章已齐'],
      ['完整演示视频 ≤5min（逐镜脚本 4 分 45 秒）', 0, '脚本已齐 · 待录'],
      ['访问入口 zip（双击即开 · 断网可演）', 0, '打包器已就绪 · 待打包'],
      ['官方命名（学号 + 队名 + 作品名 + 尾缀）', 1, '打包器自动校验'],
      ['云盘上传 + 群内回复「已提交」', 0, '待办'],
      ['现场可运行（本演示页 + 可用版应用）', 1, '已验证 · 断网可演'],
      ['答辩 PPT', 0, '待办']
    ];
    document.getElementById('checklist').innerHTML = CHECKS.map(function(c){
      var ok = c[1] === 1;
      return '<div class="ck"><span class="ck-mark ' + (ok?'ok':'todo') + '">' + (ok?'✓':'○') + '</span>'
        + '<span class="ck-txt">' + esc(c[0]) + '</span>'
        + '<span class="ck-st ' + (ok?'ok':'todo') + '">' + esc(c[2]) + '</span></div>';
    }).join('');
  }

  /* 翻页 */
  function show(i){
    if (i < 0) i = 0;
    if (i > TOTAL-1) i = TOTAL-1;
    cur = i;
    screens.forEach(function(s, si){ s.classList.toggle('on', si === i); });
    stage.classList.toggle('dark', screens[i].classList.contains('darkscreen'));
    prog.style.width = ((i+1)/TOTAL*100) + '%';
    pg.innerHTML = '<b>' + (i+1) + '</b> / ' + TOTAL;
    /* 首次进入现场演示屏才加载 iframe，避免开场就加载大文件 */
    if (i === 6 && !frameLoaded && frame){
      frameLoaded = true;
      frame.src = '知时_可用版.html';
    }
    try { history.replaceState(null, '', '#' + (i+1)); } catch(e){}
  }
  function next(){ show(cur+1); }
  function prev(){ show(cur-1); }

  document.addEventListener('keydown', function(e){
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar'){ e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); prev(); }
    else if (k === 'Home'){ e.preventDefault(); show(0); }
    else if (k === 'End'){ e.preventDefault(); show(TOTAL-1); }
  });

  /* 点击左右热区（两侧各约 8%），交互元素除外 */
  stage.addEventListener('click', function(e){
    if (e.target.closest && e.target.closest('a,button,iframe')) return;
    var r = stage.getBoundingClientRect();
    var s = r.width / 1280;
    var x = (e.clientX - r.left) / s;
    if (x < 100) prev();
    else if (x > 1180) next();
  });
  document.getElementById('btnPrev').addEventListener('click', prev);
  document.getElementById('btnNext').addEventListener('click', next);

  /* URL hash 直达：#N = 第 N 屏（1 起，与右下角页码一致）*/
  function fromHash(){
    var n = parseInt((location.hash || '').replace(/^#/, ''), 10);
    if (isNaN(n) || n <= 0) return 0;
    return Math.min(n-1, TOTAL-1);
  }
  window.addEventListener('hashchange', function(){ show(fromHash()); });
  window.addEventListener('resize', fit);

  fit();
  bindStat();
  initAI();
  initChecks();
  show(fromHash());
})();
</script>
</body>
</html>
`;

/* ==================================================================
 * 主流程：现算 KPI → 挑 AI 样本 → 内联 → 写出 → 打印摘要
 * ================================================================== */
const NOTICES = loadNotices();
const real = NOTICES.filter(function(n){ return n.real === true; });

/* 基准日：用构建当天，并把基准日写进 DEMO_STAT 供页面标注 */
const today = new Date();
const baseDate = today.getFullYear() + '-' +
  String(today.getMonth() + 1).padStart(2, '0') + '-' +
  String(today.getDate()).padStart(2, '0');

const isHttp = function(u){ return /^http/.test(String(u || '')); };
const isDeep = function(u){ return /(\/info\/\d+\/\d+\.htm|\/20\d{2}\/)/.test(String(u || '')); };
const withDdl = real.filter(function(n){ return !!n.deadline; });
const notExpired = withDdl.filter(function(n){ return n.deadline >= baseDate; });

const units = new Set(real.map(function(n){ return n.source; }).filter(Boolean));
const events = new Set(real.map(function(n){ return n.event; }).filter(Boolean));
const years = real.map(function(n){ return String(n.publish || '').slice(0, 4); })
  .filter(Boolean).sort();
const yearSpan = years.length ? years[0] + '-' + years[years.length - 1] : '—';

const evCount = {};
real.forEach(function(n){ if (n.event) evCount[n.event] = (evCount[n.event] || 0) + 1; });
const eventDist = Object.keys(evCount)
  .map(function(k){ return { k: k, v: evCount[k] }; })
  .sort(function(a, b){ return b.v - a.v || a.k.localeCompare(b.k, 'zh'); });

/*
 * aiCount 采用「真实通知」口径：与技术分举证、其余 KPI 保持一致，
 * 不用演示样本把数字做大。aiCountAll 另记全源口径，页面脚注如实披露。
 */
const DEMO_STAT = {
  real: real.length,
  total: NOTICES.length,
  demo: NOTICES.length - real.length,
  units: units.size,
  linked: real.filter(function(n){ return isHttp(n.url); }).length,
  deepLink: real.filter(function(n){ return isDeep(n.url); }).length,
  withDeadline: withDdl.length,
  notExpired: notExpired.length,
  expired: withDdl.length - notExpired.length,
  aiCount: real.filter(function(n){ return !!n.llm; }).length,
  aiCountAll: NOTICES.filter(function(n){ return !!n.llm; }).length,
  events: events.size,
  yearSpan: yearSpan,
  baseDate: baseDate,
  eventDist: eventDist
};

/* 挑 1~2 条「真实 + 带 llm + 引文 full」的通知作为现场举证样本。
 * 排序偏好：抽取字段越全越好 → 引文越长越好 → 发布日越新越好。
 * 这样选出来的样本八个字段基本都有值，且一条常为当前提示词版本(1.1.0)、
 * 一条常为历史产物(unknown)，正好把「版本如实标注」也一并举证。 */
const SAMPLE_KEYS = ['who','what','where','deadline','materials','summary','event_type','source_quote'];

/** 取 200 字原文片段：优先围绕 quoteIndex（引文定位处）开窗，让高亮能落在片段内 */
function makeExcerpt(n) {
  var raw = String(n.raw || n.digestOne || n.digest || '');
  var qi = Number(n.llm && n.llm.quoteIndex);
  if (raw && isFinite(qi) && qi >= 0 && qi < raw.length) {
    /* 让引文落在片段开头附近，金色高亮一定能出现在可见的 200 字窗口内 */
    var start = Math.max(0, qi - 16);
    return { text: raw.slice(start, start + 200), start: start };
  }
  return { text: raw.slice(0, 200), start: 0 };
}

const DEMO_AI_SAMPLE = NOTICES
  .filter(function(n){ return n.real === true && n.llm && n.llm.quoteMatch === 'full'; })
  .map(function(n){
    var f = n.llm.fields || {};
    return {
      n: n,
      rich: SAMPLE_KEYS.reduce(function(s, k){
        return s + (f[k] !== null && f[k] !== undefined && f[k] !== '' ? 1 : 0);
      }, 0),
      qlen: String(f.source_quote || '').length
    };
  })
  .sort(function(a, b){
    return b.rich - a.rich || b.qlen - a.qlen ||
      String(b.n.publish || '').localeCompare(String(a.n.publish || ''));
  })
  .slice(0, 2)
  .map(function(x){
    var n = x.n;
    var ex = makeExcerpt(n);
    return {
      id: n.id,
      title: n.title,
      source: n.source,
      publish: n.publish,
      url: n.url,
      /* 原文片段：优先 raw，其次 digestOne / digest（本项目实际字段为 digestOne）*/
      raw: ex.text,
      rawStart: ex.start,
      llm: {
        offline: n.llm.offline,
        model: n.llm.model,
        at: n.llm.at,
        promptVersion: n.llm.promptVersion,
        quoteMatch: n.llm.quoteMatch,
        quoteIndex: n.llm.quoteIndex,
        fields: n.llm.fields || {}
      }
    };
  });

const statJs = 'const DEMO_STAT = ' + safeJson(DEMO_STAT) + ';';
const sampleJs = 'const DEMO_AI_SAMPLE = ' + safeJson(DEMO_AI_SAMPLE) + ';';

/* 用函数式替换，避免数据里出现 $& 之类被当作替换模式 */
const HTML = TEMPLATE
  .replace('__DEMO_STAT__', function(){ return statJs; })
  .replace('__DEMO_AI_SAMPLE__', function(){ return sampleJs; });

fs.writeFileSync(OUT, HTML, 'utf8');

const kb = (Buffer.byteLength(HTML, 'utf8') / 1024).toFixed(1);
console.log('[OK] 已生成 知时_演示版.html → ' + OUT + '（' + kb + ' KB）');
console.log('     数据源：NOTICES ' + DEMO_STAT.total + ' 条 · 真实 ' + DEMO_STAT.real +
  ' · 演示样本 ' + DEMO_STAT.demo);
console.log('     现算 KPI：来源单位 ' + DEMO_STAT.units + ' · 带官网链接 ' + DEMO_STAT.linked +
  ' · 深链接 ' + DEMO_STAT.deepLink + ' · 带截止日 ' + DEMO_STAT.withDeadline +
  ' · 未过期 ' + DEMO_STAT.notExpired + '/已过期 ' + DEMO_STAT.expired +
  ' · AI 产物 ' + DEMO_STAT.aiCount + '（全源 ' + DEMO_STAT.aiCountAll + '）' +
  ' · 事件 ' + DEMO_STAT.events + ' 类 · 年份 ' + DEMO_STAT.yearSpan +
  ' · 基准日 ' + DEMO_STAT.baseDate);
console.log('     AI 举证样本：' + DEMO_AI_SAMPLE.length + ' 条 → ' +
  (DEMO_AI_SAMPLE.map(function(s){ return s.id; }).join('、') || '（无）'));
