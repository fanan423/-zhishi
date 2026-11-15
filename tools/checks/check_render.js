/**
 * 真·渲染测试（内联版，排除外链加载顺序干扰）
 * ================================================
 * 上一版失败是因为 jsdom 把 <script src> 当异步资源、顺序不可控。
 * 这一版把所有脚本**内联**进同一个文档，顺序完全确定：
 *   ① 把 zhishi-core.js / zhishi-data.js 的内容直接塞进 <script>
 *   ② 跑 index.html 的内联脚本（提取出来同样内联）
 * 这样测的是"代码本身对不对"，而不是"jsdom 的加载器对不对"。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');

const core = fs.readFileSync(path.join(WEB, 'zhishi-core.js'), 'utf8');
const data = fs.readFileSync(path.join(WEB, 'zhishi-data.js'), 'utf8');
let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

/* 把外链 script 替换成内联内容 */
html = html.replace('<script src="zhishi-core.js"></script>', '<script>\n' + core + '\n</script>');
html = html.replace('<script src="zhishi-data.js"></script>', '<script>\n' + data + '\n</script>');

const errors = [];
const seen = new Set();

const dom = new JSDOM(html, {
  url: 'http://localhost/web/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    /* jsdom 没实现 scrollIntoView，补一个空实现（真实浏览器有） */
    window.Element.prototype.scrollIntoView = function () {};
    window.console.error = (...a) => {
      const m = a.map(x => (x && x.stack) || String(x)).join(' ');
      if (!seen.has(m)) { seen.add(m); errors.push('console.error: ' + m); }
    };
    window.addEventListener('error', (e) => {
      const m = (e.error && e.error.stack) || e.message || '';
      if (!seen.has(m)) { seen.add(m); errors.push('onerror: ' + m); }
    });
  }
});

const { window } = dom;
const D = window.document;

const pass = [];
const fail = [];
function ck(name, cond, extra) {
  if (cond) pass.push(name);
  else fail.push(name + (extra ? ' → ' + extra : ''));
}

console.log('='.repeat(64));
console.log('知时 · 网页版真渲染测试（内联，确定性顺序）');
console.log('='.repeat(64));

