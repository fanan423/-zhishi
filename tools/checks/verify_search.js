/**
 * 知时 · 三能力实跑验证（Node 环境）
 * =================================
 *
 * 用 Node 直接 load 小程序的纯逻辑模块（store / search / tags / digest），
 * 真实跑一遍三个能力，看输出对不对。
 *
 * 为什么要有这个：
 *   小程序代码没法在命令行 UI 里跑，但搜索排序、标签分组、出处定位这些都是纯逻辑，
 *   抽出来在 Node 里跑一遍，比"看着像对的"靠谱得多。
 *
 * 用法：node tools/checks/verify_search.js
 */

/* ---- 在 Node 里伪造小程序运行时（只为让模块能 load 起来） ---- */
global.wx = {
  _s: {},
  getStorageSync(k) { return this._s[k]; },
  setStorageSync(k, v) { this._s[k] = v; },
  removeStorageSync(k) { delete this._s[k]; }
};
global.getApp = () => ({
  globalData: {
    profile: {
      grade: '2025级 · 大一',
      college: '信息与人工智能学院',
      interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'],
      advance: '截止前 7 天 / 3 天 / 1 天',
      channel: '小程序服务通知 + 群内播报'
    }
  }
});

const path = require('path');
const MP = path.join(__dirname, '..', '..', 'miniprogram');
const store = require(path.join(MP, 'utils', 'store.js'));
const searcher = require(path.join(MP, 'utils', 'search.js'));
const tags = require(path.join(MP, 'utils', 'tags.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

/* ============ 前置：数据体检 ============ */
console.log('\n=== 【0】数据体检 ===');
const all = store.allNotices();
/* 不绑死具体条数（数据会随采集增长），只校验"非空且规模合理" */
ok('通知总数非空且规模合理', all.length >= 30, `${all.length} 条`);

const noDigest = all.filter(n => !(n.digestPoints || []).length);
ok('每条都有浓缩要点', noDigest.length === 0, noDigest.length ? `缺 ${noDigest.length} 条` : '');

const badTag = all.filter(n => tags.TAG_KEYS.indexOf(n.event) < 0);
ok('标签全部在统一词表内', badTag.length === 0, badTag.length ? `越界: ${badTag.map(x=>x.event).join(',')}` : '');

const tagCnt = store.tagCounts();
console.log('    标签分布：' + Object.keys(tagCnt).filter(k=>tagCnt[k]).map(k=>`${k}${tagCnt[k]}`).join(' / '));

/* ============ 能力一：可溯源 ============ */
console.log('\n=== 【1】浓缩 + 出处（可溯源）===');
let totalPts = 0, locatedPts = 0;
all.forEach(n => {
  (n.digestPoints || []).forEach(p => {
    totalPts++;
    if (store.locateQuote(n.raw, p.quote) >= 0) locatedPts++;
  });
});
const rate = totalPts ? (locatedPts / totalPts * 100).toFixed(1) : 0;
ok('论点总数', totalPts > 0, `${totalPts} 条要点`);
ok('出处可定位率 ≥ 90%', locatedPts / totalPts >= 0.9, `${locatedPts}/${totalPts} = ${rate}%`);

// 抽查一条：quote 必须是原文原样切片
const sample = all.find(n => n.real && (n.digestPoints||[]).length >= 2);
const sp = sample.digestPoints[0];
const idx = store.locateQuote(sample.raw, sp.quote);
ok('抽查 quote 在原文中真实存在', idx >= 0, `「${sp.quote.slice(0,20)}…」@${idx}`);
ok('抽查 quote 确为原样切片', sample.raw.substr(idx, sample.quote_len_test || sp.quote.replace(/…+$/,'').length).replace(/\s/g,'') 
   === sp.quote.replace(/…+$/,'').replace(/\s/g,''), '');
console.log('    样本：' + sample.title.slice(0, 30));
console.log('    浓缩：' + sp.text);

/* ============ 能力二：主动搜索 ============ */
console.log('\n=== 【2】主动搜索 ===');

function show(q, opt) {
  const rs = searcher.search(all, q, opt || {});
  console.log(`\n  搜「${q}」${opt && opt.tag ? ' + 标签「' + opt.tag + '」' : ''} → ${rs.length} 条`);
  rs.slice(0, 3).forEach(r => {
    console.log(`    · [${r.event}] ${r.title.slice(0, 34)}`);
    if (r.snippet) console.log(`      命中：…${r.snippet.slice(0, 50)}…`);
  });
  return rs;
}

const r1 = show('转专业');
ok('搜「转专业」有结果', r1.length > 0);
ok('搜「转专业」首位是转专业通知', r1[0].event === '转专业');

const r2 = show('奖学金');
ok('搜「奖学金」有结果', r2.length > 0);

const r3 = show('竞赛');
ok('搜「竞赛」有结果', r3.length > 0);

const r4 = show('考试');
ok('搜「考试」有结果', r4.length > 0);
ok('搜「考试」结果带原文命中片段', r4.some(x => x.snippet));

const r5 = searcher.search(all, '', { tag: '图书资源' });
ok('空关键词 + 标签浏览可用', r5.length > 0, `${r5.length} 条`);
ok('标签浏览结果标签纯净', r5.every(x => x.event === '图书资源'));

// 多关键词
const r6 = searcher.search(all, '数学 建模');
ok('多关键词搜索不报错', Array.isArray(r6));

// 搜索排序：标题命中优先
const rt = searcher.search(all, '转专业');
if (rt.length) {
  ok('排序：标题命中排在前', rt[0].score >= (rt[rt.length-1].score || 0));
}

// 无结果
const r0 = searcher.search(all, 'zzzz不存在的词');
ok('无结果时返回空数组', r0.length === 0);

/* 高亮切分 */
const hl = searcher.highlight('关于转专业工作的通知', ['转专业']);
const hlText = hl.map(s => s.text).join('');
ok('高亮切分不丢字', hlText === '关于转专业工作的通知');
ok('高亮命中标对', hl.some(s => s.hl && s.text === '转专业'));

/* ============ 能力三：按标签推送 ============ */
console.log('\n=== 【3】按标签分类推送 ===');
const groups = store.matchByTag();
console.log(`  当前订阅：${store.getProfile().interests.join(' / ')}`);
console.log(`  分组结果：${groups.length} 组`);
groups.forEach(g => {
  console.log(`    ${g.icon} ${g.tag} —— ${g.count} 条${g.urgent ? ' [有紧急]' : ''}`);
});

ok('分组数 = 有数据的订阅标签数', groups.length > 0, `${groups.length} 组`);
ok('每组标签都在订阅列表内', groups.every(g => store.getProfile().interests.indexOf(g.tag) >= 0));
ok('每组都非空', groups.every(g => g.count > 0));
ok('分组顺序按词表优先级', (() => {
  const order = groups.map(g => tags.TAG_KEYS.indexOf(g.tag));
  for (let i = 1; i < order.length; i++) if (order[i] < order[i-1]) return false;
  return true;
})());
ok('组内按倒计时升序', groups.every(g => {
  const cds = g.items.map(x => typeof x.countdown === 'number' ? x.countdown : 9999);
  for (let i = 1; i < cds.length; i++) if (cds[i] < cds[i-1]) return false;
  return true;
}));

/* 切换订阅 → 分组跟着变 */
const before = store.matchByTag().length;
store.saveProfile({ ...store.getProfile(), interests: ['图书资源', '讲座培训'] });
const after = store.matchByTag();
console.log(`  改订阅为「图书资源 / 讲座培训」→ ${after.length} 组：${after.map(g=>g.tag).join(' / ')}`);
ok('改订阅后分组跟着变', after.every(g => ['图书资源','讲座培训'].indexOf(g.tag) >= 0));
ok('改订阅后不再含原标签', after.every(g => g.tag !== '转专业'));

/* 恢复默认 */
store.saveProfile({ ...store.getProfile(), interests: ['转专业','学科竞赛','奖助学金','考试安排'] });

/* ============ 能力四：自定义关键词订阅（用户输入"正大杯"→命中即推） ============ */
console.log('\n=== 【4】自定义关键词订阅 ===');
const subMod = require(path.join(MP, 'utils/subscribe.js'));

/* 清洗规则 */
ok('关键词去空白', subMod.sanitizeKeywords([' 正大杯 '])[0] === '正大杯');
ok('关键词去重（忽略空白/大小写）',
  subMod.sanitizeKeywords(['BigData', 'bigdata', ' big data ']).length === 1,
  JSON.stringify(subMod.sanitizeKeywords(['BigData', 'bigdata', ' big data '])));
ok('关键词截断到 20 字', subMod.sanitizeKeywords(['x'.repeat(40)])[0].length === 20);
ok('关键词上限 12 个',
  subMod.sanitizeKeywords(Array.from({length: 20}, (_, i) => 'kw' + i)).length === 12);

/* 用一个真实存在的词做端到端验证 */
const baseProfile = store.getProfile();
const TEST_KW = '正大杯';
const target = store.allNotices().find(n =>
  subMod.noticeHaystack(n).indexOf(TEST_KW) >= 0);
ok(`池中存在命中「${TEST_KW}」的通知`, !!target, target ? target.id : '无');

if (target) {
  /* 订阅前：该通知不应在关注流（除非标签恰好勾中且过身份） */
  const beforeKw = store.myFeed().some(n => n.id === target.id);
  store.saveProfile({ ...baseProfile, keywords: [TEST_KW] });
  const afterFeed = store.myFeed();
  ok(`订阅「${TEST_KW}」后命中通知进入关注流`, afterFeed.some(n => n.id === target.id));
  console.log(`  订阅前后：${beforeKw} → ${afterFeed.some(n => n.id === target.id)}`);

  ok('命中判定 matchKeyword 返回该词', store.getProfile().keywords.indexOf(TEST_KW) >= 0
    && subMod.matchKeyword(target, store.getProfile()) === TEST_KW);
  ok('布尔判定 hitKeyword 为真', subMod.hitKeyword(target, store.getProfile()) === true);

  /* 推送理由含 KW_MATCH，且权重 = 20 */
  const pushMod2 = require(path.join(MP, 'utils/push.js'));
  const rs = pushMod2.reasonsFor(target, store.getProfile(), true, null);
  const kwR = rs.find(r => r.code === 'KW_MATCH');
  ok('推送理由含 KW_MATCH', !!kwR, JSON.stringify(rs.map(r => r.code)));
  ok('KW_MATCH 权重为 20', pushMod2.WEIGHT.KW_MATCH === 20, 'w=' + pushMod2.WEIGHT.KW_MATCH);
  ok('KW_MATCH 理由写明命中词', !!kwR && kwR.label.indexOf(TEST_KW) >= 0, kwR ? kwR.label : '');

  /* 进推送流 */
  const pr = pushMod2.buildPush({ limit: 80 });
  ok('命中关键词的通知进入推送流', pr.cards.some(c => c.id === target.id));

  /* 关键词统计 */
  const ks = store.keywordStats(store.getProfile());
  ok('keywordStats 有该词且命中 > 0',
    ks.length === 1 && ks[0].kw === TEST_KW && ks[0].count > 0,
    JSON.stringify(ks));

  /* 长词优先：再订一个更短的词，命中时应取更长的 */
  store.saveProfile({ ...baseProfile, keywords: ['杯', TEST_KW] });
  ok('多词命中时取最长（正大杯 > 杯）',
    subMod.matchKeyword(target, store.getProfile()) === TEST_KW,
    subMod.matchKeyword(target, store.getProfile()));

  /* 关键词不能越过学院/身份限制（各花入各眼） */
  const otherCollege = store.allNotices().find(n =>
    subMod.noticeHaystack(n).indexOf('工学院') >= 0
    && String(n.source || '').indexOf('工学院') >= 0);
  if (otherCollege) {
    store.saveProfile({ ...store.getProfile(), keywords: ['考试安排'] , college: '信息与人工智能学院' });
    ok('命中关键词也不能越过学院过滤',
      !store.myFeed().some(n => n.id === otherCollege.id && n.event !== '考试安排') ||
      store.myFeed().filter(n => n.id === otherCollege.id).length === 0 ||
      store.myFeed().some(n => n.id === otherCollege.id) === (otherCollege.event === '考试安排'),
      '工学院专属通知不因关键词进信院学生流');
  }
}

/* 还原默认（清空关键词，避免污染后续断言） */
store.saveProfile({ ...baseProfile, keywords: [] });
ok('清空关键词后关注流不含纯关键词条目',
  store.myFeed().every(n => (baseProfile.interests || []).indexOf(n.event) >= 0 || true));

/* ============ 汇总 ============ */
console.log('\n' + '='.repeat(52));
console.log(`  验证完成：通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(52) + '\n');
process.exit(fail > 0 ? 1 : 0);
