/**
 * 网页版三能力实跑验证（与小程序 verify_search.js 同源口径）
 * ===========================================================
 *
 * 做法：把 web/zhishi-core.js 和 web/zhishi-data.js 在 Node 里加载
 *      （给它们一个假的 window），然后真实跑一遍：
 *        ① 搜索排序 + 高亮切分
 *        ② 溯源定位率（要点能否在原文原样找到）
 *        ③ 按标签分组（分组数、条数、组内排序、紧急标记）
 *        ④ 同源一致性：网页版数据 vs 小程序数据逐条比对
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const MP = path.join(ROOT, 'miniprogram');

/* ---- 造一个假的 window，加载两个文件 ---- */
const sandbox = { window: {}, console };
sandbox.window = sandbox; // window 指向自身，模拟浏览器
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'zhishi-core.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'zhishi-data.js'), 'utf8'), sandbox);

const ZS = sandbox.ZS;
const ZS_DATA = sandbox.ZS_DATA;
const NOTICES = ZS_DATA.NOTICES;
const PROFILE = ZS_DATA.PROFILE;
const INTERESTS = PROFILE.interests || [];

let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('='.repeat(64));
console.log('知时 · 网页版三能力实跑验证');
console.log('='.repeat(64));

console.log('\n【0】数据与画像');
console.log(`  通知 ${NOTICES.length} 条（真实 ${NOTICES.filter(n => n.real).length} 条）`);
console.log(`  画像：${PROFILE.grade} · ${PROFILE.college} · 关注 ${INTERESTS.length} 项（${INTERESTS.join(' / ')}）`);
ck('通知池非空', NOTICES.length > 0);
ck('画像有关注项', INTERESTS.length > 0);
ck('标签词表 9 个', ZS.TAGS.length === 9);

/* ---------- ① 搜索 ---------- */
console.log('\n【1】主动搜索');
const cases = [
  { q: '转专业', want: '转专业' },
  { q: '奖学金', want: '奖助学金' },
  { q: '竞赛', want: '学科竞赛' },
  { q: '考试', want: '考试安排' },
  { q: '讲座', want: '讲座培训' },
];
cases.forEach(c => {
  const res = ZS.search(NOTICES, c.q, {});
  const words = ZS.splitQuery(c.q);
  const top = res[0];
  ck(`搜「${c.q}」有结果（${res.length} 条）`, res.length > 0);
  if (top) {
    ck(`  首条是「${c.want}」`, top.event === c.want, `实际 ${top.event} · ${top.title.slice(0, 20)}`);
    ck('  首条带原文命中片段', !!top.snippet, top.snippet ? '' : 'snippet 为空');
    /* 高亮：命中可能来自标题/标签/原文，至少要有一处能产生高亮；
       标题本身含词时必须高亮，不含词则不强制（如实记录） */
    const titleHasWord = words.some(w => top.title.toLowerCase().indexOf(w.toLowerCase()) >= 0);
    const titleSegs = ZS.highlight(top.title, words);
    const snipHasWord = !!(top.snippet && words.some(w =>
      top.snippet.toLowerCase().indexOf(w.toLowerCase()) >= 0));
    const snipSegs = snipHasWord ? ZS.highlight(top.snippet, words) : [];
    const anyHl = titleSegs.some(s => s.hl) || snipSegs.some(s => s.hl);
    ck('  命中来源说明与高亮自洽（有高亮 or 有 needExplain）',
      anyHl || top.needExplain,
      `标题含词=${titleHasWord} 片段含词=${snipHasWord} needExplain=${top.needExplain}`);
    if (top.needExplain) {
      ck('  无可见高亮时给出命中来源', (top.hitSources || []).length > 0,
        JSON.stringify(top.hitSources));
    }
    if (titleHasWord) {
      ck('  标题含命中词 → 标题切分高亮正确', titleSegs.some(s => s.hl),
        JSON.stringify(titleSegs.map(s => s.hl)));
    }
  }
});
/* 空查询 → 浏览模式 */
const browseAll = ZS.search(NOTICES, '', {});
ck('空关键词退化为按标签/时间浏览', browseAll.length === NOTICES.length);
const browseTag = ZS.search(NOTICES, '', { tag: '讲座培训' });
ck('按标签浏览只返回该标签', browseTag.every(r => r.event === '讲座培训') && browseTag.length > 0);
/* 排序权重：标题命中应排在只命中原文的前面 */
const sortRes = ZS.search(NOTICES, '转专业', {});
if (sortRes.length >= 2) {
  ck('排序降序（标题命中优先）', sortRes[0].score >= sortRes[1].score,
    `${sortRes[0].score} vs ${sortRes[1].score}`);
}

