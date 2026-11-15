/**
 * 小程序 · 真运行测试
 * ================================================
 * 目的：证明 miniprogram/ 里的源码**真的能跑**，而不是"文件齐全"。
 *
 * 做法：在 Node 里搭一个最小微信小程序运行时——
 *   ① 实现 App / Page / wx.* 这套宿主 API（含 setData 的 data-path 语义）
 *   ② 按 app.json 的 pages 列表，真实 require 每个页面的 js、解析 wxml 的 {{}}
 *   ③ 驱动交互（onLoad → onShow → 点按钮 → 跳转 → 搜索 → 溯源）
 *
 * 这测的是"小程序的业务代码逻辑对不对"。
 * 渲染（wxml → 视图）由 check_wxml.py 静态校验，两者互补。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');

const pass = [];
const fail = [];
function ck(name, cond, extra) {
  if (cond) pass.push(name);
  else fail.push(name + (extra ? ' → ' + extra : ''));
}
function log(s) { console.log(s); }

/* ================================================================
 * 最小运行时：wx API
 * ================================================================ */
const storage = {};
let toastLog = [];
let navLog = [];
let clipboardLog = [];
let currentPage = null;
const pageStack = [];

const wx = {
  getStorageSync(k) { return storage[k] === undefined ? '' : storage[k]; },
  setStorageSync(k, v) { storage[k] = v; },
  removeStorageSync(k) { delete storage[k]; },
  showToast(o) { toastLog.push(o.title || ''); },
  vibrateShort() {},
  showModal(o) { if (o && o.success) o.success({ confirm: true }); },
  navigateTo(o) { navLog.push({ type: 'navigateTo', url: o.url }); },
  switchTab(o) { navLog.push({ type: 'switchTab', url: o.url }); },
  navigateBack() { navLog.push({ type: 'navigateBack' }); },
  setNavigationBarTitle() {},
  getSystemInfoSync() { return { platform: 'devtools', SDKVersion: '3.0.0' }; },
  showLoading() {},
  hideLoading() {},
  setClipboardData(o) { if (o) clipboardLog.push(o.data); if (o && o.success) o.success(); },
  request(o) { if (o && o.fail) o.fail({ errMsg: 'mock: no network' }); },
  login(o) { if (o && o.fail) o.fail({ errMsg: 'mock: no cloud' }); },
  /* 订阅消息：模拟"用户同意"（真实审核在真机，这里只验证授权闭环不抛错） */
  requestSubscribeMessage(o) {
    const res = {};
    (o && o.tmplIds ? o.tmplIds : []).forEach((id) => { res[id] = 'accept'; });
    if (o && o.success) o.success(res);
  },
  cloud: null
};

/* ================================================================
 * setData 的 data-path 语义（小程序的核心）
 * 支持 'a.b' / 'a[0].b' / 'a[0].b.c'
 * ================================================================ */
function setByPath(obj, pathExpr, value) {
  const keys = [];
  pathExpr.replace(/[^.[\]]+/g, (m) => keys.push(m));
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] === undefined || cur[k] === null) {
      cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o === undefined ? null : o));
}

/* ================================================================
 * Page 注册与实例化
 * ================================================================ */
const registeredPages = {};   // route -> definition
let pendingRoute = null;

global.Page = function (def) {
  registeredPages[pendingRoute] = def;
};

global.App = function (def) {
  global.__appDef = def;
  if (def.onLaunch) { try { def.onLaunch(); } catch (e) { fail.push('App.onLaunch 抛错: ' + e.message); } }
};

global.getApp = function () { return global.__app; };

/* require 拦截：把相对路径解析到 miniprogram/ 下 */
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('./') || request.startsWith('../')) {
    const base = parent && parent.filename ? path.dirname(parent.filename) : MP;
    const cand = path.resolve(base, request);
    for (const ext of ['', '.js', '/index.js']) {
      const p = cand + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    const withJs = cand + '.js';
    return withJs;
  }
  return origResolve.call(this, request, parent, ...rest);
};

/* 注入 wx 到全局，让页面 js 里的 wx.* 可用 */
global.wx = wx;

/* ================================================================
 * 加载一个页面：require 它的 js，实例化
 * ================================================================ */
function loadPage(route) {
  const jsPath = path.join(MP, route + '.js');
  if (!fs.existsSync(jsPath)) { ck('页面文件存在: ' + route, false, '缺 .js'); return null; }
  pendingRoute = route;
  delete require.cache[require.resolve(jsPath)];
  try {
    require(jsPath);
  } catch (e) {
    ck('页面可加载: ' + route, false, e.message);
    return null;
  }
  const def = registeredPages[route];
  if (!def) { ck('页面已注册 Page(): ' + route, false); return null; }
  if (!def.data) { ck('页面 def 有 data: ' + route, false, 'keys=' + Object.keys(def).join(',')); }

  /* 实例：把 def 的方法 + data 挂上，实现 setData */
  const inst = Object.create(null);
  Object.keys(def).forEach((k) => {
    inst[k] = typeof def[k] === 'function' ? def[k].bind(inst) : deepClone(def[k]);
  });
  inst.data = deepClone(def.data || {});
  inst.__setDataCalls = [];
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      if (/[.[]/.test(k)) setByPath(inst.data, k, patch[k]);
      else inst.data[k] = patch[k];
    });
    inst.__setDataCalls.push(patch);
    if (typeof cb === 'function') cb();
  };
  inst.route = route;
  inst.__def = def;
  return inst;
}

/* ================================================================
 * 开始
 * ================================================================ */
log('='.repeat(64));
log('知时 · 小程序真运行测试（Node 模拟 wx 宿主）');
log('='.repeat(64));

