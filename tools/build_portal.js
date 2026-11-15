/**
 * 生成「知时门户.html」—— 统一入口
 * ==========================================
 * 为什么要有：
 *   演示页已经攒到十几个（可用应用 / 主链路 / 浓缩溯源 / 理解层 / 机理 /
 *   数据源 / 小程序预览 / 原始数据 / 体检 / 交互 Demo …），散落各处，
 *   演示时来回找文件很尴尬。
 *   这个脚本把**所有入口收进一个左侧导航 + 右侧工作区**的单文件门户：
 *   点左边一项，右边内嵌打开对应页；顶部给出**当前真实数据规模**。
 *
 * 数据现算：
 *   门户顶部的"真实通知 N 条 / 来源 M 个 / 覆盖 Y 年"不是写死的，
 *   而是从 web/zhishi-data.js 现场统计，数据一改、门户重跑，数字跟着变。
 *
 * 用法：node tools/build_portal.js
 * 产出：项目根目录 知时门户.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, '知时门户.html');

/* ---- 现场统计真实数据规模 ---- */
const dataSrc = fs.readFileSync(path.join(WEB, 'zhishi-data.js'), 'utf8');
let NOTICES = [];
try {
  const m = dataSrc.match(/window\.ZS_DATA\s*=\s*([\s\S]*);\s*$/);
  NOTICES = JSON.parse(m[1]).NOTICES || [];
} catch (e) {
  NOTICES = [];
}
const realOnes = NOTICES.filter((n) => n.real);
const linked = realOnes.filter((n) => n.url).length;
const withDdl = realOnes.filter((n) => n.deadline).length;
const units = new Set(realOnes.map((n) => n.source || '').filter(Boolean));
const years = realOnes.map((n) => (n.publish || '').slice(0, 4)).filter(Boolean).sort();
const yearSpan = years.length ? years[0] + '–' + years[years.length - 1] : '—';

const STAT = {
  real: realOnes.length,
  total: NOTICES.length,
  linked: linked,
  withDdl: withDdl,
  units: units.size,
  yearSpan: yearSpan,
};

/* ---- 导航清单（分组 → 条目）----
 * key:  用于高亮
 * file: 相对根目录的路径；"__app__" 特指可用应用 知时.html
 * tag:  角标文案
 * desc: 一句话说明
 * star: true = 主推（首屏大按钮，其余分组默认折叠）
 */
const NAV = [
  {
    group: '上手就用',
    items: [
      { key: 'app', file: '知时.html', icon: '📱', title: '可用应用',
        tag: '单文件·双击即用', star: true,
        desc: '手机壳界面里真能点：雷达推送流 / 时间轴 / 简报 / 我的。每条贴出处、带主动推送引擎。' },
      { key: 'demo', file: '交互Demo.html', icon: '🕹', title: '交互 Demo',
        tag: '五 Tab 可点', star: true,
        desc: '带完整数据源总览：百余条通知从哪来、怎么分布、被拦截的站点如实标。' },
    ],
  },
  {
    group: '核心演示',
    items: [
      { key: 'digest', file: 'web/digest.html', icon: '🔬', title: '浓缩 + 溯源',
        tag: '最核心', star: true, desc: '左原文右浓缩，双向联动高亮。与官方平台最硬的区别。' },
      { key: 'overview', file: 'web/overview.html', icon: '📊', title: '项目总览',
        tag: '答辩用', star: true, desc: '评分项对位表 + 5 分钟答辩路线 + 合规边界。' },
      { key: 'index', file: 'web/index.html', icon: '🧭', title: '主链路演示',
        tag: 'DEMO 01', desc: '采集 → 理解 → 匹配 → 提醒，一条通知如何变成倒计时卡片。' },
      { key: 'understand', file: 'web/understand.html', icon: '🧠', title: '理解层拆解',
        tag: 'DEMO 03', desc: '非结构化文本 → 结构化五要素，逐条演示如何"读懂"一条通知。' },
    ],
  },
  {
    group: '落地面',
    items: [
      { key: 'pipeline', file: 'web/pipeline.html', icon: '⚙️', title: '数据从哪来 · 跑在哪',
        tag: 'DEMO 04 · 评委必问', desc: '正面回答两个必问题：数据源边界、部署平台。' },
      { key: 'sources', file: 'web/sources.html', icon: '🛰', title: '数据源接入状态',
        tag: 'DEMO 05 · 边界感', desc: '每条链路的真实状态：已跑通 / 需授权 / 永不碰的红线。' },
      { key: 'rawdata', file: 'web/rawdata.html', icon: '🗂', title: '原始数据 · 逐条摊开',
        tag: 'DEMO 07 · 真实数据', desc: '采集器从官网公开页真实抓回的原文，逐条列来源链接与抓取时间。' },
      { key: 'inspect', file: 'web/inspect.html', icon: '🩺', title: '真实数据体检',
        tag: 'DEMO 08', desc: '溯源锚点覆盖率、标签归类、原文可定位率。' },
    ],
  },
  {
    group: '形态预览',
    items: [
      { key: 'mobile', file: 'web/mobile.html', icon: '📲', title: '小程序形态预览',
        tag: 'DEMO 06', desc: '提醒列表 / 详情溯源 / 订阅设置，回答"学生在哪看到它"。' },
      { key: 'mppreview', file: '小程序预览.html', icon: '🖼', title: '十三屏界面预览',
        tag: '数字安农风', desc: '小程序十三屏视觉稿，安农 VI 标准色。' },
      { key: 'mpreal', file: 'web/mp-preview.html', icon: '🧪', title: '小程序真实数据预览',
        tag: 'Node 模拟宿主', desc: 'Node 模拟 wx 宿主把小程序四页真跑一遍生成的静态页。' },
    ],
  },
];