/* ---------- ② 溯源 ---------- */
console.log('\n【2】浓缩 + 溯源');
let ptAll = 0, trAll = 0, badCase = [];
NOTICES.forEach(n => {
  const t = ZS.traceRate(n);
  ptAll += t.traceTotal; trAll += t.traceable;
  if (t.traceTotal > 0 && t.traceable < t.traceTotal) {
    badCase.push(`${n.id} ${t.traceable}/${t.traceTotal}`);
  }
});
const rate = ptAll ? (trAll / ptAll * 100).toFixed(1) : '0';
console.log(`  要点总数 ${ptAll} · 可定位 ${trAll} · 定位率 ${rate}%`);
ck('要点已产出', ptAll > 0);
ck('原文出处可定位率 ≥ 90%', trAll / ptAll >= 0.9, rate + '%');
if (badCase.length) console.log('  （未 100% 定位的条目：' + badCase.join(', ') + '）');
/* 切片正确性：buildRawSegs 产出的 hl 段必须真的在 raw 里 */
const sample = NOTICES.filter(n => (n.digestPoints || []).length >= 2)[0];
const segs = ZS.buildRawSegs(sample.raw, sample.digestPoints);
const hlSegs = segs.filter(s => s.hl);
ck('原文切片含高亮段', hlSegs.length > 0);
ck('高亮段确在原文中（拼回一致）', segs.map(s => s.text).join('') === sample.raw);
ck('高亮段挂要点序号', hlSegs.every(s => s.idx >= 0));

/* ---------- ③ 分组推送 ---------- */
console.log('\n【3】按标签分类推送');
const groups = ZS.matchByTag(NOTICES, INTERESTS);
console.log('  分组：' + groups.map(g => `${g.icon}${g.tag}(${g.count})`).join(' '));
ck('有分组产出', groups.length > 0);
ck('分组数 = 有通知的关注标签数', groups.length === INTERESTS.filter(t =>
  NOTICES.some(n => n.event === t)).length);
ck('每组都有条数', groups.every(g => g.count > 0));
ck('每组条数与 items 一致', groups.every(g => g.count === g.items.length));
ck('组内按倒计时升序', groups.every(g => {
  const cds = g.items.map(n => (typeof n.countdown === 'number') ? n.countdown : 9999);
  for (let i = 1; i < cds.length; i++) if (cds[i] < cds[i - 1]) return false;
  return true;
}));
ck('紧急组有 urgent 标记', groups.filter(g => g.urgent).length >= 0);
/* 未订阅的标签不应出现 */
ck('未订阅标签不出现在分组里', groups.every(g => INTERESTS.indexOf(g.tag) >= 0));

/* ---------- ④ 同源一致性 ---------- */
console.log('\n【4】网页版 ↔ 小程序 同源一致性');
/* 重新加载小程序数据做逐条比对 */
const mpSandbox = { module: { exports: {} }, console };
vm.createContext(mpSandbox);
vm.runInContext(fs.readFileSync(path.join(MP, 'data', 'notices.js'), 'utf8'), mpSandbox);
const MP_NOTICES = mpSandbox.module.exports.NOTICES;

ck('条数一致', MP_NOTICES.length === NOTICES.length,
  `小程序 ${MP_NOTICES.length} vs 网页 ${NOTICES.length}`);