(async function main() {

/* ---- 1. 同源脚本挂载 ---- */
console.log('\n【1】同源脚本挂载');
ck('window.ZS 已挂载', typeof window.ZS === 'object');
ck('window.ZS_DATA 已挂载', typeof window.ZS_DATA === 'object');
ck('ZS.search 是函数', typeof window.ZS === 'object' && typeof window.ZS.search === 'function');
ck('NOTICES 有数据', window.ZS_DATA && (window.ZS_DATA.NOTICES || []).length > 0);
console.log('  ZS 方法数:', window.ZS ? Object.keys(window.ZS).length : 0);
console.log('  NOTICES:', window.ZS_DATA ? (window.ZS_DATA.NOTICES || []).length : 0, '条');

/* ---- 2. 页面初始化是否真的跑了 ---- */
console.log('\n【2】页面初始化结果');
const sTags = D.getElementById('sTags');
const sBody = D.getElementById('sBody');
const footStats = D.getElementById('foot-stats');
const pushH2 = D.querySelector('#panel-push h2');

ck('搜索标签区已渲染（9+1 个 chip）', sTags && sTags.children.length >= 10,
  sTags ? String(sTags.children.length) : 'N/A');
ck('搜索主体已渲染（热词+浏览）', sBody && sBody.children.length > 0,
  sBody ? String(sBody.children.length) : 'N/A');
ck('页脚统计已填充', footStats && footStats.textContent.trim().length > 0);
ck('推送标题已注入画像', pushH2 && pushH2.innerHTML.indexOf('画像') >= 0);
if (footStats) console.log('  页脚:', footStats.textContent.trim().slice(0, 100));
if (sTags) console.log('  标签 chip 数:', sTags.children.length);
if (sBody) console.log('  搜索主体子节点:', sBody.children.length);

/* ---- 3. 三能力：点「运行智能体」并等它跑完 ---- */
console.log('\n【3】能力① 按标签分组推送');
const runBtn = D.getElementById('run');
ck('运行按钮存在', !!runBtn);
runBtn.click();
/* 等待异步链路跑完（内部 setTimeout 总计约 2.2s / speed） */
await new Promise(r => setTimeout(r, 4000));

const c0 = D.getElementById('c0'), c1 = D.getElementById('c1');
const c2 = D.getElementById('c2'), c3 = D.getElementById('c3');
console.log('  四阶段文案:', [c0, c1, c2, c3].map(e => e ? e.textContent : '?').join(' | '));
const pushBox = D.getElementById('pushBox');
const grpEls = pushBox ? pushBox.querySelectorAll('.grp') : [];
ck('分组已渲染（≥1 组）', grpEls.length > 0, '组数=' + grpEls.length);
ck('分组头存在', pushBox && pushBox.querySelectorAll('.ghd').length > 0);
console.log('  分组数:', grpEls.length);
if (grpEls.length) {
  grpEls.forEach((g, i) => {
    const k = g.querySelector('.gk'), n = g.querySelector('.gnum');
    console.log(`    组${i + 1}: ${k ? k.textContent : '?'} ${n ? n.textContent : ''}`);
  });
  /* 默认第一组应展开，含通知卡 */
  const cardsInGrp = pushBox.querySelectorAll('.gbody .mc');
  ck('默认展开组内有通知卡', cardsInGrp.length > 0, '卡片数=' + cardsInGrp.length);
  /* 点第二组头 → 应展开 */
  const heads = pushBox.querySelectorAll('.ghd');
  if (heads.length >= 2) {
    heads[1].click();
    const after = D.getElementById('pushBox').querySelectorAll('.gbody .mc');
    ck('点分组头可展开', after.length >= cardsInGrp.length, '展开后卡片=' + after.length);
  }
}
ck('STEP01 已聚合', c0 && /条（真实/.test(c0.textContent), c0 ? c0.textContent : '');
ck('STEP02 已浓缩', c1 && /已浓缩/.test(c1.textContent), c1 ? c1.textContent : '');
ck('STEP04 已推送', c3 && /组/.test(c3.textContent), c3 ? c3.textContent : '');

/* ---- 4. 搜索能力 ---- */
console.log('\n【4】能力② 主动搜索');
const sInput = D.getElementById('sInput');
ck('搜索框存在', !!sInput);
sInput.value = '转专业';
sInput.dispatchEvent(new window.Event('input', { bubbles: true }));
sInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

const sRes = D.getElementById('sRes');
ck('搜索结果容器出现', !!sRes);
if (sRes) {
  const cards = sRes.querySelectorAll('.mc[data-id]');
  ck('搜索出结果卡片', cards.length > 0, '卡片数=' + cards.length);
  ck('结果里有高亮词', sRes.querySelectorAll('.mhl').length > 0,
    '高亮数=' + sRes.querySelectorAll('.mhl').length);
  console.log('  搜「转专业」命中卡片:', cards.length, '高亮片段:', sRes.querySelectorAll('.mhl').length);
}

/* ---- 5. 溯源能力 ---- */
console.log('\n【5】能力③ 浓缩 + 溯源');
const firstCard = sRes ? sRes.querySelector('.mc[data-id]') : null;
ck('搜到可点卡片', !!firstCard);
if (firstCard) {
  firstCard.click();
  const traceBody = D.getElementById('traceBody');
  const panelTrace = D.getElementById('panel-trace');
  ck('详情面板已切到可见', panelTrace && panelTrace.style.display === 'block');
  const pts = traceBody ? traceBody.querySelectorAll('.pt') : [];
  ck('要点已渲染', pts.length > 0, '要点数=' + pts.length);
  ck('四要素已渲染', traceBody && traceBody.querySelectorAll('.fx').length >= 4,
    '四要素=' + (traceBody ? traceBody.querySelectorAll('.fx').length : 0));
  if (pts.length) {
    pts[0].click();
    const tb2 = D.getElementById('traceBody');
    ck('点要点展开原文出处', tb2 && tb2.innerHTML.indexOf('原文出处') >= 0);
    const jump = tb2 ? tb2.querySelector('.pj') : null;
    if (jump) {
      jump.click();
      const tb3 = D.getElementById('traceBody');
      ck('跳到原文视图', tb3 && tb3.querySelector('.raw') !== null);
      ck('原文中有高亮句', tb3 && tb3.querySelectorAll('.raw .q.hl').length > 0,
        '高亮句=' + (tb3 ? tb3.querySelectorAll('.raw .q.hl').length : 0));
    }
  }
}

/* ---- 6. 报错汇总 ---- */
console.log('\n【6】JS 报错');
if (!errors.length) console.log('  无报错');
else errors.forEach(e => console.log('  ✗ ' + e.slice(0, 240)));

/* ---- 汇总 ---- */
console.log('\n' + '='.repeat(64));
console.log(`渲染测试：${pass.length} 项通过，${fail.length} 项失败`);
if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(64));
process.exit((fail.length || errors.length) ? 1 : 0);

})();