/* ---- 生成导航 HTML ----
 * 统一标记：所有入口都是 a.nv（便于选择/校验），
 *   主推项额外挂 .star（首屏大按钮），普通项挂在折叠分组里；
 *   折叠分组头用 .nv-g 兼作分组标签（兼容校验）。
 * 主推项（star）不进折叠区，直接大按钮置顶；
 * 其余按分组折叠（默认收起），点分组标题展开。 */
function nvItem(it, cls) {
  const ind = cls === 'star' ? '      ' : '        ';
  return ind + '<a class="nv' + (it.star ? ' star' : '') + '" data-key="' + it.key +
    '" href="#" data-file="' + it.file + '">\n' +
    ind + '  <span class="nv-i">' + it.icon + '</span>\n' +
    ind + '  <span class="nv-b"><span class="nv-t">' + it.title + '</span>' +
    '<span class="nv-tg">' + it.tag + '</span></span>\n' +
    (it.star ? ind + '  <span class="nv-a">›</span>\n' : '') +
    ind + '</a>';
}

const starItems = [];
const foldGroups = [];
NAV.forEach((g) => {
  const stars = g.items.filter((it) => it.star);
  const rest = g.items.filter((it) => !it.star);
  stars.forEach((it) => starItems.push(it));
  if (rest.length) foldGroups.push({ group: g.group, items: rest });
});

const starHtml = '    <div class="navh">主推入口</div>\n' +
  starItems.map((it) => nvItem(it, 'star')).join('\n');

const foldHtml = foldGroups.map((g, gi) => (
  '    <div class="fg' + (gi === 0 ? ' open' : '') + '" data-g="' + gi + '">\n' +
  '      <div class="nv-g fg-h" data-fg="' + gi + '"><span>' + g.group + '</span>' +
  '<span class="fg-n">' + g.items.length + '</span><span class="fg-x">▾</span></div>\n' +
  '      <div class="fg-b"' + (gi === 0 ? '' : ' style="display:none"') + '>\n' +
  g.items.map((it) => nvItem(it)).join('\n') + '\n' +
  '      </div>\n' +
  '    </div>'
)).join('\n');

const navHtml = starHtml + '\n' + foldHtml;