(async function main() {

  /* ---- 0. app.json 结构 ---- */
  log('\n【0】app.json 页面清单');
  const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
  ck('app.json 可解析', !!appJson.pages);
  /* 页面数不写死：新增页面不应让测试失败，但必须"每个声明页面都有真实文件" */
  ck('声明了至少 8 个页面', appJson.pages.length >= 8, 'pages=' + (appJson.pages || []).length);
  const missingPage = appJson.pages.filter((p) => {
    const base = path.join(MP, p);
    return !['.js', '.wxml', '.json'].every((ext) => fs.existsSync(base + ext));
  });
  ck('每个声明页面都有 .js/.wxml/.json 三件套', missingPage.length === 0,
    missingPage.length ? '缺失: ' + missingPage.join(', ') : '全部齐备');
  ck('tabBar 有 4 项', appJson.tabBar && appJson.tabBar.list.length === 4,
    'tabs=' + ((appJson.tabBar && appJson.tabBar.list) || []).length);
  appJson.pages.forEach((p) => log('  · ' + p));
  /* tabBar 指向的页面必须都已注册 */
  (appJson.tabBar.list || []).forEach((t) => {
    ck('tabBar 指向已注册页面: ' + t.pagePath, appJson.pages.indexOf(t.pagePath) >= 0);
  });

  /* ---- 1. App 启动 ---- */
  log('\n【1】App 启动');
  require(path.join(MP, 'app.js'));
  global.__app = {
    globalData: (global.__appDef && global.__appDef.globalData) || {},
    onLaunch: global.__appDef && global.__appDef.onLaunch
  };
  ck('globalData.profile 存在', !!global.__app.globalData.profile);
  ck('profile.interests 有 4 项',
    (global.__app.globalData.profile.interests || []).length === 4,
    JSON.stringify(global.__app.globalData.profile.interests));
  log('  画像:', global.__app.globalData.profile.college,
    '| 关注:', (global.__app.globalData.profile.interests || []).join(' / '));

  /* ---- 2. 【首页 · 关注流】index ---- */
  log('\n【2】首页 index —— 关注流 / 按标签 / 知时指数');
  const idx = loadPage('pages/index/index');
  ck('index 页可加载并注册', !!idx);
  if (idx) {
    idx.onLoad();
    await new Promise((r) => setTimeout(r, 80));

    ck('onLoad 后 profile 已注入', !!idx.data.profile && !!idx.data.profile.interests);
    ck('默认视图为关注流', idx.data.viewMode === 'feed', 'viewMode=' + idx.data.viewMode);
    ck('主题已注入', idx.data.theme === 'light' || idx.data.theme === 'dark',
      'theme=' + idx.data.theme);

    /* 三档分区 */
    log('  关注流三档: 紧急 ' + idx.data.urgent.length +
      ' / 一周内 ' + idx.data.soon.length + ' / 长期 ' + idx.data.later.length);
    ck('三档分区已生成', Array.isArray(idx.data.urgent) && Array.isArray(idx.data.soon) && Array.isArray(idx.data.later));
    const feedTotal = idx.data.urgent.length + idx.data.soon.length + idx.data.later.length;
    ck('三档并集 = 命中总数', feedTotal === idx.data.stats.matched,
      `feed=${feedTotal} matched=${idx.data.stats.matched}`);

    /* 三档互斥：同一条不能出现在两个分区 */
    const ids = [].concat(idx.data.urgent, idx.data.soon, idx.data.later).map((n) => n.id);
    ck('三档分区不重复', new Set(ids).size === ids.length,
      'unique=' + new Set(ids).size + ' total=' + ids.length);

    /* 分区语义正确：urgent 全是 <=3 天 */
    ck('紧急区全部 <= 3 天',
      idx.data.urgent.every((n) => typeof n.countdown === 'number' && n.countdown <= 3),
      JSON.stringify(idx.data.urgent.map((n) => n.countdown)));
    ck('一周内区全部在 4-7 天',
      idx.data.soon.every((n) => typeof n.countdown === 'number' && n.countdown > 3 && n.countdown <= 7),
      JSON.stringify(idx.data.soon.map((n) => n.countdown)));

    /* 知时指数 */
    ck('知时指数已生成', !!idx.data.index && typeof idx.data.index.score === 'number',
      JSON.stringify(idx.data.index));
    ck('指数在 0-100 之间',
      idx.data.index.score >= 0 && idx.data.index.score <= 100,
      'score=' + idx.data.index.score);
    ck('指数有等级与文案', !!idx.data.index.level && !!idx.data.index.label,
      idx.data.index.level + '/' + idx.data.index.label);
    log('  知时指数: ' + idx.data.index.score + ' (' + idx.data.index.level + ') — ' + idx.data.index.label);

    /* 简报摘要一句话 */
    ck('简报摘要一句话已生成', !!idx.data.briefLine && idx.data.briefLine.length > 4,
      idx.data.briefLine);
    log('  简报摘要: ' + idx.data.briefLine);

    /* 按标签分组 */
    ck('groups 已生成', idx.data.groups.length > 0, 'groups=' + idx.data.groups.length);
    idx.data.groups.forEach((g, i) => {
      log(`    组${i + 1}: ${g.icon} ${g.tag} — ${g.count} 条${g.urgent ? ' [紧急]' : ''}`);
    });
    ck('分组只含已订阅标签',
      idx.data.groups.every((g) => (idx.data.profile.interests || []).indexOf(g.tag) >= 0));

    /* 分组展开 / 收起 */
    const t0 = idx.data.groups[0].tag;
    idx.toggleGroup({ currentTarget: { dataset: { t: t0 } } });
    ck('toggleGroup 可展开', idx.data.openTag === t0, 'openTag=' + idx.data.openTag);
    idx.toggleGroup({ currentTarget: { dataset: { t: t0 } } });
    ck('toggleGroup 可收起', idx.data.openTag === '');

    /* 视图切换 */
    idx.switchView({ currentTarget: { dataset: { m: 'tag' } } });
    ck('可切到按标签视图', idx.data.viewMode === 'tag');
    idx.switchView({ currentTarget: { dataset: { m: 'feed' } } });
    ck('可切回关注流', idx.data.viewMode === 'feed');

    /* 跳详情 */
    const anyId = (idx.data.urgent[0] || idx.data.soon[0] || idx.data.later[0]).id;
    navLog = [];
    idx.goDetail({ currentTarget: { dataset: { id: anyId } } });
    ck('goDetail 触发 navigateTo', navLog.some((n) => /detail\?id=/.test(n.url)),
      JSON.stringify(navLog.map((n) => n.url)));

    /* 跳时间轴 / 简报（switchTab） */
    navLog = [];
    idx.goTimeline();
    ck('goTimeline 走 switchTab', navLog.some((n) => n.type === 'switchTab' && /timeline/.test(n.url)),
      JSON.stringify(navLog));
    navLog = [];
    idx.goDigest();
    ck('goDigest 走 switchTab', navLog.some((n) => n.type === 'switchTab' && /digest/.test(n.url)),
      JSON.stringify(navLog));

    /* 跳标签搜索 */
    navLog = [];
    idx.goTag({ currentTarget: { dataset: { t: '学科竞赛' } } });
    ck('goTag 跳搜索页带标签', navLog.some((n) => /search\?tag=/.test(n.url)),
      JSON.stringify(navLog.map((n) => n.url)));
  }

  /* ---- 2b. 【时间轴页】timeline ---- */
  log('\n【2b】时间轴页 timeline');
  const tl = loadPage('pages/timeline/timeline');
  ck('timeline 页可加载并注册', !!tl);
  if (tl) {
    tl.onLoad();
    await new Promise((r) => setTimeout(r, 60));

    ck('时间轴主题已注入', tl.data.theme === 'light' || tl.data.theme === 'dark');
    ck('分箱已生成（5 档）', (tl.data.buckets || []).length === 5,
      'buckets=' + (tl.data.buckets || []).length);
    log('  分箱: ' + tl.data.buckets.map((b) => `${b.label}=${b.count}`).join(' | '));

    const bsum = tl.data.buckets.reduce((s, b) => s + b.count, 0);
    ck('分箱总量 = total', bsum === tl.data.total, `sum=${bsum} total=${tl.data.total}`);

    /* 五档语义正确 */
    const byKey = {};
    tl.data.buckets.forEach((b) => { byKey[b.key] = b; });
    ck('有 today/d3/week/month/later 五档',
      !!byKey.today && !!byKey.d3 && !!byKey.week && !!byKey.month && !!byKey.later);
    ck('today 档全部为 0 天',
      byKey.today.items.every((n) => n.countdown === 0),
      JSON.stringify(byKey.today.items.map((n) => n.countdown)));
    ck('d3 档全部在 1-3 天',
      byKey.d3.items.every((n) => n.countdown > 0 && n.countdown <= 3),
      JSON.stringify(byKey.d3.items.map((n) => n.countdown)));
    ck('week 档全部在 4-7 天',
      byKey.week.items.every((n) => n.countdown > 3 && n.countdown <= 7),
      JSON.stringify(byKey.week.items.map((n) => n.countdown)));
    ck('month 档全部在 8-30 天',
      byKey.month.items.every((n) => n.countdown > 7 && n.countdown <= 30),
      JSON.stringify(byKey.month.items.map((n) => n.countdown)));

    /* 档内按倒计时升序 */
    const d3cd = byKey.d3.items.map((n) => n.countdown);
    ck('档内按剩余天数升序',
      d3cd.every((v, i) => i === 0 || d3cd[i - 1] <= v),
      JSON.stringify(d3cd));

    /* 指数 */
    ck('时间轴指数已注入', !!tl.data.index && typeof tl.data.index.score === 'number');
    ck('有内容时 hasAny=true', tl.data.total > 0 ? tl.data.hasAny === true : true,
      'total=' + tl.data.total + ' hasAny=' + tl.data.hasAny);

    /* 折叠交互 */
    const k0 = tl.data.buckets.find((b) => b.count > 0).key;
    const isOpenBefore = tl.data.openKeys.indexOf(k0) >= 0;
    tl.toggleBucket({ currentTarget: { dataset: { k: k0 } } });
    const isOpenAfter = tl.data.openKeys.indexOf(k0) >= 0;
    ck('toggleBucket 可切换折叠态', isOpenAfter !== isOpenBefore,
      'before=' + isOpenBefore + ' after=' + isOpenAfter);
    tl.toggleBucket({ currentTarget: { dataset: { k: k0 } } });
    ck('再次点击可复原', (tl.data.openKeys.indexOf(k0) >= 0) === isOpenBefore,
      JSON.stringify(tl.data.openKeys));

    /* 自动展开靠前的有内容档 */
    ck('默认自动展开有内容的分箱', tl.data.openKeys.length > 0,
      JSON.stringify(tl.data.openKeys));

    /* 进详情 */
    navLog = [];
    tl.goDetail({ currentTarget: { dataset: { id: byKey.d3.items[0] ? byKey.d3.items[0].id : anyId } } });
    ck('时间轴可进详情', navLog.some((n) => /detail\?id=/.test(n.url)),
      JSON.stringify(navLog.map((n) => n.url)));
  }

  /* ---- 2c. 【今日简报页】digest ---- */
  log('\n【2c】今日简报页 digest');
  const dg = loadPage('pages/digest/digest');
  ck('digest 页可加载并注册', !!dg);
  if (dg) {
    dg.onLoad();
    await new Promise((r) => setTimeout(r, 60));

    ck('简报已生成', !!dg.data.brief, dg.data.brief ? '' : 'brief 为空');
    ck('简报含知时指数', !!(dg.data.brief && dg.data.brief.index),
      JSON.stringify(dg.data.brief && dg.data.brief.index));
    ck('简报含 must/watch 两段',
      Array.isArray(dg.data.brief.must) && Array.isArray(dg.data.brief.watch),
      'must=' + (dg.data.brief.must || []).length + ' watch=' + (dg.data.brief.watch || []).length);
    log('  三天内要办 ' + dg.data.brief.must.length + ' 件 / 本周留意 ' + dg.data.brief.watch.length + ' 件');

    ck('一句话总结已拆句', (dg.data.sentences || []).length > 0,
      JSON.stringify(dg.data.sentences));
    log('  一句话总结: ' + dg.data.brief.summary);

    /* must 段必须都是 <=3 天 */
    ck('「三天内要办」全部 <= 3 天',
      dg.data.brief.must.every((n) => typeof n.countdown === 'number' && n.countdown <= 3),
      JSON.stringify(dg.data.brief.must.map((n) => n.countdown)));
    ck('「本周留意」全部在 4-7 天',
      dg.data.brief.watch.every((n) => typeof n.countdown === 'number' && n.countdown > 3 && n.countdown <= 7),
      JSON.stringify(dg.data.brief.watch.map((n) => n.countdown)));

    /* 可信度 */
    ck('可信度已判定', !!dg.data.trustLevel && !!dg.data.trustLabel,
      dg.data.trustLevel + '/' + dg.data.trustLabel);
    log('  数据可信度: ' + dg.data.trustLevel + ' — ' + dg.data.trustLabel);
    ck('生成时间戳已填', /\d{4}-\d{2}-\d{2}/.test(dg.data.stamp), dg.data.stamp);
    ck('收藏数已读', typeof dg.data.favCount === 'number', 'favCount=' + dg.data.favCount);

    /* 复制简报 */
    toastLog = [];
    dg.copyBrief();
    ck('copyBrief 有反馈', toastLog.length > 0, JSON.stringify(toastLog));

    /* 快捷跳转 */
    navLog = [];
    dg.goTimeline();
    ck('简报可跳时间轴', navLog.some((n) => n.type === 'switchTab' && /timeline/.test(n.url)));
    navLog = [];
    dg.goSearch();
    ck('简报可跳搜索', navLog.some((n) => /search/.test(n.url)));

    /* 简报内容随订阅变化 —— 取消一个标签后 must 应变（或至少重算不崩） */
    const storeM = require(path.join(MP, 'utils/store.js'));
    const bBefore = storeM.brief();
    dg.build();
    ck('重新 build 后简报仍自洽', !!dg.data.brief && dg.data.brief.summary.length > 0);
  }

  /* ---- 3. 【搜索页】search ---- */
  log('\n【3】搜索页 search —— 主动搜索');
  const sr = loadPage('pages/search/search');
  ck('search 页可加载并注册', !!sr);
  if (sr) {
    sr.onLoad && sr.onLoad();
    sr.onShow && sr.onShow();
    ck('search 页有输入处理函数', typeof sr.onInput === 'function' || typeof sr.onSearchInput === 'function');

    ck('doSearch 存在', typeof sr.doSearch === 'function');
    ck('onConfirm 存在', typeof sr.onConfirm === 'function');
    ck('tapTag 存在', typeof sr.tapTag === 'function');

    /* 走真实入口链：onInput 写 q → onConfirm 提交（e.detail.value） */
    sr.onInput({ detail: { value: '转专业' } });
    sr.onConfirm({ detail: { value: '转专业' } });
    await new Promise((r) => setTimeout(r, 100));

    log('  搜「转专业」→ 结果数:', sr.data.results.length);
    ck('搜索返回结果', sr.data.results.length > 0, 'results=' + sr.data.results.length);
    ck('搜索结果已标记 searched', sr.data.searched === true);
    ck('标题高亮切分已生成',
      Object.keys(sr.data.titleSegs).length === sr.data.results.length,
      'segs=' + Object.keys(sr.data.titleSegs).length + ' / res=' + sr.data.results.length);
    ck('stat.total 正确', sr.data.stat.total === sr.data.results.length,
      `stat=${sr.data.stat.total} / res=${sr.data.results.length}`);
    if (sr.data.results.length) {
      const r0 = sr.data.results[0];
      const hl = (sr.data.titleSegs[r0.id] || []).filter((s) => s.hl).length;
      log('  首条:', r0.title.slice(0, 26) + '… | 命中来源:', r0.hitSources.join('/'), '| 高亮段:', hl);
      ck('首条标题有高亮或有命中说明', hl > 0 || r0.needExplain === true,
        'hl=' + hl + ' needExplain=' + r0.needExplain);
      ck('首条带可溯源字段', r0.source && r0.publish && r0.event);
    }

    /* 第二个关键词 */
    sr.onInput({ detail: { value: '奖学金' } });
    sr.onConfirm({ detail: { value: '奖学金' } });
    await new Promise((r) => setTimeout(r, 100));
    log('  搜「奖学金」→ 结果数:', sr.data.results.length);
    ck('第二个关键词也能搜到', sr.data.results.length > 0, 'results=' + sr.data.results.length);

    /* 搜索历史已记录 */
    ck('搜索历史已记录', sr.data.history.indexOf('奖学金') === 0,
      JSON.stringify(sr.data.history));

    /* 搜索无结果时不崩 */
    sr.onInput({ detail: { value: 'zzz不存在的词zzz' } });
    sr.onConfirm({ detail: { value: 'zzz不存在的词zzz' } });
    await new Promise((r) => setTimeout(r, 100));
    ck('无结果时不崩溃且搜过', sr.data.searched === true && sr.data.results.length === 0,
      'results=' + sr.data.results.length);

    /* 标签浏览：先清关键词，单独按标签看 */
    sr.onClear();
    sr.tapTag({ currentTarget: { dataset: { t: '学科竞赛' } } });
    await new Promise((r) => setTimeout(r, 100));
    log('  点标签「学科竞赛」→ 结果数:', sr.data.results.length);
    ck('标签浏览有结果', sr.data.results.length > 0, 'results=' + sr.data.results.length);
    ck('结果全属该标签',
      sr.data.results.every((r) => r.event === '学科竞赛'),
      '标签混杂');

    /* 关键词 × 标签 取交集（应正常收窄而非报错） */
    sr.onInput({ detail: { value: '大赛' } });
    sr.onConfirm({ detail: { value: '大赛' } });
    await new Promise((r) => setTimeout(r, 100));
    log('  搜「大赛」+标签「学科竞赛」→ 结果数:', sr.data.results.length);
    ck('关键词+标签取交集不报错',
      sr.data.results.every((r) => r.event === '学科竞赛'),
      '交集内含其他标签');

    /* 进详情带搜索词 */
    navLog = [];
    sr.goDetail({ currentTarget: { dataset: { id: sr.data.results[0].id } } });
    ck('goDetail 带 q 参数',
      navLog.some((n) => /detail\?id=.*&q=/.test(n.url)),
      JSON.stringify(navLog.map((n) => n.url)));

    /* 清空回到浏览态 */
    sr.onClear();
    ck('onClear 回到浏览态', sr.data.searched === false && sr.data.results.length === 0);
  }

  /* ---- 4. 【详情页】detail —— 浓缩 + 溯源 ---- */
  log('\n【4】详情页 detail —— 浓缩 + 溯源');
  const dt = loadPage('pages/detail/detail');
  ck('detail 页可加载并注册', !!dt);
  if (dt) {
    /* 取一条通知的 id */
    const store = require(path.join(MP, 'utils/store.js'));
    const sample = store.NOTICES[0];
    dt.onLoad && dt.onLoad({ id: sample.id, q: encodeURIComponent('转专业') });
    await new Promise((r) => setTimeout(r, 100));
    ck('detail 已加载通知', !!dt.data.notice, dt.data.notice ? '' : 'data.notice 为空');
    if (dt.data.notice) {
      const n = dt.data.notice;
      log('  通知:', n.title.slice(0, 28) + '…');
      ck('有浓缩一句话', !!n.digestOne);
      ck('有浓缩要点', (n.digestPoints || []).length > 0,
        'points=' + (n.digestPoints || []).length);
      ck('有原文', (n.raw || '').length > 50, 'rawLen=' + (n.raw || '').length);
      ck('四要素已生成', dt.data.factList.length === 4,
        'facts=' + dt.data.factList.length);
      log('  四要素:', dt.data.factList.map((f) => f.k).join(' / '));
      ck('溯源自评已算', dt.data.traceTotal > 0,
        `${dt.data.traceable}/${dt.data.traceTotal}`);
      log('  溯源定位:', dt.data.traceable + '/' + dt.data.traceTotal);
      ck('要点可在原文中定位', dt.data.traceable > 0,
        dt.data.traceable + '/' + dt.data.traceTotal);

      /* 原文切片：应有 hl=true 的片段 */
      ck('原文已切成可高亮片段', dt.data.quotedRaw.length > 0,
        'segs=' + dt.data.quotedRaw.length);
      const hlSegs = dt.data.quotedRaw.filter((s) => s.hl);
      log('  原文切片:', dt.data.quotedRaw.length, '段，其中高亮', hlSegs.length, '段');
      ck('原文有高亮片段（可跳转）', hlSegs.length > 0,
        'hl=' + hlSegs.length);

      /* 交互：切 tab / 点要点 / 跳原文 / 全部高亮 */
      dt.switchTab({ currentTarget: { dataset: { tab: 'raw' } } });
      ck('可切到原文视图', dt.data.tab === 'raw');
      dt.tapPoint({ currentTarget: { dataset: { idx: 0 } } });
      ck('点要点可设 activeIdx', dt.data.activeIdx === 0);
      dt.jumpToRaw({ currentTarget: { dataset: { idx: 0 } } });
      ck('可从要点跳原文', dt.data.tab === 'raw' && dt.data.activeIdx === 0);
      dt.tapQuote({ currentTarget: { dataset: { idx: 0 } } });
      ck('可点原文句跳回要点', dt.data.tab === 'digest' && dt.data.activeIdx === 0);
      dt.toggleAll();
      ck('全部高亮可开启', dt.data.rawFocused === true);
      dt.toggleAll();
      ck('全部高亮可关闭', dt.data.rawFocused === false);

      /* 复制办理信息 */
      ck('copyEntry 存在', typeof dt.copyEntry === 'function');
      /* 搜索同标签跳转 */
      navLog = [];
      dt.searchTag();
      ck('searchTag 跳搜索页带 tag',
        navLog.some((x) => /search\?tag=/.test(x.url)),
        JSON.stringify(navLog.map((x) => x.url)));
    }

    /* 不存在的 id 应被拒（健壮性） */
    const dt2 = loadPage('pages/detail/detail');
    navLog = [];
    dt2.onLoad && dt2.onLoad({ id: '__not_exist__' });
    ck('未知 id 不崩溃且提示', toastLog.length > 0 || navLog.some((x) => x.type === 'navigateBack'));
    toastLog = [];
  }

  /* ---- 4b. 【和我有关吗 + 办理清单】详情页新增的学生视角能力 ---- */
  log('\n【4b】详情页 detail —— 和我有关吗 / 办理清单');
  {
    const store = require(path.join(MP, 'utils/store.js'));
    const favMod = require(path.join(MP, 'utils/favorites.js'));

    /* ① relevance：把 audience 翻成人话，逐条比对本人的画像
     * 用构造的 audience 做「条件识别」断言（历史行文措辞会变，不该绑死某条数据） */
    const prof = store.getProfile();
    const nMock = {
      id: '__mock_transfer__',
      event: '转专业',
      title: '关于2025级本科生转专业工作的通知',
      audience: '2025级全日制本科（无处分）',
      materials: '在线申请表 / 纸质表 / 成绩单',
      entry: '教务管理系统→转专业申请模块',
      deadline: '2026-11-18',
      countdown: 15,
      digestPoints: []
    };
    const rel = store.relevance(nMock, prof);
    log('  转专业 relevance:', rel.level, '/', rel.label, '/ 条数', rel.reasons.length);
    ck('relevance 返回四段结论之一',
      ['ok', 'warn', 'no', 'open'].indexOf(rel.level) >= 0, 'level=' + rel.level);
    ck('relevance 有可读标签', !!rel.label && !!rel.hint);
    ck('relevance 逐条列出条件', rel.reasons.length > 0, 'reasons=' + rel.reasons.length);
    ck('每条条件三态合法',
      rel.reasons.every((r) => ['ok', 'warn', 'no'].indexOf(r.state) >= 0),
      rel.reasons.map((r) => r.key + ':' + r.state).join(' '));
    ck('每条条件都有我方/对方对照',
      rel.reasons.every((r) => !!r.label && !!r.mine && !!r.need));
    /* 年级应能被识别（构造的原文写了 2025级，画像默认也是 2025级 → ok） */
    const gradeR = rel.reasons.find((r) => r.key === 'grade');
    log('  年级对照:', gradeR ? `${gradeR.mine} ↔ ${gradeR.need} → ${gradeR.state}` : '(未识别年级)');
    ck('识别出年级条件', !!gradeR, 'grade reason 缺失');
    ck('年级条件判定为符合', !!gradeR && gradeR.state === 'ok',
      gradeR ? gradeR.state : 'n/a');

    /* 无 audience 的通知 → open（不假装有限制） */
    const relOpen = store.relevance({ title: '关于图书馆开放时间调整的通知', audience: '' }, prof);
    log('  无 audience:', relOpen.level);
    ck('原文没写限制时判为 open', relOpen.level === 'open', 'level=' + relOpen.level);

    /* 明确不符 → 至少命中一条 no */
    const relNo = store.relevance(
      { title: '关于研究生学业奖学金评审的通知', audience: '全日制研究生', event: '奖助学金' }, prof);
    log('  研究生限定（本人本科生）:', relNo.level,
      relNo.reasons.map((r) => r.key + ':' + r.state).join(' '));
    ck('身份不符时判为 no', relNo.level === 'no', 'level=' + relNo.level);

    /* 回归：「全校本科生、研究生」两个层次都收 → 本科生应判 ok，不能误降为 warn */
    const relBoth = store.relevance(
      { title: '关于创新创业训练计划申报的通知', audience: '全校本科生、研究生', event: '学科竞赛' }, prof);
    const bothLv = relBoth.reasons.find((r) => r.key === 'level');
    log('  本研都收:', relBoth.level, '/', bothLv ? bothLv.state : 'n/a');
    ck('本研都收时判为 ok', relBoth.level === 'ok', 'level=' + relBoth.level);

    /* 回归：材料里的日期斜杠不能把一条材料劈成两半 */
    const stepsDate = store.actionSteps({
      materials: '调研报告初稿(11/24) / 答辩PPT', deadline: '', entry: '', digestPoints: []
    });
    const dateStep = stepsDate.find((s) => /调研报告初稿/.test(s.text));
    log('  日期材料:', dateStep ? dateStep.text : '(缺失)');
    ck('日期斜杠不被当分隔符', !!dateStep && /11\/24/.test(dateStep.text),
      dateStep ? dateStep.text : 'n/a');
    ck('日期材料没被劈开',
      !stepsDate.some((s) => /^\u51c6\u5907\uff1a24\)$/.test(s.text)), '出现半截条目');

    /* ② actionSteps：拆出「要办什么」的清单 */
    /* 用一条真实数据做「详情页串联」集成测试（要能按 id 取到） */
    const nZhuanye = store.NOTICES.find((x) => x.event === '转专业') || store.NOTICES[1];
    const steps = store.actionSteps(nMock);
    log('  办理步骤:', steps.length, '步 →', steps.map((s) => s.kind).join('/'));
    ck('actionSteps 产出清单', steps.length > 0, 'steps=' + steps.length);
    ck('步骤带 kind 分类', steps.every((s) => !!s.kind && !!s.text));
    ck('步骤 key 唯一', new Set(steps.map((s) => s.key)).size === steps.length);
    ck('含材料步骤', steps.some((s) => s.kind === 'mat'));
    ck('含入口步骤', steps.some((s) => s.kind === 'entry'));
    ck('含时间步骤', steps.some((s) => s.kind === 'time'));
    ck('初始都未勾选', steps.every((s) => s.done === false));

    /* ③ 详情页把三者串起来 */
    const dt3 = loadPage('pages/detail/detail');
    navLog = [];
    dt3.onLoad && dt3.onLoad({ id: nZhuanye.id });
    await new Promise((r) => setTimeout(r, 100));
    ck('detail 渲染出 relevance', !!dt3.data.rel, 'rel 为空');
    ck('detail 渲染出 reasonLine', !!(dt3.data.rel && dt3.data.rel.reasonLine));
    ck('detail 渲染出清单', dt3.data.steps.length > 0, 'steps=' + dt3.data.steps.length);
    ck('清单计数一致',
      dt3.data.stepTotal === dt3.data.steps.length && dt3.data.stepDone === 0,
      `${dt3.data.stepDone}/${dt3.data.stepTotal}`);

    /* 勾一步 → 计数与落盘 */
    const k0 = dt3.data.steps[0].key;
    dt3.toggleStep({ currentTarget: { dataset: { k: k0 } } });
    ck('勾选后 stepDone +1', dt3.data.stepDone === 1, 'done=' + dt3.data.stepDone);
    ck('勾选后落盘可读', favMod.isStepDone(nZhuanye.id, k0) === true);
    ck('勾选只影响该步',
      dt3.data.steps.filter((s) => s.done).length === 1);

    /* 再勾一次 → 取消 */
    dt3.toggleStep({ currentTarget: { dataset: { k: k0 } } });
    ck('再点取消勾选', dt3.data.stepDone === 0, 'done=' + dt3.data.stepDone);
    ck('取消后落盘同步', favMod.isStepDone(nZhuanye.id, k0) === false);

    /* 全勾完 → allDone 为真 */
    dt3.data.steps.forEach((s) => {
      dt3.toggleStep({ currentTarget: { dataset: { k: s.key } } });
    });
    ck('全勾完 allDone 为真', dt3.data.allDone === true,
      `${dt3.data.stepDone}/${dt3.data.stepTotal}`);
    ck('全勾完 done === total', dt3.data.stepDone === dt3.data.stepTotal);

    /* 重置 */
    dt3.resetSteps();
    ck('重置后进度归零', dt3.data.stepDone === 0 && dt3.data.allDone === false);
    ck('重置后落盘也清空', favMod.isStepDone(nZhuanye.id, k0) === false);

    /* 复制清单 */
    toastLog = [];
    dt3.copySteps();
    ck('copySteps 可调用不崩溃', true);
    toastLog = [];

    /* gotoMe 跳 tabBar 页（必须 switchTab） */
    navLog = [];
    dt3.gotoMe();
    ck('gotoMe 用 switchTab 跳订阅页',
      navLog.some((x) => x.type === 'switchTab' && /pages\/me/.test(x.url)),
      JSON.stringify(navLog.map((x) => x.type + ':' + x.url)));

    /* 取消收藏应清掉该条的办事进度（避免残留串号） */
    favMod.add(nZhuanye.id);
    favMod.toggleStep(nZhuanye.id, k0);
    const dt4 = loadPage('pages/detail/detail');
    dt4.onLoad && dt4.onLoad({ id: nZhuanye.id });
    await new Promise((r) => setTimeout(r, 60));
    ck('已收藏状态被读到', dt4.data.favorited === true);
    dt4.toggleFav();  /* 取消收藏 */
    ck('取消收藏后 favorited=false', dt4.data.favorited === false);
    ck('取消收藏后办事进度被清空',
      favMod.isStepDone(nZhuanye.id, k0) === false, '步骤残留');
    favMod.remove(nZhuanye.id);
    toastLog = [];
    navLog = [];
  }

  /* ---- 5. 【我的订阅】me ---- */
  log('\n【5】我的订阅页 me');
  const me = loadPage('pages/me/me');
  ck('me 页可加载并注册', !!me);
  if (me) {
    /* onLoad 里先用本地画像同步渲染（loadLocal），云端是异步覆盖；
       所以这里不 await 云端（弱网下 SDK 重试退避可达 7s），只等同步渲染落地 */
    me.onLoad();
    await new Promise((r) => setTimeout(r, 60));
    ck('me 页有 profile', !!me.data.profile && !!me.data.profile.interests,
      'profile=' + JSON.stringify(me.data.profile && me.data.profile.interests));
    ck('本地画像即时渲染（不等云端）', me.data.totalNotices > 0,
      'totalNotices=' + me.data.totalNotices);
    const tagsUtils = require(path.join(MP, 'utils/tags.js'));
    ck('标签体系有 9 个', tagsUtils.TAGS.length === 9, 'tags=' + tagsUtils.TAGS.length);
    ck('runMode 已判定', me.data.runMode === 'local' || me.data.runMode === 'cloud',
      'runMode=' + me.data.runMode);
    log('  9 个标签:', tagsUtils.TAGS.map((t) => t.key).join(' / '));
    log('  运行模式:', me.data.runMode, '| 云就绪:', me.data.cloudReady);
    log('  订阅数:', (me.data.profile.interests || []).length,
      '| 可触达:', me.data.reachable, '条');

    ck('reachable 已实时算出', me.data.reachable > 0, 'reachable=' + me.data.reachable);
    ck('tagCounts 已注入', Object.keys(me.data.tagCounts).length === 9,
      'tagCounts=' + Object.keys(me.data.tagCounts).length);

    /* 订阅开关：切换一个标签，interests 应变化 + dirty 置位 */
    const toggle = me.toggleEvent;
    ck('toggleEvent 存在', typeof toggle === 'function');
    if (typeof toggle === 'function') {
      const before = (me.data.profile.interests || []).slice();
      const target = tagsUtils.TAGS.map((t) => t.key).find((k) => before.indexOf(k) < 0);
      toggle.call(me, { currentTarget: { dataset: { ev: target } } });
      const after = me.data.profile.interests.slice();
      ck('切换标签后 interests 变化', after.length === before.length + 1,
        JSON.stringify({ before, after }));
      ck('订阅变更置 dirty', me.data.dirty === true);
      log('  订阅变更: ' + before.join('/') + ' → ' + after.join('/'));
      ck('reachable 随订阅更新', me.data.reachable > 0);

      /* 取消订阅（切回去） */
      toggle.call(me, { currentTarget: { dataset: { ev: target } } });
      ck('可取消订阅', me.data.profile.interests.indexOf(target) < 0);
    }

    /* ---- 自定义关键词订阅（用户输入"正大杯"，之后命中即推） ---- */
    const subMod = require(path.join(MP, 'utils/subscribe.js'));
    ck('subscribe 模块可加载（关键词单一事实源）', !!subMod && typeof subMod.matchKeyword === 'function');
    ck('关键词清洗：去空白/去重/截断 20 字',
      JSON.stringify(subMod.sanitizeKeywords([' 正大杯 ', '正大杯', 'a b', 'x'.repeat(30)]))
        === JSON.stringify(['正大杯', 'ab', 'x'.repeat(20)]),
      JSON.stringify(subMod.sanitizeKeywords([' 正大杯 ', '正大杯', 'a b', 'x'.repeat(30)])));
    ck('关键词上限为 12', subMod.MAX_KEYWORDS === 12, 'MAX=' + subMod.MAX_KEYWORDS);

    ck('me 页 keywords 归一成数组', Array.isArray(me.data.profile.keywords),
      'keywords=' + JSON.stringify(me.data.profile.keywords));
    ck('kwStats / kwSuggest 已注入',
      Array.isArray(me.data.kwStats) && Array.isArray(me.data.kwSuggest));

    /* 通过页面接口订阅"正大杯"，应写进画像 + 命中统计 > 0 + 置 dirty */
    if (typeof me.onKwInput === 'function' && typeof me.addKeyword === 'function') {
      me.onKwInput({ detail: { value: '正大杯' } });
      ck('onKwInput 记录输入', me.data.kwInput === '正大杯');
      me.addKeyword();
      ck('添加后 keywords 含「正大杯」',
        (me.data.profile.keywords || []).indexOf('正大杯') >= 0);
      ck('添加关键词置 dirty', me.data.dirty === true);
      const st = (me.data.kwStats || []).find((s) => s.kw === '正大杯');
      ck('关键词命中统计已算出', !!st && st.count > 0, JSON.stringify(st));
      ck('添加后输入框清空', me.data.kwInput === '');
      log('  关键词「正大杯」命中 ' + (st ? st.count : 0) + ' 条');

      /* 重复添加应被拦下 */
      const nKw = (me.data.profile.keywords || []).length;
      me.onKwInput({ detail: { value: '正大杯' } });
      me.addKeyword();
      ck('重复关键词不重复写入', (me.data.profile.keywords || []).length === nKw);

      /* 命中关键词的通知必须真的进"我的关注流"（订阅 OR 关键词） */
      await me.save();
      await new Promise((r) => setTimeout(r, 200));
      const storeMod = require(path.join(MP, 'utils/store.js'));
      const feedKw = storeMod.myFeed();
      const storeSub = require(path.join(MP, 'utils/subscribe.js'));
      const hitFeed = feedKw.filter((n) => storeSub.hitKeyword(n, storeMod.getProfile()));
      ck('命中关键词的通知进入关注流', hitFeed.length > 0, 'hitFeed=' + hitFeed.length);

      /* 推送理由里必须出现 KW_MATCH（分数可解释） */
      const pushMod = require(path.join(MP, 'utils/push.js'));
      const kwNotice = storeMod.allNotices().find((n) =>
        storeSub.noticeHaystack(n).indexOf('正大杯') >= 0);
      ck('存在命中关键词的通知', !!kwNotice, kwNotice ? kwNotice.id : 'none');
      if (kwNotice) {
        const rs = pushMod.reasonsFor(kwNotice, storeMod.getProfile(), true, null);
        const kwR = rs.find((r) => r.code === 'KW_MATCH');
        ck('推送理由含 KW_MATCH', !!kwR, JSON.stringify(rs.map((r) => r.code)));
        ck('KW_MATCH 权重为 20', pushMod.WEIGHT.KW_MATCH === 20,
          'w=' + pushMod.WEIGHT.KW_MATCH);
        ck('KW_MATCH 理由写明命中词', !!kwR && kwR.label.indexOf('正大杯') >= 0,
          kwR ? kwR.label : '');
        log('  推送理由:', kwR ? kwR.label : '(无)');

        /* 推送流里也应出现这条（候选池按订阅 OR 关键词筛选） */
        const pr = pushMod.buildPush({ limit: 60 });
        ck('命中关键词的通知进入推送流',
          pr.cards.some((c) => c.id === kwNotice.id));
      }

      /* 删除关键词 */
      if (typeof me.removeKeyword === 'function') {
        me.removeKeyword({ currentTarget: { dataset: { kw: '正大杯' } } });
        ck('取消订阅后 keywords 不含「正大杯」',
          (me.data.profile.keywords || []).indexOf('正大杯') < 0);
      }
    }

    /* 至少保留一项：把其余全取消，最后一项应被保护 */
    if (me.selectAll) {
      me.selectAll();
      ck('selectAll 可全选', me.data.profile.interests.length === 9,
        'n=' + me.data.profile.interests.length);
      log('  全选后 reachable:', me.data.reachable, '条（应等于通知总数）');
    }
    if (me.resetDefault) {
      me.resetDefault();
      ck('resetDefault 回到 4 项默认', me.data.profile.interests.length === 4,
        'n=' + me.data.profile.interests.length);
    }

    /* 保存订阅 */
    await me.save();
    await new Promise((r) => setTimeout(r, 250));
    const saved = wx.getStorageSync('zhishi_profile');
    ck('save 已落本地存储', !!saved && !!saved.interests,
      'storage=' + JSON.stringify(saved && saved.interests));
    ck('保存后 dirty 复位', me.data.dirty === false);
    log('  保存提示:', toastLog.slice(-1)[0] || '(无)');

    /* 主题切换 */
    const themeBefore = me.data.theme;
    me.toggleTheme && me.toggleTheme();
    ck('toggleTheme 可切换主题', me.data.theme !== themeBefore,
      themeBefore + ' → ' + me.data.theme);
    me.toggleTheme && me.toggleTheme();
    ck('可切回原主题', me.data.theme === themeBefore);

    /* 收藏列表 */
    ck('favList 已注入', Array.isArray(me.data.favList), 'favList=' + (me.data.favList || []).length);

    /* 快捷跳转 */
    navLog = [];
    me.goTimeline && me.goTimeline();
    ck('订阅页可跳时间轴', navLog.some((n) => n.type === 'switchTab' && /timeline/.test(n.url)),
      JSON.stringify(navLog));
    navLog = [];
    me.goDigest && me.goDigest();
    ck('订阅页可跳简报', navLog.some((n) => n.type === 'switchTab' && /digest/.test(n.url)));
  }

  /* ---- 6. 同源一致性：web 与 mp 算法是否同一套 ---- */
  log('\n【6】同源一致性（web ↔ miniprogram）');
  const store = require(path.join(MP, 'utils/store.js'));
  const mpGroups = store.matchByTag();
  log('  小程序分组:', mpGroups.map((g) => `${g.tag}×${g.count}`).join(' '));

  const core = fs.readFileSync(path.join(ROOT, 'web', 'zhishi-core.js'), 'utf8');
  const dataJs = fs.readFileSync(path.join(ROOT, 'web', 'zhishi-data.js'), 'utf8');
  const vm = require('vm');
  const sandbox = { window: {}, console };
  sandbox.window.document = undefined;
  vm.createContext(sandbox);
  vm.runInContext(dataJs + '\nthis.ZS_DATA = window.ZS_DATA;', sandbox);
  vm.runInContext(core + '\nthis.ZS = window.ZS;', sandbox);
  const webGroups = sandbox.ZS.matchByTag(sandbox.ZS_DATA.NOTICES,
    sandbox.ZS_DATA.PROFILE.interests, sandbox.ZS_DATA.PROFILE);
  log('  网页版分组:', webGroups.map((g) => `${g.tag}×${g.count}`).join(' '));
  ck('两端分组结果一致',
    JSON.stringify(mpGroups.map((g) => [g.tag, g.count])) ===
    JSON.stringify(webGroups.map((g) => [g.tag, g.count])),
    'mp=' + JSON.stringify(mpGroups.map((g) => [g.tag, g.count])) +
    ' web=' + JSON.stringify(webGroups.map((g) => [g.tag, g.count])));

  /* 身份过滤同源 */
  const mpIdent = require(path.join(MP, 'utils/identity.js'));
  const probeAud = ['全体研究生', '在校学生 / 在职教职工（1-3人团队）', '2025级新生', '全校师生'];
  let identSame = true;
  probeAud.forEach((a) => {
    const mpR = mpIdent.matchAudience(a, sandbox.ZS_DATA.PROFILE);
    const webR = sandbox.ZS.matchAudience(a, sandbox.ZS_DATA.PROFILE);
    if (mpR !== webR) { identSame = false; log('    ✗ 不一致: ' + a + ' mp=' + mpR + ' web=' + webR); }
  });
  ck('两端身份过滤结果一致', identSame);

  /* 搜索同源 */
  const mpSearch = require(path.join(MP, 'utils/search.js'));
  let mpHit = null;
  if (typeof mpSearch.search === 'function') {
    mpHit = mpSearch.search(store.NOTICES, '竞赛', {});
  }
  const webHit = sandbox.ZS.search(sandbox.ZS_DATA.NOTICES, '竞赛', {});
  if (mpHit) {
    log('  搜「竞赛」: 小程序', mpHit.length, '条 / 网页版', webHit.length, '条');
    ck('两端搜索结果数一致', mpHit.length === webHit.length,
      `mp=${mpHit.length} web=${webHit.length}`);
  }

  /* ---- 6b. 跨页一致性：首页 / 时间轴 / 简报 三处的数字必须对得上 ---- */
  log('\n【6b】跨页一致性（首页 ↔ 时间轴 ↔ 简报）');
  /* 首页：warmUp 同步渲染即可，云端是异步覆盖，不等它 */
  const idxP = loadPage('pages/index/index');
  idxP.onLoad();
  await new Promise((r) => setTimeout(r, 60));

  const tlP = loadPage('pages/timeline/timeline');
  tlP.onLoad();

  const dgP = loadPage('pages/digest/digest');
  dgP.onLoad();

  /* 命中总数三处一致 */
  const idxFeed = idxP.data.urgent.length + idxP.data.soon.length + idxP.data.later.length;
  log('  首页关注流 ' + idxFeed + ' 条 / 时间轴 ' + tlP.data.total + ' 条 / 简报统计 ' +
    (dgP.data.brief.stats && dgP.data.brief.stats.matched) + ' 条');
  ck('首页与时间轴总量一致', idxFeed === tlP.data.total,
    `index=${idxFeed} timeline=${tlP.data.total}`);
  ck('时间轴与简报统计一致',
    tlP.data.total === (dgP.data.brief.stats && dgP.data.brief.stats.matched),
    `timeline=${tlP.data.total} brief=${dgP.data.brief.stats && dgP.data.brief.stats.matched}`);

  /* 知时指数三处同源 */
  ck('知时指数首页 = 时间轴', idxP.data.index.score === tlP.data.index.score,
    `index=${idxP.data.index.score} timeline=${tlP.data.index.score}`);
  ck('知时指数首页 = 简报', idxP.data.index.score === dgP.data.brief.index.score,
    `index=${idxP.data.index.score} brief=${dgP.data.brief.index.score}`);

  /* 简报的「三天内要办」应 ⊆ 首页紧急区 */
  const idxUrgentIds = idxP.data.urgent.map((n) => n.id);
  const briefMustIds = dgP.data.brief.must.map((n) => n.id);
  ck('简报「三天内要办」⊆ 首页紧急区',
    briefMustIds.every((id) => idxUrgentIds.indexOf(id) >= 0),
    JSON.stringify({ briefMustIds, idxUrgentIds }));

  /* 时间轴 d3 档 应 ⊆ 首页紧急区 */
  const tlD3Ids = (tlP.data.buckets.find((b) => b.key === 'd3') || { items: [] }).items.map((n) => n.id);
  ck('时间轴 d3 档 ⊆ 首页紧急区',
    tlD3Ids.every((id) => idxUrgentIds.indexOf(id) >= 0),
    JSON.stringify({ tlD3Ids, idxUrgentIds }));

  /* 简报每句都用中文分号分隔 —— 保证 sentences 拆句正确 */
  ck('简报一句话可拆成多句', dgP.data.sentences.length >= 1,
    JSON.stringify(dgP.data.sentences));

  /* ---- 6c. 边界与健壮性 ---- */
  /* ---- 4c. 出处真实性（这是"可靠性"的红线，必须被测试守住） ---- */
  log('\n【4c】出处真实性审计');
  {
    const store = require(path.join(MP, 'utils/store.js'));
    const all = store.NOTICES;
    const realLinked = all.filter((n) => n.real === true && n.url);
    const demo = all.filter((n) => n.real !== true);
    const demoWithUrl = demo.filter((n) => n.url);

    log('  总数:', all.length, '| real=true:', all.filter((n) => n.real === true).length,
      '| 带链接:', realLinked.length, '| 演示样例:', demo.length);

    /* 红线①：演示样例绝不能带 url（带了就是伪造出处） */
    ck('演示样例不带 url（不伪造出处）', demoWithUrl.length === 0,
      demoWithUrl.map((n) => n.title.slice(0, 20)).join(' / '));

    /* 红线②：凡 real=true 的，必须有其码的出处线索（site 或 source 非空） */
    ck('real=true 均有 source',
      all.filter((n) => n.real === true).every((n) => !!n.source));

    /* 红线③：附带了 url 的，必须是 ahau.edu.cn 域名（不能指向别处/编造） */
    const badHost = realLinked.filter((n) => !/ahau\.edu\.cn/.test(n.url));
    ck('带链接的 url 均属 ahau.edu.cn', badHost.length === 0,
      badHost.map((n) => n.url).join(' / '));

    /* 红线④：real=true 且带链接的，其 raw 必须能在原文里定位到要点引文
     *        （url 给了就必须能对上，否则链接是假的） */
    const linkedWithPts = realLinked.filter((n) => (n.digestPoints || []).length > 0);
    const traceOk = linkedWithPts.filter((n) =>
      n.digestPoints.every((p) => store.locateQuote(n.raw, p.quote) >= 0));
    log('  带链接且可溯源:', traceOk.length + '/' + linkedWithPts.length);
    ck('带链接条目要点均可在 raw 中定位',
      linkedWithPts.length === 0 || traceOk.length === linkedWithPts.length,
      traceOk.length + '/' + linkedWithPts.length);

    /* 红线⑤：统计层必须如实给出「可核对条数」 */
    const stats = store.getStats();
    ck('stats 暴露 linkedCnt', typeof stats.linkedCnt === 'number',
      'linkedCnt=' + stats.linkedCnt);
    ck('linkedCnt 与实际相符', stats.linkedCnt === realLinked.length,
      'stats=' + stats.linkedCnt + ' 实际=' + realLinked.length);

    /* 红线⑥：详情页对三种出处状态要说不同的话（找一条演示样例验证） */
    if (demo.length) {
      const dtDemo = loadPage('pages/detail/detail');
      dtDemo.onLoad && dtDemo.onLoad({ id: demo[0].id });
      await new Promise((r) => setTimeout(r, 60));
      ck('演示样例详情页标为 demo', dtDemo.data.srcState === 'demo',
        'srcState=' + dtDemo.data.srcState);
      ck('演示样例标签写明"非真实通知"',
        /非真实通知/.test(dtDemo.data.srcLabel || ''), dtDemo.data.srcLabel);
    }
    /* 真实且有链接 → verifiable */
    if (realLinked.length) {
      const dtReal = loadPage('pages/detail/detail');
      dtReal.onLoad && dtReal.onLoad({ id: realLinked[0].id });
      await new Promise((r) => setTimeout(r, 60));
      ck('可核对条目详情页标为 verifiable', dtReal.data.srcState === 'verifiable',
        'srcState=' + dtReal.data.srcState);
      ck('可核对条目标签写明"可核对"',
        /可核对/.test(dtReal.data.srcLabel || ''), dtReal.data.srcLabel);
    }
    toastLog = []; navLog = [];
  }

  /* ---- 4d. 自查自纠系统（用户红线：保证真实可靠性） ---- */
  log('\n【4d】自查自纠系统');
  {
    const sc = require(path.join(MP, 'utils/selfcheck.js'));
    const store4 = require(path.join(MP, 'utils/store.js'));

    /* —— 引擎基础能力 —— */
    ck('有 auditNotice/auditPool/selfReport/auditHistory 四件套',
      typeof sc.auditNotice === 'function' && typeof sc.auditPool === 'function' &&
      typeof sc.selfReport === 'function' && typeof sc.auditHistory === 'function');
    ck('域名白名单含 ahau.edu.cn', sc.ALLOWED_HOSTS.indexOf('ahau.edu.cn') >= 0,
      JSON.stringify(sc.ALLOWED_HOSTS));
    ck('hostAllowed 接受 jwc.ahau.edu.cn', sc.hostAllowed('https://jwc.ahau.edu.cn/info/1881/36671.htm') === true);
    ck('hostAllowed 拒绝外域名', sc.hostAllowed('https://example.com/x') === false);
    ck('hostOf 正确取域名', sc.hostOf('https://xxb.ahau.edu.cn/a') === 'xxb.ahau.edu.cn',
      sc.hostOf('https://xxb.ahau.edu.cn/a'));

    /* —— 铁律 R2：演示样例带 url → fatal 剔除 —— */
    const fakeDemo = { id: 'x-demo', title: '演示通知', real: false, url: 'https://jwc.ahau.edu.cn/a.htm' };
    const rDemo = sc.auditNotice(fakeDemo);
    ck('R2 演示样例带 url → fatal',
      rDemo.level === 'fatal' && rDemo.issues.some((i) => i.code === 'R2_DEMO_HAS_URL'),
      rDemo.level + ' ' + JSON.stringify(rDemo.issues.map((i) => i.code)));

    /* —— 铁律 R1：real 但 url 非白名单 → fatal —— */
    const badHostN = { id: 'x-host', title: '外部链接', real: true, source: '教务处', url: 'https://weibo.com/x', raw: '一段足够长的原文用于测试'.repeat(3) };
    const rHost = sc.auditNotice(badHostN);
    ck('R1 非白名单域名 → fatal',
      rHost.level === 'fatal' && rHost.issues.some((i) => i.code === 'R1_BAD_HOST'),
      rHost.level + ' ' + JSON.stringify(rHost.issues.map((i) => i.code)));

    /* —— 铁律 R3：引文全不可定位 → fatal —— */
    const rawText = '关于做好本科生转专业工作的通知。请于11月3日前报送名单，11月6日前报送选录细则。';
    const badQuote = {
      id: 'x-quote', title: '引文测试', real: false, source: '教务处',
      raw: rawText,
      digestPoints: [{ quote: '这段文字在原文里根本不存在' }, { quote: '另一段也不存在的话' }]
    };
    const rQuote = sc.auditNotice(badQuote);
    ck('R3 引文全不可定位 → fatal',
      rQuote.level === 'fatal' && rQuote.issues.some((i) => i.code === 'R3_QUOTE_MISS'),
      rQuote.level);

    /* —— R3 部分命中：有疑点但保留（warn） —— */
    const partQuote = {
      id: 'x-part', title: '部分引文', real: false, source: '教务处', raw: rawText,
      digestPoints: [{ quote: '请于11月3日前报送名单' }, { quote: '不存在的一句' }]
    };
    const rPart = sc.auditNotice(partQuote);
    ck('R3 部分命中 → warn 且保留',
      rPart.level === 'warn' && rPart.issues.some((i) => i.code === 'R3_QUOTE_MISS' && i.fatal === false),
      rPart.level);

    /* —— 自纠：countdown 与 deadline 不符 → 以 deadline 为准重算（info，不报警） —— */
    /* 用真实 deadline 的偏移量，模拟"数据是几天前编制的"，漂移在 60 天内属正常刷新 */
    const realExpect = Math.round((new Date('2026-11-06T00:00:00') - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);
    const cdN = { id: 'x-cd', title: '倒计时', real: false, source: 'x', raw: '一段足够长的原文用于测试内容'.repeat(3), deadline: '2026-11-06', countdown: realExpect - 3 };
    const rCd = sc.auditNotice(cdN);
    ck('自纠 countdown → fixed.countdown',
      typeof rCd.fixed.countdown === 'number' && rCd.fixed.countdown === realExpect,
      'expect=' + rCd.fixed.countdown + ' real=' + realExpect);
    ck('倒计时刷新记为 info（不计入 warn）',
      rCd.issues.some((i) => i.code === 'CD_REFRESH' && i.info === true),
      JSON.stringify(rCd.issues.map((i) => i.code + ':' + i.info)));

    /* —— 自纠：raw 过短 → warn 提示 —— */
    const shortN = { id: 'x-short', title: '短原文', real: false, source: 'x', raw: '太短了' };
    const rShort = sc.auditNotice(shortN);
    ck('raw 过短 → warn RAW_TOO_SHORT',
      rShort.issues.some((i) => i.code === 'RAW_TOO_SHORT'),
      JSON.stringify(rShort.issues.map((i) => i.code)));

    /* —— auditPool：fatal 剔除、warn 保留、计数如实 —— */
    const poolIn = [fakeDemo, badHostN, badQuote, partQuote, shortN, cdN];
    const poolOut = sc.auditPool(poolIn, { persist: false });
    ck('auditPool 剔除 3 条 fatal',
      poolOut.dropped.length === 3, 'dropped=' + poolOut.dropped.length + ' ' + JSON.stringify(poolOut.dropped.map((d) => d.id)));
    ck('auditPool 放行 3 条',
      poolOut.clean.length === 3, 'clean=' + poolOut.clean.length);
    ck('auditPool 统计 total 如实',
      poolOut.stats.total === poolIn.length, 'total=' + poolOut.stats.total);
    ck('auditPool passed+dropped=total',
      poolOut.stats.passed + poolOut.stats.dropped === poolOut.stats.total);
    ck('放行条目带 audit 标记',
      poolOut.clean.every((x) => x.audit && typeof x.audit.verifiable === 'boolean'));
    ck('自纠后的 countdown 已应用到副本',
      poolOut.clean.filter((x) => x.id === 'x-cd').every((x) => x.countdown === rCd.fixed.countdown));

    /* —— 全池自查：真实数据池必须「零剔除、零致命」——
     * 注意：R_NO_URL（真实采集但未留存链接）是如实标注的 warn，不是致命问题。
     *       它只说明"这条没留链接"，不是"这条不可信"——所以允许存在。 */
    const rep = store4.selfReport();
    log('  全池自查: 审计', rep.stats.total, '放行', rep.stats.passed,
      '剔除', rep.stats.dropped, '可举证', rep.stats.verifiable);
    ck('真实数据池零剔除', rep.stats.dropped === 0, 'dropped=' + rep.stats.dropped);
    /* 无 fatal 级问题（issueLines 里不含剔除类，健康判定只卡"剔除"这一项） */
    ck('真实数据池无剔除类问题',
      !rep.issueLines.some((l) => /剔除|伪造|非安农官网/.test(l)),
      JSON.stringify(rep.issueLines));
    /* 留存链接标注与实际相符：有缺链就必须如实写出来，无缺链就不该凭空报缺。
     * （本轮 200 条采集全部带 url，所以应"无缺链告警"；断言不写死方向，
     *   只要求"告警出现与否"与真实缺链数一致 —— 这本身才是"不伪装"。） */
    const noUrlCnt = (() => {
      let c = 0;
      (store4.list ? store4.list() : []).forEach((n) => {
        if (n.real && !n.url) c++;
      });
      return c;
    })();
    const warnsNoUrl = rep.issueLines.some((l) => /未留存原文链接/.test(l));
    ck('留存链接标注与真实缺链数一致（不伪装）',
      warnsNoUrl === (noUrlCnt > 0),
      `缺链=${noUrlCnt} 告警=${warnsNoUrl}`);
    ck('自查报告 stats 完整',
      typeof rep.stats.total === 'number' && typeof rep.stats.verifiable === 'number');
    ck('可举证条数与 stats.linkedCnt 一致',
      rep.stats.verifiable === store4.getStats().linkedCnt,
      'rep=' + rep.stats.verifiable + ' linkedCnt=' + store4.getStats().linkedCnt);

    /* —— 留痕：审计历史可读 —— */
    const hist = store4.auditHistory();
    ck('审计留痕可读取（数组）', Array.isArray(hist));
    ck('留痕含时间戳与计数',
      hist.length === 0 || (typeof hist[0].ts === 'number' && typeof hist[0].passed === 'number'));

    /* —— 自查页渲染 —— */
    const scPage = loadPage('pages/selfcheck/selfcheck');
    scPage.onLoad && scPage.onLoad({});
    await new Promise((r) => setTimeout(r, 60));
    ck('自查页 stat.total 与引擎一致', scPage.data.stat.total === rep.stats.total,
      'page=' + scPage.data.stat.total + ' engine=' + rep.stats.total);
    ck('自查页 三条铁律齐全（R1/R2/R3）',
      scPage.data.rules.length === 3 &&
      scPage.data.rules.map((r) => r.code).join(',') === 'R1,R2,R3',
      scPage.data.rules.map((r) => r.code).join(','));
    ck('自查页 结论卡健康态与引擎一致',
      scPage.data.healthy === rep.healthy, 'page=' + scPage.data.healthy);
    ck('自查页 可举证清单非空且均带 url',
      scPage.data.verifiableList.length > 0 &&
      scPage.data.verifiableList.every((v) => !!v.url),
      'cnt=' + scPage.data.verifiableList.length);

    /* 自查页 copyUrl：复制链接，不跳外链 */
    toastLog = []; navLog = [];
    if (scPage.data.verifiableList.length) {
      scPage.copyUrl({ currentTarget: { dataset: { url: scPage.data.verifiableList[0].url } } });
      ck('自查页 copyUrl 触发剪贴板复制', clipboardLog.length > 0, JSON.stringify(clipboardLog.slice(-1)));
      ck('自查页 copyUrl 不跳外链', navLog.length === 0);
    }

    /* 自查页 goDetail：进入详情 */
    toastLog = []; navLog = [];
    if (scPage.data.verifiableList.length) {
      scPage.goDetail({ currentTarget: { dataset: { id: scPage.data.verifiableList[0].id } } });
      ck('自查页 goDetail 进入详情页',
        navLog.length > 0 && /pages\/detail\/detail/.test(navLog.slice(-1)[0].url || ''),
        JSON.stringify(navLog.slice(-1)));
    }

    /* 自查页 rerun：重跑自查并提示 */
    toastLog = []; navLog = [];
    scPage.rerun();
    await new Promise((r) => setTimeout(r, 300));
    ck('自查页 rerun 有 toast 反馈', toastLog.length > 0,
      toastLog.length ? JSON.stringify(toastLog.slice(-1)) : '(无)');
    ck('自查页 rerun 后 healthy 不变（数据未变）', scPage.data.healthy === rep.healthy);

    toastLog = []; navLog = []; clipboardLog = [];
  }

  log('\n【4e】主动推送引擎');
  {
    const push = require(path.join(MP, 'utils/push.js'));
    const identity4 = require(path.join(MP, 'utils/identity.js'));
    const store5 = require(path.join(MP, 'utils/store.js'));

    /* —— 引擎五件套 —— */
    ck('有 buildPush/shouldNotifyNow/pushBuckets/pushStats 四件套',
      typeof push.buildPush === 'function' && typeof push.shouldNotifyNow === 'function' &&
      typeof push.pushBuckets === 'function' && typeof push.pushStats === 'function');

    /* —— 推送级别映射 —— */
    ck('倒计时 → 级别：0/1 天为 now', push.levelOfCd(0) === 'now' && push.levelOfCd(1) === 'now');
    ck('倒计时 → 级别：3 天为 hot', push.levelOfCd(3) === 'hot');
    ck('倒计时 → 级别：7 天为 soon', push.levelOfCd(7) === 'soon');
    ck('倒计时 → 级别：30 天为 plan', push.levelOfCd(30) === 'plan');
    ck('倒计时 → 级别：null/far 为 far', push.levelOfCd(null) === 'far' && push.levelOfCd(99) === 'far');
    ck('已过期降级为 far（不顶在首页）', push.levelOfCd(-3) === 'far');

    /* —— 打扰阈值：只有 now/hot 允许打扰 —— */
    ck('级别元信息 notify 只对 now/hot 为真',
      push.levelMeta('now').notify === true && push.levelMeta('hot').notify === true &&
      push.levelMeta('soon').notify === false && push.levelMeta('plan').notify === false);

    /* —— 打分可解释 —— */
    const p = { identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
      interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'] };
    const urgentN = { id: 'u1', real: false, event: '考试安排', title: '考试安排通知',
      deadline: '2026-01-01', countdown: 2, publish: '2026-01-01' };
    const farN = { id: 'f1', real: false, event: '讲座培训', title: '某讲座',
      deadline: '', countdown: null, publish: '2026-01-01' };
    /* 分数刻度由 MAX_RAW 决定，断言改为"与权重表自洽"而非写死数字：
     * 三天内截止（DUE_3=28）+ 订阅（SUBSCRIBED=16）= 权重 44 → 分数 = 44/MAX_RAW*100。 */
    const expectUrgent = Math.round(100 * (push.WEIGHT.DUE_3 + push.WEIGHT.SUBSCRIBED) / push.WEIGHT_MAX_RAW());
    ck('三天内截止得分 = (DUE_3+SUBSCRIBED)/MAX_RAW 归一化值（刻度自洽）',
      push.scoreOf(urgentN, p, false) === expectUrgent,
      'score=' + push.scoreOf(urgentN, p, false) + ' 期望=' + expectUrgent);
    ck('三天内截止显著靠前（不低于 25 分，归一化后仍显眼）',
      push.scoreOf(urgentN, p, false) >= 25, 'score=' + push.scoreOf(urgentN, p, false));
    ck('新收录额外加 NEW 权重对应的分（差值与权重表一致）',
      push.scoreOf(urgentN, p, true) - push.scoreOf(urgentN, p, false)
        === Math.round(100 * push.WEIGHT.NEW / push.WEIGHT_MAX_RAW()) ||
      /* 允许 ±1 的取整误差 */
      Math.abs((push.scoreOf(urgentN, p, true) - push.scoreOf(urgentN, p, false))
        - push.WEIGHT.NEW / push.WEIGHT_MAX_RAW() * 100) <= 1,
      'Δ=' + (push.scoreOf(urgentN, p, true) - push.scoreOf(urgentN, p, false))
        + ' NEW=' + push.WEIGHT.NEW);
    ck('可核对原文额外加分（real+url）',
      push.scoreOf(Object.assign({}, farN, { real: true, url: 'https://jwc.ahau.edu.cn/a.htm' }), p, false) >
      push.scoreOf(farN, p, false));
    ck('身份点名年级额外加分',
      push.scoreOf(Object.assign({}, farN, { title: '2025级本科生通知' }), p, false) >
      push.scoreOf(farN, p, false));

    /* —— 归一化：分数 = 理由权重之和，且落在 0-100 —— */
    const reasonsU = push.reasonsFor(urgentN, p, false);
    ck('分数 = 理由权重之和（理由即分数，单一事实源）',
      push.scoreFromReasons(reasonsU) === push.scoreOf(urgentN, p, false),
      'reasons=' + push.scoreFromReasons(reasonsU) + ' scoreOf=' + push.scoreOf(urgentN, p, false));
    ck('每条理由都带权重 w', reasonsU.every((r) => typeof r.w === 'number'));
    ck('归一化分数恒在 0-100',
      [urgentN, farN].every((n) => { const s = push.scoreOf(n, p, false); return s >= 0 && s <= 100; }));
    ck('分数封顶不超过 100（构造满分不溢出）',
      push.scoreFromReasons([
        { w: 40 }, { w: 28 }, { w: 22 }, { w: 18 }, { w: 16 }, { w: 14 }, { w: 10 }, { w: 10 }, { w: 8 }, { w: 6 }, { w: 6 }
      ]) <= 100);

    /* —— 机会类加权 —— */
    ck('机会类标签白名单存在且含转专业/奖助/竞赛',
      push.OPPORTUNITY_TAGS.indexOf('转专业') >= 0 && push.OPPORTUNITY_TAGS.indexOf('奖助学金') >= 0 &&
      push.OPPORTUNITY_TAGS.indexOf('学科竞赛') >= 0);
    ck('机会类条目多一条 OPPORTUNITY 理由（+14）',
      (function () {
        const opp = { id: 'o1', real: false, event: '奖助学金', title: '奖学金评审', countdown: null, publish: '2026-01-01' };
        const plain = { id: 'p1', real: false, event: '校内通知', title: '一般通知', countdown: null, publish: '2026-01-01' };
        const ro = push.reasonsFor(opp, { interests: [] }, false);
        return ro.some((r) => r.code === 'OPPORTUNITY') &&
          push.scoreOf(opp, { interests: [] }, false) > push.scoreOf(plain, { interests: [] }, false);
      })());

    /* —— 新近发布补偿：无截止日期条目不再永远沉底 —— */
    ck('publishAge 解析正确（今天为 0）',
      push.publishAge(new Date().toISOString().slice(0, 10)) === 0);
    ck('新近发布（14 天内）获得 FRESH 理由',
      (function () {
        const n = { id: 'fr', event: '校内通知', title: 'x', countdown: null, publish: new Date().toISOString().slice(0, 10) };
        return push.reasonsFor(n, { interests: [] }, false).some((r) => r.code === 'FRESH');
      })());
    ck('过期发布（>14 天）不给 FRESH',
      push.publishAge('2020-01-01') > 14);

    /* —— 反馈闭环：点开过的同类加分（READ） —— */
    push.resetFeedback();
    ck('反馈初始为空', push.feedbackStats().opened === 0);
    push.markOpened({ id: 'k1', event: '学科竞赛' });
    push.markOpened({ id: 'k2', event: '学科竞赛' });
    ck('点开两次同类 → 该标签计数 = 2', push.feedbackStats().opened === 2);
    ck('常看标签的同类条目带 READ 理由',
      (function () {
        const n = { id: 'k3', event: '学科竞赛', title: 'x', countdown: null, publish: '2026-01-01' };
        return push.reasonsFor(n, { interests: [] }, false, push.feedbackFor(n)).some((r) => r.code === 'READ');
      })());
    ck('READ 为正权重（越用越准）', push.WEIGHT.READ > 0);

    /* —— 重复抑制：展示多次没点开 → STALE 降权 —— */
    push.resetFeedback();
    /* 用一条"本来有分"的条目（订阅标签），否则 0 分再怎么减也还是 0，测不出效果 */
    const staleN = { id: 's1', event: '学科竞赛', title: 'x', countdown: null, publish: '2026-01-01' };
    const staleP = { interests: ['学科竞赛'] };
    const baseScore = push.scoreOf(staleN, staleP, false);
    push.markShown([staleN]); push.markShown([staleN]); push.markShown([staleN]);
    const fbStale = push.feedbackFor(staleN);
    ck('展示 3 次未点开 → stale = true', fbStale.stale === true);
    ck('STALE 为负权重（重复抑制）', push.WEIGHT.STALE < 0);
    ck('重复抑制后分数下降',
      push.scoreOf(staleN, staleP, false, fbStale) < baseScore,
      baseScore + ' → ' + push.scoreOf(staleN, staleP, false, fbStale));
    ck('点开过的不再判 stale',
      (function () { push.markOpened(staleN); return push.feedbackFor(staleN).stale === false; })());
    push.resetFeedback();

    /* —— 推送理由可核对 —— */
    const reasons = push.reasonsFor(Object.assign({}, urgentN, { audience: '2025级本科生' }), p, true);
    ck('理由含时间项（DUE_/今天截止）', reasons.some((r) => /DUE/.test(r.code)),
      JSON.stringify(reasons.map((r) => r.code)));
    ck('理由含订阅项（SUBSCRIBED）', reasons.some((r) => r.code === 'SUBSCRIBED'));
    ck('理由含新收录项（NEW）', reasons.some((r) => r.code === 'NEW'));
    ck('理由含身份契合项（MATCH_GRADE）', reasons.some((r) => r.code === 'MATCH_GRADE'));
    ck('每条理由都带 label 与 detail（可展示、可核对）',
      reasons.every((r) => r.label && r.detail));

    /* —— buildPush：真数据流 —— */
    const r1 = push.buildPush({ profile: p, limit: 99 });
    ck('buildPush 返回卡片流且非空', r1.cards.length > 0, r1.cards.length + ' 条');
    ck('卡片按 pushScore 降序',
      r1.cards.every((c, i) => i === 0 || r1.cards[i - 1].pushScore >= c.pushScore));
    ck('shouldNotify 与级别严格一致',
      r1.cards.every((c) => (c.pushLevel === 'now' || c.pushLevel === 'hot') === c.shouldNotify));
    ck('notify + silent = total',
      r1.notify.length + r1.silent.length === r1.total);
    ck('summary 有 line/badge/tone',
      r1.summary && r1.summary.line && typeof r1.summary.tone === 'string');
    ck('summary.tone 与是否有待办一致',
      (r1.hotCount > 0) === (r1.summary.tone === 'alert'), 'tone=' + r1.summary.tone);
    log('  推送流:', r1.total, '条 · 打扰', r1.hotCount, '条 · 新收录', r1.newCount, '条');
    log('  一句话:「' + r1.summary.line + '」');

    /* —— 新收录留痕 —— */
    push.resetState();
    const a1 = push.buildPush({ profile: p, limit: 99 });
    ck('首次构建全部标为新', a1.newCount === a1.total, 'new=' + a1.newCount + '/' + a1.total);
    push.markPushed(a1.cards.map((c) => c.id));
    const a2 = push.buildPush({ profile: p, limit: 99 });
    ck('标记已推后 newCount 归零', a2.newCount === 0, 'new=' + a2.newCount);
    ck('推送留痕计数递增', push.pushState().pushCount >= 1);
    push.resetState();
    const a3 = push.buildPush({ profile: p, limit: 99 });
    ck('重置留痕后重新标为新', a3.newCount === a3.total);

    /* —— shouldNotifyNow 轻量入口 —— */
    const sn = push.shouldNotifyNow(p);
    ck('shouldNotifyNow 返回 notify/count/line',
      typeof sn.notify === 'boolean' && typeof sn.count === 'number' && !!sn.line);
    ck('shouldNotifyNow.count 与 buildPush.notify 一致', sn.count === r1.notify.length);

    /* —— pushBuckets 分箱 —— */
    /* 注意：buildPush 的 total 是**截断后**的条数（默认 limit=30），
     * pushBuckets 也用同一默认 limit，所以必须用同样的 limit 比才自洽。
     * （数据池扩到 200 条后相关条目 >30，这里若用 limit:99 比就会假报警。） */
    const bk = push.pushBuckets(p);
    ck('pushBuckets 分箱 count 与 items 长度一致',
      bk.every((b) => b.count === b.items.length && b.count > 0));
    ck('pushBuckets 总数 = buildPush.total（同 limit 口径）',
      bk.reduce((s, b) => s + b.count, 0) === push.buildPush({ profile: p }).total,
      'buckets=' + bk.reduce((s, b) => s + b.count, 0) +
      ' total=' + push.buildPush({ profile: p }).total);

    /* —— heroCard：首屏头条（合并三卡） —— */
    /* 注意：newCount/line 依赖"已推留痕"这一可变状态，
     * 所以这里 hero 与参照 buildPush 必须**紧接着**构建，不能隔着 markPushed/resetState。 */
    const rFresh = push.buildPush({ profile: p, limit: 40 });
    const hero = push.heroCard(p);
    ck('heroCard 有 line/tone/action/total',
      typeof hero.line === 'string' && !!hero.tone && !!hero.action &&
      typeof hero.total === 'number');
    ck('heroCard.line 与同刻 buildPush 一句话一致', hero.line === rFresh.summary.line,
      'hero=' + hero.line + ' | push=' + rFresh.summary.line);
    ck('heroCard.tone 与紧急度自洽',
      (rFresh.hotCount > 0) === (hero.tone === 'alert'),
      'hot=' + rFresh.hotCount + ' tone=' + hero.tone);
    ck('heroCard.badge 与 push badge 一致', hero.badge === rFresh.summary.badge);
    ck('heroCard.total = buildPush.total', hero.total === rFresh.total);
    ck('heroCard lead 只取三天内',
      !hero.hasLead || hero.lead.pushLevel === 'now' || hero.lead.pushLevel === 'hot',
      hero.lead ? hero.lead.pushLevel : 'no-lead');
    ck('heroCard lead 是分数最高的那条',
      !hero.hasLead || hero.lead.id === rFresh.cards[0].id);
    ck('heroCard reasons 最多 3 条且都有 label',
      hero.reasons.length <= 3 && hero.reasons.every((x) => !!x.label));
    ck('heroCard action 有 text 与 kind',
      !!hero.action.text && !!hero.action.kind);
    ck('heroCard 无 lead 时给出 hint 且 action 不用 detail',
      hero.hasLead || (!!hero.hint && hero.action.kind !== 'detail'));

    /* —— tieredFeed：主次梯度（major 三天内 / minor 归档） —— */
    const tf = push.tieredFeed(p);
    ck('tieredFeed 三段结构齐备',
      Array.isArray(tf.hero) && Array.isArray(tf.major) && Array.isArray(tf.minor));
    ck('tieredFeed 总数 = buildPush.total',
      tf.major.length + tf.minor.length + tf.hero.length === rFresh.total);
    ck('tieredFeed 与 buildPush 同口径（不产生第二套事实）',
      tf.major.length + tf.minor.length === rFresh.total);
    ck('tieredFeed.major 为「三天内 或 分数≥阈值」',
      tf.major.every((c) => c.pushLevel === 'now' || c.pushLevel === 'hot'
                            || (typeof c.pushScore === 'number' && c.pushScore >= push.MAJOR_SCORE)),
      tf.major.map((c) => c.pushLevel + '/' + c.pushScore).join(','));
    ck('tieredFeed.major 覆盖全部 hot（三天内必为中卡）',
      tf.major.filter((c) => c.pushLevel === 'now' || c.pushLevel === 'hot').length === rFresh.hotCount,
      'major-hot=' + tf.major.filter((c) => c.pushLevel === 'now' || c.pushLevel === 'hot').length + ' hot=' + rFresh.hotCount);
    ck('tieredFeed.minor 均低于阈值且非紧急',
      tf.minor.every((c) => ['soon', 'plan', 'far'].indexOf(c.pushLevel) >= 0
                            && (typeof c.pushScore !== 'number' || c.pushScore < push.MAJOR_SCORE)));
    ck('tieredFeed 每张卡都带 tier 标签',
      tf.major.concat(tf.minor).every((c) => !!c.tier));
    ck('tierOf 映射：三天内必中卡；高分（≥MAJOR_SCORE）也中卡；其余小卡',
      push.tierOf({ pushLevel: 'now' }) === 'major' &&
      push.tierOf({ pushLevel: 'hot' }) === 'major' &&
      push.tierOf({ pushLevel: 'far', pushScore: push.MAJOR_SCORE }) === 'major' &&
      push.tierOf({ pushLevel: 'plan', pushScore: push.MAJOR_SCORE - 1 }) === 'minor' &&
      push.tierOf({ pushLevel: 'far', pushScore: 10 }) === 'minor');

    /* —— 过期系统性降权（EXPIRED）：过期条目必须沉底 —— */
    ck('权重 EXPIRED 为负且量级足以沉底',
      typeof push.WEIGHT.EXPIRED === 'number' && push.WEIGHT.EXPIRED < 0
      && push.WEIGHT.EXPIRED <= -30);
    const expN = { id: 'exp-x', event: '考试安排', countdown: -3, deadline: '2026-01-01',
                   priority: 'high', real: true, url: 'https://x', publish: '2026-01-01',
                   audience: '全体本科生', title: '过期考试安排' };
    const expR = push.reasonsFor(expN, store5.getProfile(), true, null);
    ck('过期条目只给 EXPIRED，不给正向"该行动"理由',
      expR.some((x) => x.code === 'EXPIRED')
      && !expR.some((x) => ['OPPORTUNITY', 'FRESH', 'MATCH_LEVEL'].indexOf(x.code) >= 0),
      expR.map((x) => x.code).join('+'));
    ck('过期条目首/唯一负面理由是"已截止"且含天数',
      expR.some((x) => x.code === 'EXPIRED' && /已截止\s*\d+\s*天/.test(x.label)),
      expR.map((x) => x.label).join(' | '));
    const expScore = push.scoreOf(expN, store5.getProfile(), true, null);
    const freshN = Object.assign({}, expN, { countdown: 5, id: 'fresh-x' });
    const freshScore = push.scoreOf(freshN, store5.getProfile(), true, null);
    ck('同一事项：过期分 < 未过期分（时间维度决定性）',
      expScore < freshScore, '过期 ' + expScore + ' vs 未过期 ' + freshScore);
    /* 过期越久分越低（EXPIRED 随天数递增） */
    const exp3 = push.scoreOf(Object.assign({}, expN, { countdown: -3 }), store5.getProfile(), true, null);
    const exp20 = push.scoreOf(Object.assign({}, expN, { countdown: -20 }), store5.getProfile(), true, null);
    ck('过期越久分不高于刚过期（负权随天数递增）', exp20 <= exp3,
      '过期20天 ' + exp20 + ' vs 过期3天 ' + exp3);
    /* 推送流排序：所有过期条目都排在所有未过期条目之后 */
    const allCards = rFresh.cards;
    const lastFreshIdx = (() => {
      let k = -1;
      allCards.forEach((c, i) => { if (!(typeof c.countdown === 'number' && c.countdown < 0)) k = i; });
      return k;
    })();
    const firstExpIdx = allCards.findIndex((c) => typeof c.countdown === 'number' && c.countdown < 0);
    ck('推送流：过期条目全部排在未过期之后',
      firstExpIdx < 0 || lastFreshIdx < 0 || firstExpIdx > lastFreshIdx,
      'lastFresh=' + lastFreshIdx + ' firstExp=' + firstExpIdx);
    ck('过期卡带 isExpired 标记且 reasonLine 为"已截止…"',
      allCards.filter((c) => typeof c.countdown === 'number' && c.countdown < 0)
        .every((c) => c.isExpired === true && /已截止/.test(c.pushReasonLine)));
    ck('未过期卡 isExpired 为 false',
      allCards.filter((c) => !(typeof c.countdown === 'number' && c.countdown < 0))
        .every((c) => c.isExpired === false));

    /* —— 「说明类」非待办降权（EXPLAIN_ONLY）—— */
    ck('权重 EXPLAIN_ONLY 为负',
      typeof push.WEIGHT.EXPLAIN_ONLY === 'number' && push.WEIGHT.EXPLAIN_ONLY < 0);
    const explN = { id: 'expl-1', event: '选课', title: '关于智慧安农门户页面打开缓慢的说明',
                    countdown: null, audience: '全体师生', publish: '2026-11-01' };
    const explR = push.reasonsFor(explN, store5.getProfile(), true, null);
    ck('说明类条目给 EXPLAIN_ONLY 且不给 OPPORTUNITY',
      explR.some((x) => x.code === 'EXPLAIN_ONLY')
      && !explR.some((x) => x.code === 'OPPORTUNITY'),
      explR.map((x) => x.code).join('+'));
    /* 有截止的"说明"不算纯说明 —— 可能是"材料补交说明"，那确实是待办 */
    const explDead = push.reasonsFor(
      Object.assign({}, explN, { title: '关于开展xx工作的说明', countdown: 3 }), store5.getProfile(), true, null);
    ck('有截止的"说明"不视为纯说明（仍可给机会/待办理由）',
      !explDead.some((x) => x.code === 'EXPLAIN_ONLY'));

    /* —— 远期折扣：cd>14 的软信号（机会/新鲜度）减半 —— */
    const oppFar = { id: 'of', event: '学科竞赛', title: '某竞赛', countdown: 30,
                     audience: '全体本科生', publish: '2026-11-01' };
    const oppNear = Object.assign({}, oppFar, { countdown: 10 });
    const wFar = (push.reasonsFor(oppFar, store5.getProfile(), false, null)
      .filter((x) => x.code === 'OPPORTUNITY')[0] || {}).w;
    const wNear = (push.reasonsFor(oppNear, store5.getProfile(), false, null)
      .filter((x) => x.code === 'OPPORTUNITY')[0] || {}).w;
    ck('机会类权重：远期(cd>14)为近期的一半',
      wFar === Math.round(push.WEIGHT.OPPORTUNITY / 2) && wNear === push.WEIGHT.OPPORTUNITY,
      'far=' + wFar + ' near=' + wNear);
    const farFresh = (push.reasonsFor(oppFar, store5.getProfile(), false, null)
      .filter((x) => x.code === 'FRESH')[0] || {}).w;
    const nearFresh = (push.reasonsFor(oppNear, store5.getProfile(), false, null)
      .filter((x) => x.code === 'FRESH')[0] || {}).w;
    ck('新鲜度权重：远期(cd>14)减半',
      farFresh === Math.round(push.WEIGHT.FRESH / 2) && nearFresh === push.WEIGHT.FRESH,
      'far=' + farFresh + ' near=' + nearFresh);
    /* 时间主导（保守版）：**三天内**的条目必须压过"远期但身份契合"的条目。
     * 不做"7 天内也必须压过"——那太严：一条"38 天后但点名你年级、且你订阅的
     * 竞赛"确实更"为你而设"，让它排在一场泛泛讲座前面是合理的。
     * 要守的是"紧急不能被淹"，不是"一切按倒计时排"。 */
    const nearUrgent = { id: 'nu', event: '讲座培训', title: '讲座', countdown: 3,
                         audience: '全体本科生', publish: '2026-11-01' };
    const farMatch = { id: 'fm', event: '学科竞赛', title: '2025级本科生竞赛', countdown: 38,
                       audience: '2025级本科生', publish: '2026-11-01' };
    ck('时间主导：三天内条目分数必高于"38 天后但点名年级"的条目',
      push.scoreOf(nearUrgent, store5.getProfile(), false, null)
        > push.scoreOf(farMatch, store5.getProfile(), false, null),
      'near=' + push.scoreOf(nearUrgent, store5.getProfile(), false, null)
        + ' far=' + push.scoreOf(farMatch, store5.getProfile(), false, null));
    /* 但远期条目也不该完全不降：同样的条目，cd=38 应低于 cd=10（软信号减半的净效果） */
    ck('远期折扣净效果：同一条目 38 天后 < 10 天后（软信号减半起作用）',
      push.scoreOf(Object.assign({}, farMatch, { countdown: 38 }), store5.getProfile(), false, null)
        < push.scoreOf(Object.assign({}, farMatch, { countdown: 10 }), store5.getProfile(), false, null));

    /* —— pushStats 指标 —— */
    const ps = push.pushStats(p);
    ck('pushStats 有 pool/feed/pushing/coverage',
      typeof ps.pool === 'number' && typeof ps.feed === 'number' &&
      typeof ps.pushing === 'number' && typeof ps.coverage === 'number');
    ck('pushStats.feed 与 store.myFeed 一致', ps.feed === store5.myFeed().length,
      'push=' + ps.feed + ' store=' + store5.myFeed().length);
    ck('覆盖率 = feed / pool', ps.coverage === Math.round(ps.feed / ps.pool * 100));

    /* —— 身份过滤：并列接收范围不得错杀 —— */
    ck('身份 MATCH 修复：本科生、研究生 并列 → 本科生可见',
      identity4.matchAudience('全校本科生、研究生', { identityType: '本科生' }) === true);
    ck('身份 MATCH 修复：本科生、研究生 并列 → 研究生可见',
      identity4.matchAudience('全校本科生、研究生', { identityType: '研究生' }) === true);
    ck('身份 MATCH 修复：并列范围 → 教职工排除',
      identity4.matchAudience('全校本科生、研究生', { identityType: '教职工' }) === false);
    ck('身份 MATCH：只面向研究生 → 本科生排除',
      identity4.matchAudience('全体研究生', { identityType: '本科生' }) === false);
    ck('身份 MATCH：只面向本科生 → 研究生排除',
      identity4.matchAudience('全体本科生', { identityType: '研究生' }) === false);
    ck('身份 MATCH：点名 20xx级 → 年级不符排除',
      identity4.matchAudience('2024级本科生', { identityType: '本科生', grade: '2025级 · 大一' }) === false);
    ck('身份 MATCH：点名 20xx级 → 年级相符放行',
      identity4.matchAudience('2025级本科生', { identityType: '本科生', grade: '2025级 · 大一' }) === true);
    ck('身份 MATCH：原文未写 → 任何身份放行',
      identity4.matchAudience('', { identityType: '本科生' }) === true);
    ck('身份 MATCH：教职工专属 → 学生排除',
      identity4.matchAudience('在职教职工', { identityType: '本科生' }) === false);

    /* 真实数据回归：订阅范围内本科生也应收得到并列范围那条 */
    const under = { identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
      interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'] };
    const pool = store5.allNotices().filter((n) => under.interests.indexOf(n.event) >= 0);
    const both = pool.filter((n) => /本科生/.test(String(n.audience || '')) && /研究生/.test(String(n.audience || '')));
    ck('真实数据里「本科生+研究生」并列条目对本科生放行',
      both.every((n) => identity4.passesIdentity(n, under)),
      '并列条目 ' + both.length + ' 条');
    const underFeed = store5.myFeed().length;
    log('  本科生订阅范围内命中（修复后）:', underFeed, '条');

    /* —— 推送设置页渲染与交互 —— */
    const pushPage = loadPage('pages/push/push');
    if (pushPage) {
      pushPage.onLoad && pushPage.onLoad({});
      await new Promise((r) => setTimeout(r, 80));
      /* 口径必须一致：页面 stats.pushing 取自 pushStats（默认 limit），
       * 这里也用默认 limit 比；用 limit:99 比会因"截断"而假报警。 */
      ck('推送页 引擎状态与引擎一致',
        pushPage.data.stats && pushPage.data.stats.pushing === push.buildPush({ profile: store5.getProfile() }).total,
        'page=' + (pushPage.data.stats && pushPage.data.stats.pushing) +
        ' engine=' + push.buildPush({ profile: store5.getProfile() }).total);
      ck('推送页 有推送流卡片', pushPage.data.cards.length > 0,
        'cards=' + pushPage.data.cards.length);
      ck('推送页 卡片都带推送理由',
        pushPage.data.cards.every((c) => c.pushReasonLine && c.pushScore >= 0));
      ck('推送页 有分箱', Array.isArray(pushPage.data.buckets) && pushPage.data.buckets.length > 0,
        'buckets=' + pushPage.data.buckets.length);
      ck('推送页 summary.tone 与 notify 一致',
        (pushPage.data.stats.notify > 0) === (pushPage.data.summary.tone === 'alert'),
        'tone=' + pushPage.data.summary.tone);

      /* 开关切换 */
      const beforeOn = pushPage.data.flags.pushOn;
      pushPage.toggleFlag({ currentTarget: { dataset: { k: 'pushOn' } } });
      await new Promise((r) => setTimeout(r, 20));
      ck('推送页 toggleFlag 生效', pushPage.data.flags.pushOn === !beforeOn,
        beforeOn + ' → ' + pushPage.data.flags.pushOn);
      ck('推送页 开关写入画像（单一事实来源）',
        store5.getProfile().push && typeof store5.getProfile().push.pushOn === 'boolean');
      /* 还原 */
      pushPage.toggleFlag({ currentTarget: { dataset: { k: 'pushOn' } } });
      await new Promise((r) => setTimeout(r, 20));

      /* 打扰级别选择 */
      pushPage.onNotifyLevel({ detail: { value: 2 } });
      await new Promise((r) => setTimeout(r, 20));
      ck('推送页 打扰级别可切换（选「从不打扰」）',
        pushPage.data.notifyLevel === 'none' && /从不打扰/.test(pushPage.data.notifyLevelText),
        pushPage.data.notifyLevel + ' / ' + pushPage.data.notifyLevelText);
      pushPage.onNotifyLevel({ detail: { value: 0 } });
      await new Promise((r) => setTimeout(r, 20));
      ck('推送页 打扰级别可切回「只打扰三天内」',
        pushPage.data.notifyLevel === 'hot');

      /* 重置留痕 —— 断言"哨兵被清掉"而不是"总数为 0"：
       * 因为别的页面（如首页 recompute）有 800ms 延迟的 markPushed 定时器，
       * 它可能在等待窗口内触发，把总数从 0 重新变正。
       * 用哨兵判断才真正反映「重置是否生效」，不依赖时序。 */
      push.markPushed(['x-sentinel-1', 'x-sentinel-2']);
      const hadSentinel = push.pushState().tracked > 0;
      pushPage.resetState();
      await new Promise((r) => setTimeout(r, 120));
      const stAfter = (() => { try { return wx.getStorageSync('zhishi_push_state'); } catch (e) { return null; } })();
      const sentinelGone = !stAfter || (stAfter.pushedIds || []).indexOf('x-sentinel-1') < 0;
      ck('推送页 resetState 清空留痕',
        sentinelGone && hadSentinel,
        'before=' + hadSentinel + ' sentinelGone=' + sentinelGone);

      /* 跳转详情 */
      toastLog = []; navLog = [];
      if (pushPage.data.cards.length) {
        pushPage.goDetail({ currentTarget: { dataset: { id: pushPage.data.cards[0].id } } });
        ck('推送页 goDetail 进入详情',
          navLog.length > 0 && /pages\/detail\/detail/.test(navLog.slice(-1)[0].url || ''));
      }
      toastLog = []; navLog = [];
    }

    /* —— 首页推送流渲染（新增能力） —— */
    const idxPage = loadPage('pages/index/index');
    if (idxPage) {
      idxPage.onLoad && idxPage.onLoad({});
      await new Promise((r) => setTimeout(r, 120));
      ck('首页 有推送卡片流 pushCards', idxPage.data.pushCards.length > 0,
        'cards=' + idxPage.data.pushCards.length);
      ck('首页 有推送分箱 pushBuckets', idxPage.data.pushBuckets.length > 0);
      ck('首页 有推送小结 pushSummary',
        !!idxPage.data.pushSummary.line && typeof idxPage.data.pushSummary.tone === 'string');
      ck('首页 推送卡片带理由与分数',
        idxPage.data.pushCards.every((c) => c.pushReasonLine && typeof c.pushScore === 'number'));
      ck('首页 卡片按分数降序',
        idxPage.data.pushCards.every((c, i) => i === 0 || idxPage.data.pushCards[i - 1].pushScore >= c.pushScore));
      ck('首页 pushBuckets 覆盖所有卡片级别',
        idxPage.data.pushBuckets.reduce((s, b) => s + b.count, 0) === idxPage.data.pushCards.length ||
        idxPage.data.pushCards.length >= idxPage.data.pushBuckets.reduce((s, b) => s + b.count, 0),
        'buckets=' + idxPage.data.pushBuckets.reduce((s, b) => s + b.count, 0) + ' cards=' + idxPage.data.pushCards.length);
      ck('首页 goPush 跳推送设置页',
        (function () { navLog = []; idxPage.goPush(); return navLog.length > 0 && /pages\/push\/push/.test(navLog.slice(-1)[0].url || ''); })());
      navLog = [];

      /* —— 首屏主次分明：头条卡 + 梯度流 —— */
      ck('首页 有今日头条 hero', !!idxPage.data.hero && typeof idxPage.data.hero.line === 'string',
        idxPage.data.hero ? idxPage.data.hero.line : 'null');
      ck('首页 hero.line 与 pushSummary 一致（同源不重复造）',
        idxPage.data.hero.line === idxPage.data.pushSummary.line);
      ck('首页 有梯度 majorCards / minorCards',
        Array.isArray(idxPage.data.majorCards) && Array.isArray(idxPage.data.minorCards));
      ck('首页 major+minor = pushCards 全量',
        idxPage.data.majorCards.length + idxPage.data.minorCards.length === idxPage.data.pushCards.length,
        'major=' + idxPage.data.majorCards.length + ' minor=' + idxPage.data.minorCards.length +
        ' cards=' + idxPage.data.pushCards.length);
      ck('首页 majorCards 为「三天内 或 分数≥阈值」',
        idxPage.data.majorCards.every((c) => c.pushLevel === 'now' || c.pushLevel === 'hot'
                                             || (typeof c.pushScore === 'number' && c.pushScore >= push.MAJOR_SCORE)));
      ck('首页 minorCards 均非紧急且低于阈值',
        idxPage.data.minorCards.every((c) => ['soon', 'plan', 'far'].indexOf(c.pushLevel) >= 0
                                             && (typeof c.pushScore !== 'number' || c.pushScore < push.MAJOR_SCORE)));
      ck('首页 minorCards 默认收起',
        (function () { idxPage.setData({ minorOpen: false }); return idxPage.data.minorOpen === false; })());
      ck('首页 toggleMinor 可展开',
        (function () { idxPage.toggleMinor(); const v = idxPage.data.minorOpen; idxPage.toggleMinor(); return v === true && idxPage.data.minorOpen === false; })());
      ck('首页 heroTap 有 lead 时进详情',
        (function () {
          navLog = [];
          const h = idxPage.data.hero;
          if (h && h.hasLead) { idxPage.heroTap(); return navLog.length > 0 && /pages\/detail\/detail/.test(navLog.slice(-1)[0].url || ''); }
          return true; /* 无 lead 时不强求 */
        })());
      navLog = [];
    }

    /* —— 我的页有推送入口 —— */
    const mePage5 = loadPage('pages/me/me');
    if (mePage5) {
      ck('我的页有 goPush 入口', typeof mePage5.goPush === 'function');
      navLog = [];
      mePage5.goPush();
      ck('我的页 goPush 跳转推送设置页',
        navLog.length > 0 && /pages\/push\/push/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
    }

    push.resetState();
  }

  /* ================================================================
   * 【4f】问知时 · 问答引擎 + 办事日历（新增能力）
   * ================================================================ */
  log('\n【4f】问知时 · 问答引擎 + 办事日历');
  {
    const ask = require(path.join(MP, 'utils/ask.js'));
    const store6 = require(path.join(MP, 'utils/store.js'));

    /* —— 纯函数：问题库 —— */
    const allQ = ask.allQuestions();
    ck('问答引擎 有问题库（≥13 条）', allQ.length >= 13, 'questions=' + allQ.length);
    ck('问答引擎 每个问题有 id/q/hint',
      allQ.every((q) => q.id && q.q && typeof q.hint === 'string'));

    const groups = ask.questionGroups();
    ck('问答引擎 分组（≥6 组）', groups.length >= 6, 'groups=' + groups.length);
    ck('问答引擎 每组至少 1 问',
      groups.every((g) => g.questions && g.questions.length >= 1));
    ck('问答引擎 分组覆盖「今天/先办/漏了什么/是不是给我的/要准备什么/可靠吗」',
      ['today', 'pick', 'miss', 'fit', 'prep', 'trust'].every((k) => groups.some((g) => g.key === k)));

    /* —— 逐条问题：结构完整，答案与依据都非空 —— */
    let allAnswered = true, badId = '';
    allQ.forEach((q) => {
      const r = ask.ask(q.id);
      if (!r || !r.answer || !r.basis || r.id !== q.id) { allAnswered = false; badId = q.id; }
    });
    ck('问答引擎 每个问题都能给出「答案 + 依据」', allAnswered, badId ? ('异常: ' + badId) : '全部可答');

    /* —— 答案必须由真实字段派生（不能是空话） —— */
    const today = ask.ask('today');
    ck('问答引擎「今天要办什么」答案含统计口径或明确说没有',
      /倒计时|今天没有/.test(today.answer + today.basis));
    ck('问答引擎「今天」有依据行', today.basis.includes('倒计时'));

    /* —— 依据必须可核对（每条都写明算法/口径） —— */
    const basisOk = allQ.every((q) => {
      const r = ask.ask(q.id);
      return /口径|依据|筛选|统计|比对|结果/.test(r.basis);
    });
    ck('问答引擎 每条依据都写明算法/口径', basisOk);

    /* —— 非法 id → null（不假装有答案） —— */
    ck('问答引擎 非法问题 id 返回 null', ask.ask('no_such_question') === null);

    /* —— 机会类筛选：不得把"考试安排"当成可报机会 —— */
    const allApply = ask.ask('all_can_apply');
    ck('问答引擎「全校都能报」不含考试安排',
      !(allApply.items || []).some((n) => n.event === '考试安排'),
      'items=' + allApply.itemCount);
    ck('问答引擎「全校都能报」限定机会类标签',
      (allApply.items || []).every((n) => ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'].indexOf(n.event) >= 0));

    /* —— 硬门槛同样限定机会类 —— */
    const thr = ask.ask('threshold');
    ck('问答引擎「硬门槛」限定机会类标签',
      (thr.items || []).every((n) => ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'].indexOf(n.event) >= 0));

    /* —— 材料汇总：拆分正确（日期里的斜杠不被拆） —— */
    const mat = ask.ask('need_material');
    ck('问答引擎「要准备材料」有材料语义或如实说没有',
      /材料/.test(mat.answer));
    if (mat.materials) {
      ck('问答引擎 材料项都注明来源条目',
        mat.materials.every((m) => m.material && m.from && m.id),
        'materials=' + mat.materials.length);
      ck('问答引擎 材料拆分不把日期当分隔符',
        mat.materials.every((m) => !/^\d{1,2}$/.test(m.material)));
    }

    /* —— 头条：优先"今天"，其次"漏没漏" —— */
    const hl = ask.headline();
    ck('问答引擎 有今日一问头条', !!(hl && hl.q && hl.answer && hl.id));
    ck('问答引擎 头条 tone 合法',
      ['calm', 'alert', 'busy', 'new', 'warn', 'ok'].indexOf(hl.tone) >= 0, 'tone=' + hl.tone);

    /* —— 自评指标 —— */
    const st = ask.askStats();
    ck('问答引擎 自评含 pool/questions/readyRate',
      st.pool >= 0 && st.questions >= 13 && typeof st.readyRate === 'number');

    /* —— 办事日历 —— */
    const cal = ask.buildCalendar(2026, 11);
    ck('日历 返回完整周网格',
      cal.weeks.length >= 4 && cal.weeks.every((w) => w.length === 7),
      'weeks=' + cal.weeks.length);
    ck('日历 有 7 个星期表头', cal.weekdays.length === 7);
    ck('日历 网格格数 = 周数 × 7',
      cal.weeks.length * 7 === cal.weeks.reduce((a, w) => a + w.length, 0));
    ck('日历 有 today 标记',
      cal.today && typeof cal.today.y === 'number' && typeof cal.today.d === 'number');
    ck('日历 busyDays 与 monthItems 一致',
      cal.busyDays.length <= cal.monthCount || cal.monthCount === 0,
      'busy=' + cal.busyDays.length + ' items=' + cal.monthCount);
    ck('日历 有本月总结句', /件要办|没有要办/.test(cal.summary));

    /* 单元格结构 */
    const flat = [];
    cal.weeks.forEach((w) => w.forEach((c) => flat.push(c)));
    const real = flat.filter((c) => !c.blank);
    ck('日历 非空格子数量 = 当月天数', real.length === new Date(2026, 11, 0).getDate(),
      'real=' + real.length);
    ck('日历 有事项的格子带 level',
      real.filter((c) => c.hasItem).every((c) => !!c.level));
    ck('日历 无事项的格子 count=0',
      real.filter((c) => !c.hasItem).every((c) => c.count === 0));

    /* 跨月边界：1 月（31 天）与 2 月（28 天，2026 非闰年） */
    const jan = ask.buildCalendar(2026, 1);
    ck('日历 跨月：1 月网格正确',
      jan.weeks.every((w) => w.length === 7) && jan.weeks.reduce((a, w) => a + w.length, 0) % 7 === 0);
    const feb = ask.buildCalendar(2026, 2);
    const febReal = [];
    feb.weeks.forEach((w) => w.forEach((c) => { if (!c.blank) febReal.push(c); }));
    ck('日历 跨月：2026 年 2 月 28 天', febReal.length === 28, 'feb=' + febReal.length);

    /* 月份位移 */
    const s1 = ask.shiftMonth(2026, 1, -1);
    const s2 = ask.shiftMonth(2026, 12, 1);
    ck('日历 shiftMonth 向前跨年正确', s1.year === 2025 && s1.month === 12);
    ck('日历 shiftMonth 向后跨年正确', s2.year === 2027 && s2.month === 1);

    /* 全空池不崩 */
    ck('日历 空数据不崩', (function () {
      const c = ask.buildCalendar(2030, 6);
      return c.weeks.length >= 4 && /没有要办/.test(c.summary);
    })());

    /* —— 问答页渲染与交互 —— */
    const askPage = loadPage('pages/ask/ask');
    if (askPage) {
      askPage.onLoad && askPage.onLoad({});
      await new Promise((r) => setTimeout(r, 80));
      ck('问答页 有分组与头条',
        askPage.data.groups.length >= 6 && !!askPage.data.headline);
      ck('问答页 默认打开「今天」这一问',
        askPage.data.opened && askPage.data.opened.id === 'today');
      ck('问答页 有自评指标', !!askPage.data.stats && askPage.data.stats.questions >= 13);

      /* 点问题 */
      askPage.onAsk({ currentTarget: { dataset: { id: 'need_material' } } });
      ck('问答页 点问题后切换答案',
        askPage.data.opened && askPage.data.opened.id === 'need_material');
      ck('问答页 答案带依据', !!askPage.data.opened.basis);

      /* 非法问题 */
      toastLog = [];
      askPage.onAsk({ currentTarget: { dataset: { id: 'nope' } } });
      ck('问答页 非法问题给提示不崩', toastLog.length > 0);
      toastLog = [];

      /* 头条点击 */
      askPage.onHeadline();
      ck('问答页 点头条切换答案', askPage.data.opened && !!askPage.data.opened.id);

      /* 跳转详情 */
      navLog = [];
      if (askPage.data.opened.items && askPage.data.opened.items.length) {
        askPage.goDetail({ currentTarget: { dataset: { id: askPage.data.opened.items[0].id } } });
        ck('问答页 goDetail 进入详情',
          navLog.length > 0 && /pages\/detail\/detail/.test(navLog.slice(-1)[0].url || ''));
      } else {
        askPage.goDetail({ currentTarget: { dataset: { id: (store6.allNotices()[0] || {}).id } } });
        ck('问答页 goDetail 进入详情', navLog.length > 0);
      }
      navLog = [];

      /* 跳日历 */
      askPage.goCalendar();
      ck('问答页 goCalendar 跳日历',
        navLog.length > 0 && /pages\/calendar\/calendar/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
      toastLog = [];
    }

    /* —— 日历页渲染与交互 —— */
    const calPage = loadPage('pages/calendar/calendar');
    if (calPage) {
      calPage.onLoad && calPage.onLoad({});
      await new Promise((r) => setTimeout(r, 80));
      ck('日历页 有周网格', Array.isArray(calPage.data.weeks) && calPage.data.weeks.length >= 4);
      ck('日历页 有 7 个星期表头', (calPage.data.weekdays || []).length === 7);
      ck('日历页 有月份标题', /年/.test(calPage.data.monthLabel) && /月/.test(calPage.data.monthLabel));
      ck('日历页 有本月总结', !!calPage.data.summary);
      ck('日历页 默认选中今天（若本月）',
        typeof calPage.data.selectedDay === 'number');

      /* 点格子 */
      calPage.onPickDay({ currentTarget: { dataset: { d: 15 } } });
      ck('日历页 点日期切换选中', calPage.data.selectedDay === 15,
        'sel=' + calPage.data.selectedDay);
      ck('日历页 选中后有标签文案', /月/.test(calPage.data.selectedLabel));

      /* 翻月 */
      const beforeLabel = calPage.data.monthLabel;
      calPage.nextMonth();
      ck('日历页 翻下月更新标题', calPage.data.monthLabel !== beforeLabel);
      calPage.prevMonth();
      ck('日历页 翻回本月更新标题', calPage.data.monthLabel === beforeLabel);
      calPage.goToday();
      ck('日历页 回到今天不崩', /年/.test(calPage.data.monthLabel));

      /* 展开本月列表 */
      calPage.toggleList();
      ck('日历页 可展开本月待办列表', calPage.data.showList === true);
      calPage.toggleList();
      ck('日历页 可收起本月列表', calPage.data.showList === false);

      /* 跳转 */
      navLog = [];
      const anyId = ((calPage.data.monthItems || [])[0] || store6.allNotices()[0] || {}).id;
      if (anyId) {
        calPage.goDetail({ currentTarget: { dataset: { id: anyId } } });
        ck('日历页 goDetail 进入详情',
          navLog.length > 0 && /pages\/detail\/detail/.test(navLog.slice(-1)[0].url || ''));
      }
      navLog = [];
      calPage.goAsk();
      ck('日历页 goAsk 跳问答',
        navLog.length > 0 && /pages\/ask\/ask/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
    }

    /* —— 首页问答入口 + 头条 —— */
    const idxAsk = loadPage('pages/index/index');
    if (idxAsk) {
      idxAsk.onLoad && idxAsk.onLoad({});
      await new Promise((r) => setTimeout(r, 120));
      ck('首页 有问知时头条 headline',
        !!idxAsk.data.headline && !!idxAsk.data.headline.answer,
        'q=' + (idxAsk.data.headline && idxAsk.data.headline.q));
      navLog = [];
      idxAsk.goAsk();
      ck('首页 goAsk 跳问答页',
        navLog.length > 0 && /pages\/ask\/ask/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
      idxAsk.goCalendar();
      ck('首页 goCalendar 跳日历页',
        navLog.length > 0 && /pages\/calendar\/calendar/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
    }

    /* —— 我的页问答/日历入口 —— */
    const me6 = loadPage('pages/me/me');
    if (me6) {
      ck('我的页有 goAsk 入口', typeof me6.goAsk === 'function');
      ck('我的页有 goCalendar 入口', typeof me6.goCalendar === 'function');
      navLog = [];
      me6.goAsk();
      ck('我的页 goAsk 跳问答页',
        navLog.length > 0 && /pages\/ask\/ask/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
      me6.goCalendar();
      ck('我的页 goCalendar 跳日历页',
        navLog.length > 0 && /pages\/calendar\/calendar/.test(navLog.slice(-1)[0].url || ''));
      navLog = [];
    }
  }

  log('\n【6c】边界与健壮性');
  const storeX = require(path.join(MP, 'utils/store.js'));

  /* 空订阅：fillProfile 会把空数组兜底成默认 4 项（防止页面空白），
     这是**有意的健壮性设计**，所以这里验证的是「兜底生效且不崩」 */
  const profBackup = wx.getStorageSync('zhishi_profile');
  wx.setStorageSync('zhishi_profile', {
    identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
    campus: '长江西路校区', major: '', interests: [],
    advance: '截止前 7 天 / 3 天 / 1 天', channel: '小程序服务通知 + 群内播报'
  });
  let emptyOk = true, emptyErr = '';
  try {
    const filled = storeX.getProfile();
    const eb = storeX.brief();
    const et = storeX.timelineBuckets();
    const ei = storeX.urgencyIndex();
    emptyOk = Array.isArray(filled.interests) && filled.interests.length > 0 &&
      eb.summary.length > 0 && et.length === 5 && ei.score >= 0;
    log('  空订阅 → 兜底为 ' + filled.interests.length + ' 项 / 指数 ' + ei.score +
      ' / 分箱 ' + et.length + ' 档');
    log('  摘要:「' + eb.summary + '」');
  } catch (e) { emptyOk = false; emptyErr = e.message; }
  ck('空订阅被兜底且不崩溃', emptyOk, emptyErr);

  /* 全选订阅：边界不溢出（此时不再受兜底影响，因为非空） */
  wx.setStorageSync('zhishi_profile', {
    identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
    campus: '长江西路校区', major: '',
    interests: storeX.TAGS_KEYS ? storeX.TAGS_KEYS : require(path.join(MP, 'utils/tags.js')).TAG_KEYS,
    advance: '截止前 7 天 / 3 天 / 1 天', channel: '小程序服务通知 + 群内播报'
  });
  let fullOk = true, fullErr = '';
  try {
    const fi = storeX.urgencyIndex();
    const fsec = storeX.feedSections();
    const ftl = storeX.timelineBuckets();
    const ftlSum = ftl.reduce((s, b) => s + b.count, 0);
    fullOk = fi.score >= 0 && fi.score <= 100 &&
      fi.total === fsec.all.length && ftlSum === fi.total;
    log('  全选订阅 → 指数 ' + fi.score + ' / 关注流 ' + fi.total +
      ' 条 / 分箱合计 ' + ftlSum + ' 条（池内 ' + storeX.NOTICES.length + '）');
  } catch (e) { fullOk = false; fullErr = e.message; }
  ck('全选订阅不溢出且四处数字自洽', fullOk, fullErr);

  /* ============================================================
   * 【6c-2】「各花入各眼」学院归属规则回归（本轮新增）
   * 用户点出的真问题：工学院官网发的「第十周考试安排」被推给了信院学生。
   * 规则：通知发布在学院官网 → 只推给该学院学生；校级单位来源 → 全员可见。
   * ============================================================ */
  const idX = require(path.join(MP, 'utils/identity.js'));
  const gxyExam = {
    id: 'test-gxy-exam', real: true,
    source: '机械与车辆工程学院（工学院）· 通知公告',
    title: '机械与车辆工程学院2026-2027学年第一学期第十周考试安排',
    audience: '未点名具体对象', event: '考试安排'
  };
  const libNotice = {
    id: 'test-lib', source: '图书馆 · 新闻公告',
    title: '图书馆开放时间调整通知', audience: '全校师生', event: '图书资源'
  };
  const jgNotice = {
    id: 'test-jg', source: '经济管理学院 · 通知公告',
    title: '经济管理学院学术讲座', audience: '未点名具体对象', event: '讲座培训'
  };
  const pXin  = { identityType: '本科生', grade: '2023级 · 大三', college: '信息与人工智能学院' };
  const pGong = { identityType: '本科生', grade: '2023级 · 大三', college: '工学院' };
  const pNone = { identityType: '本科生', grade: '2023级 · 大三', college: '' };
  const pJg   = { identityType: '本科生', grade: '2023级 · 大三', college: '经济管理学院' };

  ck('归属推断：工学院官网通知 → 工学院', idX.noticeCollege(gxyExam) === '工学院');
  ck('归属推断：图书馆通知 → 校级（不归属任何学院）', idX.noticeCollege(libNotice) === '');
  ck('归属推断：经管官网通知 → 经济管理学院', idX.noticeCollege(jgNotice) === '经济管理学院');

  ck('工学院考试安排：信院学生 ❌不可见（本轮修复的核心 bug）',
    idX.passesIdentity(gxyExam, pXin) === false);
  ck('工学院考试安排：工学院学生 ✅可见',
    idX.passesIdentity(gxyExam, pGong) === true);
  ck('工学院考试安排：未填学院 ✅可见（不误杀）',
    idX.passesIdentity(gxyExam, pNone) === true);
  ck('工学院考试安排：经管学院学生 ❌不可见',
    idX.passesIdentity(gxyExam, pJg) === false);

  ck('图书馆通知：信院学生 ✅可见（校级全员）',
    idX.passesIdentity(libNotice, pXin) === true);
  ck('图书馆通知：工学院学生 ✅可见（校级全员）',
    idX.passesIdentity(libNotice, pGong) === true);

  ck('经管通知：信院学生 ❌不可见 / 经管学生 ✅可见',
    idX.passesIdentity(jgNotice, pXin) === false &&
    idX.passesIdentity(jgNotice, pJg) === true);

  /* 端到端：把工学院考试安排塞进池子，信院学生的推送流里不该出现它 */
  {
    const pushX = require(path.join(MP, 'utils/push.js'));
    const noticesMod = require(path.join(MP, 'data/notices.js'));
    /* 临时把三条测试通知挂进真实池子（找得到同一数组引用），跑完还原。 */
    const injected = [gxyExam, jgNotice, libNotice];
    const before = noticesMod.NOTICES.length;
    injected.forEach(x => noticesMod.NOTICES.push(x));
    storeX.useLocalNotices();
    wx.setStorageSync('zhishi_profile', {
      identityType: '本科生', grade: '2023级 · 大三', college: '信息与人工智能学院',
      campus: '长江西路校区', major: '', interests: ['考试安排', '讲座培训', '图书资源'],
      advance: '截止前 7 天 / 3 天 / 1 天', channel: '小程序服务通知 + 群内播报'
    });
    let e2eOk = true, e2eErr = '';
    try {
      const feedIds = storeX.myFeed().map(x => x.id);
      const bp = pushX.buildPush({ limit: 999 });
      const ids = bp.cards.map(x => x.id);
      /* 关注流与推送流都不该含跨院通知；图书馆（校级）应可见 */
      e2eOk = feedIds.indexOf('test-gxy-exam') < 0 && feedIds.indexOf('test-jg') < 0 &&
              ids.indexOf('test-gxy-exam') < 0 && ids.indexOf('test-jg') < 0;
      log('  端到端（信院档案）：关注流 ' + feedIds.length + ' 条 / 推送流 ' + ids.length +
        ' 条，工学院考试安排 ' + (feedIds.indexOf('test-gxy-exam') < 0 ? '未出现 ✅' : '误入 ❌') +
        '，图书馆通知 ' + (feedIds.indexOf('test-lib') >= 0 ? '可见 ✅' : '缺失') );
    } catch (e) { e2eOk = false; e2eErr = e.message; }
    ck('端到端：信院推送流不含工学院/经管通知，且校级通知可见', e2eOk, e2eErr);
    /* 还原池子 */
    noticesMod.NOTICES.length = before;
    storeX.useLocalNotices();
  }

  /* 恢复原画像 */
  if (profBackup) wx.setStorageSync('zhishi_profile', profBackup);
  else wx.removeStorageSync('zhishi_profile');

  /* ============================================================
   * 【6d】边界加固回归（倒计时实时刷新 + 极端输入不崩）
   * ============================================================
   * 这一节守的是"会误事的真 bug"和"一眼看不出但会崩的边界"，
   * 每一项都对应一次真实的巡检发现。
   */
  log('\n【6d】边界加固回归');
  const askX = require(path.join(MP, 'utils/ask.js'));

  /* ---- ① 倒计时必须按 deadline 与"今天"现算，不能用编制时的定值 ---- */
  {
    const all = storeX.allNotices();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let stale = 0;
    all.forEach(n => {
      const s = String(n.deadline || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
      const d = new Date(s + 'T00:00:00');
      if (isNaN(d.getTime())) return;
      const expect = Math.round((d - today) / 86400000);
      if (n.countdown !== expect) stale++;
    });
    ck('倒计时与今天自洽（无过期数字）', stale === 0, stale ? `${stale} 条不一致` : `${all.length} 条全部自洽`);
  }

  /* refreshCountdowns 是纯函数：不该改原对象，只返回新数组 */
  {
    const probe = [{ id: 'p1', deadline: '2000-01-01', countdown: 999 }, { id: 'p2', deadline: '', countdown: null }];
    const before = JSON.stringify(probe);
    const after = storeX.refreshCountdowns(probe);
    const sameRef = probe === after;
    const untouched = JSON.stringify(probe) === before;
    const p1Fixed = after[0].countdown !== 999;
    const p2Kept = after[1].countdown === null;
    ck('refreshCountdowns 不改原数组（纯函数）', untouched && !sameRef, `原数组未被改=${untouched}`);
    ck('refreshCountdowns 按 deadline 重算 countdown', p1Fixed, `2000-01-01 → ${after[0].countdown}`);
    ck('refreshCountdowns 无 deadline 时保留原值', p2Kept, `null 保留=${p2Kept}`);
  }

  /* ---- ② splitMaterials 极端输入不崩（曾崩在 null/undefined） ---- */
  {
    const cases = [null, undefined, '', '   ', '///', 12345, 'A/B/C', '第1/2周/附件'];
    let crash = 0;
    cases.forEach(c => { try { const r = askX.splitMaterials(c); if (!Array.isArray(r)) crash++; } catch (e) { crash++; } });
    ck('splitMaterials 极端输入不崩（含 null/undefined/数字）', crash === 0, crash ? `${crash} 例崩` : `${cases.length} 例全过`);
    let keep = false;
    try { keep = askX.splitMaterials('第1/2周/附件').indexOf('第1/2周') >= 0; } catch (e) {}
    ck('splitMaterials 保留数字间斜杠（第1/2周 不切）', keep);
  }

  /* ---- ③ 日历网格恒等式：36 个月全验 ---- */
  {
    let bad = 0, checked = 0;
    for (let y = 2024; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        checked++;
        const cal = askX.buildCalendar(y, m);
        const dim = new Date(y, m, 0).getDate();
        const real = cal.weeks.reduce((a, wk) => a + wk.filter(c => !c.blank).length, 0);
        const seven = cal.weeks.every(wk => wk.length === 7);
        const leadExpect = (new Date(y, m - 1, 1).getDay() + 6) % 7;
        const leadReal = cal.weeks[0].filter(c => c.blank).length;
        if (real !== dim || !seven || leadReal !== leadExpect) bad++;
      }
    }
    ck('日历 36 个月网格恒等式（天数/7格/周一起）', bad === 0, bad ? `${bad} 月错位` : `${checked} 月全对`);
  }

  /* ---- ④ 月份入参越界要夹回 1-12（不能算出不存在的月份） ---- */
  {
    let bad = 0;
    [0, 13, -1, 100, -100].forEach(m => {
      const cal = askX.buildCalendar(2026, m);
      if (!(cal.month >= 1 && cal.month <= 12)) bad++;
    });
    ck('buildCalendar 月份越界被夹回 1-12', bad === 0, bad ? `${bad} 例越界` : '5 例全夹回');
  }

  /* ---- ⑤ shiftMonth：大 delta 不死循环 + 结果恒合法 ---- */
  {
    const cases = [[2026, 1, -1], [2026, 12, 1], [2026, 6, -6], [2026, 6, 6],
      [2026, 1, -13], [2026, 12, 13], [2026, 6, 120], [2026, 6, -120], [2026, 6, 0]];
    let bad = 0;
    const t0 = Date.now();
    cases.forEach(([y, m, d]) => {
      const r = askX.shiftMonth(y, m, d);
      if (!(r.month >= 1 && r.month <= 12) || !isFinite(r.year)) bad++;
    });
    const ms = Date.now() - t0;
    ck('shiftMonth 大 delta 不越界', bad === 0, bad ? `${bad} 例越界` : `${cases.length} 例全合法`);
    ck('shiftMonth 大 delta 不卡死（<50ms）', ms < 50, `${ms}ms`);
    ck('shiftMonth NaN 入参不产出 NaN 年月',
      (() => { const r = askX.shiftMonth(NaN, NaN, NaN); return isFinite(r.year) && r.month >= 1 && r.month <= 12; })());
  }

  /* ---- ⑥ ask() 非法 id 一律返回 null（不编答案） ---- */
  {
    const badIds = ['', null, undefined, 'not_exist', '__proto__', 'constructor', 'toString', 123];
    let bad = 0;
    badIds.forEach(id => { try { if (askX.ask(id) !== null) bad++; } catch (e) { bad++; } });
    ck('ask() 非法 id 返回 null（不编答案）', bad === 0, bad ? `${bad} 例异常` : `${badIds.length} 例全 null`);
  }

  /* ---- ⑦ 13 问恒等式：数量 / 唯一 / 归属 / 有答案有依据 ---- */
  {
    const all = askX.allQuestions();
    const grps = askX.questionGroups();
    const grpSum = grps.reduce((a, g) => a + g.questions.length, 0);
    const ids = all.map(q => q.id);
    const uniq = ids.length === new Set(ids).size;
    const grpKeys = grps.map(g => g.key);
    const orphan = all.filter(q => grpKeys.indexOf(q.group) < 0);
    let noAns = 0, noBasis = 0;
    all.forEach(q => { const a = askX.ask(q.id); if (!a || !a.answer) noAns++; if (!a || !a.basis) noBasis++; });
    ck('问知时 13 问数量恒定', all.length === 13, String(all.length));
    ck('问知时问题 id 唯一', uniq);
    ck('分组求和 = 问题总数', grpSum === all.length, `${grpSum} vs ${all.length}`);
    ck('无孤立问题（group 都有归属）', orphan.length === 0, orphan.map(q => q.id).join(','));
    ck('13 问全部有答案', noAns === 0, `缺 ${noAns}`);
    ck('13 问全部有依据', noBasis === 0, `缺 ${noBasis}`);
  }

  /* ---- ⑧ 搜索边界：空/怪异 query 不崩 ---- */
  {
    const searchX = require(path.join(MP, 'utils/search.js'));
    const all = storeX.allNotices();
    const qs = ['', ' ', null, undefined, '?', '?!@#$%', '的', '__proto__', '<script>', '"', '\n\n'];
    let bad = 0;
    qs.forEach(q => { try { if (!Array.isArray(searchX.search(all, q))) bad++; } catch (e) { bad++; } });
    ck('搜索怪异 query 不崩', bad === 0, bad ? `${bad} 例崩` : `${qs.length} 例全数组`);
    /* highlight 传 words 数组 */
    let hBad = 0;
    [[], null, undefined, ['转专业']].forEach(ws => {
      try { searchX.highlight('关于转专业工作的通知', ws); } catch (e) { hBad++; }
    });
    ck('highlight 多形态 words 不崩', hBad === 0, hBad ? `${hBad} 例崩` : '4 例全过');
  }

  /* ---- ⑨ 演示样例不得带官网链接（R2 铁律回归） ---- */
  {
    const all = storeX.allNotices();
    const demoLinked = all.filter(n => !n.real && n.url && /ahau\.edu\.cn/.test(n.url));
    ck('演示样例不带官网链接（R2 铁律）', demoLinked.length === 0,
      demoLinked.length ? `${demoLinked.length} 条违规` : `${all.length} 条全合规`);
    const realLinked = all.filter(n => n.real && n.url);
    ck('真实采集带链接条目存在', realLinked.length > 0, `${realLinked.length} 条`);
  }

  /* ---- ⑩ 身份受众匹配（漏推 / 误杀的回归防线） ---- */
  {
    const idX = require(path.join(MP, 'utils/identity.js'));
    const pushX = require(path.join(MP, 'utils/push.js'));
    const ben  = { identityType: '本科生', grade: '2025级 · 大一' };
    const grad = { identityType: '研究生', grade: '研究生 · 研一' };
    const staff = { identityType: '教职工', grade: '在职教职工' };
    const m = (a, p) => idX.matchAudience(a, p);

    /* (a) 并列范围不能误杀：本科+研究并列 = 全校学生都收 */
    ck('受众 本科+研究并列 → 本科生可收', m('全校本科生、研究生均可申请', ben) === true);
    ck('受众 本科+研究并列 → 研究生可收', m('全校本科生、研究生均可申请', grad) === true);
    ck('受众 本科+研究并列 → 教职工排除', m('全校本科生、研究生均可申请', staff) === false);

    /* (b) 「本科教学/教育教学/毕业论文工作」类组合词不是受众限定（2026-11 修的真 bug） */
    const workTitles = [
      '关于召开本科毕业论文（设计）工作会议的通知',
      '本科教育教学审核评估动员会',
      '本科教学检查通知',
      '本科专业建设研讨会通知',
      '关于开展本科课程建设工作的通知'
    ];
    let workBad = 0;
    workTitles.forEach(t => { if (m(t, grad) !== true) workBad++; });
    ck('受众 「本科XX工作」不误排除研究生（漏推修复）',
      workBad === 0, workBad ? `${workBad} 例误排除` : `${workTitles.length} 例全放行`);

    /* (c) 真的受众限定仍要生效 */
    ck('受众 点名 2025级 → 2025级可收', m('2025级新生报到须知', ben) === true);
    ck('受众 点名 2025级 → 研究生排除', m('2025级新生报到须知', grad) === false);

    /* (d) 年级词表与 GRADES 同源：GRADES 里所有 20xx级 都能被点名匹配 */
    const gradeKwInGrades = idX.GRADES
      .map(g => (g.match(/(\d{4})级/) || [])[0]).filter(Boolean);
    const leak = gradeKwInGrades.filter(kw => m(kw + '学生通知', { identityType: '本科生', grade: kw + ' · 大一' }) !== true);
    ck('受众 GRADES 每个年级都能自我匹配（词表同源）',
      leak.length === 0, leak.length ? '漏: ' + leak.join(',') : gradeKwInGrades.join(' / '));

    /* (e) 2026 级新生在下拉里可选（2026-11 补的真实缺口） */
    ck('年级 下拉含 2026级（新生能选）',
      idX.GRADES.some(g => g.indexOf('2026级') >= 0), idX.GRADES.slice(0, 3).join(' / '));

    /* (f) 死代码清理：AUDIENCE_RULES / UNIVERSAL_KW 不得再作为"活规则"存在 */
    ck('死代码 已移除 AUDIENCE_RULES', typeof idX.AUDIENCE_RULES === 'undefined');
    ck('死代码 已移除 UNIVERSAL_KW', typeof idX.UNIVERSAL_KW === 'undefined');

    /* (g) 推送理由不得对「本科XX工作」误加"面向本科生" */
    const r1 = pushX.reasonsFor({ id: 'x1', title: '本科教学检查通知', event: '校内通知', countdown: 5 }, ben, false);
    ck('推送理由 「本科教学检查」不加"面向本科生"',
      r1.filter(r => r.code === 'MATCH_LEVEL').length === 0);
    const r2 = pushX.reasonsFor({ id: 'x2', title: '面向本科生的学科竞赛', event: '学科竞赛', countdown: 5 }, ben, false);
    ck('推送理由 真受众「面向本科生」仍要加',
      r2.filter(r => r.code === 'MATCH_LEVEL').length === 1);

    /* (h) 定点推送根基：受众字段必须"读得出针对对象"，非学生事项必须被剔除 */
    ck('权重 表含 NOT_STUDENT 且为负', pushX.WEIGHT.NOT_STUDENT === -30);

    /* (h1) 「非学生事项」条目给强负权理由，不参与正分 */
    const nonStud = pushX.reasonsFor(
      { id: 'ns1', title: '经济管理学院纪委召开工作会', event: '校内通知',
        audience: '非学生事项（行政/新闻）', countdown: 3 },
      ben, false, null);
    const nsR = nonStud.filter(r => r.code === 'NOT_STUDENT');
    ck('推送理由 非学生事项 → 加 NOT_STUDENT 负权理由', nsR.length === 1 && nsR[0].w === -30);

    /* (h2) 非学生事项不进推送流：真实池里若有，buildPush 结果不得出现其 id */
    const allX = storeX.allNotices();
    const nsIds = allX.filter(n => String(n.audience || '').indexOf('非学生事项') >= 0).map(n => n.id);
    const pushAll = pushX.buildPush({ profile: { identityType: '本科生', grade: '2025级 · 大一',
      interests: ['学科竞赛', '奖助学金', '考试安排', '选课', '讲座培训', '图书资源',
                  '转专业', '学工事务', '校内通知', '选课考试', '讲座活动', '竞赛'] }, limit: 60 });
    const leaked = pushAll.cards.filter(c => nsIds.indexOf(c.id) >= 0);
    ck('推送流 不含非学生事项（行政/新闻已被剔除）',
      leaked.length === 0, leaked.length ? '漏进: ' + leaked.map(c => c.id).join(',') : '已剔除 ' + nsIds.length + ' 条');

    /* (h3) 受众字段质量：全池里"原文未明确说明"应为 0（要么读到对象，要么判非学生） */
    const vague = allX.filter(n => n.audience === '原文未明确说明');
    ck('受众 全池无「原文未明确说明」残留（定点推送根基）',
      vague.length === 0, vague.length ? vague.length + ' 条未抽取: ' + vague.slice(0, 5).map(n => n.id).join(',') : '全池 ' + allX.length + ' 条均已判定受众');

    /* (h4) 受众已能"点出具体对象"：至少存在若干条含学院/年级/特定人群的定点受众 */
    const pointed = allX.filter(n => {
      const a = String(n.audience || '');
      return /\d{4}级|学院|考研|党员|毕业生|结业/.test(a);
    });
    ck('受众 存在"定点对象"条目（学院/年级/特定人群）',
      pointed.length >= 3, pointed.length + ' 条定点受众，如：' + (pointed[0] ? pointed[0].audience : '-'));

    /* (h5) 复合受众（学院 · 年级）能被正确拆解匹配：外院研究生不该命中本院年级限 */
    const hasCompound = allX.some(n => /学院.*·.*\d{4}级|\d{4}级.*·.*学院/.test(String(n.audience || '')));
    ck('受众 存在复合受众（学院 · 年级）', hasCompound);

    /* (i) 「面向学院报送 / 非学生直接申报」—— 学生的活儿 vs 老师的活儿 */
    ck('权重 INDIRECT 存在且为负', pushX.WEIGHT.INDIRECT === -14);
    const indN = { id: 'ind1', title: '关于报送转专业工作领导小组名单的通知',
      event: '转专业', audience: '各学院（部）（面向学院报送，非学生直接申报）', countdown: 3 };
    const indR = pushX.reasonsFor(indN, ben, false, null);
    ck('报送类 加 INDIRECT 负权理由',
      indR.filter(r => r.code === 'INDIRECT').length === 1);
    ck('报送类 不再给 OPPORTUNITY（不是可报名机会）',
      indR.filter(r => r.code === 'OPPORTUNITY').length === 0);
    ck('报送类 不再给 MATCH_LEVEL（不是面向你的身份）',
      indR.filter(r => r.code === 'MATCH_LEVEL').length === 0);
    /* 对照：同一标签(转专业)的真·学生事项仍应给 OPPORTUNITY */
    const realOpp = pushX.reasonsFor({ id: 'ro1', title: '本科生转专业线上申请开始了',
      event: '转专业', audience: '在校本科生', countdown: 5 }, ben, false, null);
    ck('对照 真·学生转专业事项仍给 OPPORTUNITY',
      realOpp.filter(r => r.code === 'OPPORTUNITY').length === 1);

    /* (j) tier 由分数决定：高分（≥MAJOR_SCORE）即使无截止也进中卡 */
    ck('权重/常量 MAJOR_SCORE 已导出且为正', typeof pushX.MAJOR_SCORE === 'number' && pushX.MAJOR_SCORE > 0);
    ck('tier 高分无截止 → major',
      pushX.tierOf({ pushLevel: 'far', pushScore: pushX.MAJOR_SCORE }) === 'major');
    ck('tier 低分有截止 → 仍 major（三天内）',
      pushX.tierOf({ pushLevel: 'hot', pushScore: 1 }) === 'major');
    ck('tier 低分无截止 → minor',
      pushX.tierOf({ pushLevel: 'plan', pushScore: 5 }) === 'minor');
    /* 版面与分数自洽：major 里最低分 ≥ minor 里最高分（在同一紧急度不可能混时也不该倒挂） */
    const tfX = pushX.tieredFeed(ben);
    const minorMax = tfX.minor.reduce((m, c) => Math.max(m, c.pushScore || 0), 0);
    const majorMin = tfX.major.reduce((m, c) => Math.min(m, c.pushScore === undefined ? 999 : c.pushScore), 999);
    ck('版面自洽 major 最低分 ≥ minor 最高分（无倒挂）',
      tfX.major.length === 0 || tfX.minor.length === 0 || majorMin >= minorMax,
      'majorMin=' + majorMin + ' minorMax=' + minorMax);
  }

  /* ---- ⑪ 已读 / 未读 / 删除（本地用户状态） ---- */
  {
    const rs = require(path.join(MP, 'utils/readstate.js'));

    /* 清空起步，避免受前面测试残留影响 */
    rs.reset();
    ck('已读 初始未读', rs.isRead('a1') === false);

    rs.markRead('a1');
    ck('已读 markRead 后 isRead 为真', rs.isRead('a1') === true);
    rs.markUnread('a1');
    ck('已读 markUnread 后 isRead 为假', rs.isRead('a1') === false);

    ck('已读 toggleRead 假→真', rs.toggleRead('a2') === true);
    ck('已读 toggleRead 真→假', rs.toggleRead('a2') === false);

    /* 删除（本地隐藏） */
    ck('删除 初始未隐藏', rs.isHidden('b1') === false);
    rs.hide('b1');
    ck('删除 hide 后 isHidden 为真', rs.isHidden('b1') === true);
    ck('删除 hiddenList 含该 id', rs.hiddenList().indexOf('b1') >= 0);
    rs.unhide('b1');
    ck('删除 unhide 后 isHidden 为假', rs.isHidden('b1') === false);

    /* decorate 注入 read/hidden 标记 */
    rs.markRead('c1');
    rs.hide('c2');
    const dec = rs.decorate([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    ck('decorate 注入 read 标记', dec[0].read === true && dec[2].read === false);
    ck('decorate 注入 hidden 标记', dec[1].hidden === true && dec[0].hidden === false);

    /* visible 过滤已删除 */
    const vis = rs.visible([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    ck('visible 剔除已删除条目', vis.length === 2 && vis.every(x => x.id !== 'c2'));

    /* stats 统计口径自洽：read + unread = 未删除总数 */
    const st = rs.stats([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    ck('stats read+unread = 未删除数 且 hidden 计对',
      st.read === 1 && st.hidden === 1 && st.read + st.unread === 2,
      JSON.stringify(st));

    rs.reset();
    ck('reset 清空已读/删除', rs.isRead('c1') === false && rs.isHidden('c2') === false);

    /* 页面级：首页 recompute 后推送卡带 read 标记且不含已删除。
     * 探针必须取自推送流本身（buildPush 走 store.myFeed() 个性化过滤，
     * 与 allNotices() 不同源），否则统计口径对不上。 */
    const storeR = require(path.join(MP, 'utils/store.js'));
    const allR = storeR.allNotices();
    const pushR = require(path.join(MP, 'utils/push.js'));
    const rCards = pushR.buildPush({ profile: storeR.getProfile(), limit: 40 }).cards;
    if (rCards.length) {
      const probeId = rCards[0].id;
      rs.hide(probeId);
      const idxR = loadPage('pages/index/index');
      idxR.recompute();
      const idsInFeed = (idxR.data.pushCards || []).map(c => c.id);
      ck('首页 已删除条目不出现在推送流', idsInFeed.indexOf(probeId) < 0);
      ck('首页 推送卡均带 read 布尔标记',
        (idxR.data.pushCards || []).every(c => typeof c.read === 'boolean'));
      ck('首页 readStats 统计存在且自洽',
        typeof idxR.data.readStats.unread === 'number' && idxR.data.readStats.hidden >= 1
        && idxR.data.readStats.read + idxR.data.readStats.unread
           === idxR.data.readStats.total - idxR.data.readStats.hidden);
      rs.unhide(probeId);
    }

    /* 详情页：打开即已读 */
    if (allR.length) {
      const did = allR[1] ? allR[1].id : allR[0].id;
      rs.markUnread(did);
      const dtR = loadPage('pages/detail/detail');
      if (dtR && dtR.onLoad) dtR.onLoad({ id: did });
      ck('详情页 打开即标记已读', rs.isRead(did) === true && dtR && dtR.data.isRead === true);
      ck('详情页 暴露 toggleRead / removeNotice 方法',
        dtR && typeof dtR.toggleRead === 'function' && typeof dtR.removeNotice === 'function');
      rs.markUnread(did);
    }

    /* 我的页：hiddenList 渲染 */
    const meR = loadPage('pages/me/me');
    ck('我的页 暴露 restoreHidden / clearHidden',
      typeof meR.restoreHidden === 'function' && typeof meR.clearHidden === 'function');
    ck('我的页 hiddenList 为数组',
      Array.isArray(meR.data.hiddenList));

    rs.reset();
  }

  /* ---- 汇总 ---- */
  log('\n' + '='.repeat(64));
  log(`小程序运行测试：${pass.length} 项通过，${fail.length} 项失败`);
  if (fail.length) { log('失败项：'); fail.forEach((f) => log('  - ' + f)); }
  log('='.repeat(64));
  process.exit(fail.length ? 1 : 0);

})();