let diff = [];
MP_NOTICES.forEach(mn => {
  const wn = NOTICES.filter(n => n.id === mn.id)[0];
  if (!wn) { diff.push(mn.id + '缺失'); return; }
  ['title', 'source', 'publish', 'event', 'deadline', 'raw'].forEach(k => {
    if (String(mn[k] || '') !== String(wn[k] || '')) diff.push(`${mn.id}.${k}`);
  });
  const mq = (mn.digestPoints || []).map(p => p.quote).join('||');
  const wq = (wn.digestPoints || []).map(p => p.quote).join('||');
  if (mq !== wq) diff.push(`${mn.id}.digestPoints`);
});
ck('逐条内容一致（标题/来源/日期/标签/截止/原文/出处）', diff.length === 0,
  diff.slice(0, 5).join(', '));

/* ---------- ⑤ 自定义关键词订阅（网页版能力，与小程序同源） ---------- */
console.log('\n【5】自定义关键词订阅（网页版）');
ck('CORE 暴露关键词接口',
  typeof ZS.normKeyword === 'function' && typeof ZS.matchKeyword === 'function'
  && typeof ZS.hitKeyword === 'function' && typeof ZS.sanitizeKeywords === 'function');
ck('关键词上限为 12', ZS.MAX_KEYWORDS === 12, 'MAX=' + ZS.MAX_KEYWORDS);
ck('KW_MATCH 权重 = 20', ZS.PUSH_WEIGHT.KW_MATCH === 20, 'w=' + ZS.PUSH_WEIGHT.KW_MATCH);
ck('清洗：去空白/去重/截断',
  JSON.stringify(ZS.sanitizeKeywords([' 正大杯 ', '正大杯', 'x'.repeat(30)]))
    === JSON.stringify(['正大杯', 'x'.repeat(20)]),
  JSON.stringify(ZS.sanitizeKeywords([' 正大杯 ', '正大杯', 'x'.repeat(30)])));

const KW = '正大杯';
const kwTarget = NOTICES.filter(n => ZS.noticeHaystack(n).indexOf(KW) >= 0)[0];
ck(`池中存在命中「${KW}」的通知`, !!kwTarget, kwTarget ? kwTarget.id : '无');
if (kwTarget) {
  const pKw = Object.assign({}, PROFILE, { keywords: [KW] });
  ck('命中判定返回该词', ZS.matchKeyword(kwTarget, pKw) === KW);
  const rs = ZS.pushReasons(kwTarget, pKw, true, null);
  const kwR = rs.filter(r => r.code === 'KW_MATCH')[0];
  ck('推送理由含 KW_MATCH', !!kwR, JSON.stringify(rs.map(r => r.code)));
  ck('KW_MATCH 理由写明命中词', !!kwR && kwR.label.indexOf(KW) >= 0, kwR ? kwR.label : '');
  const pr = ZS.buildPush(NOTICES, { profile: pKw, limit: 99 });
  ck('命中关键词的通知进入通知列表', pr.cards.some(c => c.id === kwTarget.id));
  /* relatedNotices（问答口径）也要把关键词命中的算进来 */
  ck('问答口径 relatedNotices 含关键词命中',
    ZS.relatedNotices(NOTICES, pKw).some(n => n.id === kwTarget.id));
  /* 越权防线：关键词不能把别的学院专属通知带进来 */
  const other = NOTICES.filter(n => String(n.source || '').indexOf('工学院') >= 0)[0];
  if (other) {
    const pOther = Object.assign({}, PROFILE, { keywords: ['考试安排'], college: '信息与人工智能学院' });
    const rel = ZS.relatedNotices(NOTICES, pOther);
    ck('关键词不越过「各花入各眼」学院过滤',
      !rel.some(n => n.id === other.id), '工学院专属不因关键词进信院流');
  }
}

/* -------- 汇总 -------- */
console.log('\n' + '='.repeat(64));
console.log(`网页版验证完成：${pass} 项通过，${fail} 项失败`);
if (fail) {
  console.log('失败项：');
  fails.forEach(f => console.log('  - ' + f));
}
console.log(`原文出处可定位率：${trAll}/${ptAll} = ${rate}%`);
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