const TOTAL = NAV.reduce((s, g) => s + g.items.length, 0);

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>知时 · 安农校园信息雷达 | 统一门户</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--line:#2a2f3a;
    --text:#e8eaed;--sub:#9aa4b2;--accent:#2fae7a;--accent2:#4f93f0;
    --warn:#e09b2d;--radius:14px;}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:var(--bg);color:var(--text);
    font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.6;display:flex;overflow:hidden}

  /* ---------- 左侧导航 ---------- */
  .side{width:314px;flex:0 0 314px;height:100vh;background:var(--panel);
    border-right:1px solid var(--line);display:flex;flex-direction:column}
  .brand{padding:20px 20px 16px;border-bottom:1px solid var(--line)}
  .brand .row{display:flex;align-items:center;gap:11px}
  .logo{width:40px;height:40px;border-radius:12px;flex:0 0 auto;
    background:linear-gradient(135deg,var(--accent),var(--accent2));
    display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;
    color:#06140f;box-shadow:0 6px 18px rgba(47,174,122,.3)}
  .brand h1{font-size:16.5px;letter-spacing:.3px}
  .brand .sub{font-size:11.5px;color:var(--sub);margin-top:2px}
  .brand .stat{margin-top:13px;display:grid;grid-template-columns:1fr 1fr;
    gap:7px}
  .brand .st{background:var(--panel2);border:1px solid var(--line);border-radius:9px;
    padding:7px 9px}
  .brand .st b{font-size:16px;color:var(--accent);font-weight:800;letter-spacing:-.3px}
  .brand .st span{display:block;font-size:10px;color:var(--sub);margin-top:1px}
  .brand .st.b2 b{color:var(--accent2)}

  .nav{flex:1 1 auto;overflow-y:auto;padding:12px 12px 26px}
  .nav::-webkit-scrollbar{width:8px}
  .nav::-webkit-scrollbar-thumb{background:#2c323d;border-radius:4px}

  /* ---------- 主推大按钮（首屏 4 项） ---------- */
  .navh{font-size:10.5px;color:#5f6a78;letter-spacing:1.6px;margin:4px 8px 8px}
  a.nv.star{gap:12px;padding:14px 13px;border-radius:12px;margin-bottom:8px;
    background:linear-gradient(135deg,rgba(47,174,122,.09),rgba(79,147,240,.06));
    border:1px solid var(--line)}
  a.nv.star:hover{border-color:rgba(47,174,122,.55);
    background:linear-gradient(135deg,rgba(47,174,122,.17),rgba(79,147,240,.1))}
  a.nv.star.on{background:linear-gradient(90deg,rgba(47,174,122,.2),rgba(47,174,122,.05));
    border-color:rgba(47,174,122,.55)}
  a.nv.star .nv-i{font-size:21px;width:26px}
  a.nv.star .nv-t{font-size:14.5px;font-weight:700}
  a.nv.star .nv-a{font-size:19px;color:#6b7583;flex:0 0 auto;transition:.16s}
  a.nv.star:hover .nv-a{color:var(--accent);transform:translateX(2px)}

  /* ---------- 折叠分组 ---------- */
  .fg{margin-bottom:6px}
  .nv-g{font-size:10.5px;color:#5f6a78;letter-spacing:1.6px;margin:13px 8px 7px}
  .nv-g:first-child{margin-top:4px}
  .fg-h{display:flex;align-items:center;gap:7px;cursor:pointer;
    padding:7px 8px;border-radius:8px;user-select:none;transition:.15s}
  .fg-h:hover{background:var(--panel2);color:#8f9bab}
  .fg-h span:first-child{flex:1}
  .fg-n{font-size:9.5px;color:#6b7583;background:var(--panel2);
    border:1px solid var(--line);border-radius:20px;padding:0 7px;letter-spacing:0}
  .fg-x{font-size:10px;color:#6b7583;transition:transform .2s;display:inline-block}
  .fg.open .fg-x{transform:rotate(180deg)}
  .fg-b{padding-top:1px}

  a.nv{display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit;
    padding:9px 10px;border-radius:10px;border:1px solid transparent;transition:.16s;
    margin-bottom:2px;cursor:pointer}
  a.nv:hover{background:var(--panel2);border-color:var(--line)}
  a.nv.on{background:linear-gradient(90deg,rgba(47,174,122,.15),rgba(47,174,122,.04));
    border-color:rgba(47,174,122,.4)}
  a.nv.on .nv-t{color:var(--accent)}
  .nv-i{font-size:16px;flex:0 0 auto;width:20px;text-align:center}
  .nv-b{flex:1;min-width:0}
  .nv-t{display:block;font-size:13px;font-weight:600;color:#dfe5ec;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .nv-tg{display:block;font-size:10px;color:#6b7583;margin-top:1px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* ---------- 右侧工作区 ---------- */
  .main{flex:1 1 auto;display:flex;flex-direction:column;height:100vh;min-width:0}
  .bar{flex:0 0 auto;height:56px;border-bottom:1px solid var(--line);
    display:flex;align-items:center;gap:12px;padding:0 18px;background:var(--panel)}
  .bar .title{font-size:14.5px;font-weight:600}
  .bar .desc{font-size:11.5px;color:var(--sub);overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .bar .sp{flex:1}
  .bar .act{border:1px solid var(--line);background:var(--panel2);color:#cdd6e0;
    border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;text-decoration:none;
    display:inline-flex;align-items:center;gap:5px;transition:.15s;white-space:nowrap}
  .bar .act:hover{border-color:var(--accent);color:var(--accent)}
  .frame{flex:1 1 auto;border:0;width:100%;background:#0f1115}
  .hint{flex:1 1 auto;display:flex;align-items:center;justify-content:center;
    text-align:center;color:#5f6a78;font-size:13.5px;padding:40px;flex-direction:column;gap:10px}
  .hint .big{font-size:40px;opacity:.5}

  @media (max-width:860px){
    body{flex-direction:column;overflow:auto}
    .side{width:100%;flex:0 0 auto;height:auto}
    .nav{max-height:240px}
    .main{height:auto}
    .frame{height:78vh}
  }
</style>
</head>
<body>
  <aside class="side">
    <div class="brand">
      <div class="row">
        <div class="logo">知</div>
        <div>
          <h1>知时 · 校园信息雷达</h1>
          <div class="sub">安徽农业大学 · 统一演示门户</div>
        </div>
      </div>
      <div class="stat">
        <div class="st"><b>${STAT.real}</b><span>真实公开通知</span></div>
        <div class="st b2"><b>${STAT.units}</b><span>来源单位</span></div>
        <div class="st b2"><b>${STAT.linked}</b><span>带官网链接</span></div>
        <div class="st"><b>${STAT.yearSpan}</b><span>年份覆盖</span></div>
      </div>
    </div>
    <nav class="nav" id="nav">
${navHtml}
    </nav>
  </aside>

  <main class="main">
    <div class="bar">
      <span class="title" id="barTitle">可用应用</span>
      <span class="desc" id="barDesc"></span>
      <span class="sp"></span>
      <a class="act" id="openNew" href="#" target="_blank">↗ 新窗口打开</a>
    </div>
    <div class="hint" id="hint">
      <span class="big">👈</span>
      <span>左侧选一项，这里直接内嵌打开</span>
      <span style="font-size:11.5px;color:#495159">共 ${TOTAL} 个入口 · 数据规模实时统计自通知池</span>
    </div>
    <iframe class="frame" id="frame" style="display:none"
      referrerpolicy="no-referrer"></iframe>
  </main>

<script>
(function(){
  var nav = document.getElementById('nav');
  var frame = document.getElementById('frame');
  var hint = document.getElementById('hint');
  var barTitle = document.getElementById('barTitle');
  var barDesc = document.getElementById('barDesc');
  var openNew = document.getElementById('openNew');
  var cur = null;

  /* 首次进入自动打开"可用应用" */
  var FIRST = nav.querySelector('a.nv[data-key="app"]');

  function pick(a){
    if (!a) return;
    var file = a.getAttribute('data-file');
    var title = a.querySelector('.nv-t').textContent;
    var desc = a.querySelector('.nv-tg').textContent;
    revealKey(a);
    /* 高亮 */
    [].forEach.call(nav.querySelectorAll('a.nv'), function(x){
      x.classList.toggle('on', x === a);
    });
    barTitle.textContent = title;
    barDesc.textContent = desc;
    openNew.setAttribute('href', file);
    /* 内嵌 */
    hint.style.display = 'none';
    frame.style.display = 'block';
    frame.setAttribute('src', file);
    cur = a;
    try { location.hash = a.getAttribute('data-key'); } catch(e){}
  }

  nav.addEventListener('click', function(e){
    /* 折叠分组头：切换该组展开/收起 */
    var h = e.target.closest ? e.target.closest('.fg-h') : null;
    if (h){
      var fg = h.parentNode;
      var body = fg.querySelector('.fg-b');
      var open = fg.classList.toggle('open');
      if (body) body.style.display = open ? 'block' : 'none';
      return;
    }
    var a = e.target.closest ? e.target.closest('a.nv') : null;
    if (!a) return;
    e.preventDefault();
    pick(a);
  });

  /* 若 #key 落在折叠分组里，自动展开该组 */
  function revealKey(a){
    if (!a) return;
    var fg = a.closest('.fg');
    if (fg && !fg.classList.contains('open')){
      fg.classList.add('open');
      var body = fg.querySelector('.fg-b');
      if (body) body.style.display = 'block';
    }
  }

  /* 支持用 #key 直达（演示时直接贴一个链接进某一页） */
  function fromHash(){
    var k = (location.hash || '').replace(/^#/, '');
    if (!k) return null;
    return nav.querySelector('a.nv[data-key="' + k + '"]');
  }
  window.addEventListener('hashchange', function(){
    var a = fromHash();
    if (a && a !== cur) pick(a);
  });

  pick(fromHash() || FIRST);
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, HTML, 'utf8');
const kb = (Buffer.byteLength(HTML, 'utf8') / 1024).toFixed(1);
console.log('[OK] 已生成统一门户 → ' + OUT + '（' + kb + ' KB）');
console.log('     入口 ' + TOTAL + ' 个 · 真实通知 ' + STAT.real + ' 条 · 来源 ' + STAT.units +
  ' 个 · 带链接 ' + STAT.linked + ' 条 · 覆盖 ' + STAT.yearSpan);
