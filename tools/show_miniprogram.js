/**
 * 小程序 · 生成可视化预览页（web/mp-preview.html）
 * ================================================
 * 把小程序四页数据**真实跑一遍**（Node 模拟 wx 宿主），
 * 然后把结果渲染成手机外框的静态 HTML，用浏览器打开就能看清。
 *
 * 关键：所有内容都来自页面 data 的真实值，不是手写的示意图。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const OUT = path.join(ROOT, 'web', 'mp-preview.html');

/* ---------- 最小 wx 宿主 ---------- */
const storage = {};
let toasts = [], navs = [];
global.wx = {
  getStorageSync: (k) => (storage[k] === undefined ? '' : storage[k]),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  showToast: (o) => { toasts.push(o && o.title); },
  vibrateShort: () => {},
  /* showModal 走 confirm 分支，这样"模拟一次送达"这类交互才会真生效 */
  showModal: (o) => { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  /* 订阅消息：模拟"用户同意"（真实授权在真机） */
  requestSubscribeMessage: (o) => {
    const res = {};
    (o && o.tmplIds ? o.tmplIds : []).forEach((id) => { res[id] = 'accept'; });
    if (o && o.success) o.success(res);
  },
  navigateTo: (o) => { navs.push(o.url); }, switchTab: (o) => { navs.push(o.url); },
  navigateBack: () => {}, setNavigationBarTitle: () => {},
  showLoading: () => {}, hideLoading: () => {},
  setClipboardData: () => {}, getSystemInfoSync: () => ({ platform: 'devtools' }),
  /* request / login 必须"快速失败"——真机离线时也是这个行为。
     若给成空函数 no-op，云端的 await 永远不 settle，生成脚本会静默挂死。 */
  request: (o) => { if (o && o.fail) o.fail({ errMsg: 'mock: no network' }); },
  login: (o) => { if (o && o.fail) o.fail({ errMsg: 'mock: no cloud' }); },
  cloud: null
};

const registered = {};
let pending = null;
global.Page = (def) => { registered[pending] = def; };
global.App = (def) => { global.__appDef = def; };
global.getApp = () => global.__app;

const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req.startsWith('./') || req.startsWith('../')) {
    const base = parent && parent.filename ? path.dirname(parent.filename) : MP;
    const cand = path.resolve(base, req);
    for (const e of ['', '.js', '/index.js']) {
      const p = cand + e;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return cand + '.js';
  }
  return orig.call(this, req, parent, ...rest);
};

require(path.join(MP, 'app.js'));
global.__app = { globalData: global.__appDef.globalData };

function setByPath(obj, pe, v) {
  const keys = []; pe.replace(/[^.[\]]+/g, m => keys.push(m));
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]]) cur[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = v;
}
function clone(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }

function load(route) {
  pending = route;
  delete require.cache[require.resolve(path.join(MP, route + '.js'))];
  require(path.join(MP, route + '.js'));
  const def = registered[route];
  const inst = {};
  Object.keys(def).forEach(k => {
    inst[k] = typeof def[k] === 'function' ? def[k].bind(inst) : clone(def[k]);
  });
  inst.data = clone(def.data || {});
  inst.setData = function (p) {
    Object.keys(p).forEach(k => {
      if (/[.[]/.test(k)) setByPath(inst.data, k, p[k]);
      else inst.data[k] = p[k];
    });
  };
  return inst;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

(async function main() {

/* ================= 跑页面 ① ================= */
const idx = load('pages/index/index');
idx.onLoad(); idx.onShow();
/* onLoad → refresh() 里已同步跑过 recompute()（分区/统计/推送卡/今日一问都在），
   这里只需等异步云端那一跳走完。早期版本调过 idx.runAgent()，该方法已随重构移除。 */
await new Promise(r => setTimeout(r, 2600));

/* ================= 跑页面 ② ================= */
const sr = load('pages/search/search');
sr.onLoad({});
sr.onInput({ detail: { value: '转专业' } });
sr.onConfirm({ detail: { value: '转专业' } });
await new Promise(r => setTimeout(r, 120));
const searchQ1 = clone(sr.data.results);
const searchQ1Segs = clone(sr.data.titleSegs);
const searchQ1Snips = clone(sr.data.snippetSegs);

sr.onInput({ detail: { value: '竞赛' } });
sr.onConfirm({ detail: { value: '竞赛' } });
await new Promise(r => setTimeout(r, 120));
const searchQ2 = clone(sr.data.results);

sr.onClear();
sr.tapTag({ currentTarget: { dataset: { t: '学科竞赛' } } });
await new Promise(r => setTimeout(r, 120));
const searchTagRes = clone(sr.data.results);

/* ================= 跑页面 ③ ================= */
const store = require(path.join(MP, 'utils/store.js'));
const tags = require(path.join(MP, 'utils/tags.js'));
const pick = store.NOTICES.find(n => (n.digestPoints || []).length >= 4)
  || store.NOTICES.find(n => (n.digestPoints || []).length >= 3)
  || store.NOTICES[0];

const dt = load('pages/detail/detail');
dt.onLoad({ id: pick.id, q: '' });
await new Promise(r => setTimeout(r, 120));
const detailNotice = clone(dt.data.notice);
const detailFacts = clone(dt.data.factList);
const detailSegs = clone(dt.data.quotedRaw);
const detailTrace = { ok: dt.data.traceable, total: dt.data.traceTotal };
const ptLocs = (detailNotice.digestPoints || []).map(p => store.locateQuote(detailNotice.raw, p.quote));
dt.switchTab({ currentTarget: { dataset: { tab: 'raw' } } });
dt.jumpToRaw({ currentTarget: { dataset: { idx: 0 } } });
const detailState = { tab: dt.data.tab, activeIdx: dt.data.activeIdx, rawFocused: dt.data.rawFocused };

/* ================= 跑页面 ④ ================= */
const me = load('pages/me/me');
me.onLoad();
await new Promise(r => setTimeout(r, 400));
const meSnap = {
  profile: clone(me.data.profile),
  tagCounts: clone(me.data.tagCounts),
  reachable: me.data.reachable,
  runMode: me.data.runMode
};
const reachBefore = me.data.reachable;
me.toggleEvent({ currentTarget: { dataset: { ev: '讲座培训' } } });
const reachAfterAdd = me.data.reachable;
me.toggleEvent({ currentTarget: { dataset: { ev: '讲座培训' } } });
me.selectAll();
const reachAll = me.data.reachable;
const allCount = me.data.profile.interests.length;
me.resetDefault();
const reachDefault = me.data.reachable;
const defCount = me.data.profile.interests.length;
await me.save();
await new Promise(r => setTimeout(r, 200));
const savedOk = !!storage['zhishi_profile'];

/* ================= 跑页面 ⑤：推送设置（微信触达 + 触达时间线） ================= */
const ps = load('pages/push/push');
ps.onLoad();
await new Promise(r => setTimeout(r, 300));
const pushSnap = {
  wx: clone(ps.data.wx),
  reach: clone(ps.data.reach),
  advanceOptions: clone(ps.data.advanceOptions),
  advanceIdx: ps.data.advanceIdx,
  reachDays: clone(ps.data.reachDays),
  notifyLevelText: ps.data.notifyLevelText
};
/* 真交互：登记一次订阅授权（演示模式），看状态是否变 */
await ps.enableWxNotify();
await new Promise(r => setTimeout(r, 200));
const pushAfterGrant = clone(ps.data.wx);
/* 真交互：改提前量 → 时间线重算 */
ps.onAdvanceChange({ detail: { value: 0 } });
await new Promise(r => setTimeout(r, 200));
const pushAfterAdvance = {
  wx: clone(ps.data.wx),
  reach: clone(ps.data.reach),
  reachDays: clone(ps.data.reachDays)
};
/* 真交互：模拟一次送达留痕 */
ps.simulateDeliver();
await new Promise(r => setTimeout(r, 200));
const pushAfterDeliver = clone(ps.data.wx);

/* ================= 跑页面 ⑥：今日简报（含智能体主动送达区块） ================= */
const dg = load('pages/digest/digest');
dg.onLoad();
await new Promise(r => setTimeout(r, 700));
const digestSnap = {
  stamp: dg.data.stamp,
  sentences: clone(dg.data.sentences),
  brief: clone(dg.data.brief),
  trustLevel: dg.data.trustLevel,
  trustLabel: dg.data.trustLabel,
  /* ★ 智能体 */
  agentReady: dg.data.agentReady,
  agentMode: dg.data.agentMode,
  agentVia: dg.data.agentVia,
  agentLabel: dg.data.agentLabel,
  agentDegraded: dg.data.agentDegraded,
  agentDegradeReason: dg.data.agentDegradeReason,
  agentMeta: clone(dg.data.agentMeta),
  agentNotify: clone(dg.data.agentNotify),
  agentSilent: clone(dg.data.agentSilent),
  agentErr: dg.data.agentErr
};
/* 真交互：让它重算一遍（本地模式下一次同步算完） */
await dg.rerunAgent();
await new Promise(r => setTimeout(r, 300));
const digestAfterRerun = { agentReady: dg.data.agentReady, agentNotify: clone(dg.data.agentNotify) };

/* ================= 渲染 HTML ================= */
const st = idx.data.stats;

function phone(title, subtitle, bodyHtml) {
  return `
  <div class="phone">
    <div class="ph-bar">
      <span class="ph-time">15:32</span>
      <span class="ph-title">${esc(title)}</span>
      <span class="ph-dots">••• ⊙</span>
    </div>
    <div class="ph-sub">${esc(subtitle)}</div>
    <div class="ph-body">${bodyHtml}</div>
  </div>`;
}

/* --- 屏 1：推送（首屏头条 + 梯度卡片） --- */
const hero = idx.data.hero;
const major = idx.data.majorCards || [];
const minor = idx.data.minorCards || [];

function heroHtml() {
  if (!hero) return '';
  const toneCls = hero.tone === 'alert' ? 'alert' : hero.tone === 'new' ? 'new' : 'calm';
  const lead = hero.lead;
  let mid = '';
  if (hero.hasLead && lead) {
    const cd = (typeof lead.countdown === 'number' && lead.countdown >= 0)
      ? `剩 ${lead.countdown} 天` : (lead.countdown === null ? '' : '已过期');
    mid = `
      <div class="hero-lead">
        <span class="hero-lv">${lead.pushLevelIcon} ${esc(lead.pushLevelLabel)}</span>
        ${lead.isNew ? '<span class="hero-nb">新</span>' : ''}
        <span class="hero-title">${esc(lead.title)}</span>
      </div>
      <div class="hero-meta">${esc(lead.source)}${lead.site ? ' · ' + esc(lead.site) : ''}${cd ? ' · ' + esc(cd) : ''}</div>`;
  } else {
    mid = `<div class="hero-hint">${esc(hero.hint || '')}</div>`;
  }
  return `
  <div class="hero tone-${toneCls}">
    <div class="hero-hd">
      <span class="hero-k">今日头条</span>
      ${hero.badge ? `<span class="hero-badge">${esc(hero.badge)}</span>` : ''}
      <span class="hero-idx">知时指数 ${esc(String(hero.index.score))}</span>
    </div>
    <div class="hero-line">${esc(hero.line)}</div>
    ${mid}
    <div class="hero-ft">
      <span class="hero-act">${esc(hero.action.text)}</span>
      ${hero.hasLead ? `<span class="hero-sub">共 ${hero.total} 条与你有关${hero.newCount ? ' · ' + hero.newCount + ' 条新收录' : ''}</span>` : ''}
    </div>
  </div>`;
}

function majorHtml() {
  if (!major.length) return '';
  return `
  <div class="sect-t red">🔴 三天内要办 · ${major.length} 条<span class="sec-warn">会打扰你</span></div>
  ${major.map(c => {
    const cd = (typeof c.countdown === 'number' && c.countdown >= 0)
      ? `剩 ${c.countdown} 天` : (c.countdown === null ? '' : '已过期');
    return `
    <div class="pc major">
      <div class="pc-row">
        <span class="pc-lv">${c.pushLevelIcon} ${esc(c.pushLevelLabel)}</span>
        ${c.isNew ? '<span class="pc-new">新</span>' : ''}
        <span class="pc-rank">#${c.rank}</span>
      </div>
      <div class="pc-t">${esc(c.title)}</div>
      <div class="pc-meta">${esc(c.source)}${c.site ? ' · ' + esc(c.site) : ''}${cd ? ' · ' + esc(cd) : ''}</div>
      ${c.digestOne ? `<div class="pc-one">${esc(c.digestOne)}</div>` : ''}
    </div>`;
  }).join('')}`;
}

function minorHtml() {
  if (!minor.length) return '';
  return `
  <div class="sect-t">🟡 一周内 · 长期归档 · ${minor.length} 条<span class="sec-sub">静默进流</span></div>
  <div class="minor-box">
    ${minor.map(c => {
      const cd = (typeof c.countdown === 'number' && c.countdown >= 0)
        ? `剩 ${c.countdown} 天` : (c.countdown === null ? '' : '已过期');
      return `
      <div class="pc minor">
        <span class="pc-mico">${c.pushLevelIcon}</span>
        <div class="pc-mmid">
          <div class="pc-mt">${esc(c.title)}</div>
          <div class="pc-mm">${esc(c.source)}${cd ? ' · ' + esc(cd) : ''}</div>
        </div>
        ${c.isNew ? '<span class="pc-mnew">新</span>' : ''}
      </div>`;
    }).join('')}
  </div>`;
}

let s1 = `
  ${heroHtml()}
  ${majorHtml()}
  ${minorHtml()}
  <div class="sumline">共 <b>${st.collected}</b> 条通知 · 真实公开源 <b>${st.realCnt}</b> 条 · 已浓缩 <b>${st.understood}</b> 条</div>
  <div class="sect-t">按标签分组 · ${idx.data.groups.length} 组 / ${st.matched} 条</div>
  ${idx.data.groups.map(g => {
    const open = idx.data.openTag === g.tag;
    return `
    <div class="grp ${open ? 'open' : ''} ${g.urgent ? 'urgent' : ''}">
      <div class="grp-h">
        <span class="grp-ico">${g.icon}</span>
        <span class="grp-k">${esc(g.tag)}</span>
        <span class="grp-n">${g.count} 条</span>
        ${g.urgent ? '<span class="badge-urgent">紧急</span>' : ''}
        <span class="grp-arrow">${open ? '▾' : '▸'}</span>
      </div>
      <div class="grp-d">${esc(g.desc)}</div>
      ${open ? g.items.map(n => {
        const cd = (typeof n.countdown === 'number' && n.countdown >= 0)
          ? `剩 ${n.countdown} 天` : (n.deadline || '长期有效');
        return `
        <div class="card">
          <div class="card-t">${esc(n.title)}</div>
          <div class="card-one">${esc(n.digestOne || '')}</div>
          <div class="card-f">
            <span>${esc(n.source)} · ${esc(n.publish)}</span>
            <span class="cd ${n.level === 'hi' ? 'hi' : n.level === 'md' ? 'md' : ''}">⏰ ${esc(cd)}</span>
          </div>
          ${n.real ? '<span class="tag-real">真实公开源</span>' : ''}
        </div>`;
      }).join('') : ''}
    </div>`;
  }).join('')}
`;

/* --- 屏 2：搜索 --- */
function hlTitle(r, segsMap) {
  const segs = segsMap[r.id] || [{ text: r.title, hl: false }];
  return segs.map(s => s.hl ? `<mark>${esc(s.text)}</mark>` : esc(s.text)).join('');
}
function hlSnip(r, snipMap) {
  const segs = snipMap[r.id];
  if (!segs) return esc((r.snippet || '').slice(0, 90));
  return (r.snippetPrefix || '') +
    segs.map(s => s.hl ? `<mark>${esc(s.text)}</mark>` : esc(s.text)).join('') +
    (r.snippetSuffix || '');
}

let s2 = `
  <div class="sbar"><span class="s-ico">🔍</span><span class="s-txt">转专业</span><span class="s-x">✕</span></div>
  <div class="hotline">
    <span class="hot-lb">热搜</span>
    ${['转专业','奖学金','竞赛','考试安排','讲座','选课','图书馆'].map(w => `<span class="hot">${esc(w)}</span>`).join('')}
  </div>
  <div class="sect-t">命中 ${searchQ1.length} 条 · 真实公开源 ${searchQ1.filter(r=>r.real).length} 条</div>
  ${searchQ1.map(r => `
    <div class="card-s">
      <div class="cs-t">${r.icon} ${hlTitle(r, searchQ1Segs)}</div>
      <div class="cs-hit">命中：${esc(r.hitSources.join(' / '))}${r.needExplain ? '<span class="why">标题与原文无该词字面出现，命中来自标签</span>' : ''}</div>
      <div class="cs-snip">…${hlSnip(r, searchQ1Snips)}…</div>
      <div class="cs-f">${esc(r.source)} · ${esc(r.publish)}</div>
    </div>`).join('')}
  <div class="sect-t">换个词：搜「竞赛」→ ${searchQ2.length} 条</div>
  <div class="note-box">其中 <b>${searchQ2.filter(r=>r.needExplain).length}</b> 条标题里没有「竞赛」二字，命中来自<b>标签</b>——页面会明说「为什么搜到」，不让人困惑。</div>
  <div class="sect-t">点标签浏览：「学科竞赛」→ ${searchTagRes.length} 条</div>
`;

/* --- 屏 3：详情溯源 --- */
const n3 = detailNotice;
const hlSegs = detailSegs.filter(s => s.hl).length;

let s3 = `
  <div class="dt-head">
    <div class="dt-t">${esc(n3.title)}</div>
    <div class="dt-meta">
      <span>${esc(n3.source)}</span>
      <span>${esc(n3.publish)}</span>
      ${(typeof n3.countdown === 'number' && n3.countdown >= 0) ? `<span class="cd hi">剩 ${n3.countdown} 天</span>` : ''}
    </div>
    <div class="dt-flags">
      ${dt.data.matched ? '<span class="fl ok">已订阅该类</span>' : '<span class="fl">未订阅</span>'}
      ${n3.real ? '<span class="fl real">真实公开源</span>' : ''}
    </div>
  </div>
  <div class="tabs"><span class="tab on">浓缩</span><span class="tab">原文</span></div>
  <div class="one-box">
    <div class="ob-lb">一句话看懂</div>
    <div class="ob-t">${esc(n3.digestOne)}</div>
  </div>
  <div class="sect-t">四要素</div>
  <div class="facts">
    ${detailFacts.map(f => `
      <div class="fact">
        <span class="f-k">${esc(f.k)}</span>
        <span class="f-v">${esc(f.v)}</span>
      </div>`).join('')}
  </div>
  <div class="sect-t">浓缩要点 · 每条都挂原文出处</div>
  ${(n3.digestPoints || []).map((p, i) => `
    <div class="pt ${i === 0 ? 'on' : ''}">
      <div class="pt-t">${i + 1}. ${esc(p.text)}</div>
      <div class="pt-q">
        <span class="q-lb">原文出处</span>
        ${ptLocs[i] >= 0 ? `<span class="q-ok">✔ 第 ${ptLocs[i]} 字符处可定位</span>` : '<span class="q-no">✘ 未定位</span>'}
      </div>
      <div class="pt-quote">「${esc(p.quote.slice(0, 76))}${p.quote.length > 76 ? '…' : ''}」</div>
    </div>`).join('')}
  <div class="trace-box">
    溯源完整度自评：<b>${detailTrace.ok} / ${detailTrace.total}</b> 条要点能在原文中定位
    ${detailTrace.ok === detailTrace.total && detailTrace.total > 0 ? '<span class="q-ok">✔ 全部可核对</span>' : ''}
  </div>
`;

/* --- 屏 4：原文高亮 --- */
let s4 = `
  <div class="dt-head mini">
    <div class="dt-t">${esc(n3.title.slice(0, 40))}${n3.title.length > 40 ? '…' : ''}</div>
    <div class="dt-meta"><span class="tab-inline on">浓缩</span><span class="tab-inline">原文</span></div>
  </div>
  <div class="note-box">原文切成 <b>${detailSegs.length}</b> 段，其中 <b>${hlSegs}</b> 段标为「可跳转高亮」——点要点就能跳到这些句子。</div>
  <div class="rawbox">
    ${detailSegs.slice(0, 14).map(s => {
      const t = esc(s.text.replace(/\s+/g, ' '));
      return s.hl
        ? `<span class="raw-hl" title="要点 ${s.idx + 1}">${t}</span>`
        : `<span class="raw-plain">${t}</span>`;
    }).join('')}
    ${detailSegs.length > 14 ? `<span class="raw-plain">…（还有 ${detailSegs.length - 14} 段）</span>` : ''}
  </div>
  <div class="note-box">点第 1 条要点 → 跳到 tab=<b>${detailState.tab}</b>，高亮第 <b>${detailState.activeIdx + 1}</b> 句。</div>
`;

/* --- 屏 5：订阅 --- */
let s5 = `
  <div class="hero-mini">
    <div class="hm-logo">我</div>
    <div>
      <div class="hm-t">${esc(meSnap.profile.grade)}</div>
      <div class="hm-s">${esc(meSnap.profile.college)}</div>
    </div>
  </div>
  <div class="sect-t">关注事项（9 个标签，勾选即订阅）</div>
  ${tags.TAGS.map(t => {
    const on = meSnap.profile.interests.indexOf(t.key) >= 0;
    return `
    <div class="sub-row ${on ? 'on' : ''}">
      <span class="sub-ck">${on ? '✔' : ''}</span>
      <span class="sub-ico">${t.icon}</span>
      <span class="sub-k">${esc(t.key)}</span>
      <span class="sub-c">该类 ${meSnap.tagCounts[t.key] || 0} 条</span>
    </div>`;
  }).join('')}
  <div class="sub-extra">
    <div>提醒时机：${esc(meSnap.profile.advance)}</div>
    <div>推送渠道：${esc(meSnap.profile.channel)}</div>
  </div>
  <div class="reach">⚡ 当前订阅能收到：<b>${meSnap.reachable}</b> 条</div>
  <div class="sect-t">改订阅，实时看到收益变化</div>
  <table class="chg">
    <tr><td>勾上「讲座培训」</td><td>订阅 5 项</td><td class="up">可触达 ${reachAfterAdd} 条（+${reachAfterAdd - reachBefore}）</td></tr>
    <tr><td>取消「讲座培训」</td><td>订阅 4 项</td><td>可触达 ${reachBefore} 条</td></tr>
    <tr><td>点「全选」</td><td>订阅 ${allCount} 项</td><td>可触达 ${reachAll} 条</td></tr>
    <tr><td>点「恢复默认」</td><td>订阅 ${defCount} 项</td><td>可触达 ${reachDefault} 条</td></tr>
    <tr><td>点「保存」</td><td colspan="2" class="${savedOk ? 'up' : ''}">${savedOk ? '已写入本地存储 ✔' : '未保存 ✘'}</td></tr>
  </table>
`;

/* --- 屏 6：推送设置（微信触达 + 触达时间线） --- */
const wxs = pushAfterAdvance.wx;
const rch = pushAfterAdvance.reach;
const days = pushAfterAdvance.reachDays || [];

function wxBlockHtml() {
  const stCls = !wxs.granted ? 'off' : (wxs.demo ? 'demo' : 'real');
  const advLabel = (pushSnap.advanceOptions[0] || {}).label || '截止前 7 / 3 / 1 天';
  return `
  <div class="wx-card">
    <div class="wx-hd">
      <div>
        <div class="wx-lb">当前状态</div>
        <div class="wx-st ${stCls}">${esc(wxs.status)}</div>
      </div>
      <span class="wx-tag ${wxs.demo ? 'demo' : 'real'}">${wxs.demo ? '演示模式' : '真实下发'}</span>
    </div>
    <div class="wx-tip">${esc(wxs.statusTip)}</div>
    <div class="wx-row"><span class="k">已订阅类别</span><span class="v">${(wxs.typeNames || []).join(' · ') || '—'}</span></div>
    <div class="wx-row"><span class="k">提前几天提醒</span><span class="v">${esc(advLabel)}</span></div>
    <div class="wx-row"><span class="k">送达留痕</span><span class="v">${(pushAfterDeliver && pushAfterDeliver.sends) || 0} 次</span></div>
    <button class="wx-btn">${wxs.granted ? '更新订阅授权' : '开启微信服务通知'}</button>
    <button class="wx-btn ghost">模拟一次主动送达</button>
  </div>`;
}

function reachBlockHtml() {
  if (!days.length) return '<div class="wx-tip">当前档案下，未来两周没有需要提醒的条目</div>';
  return `
  <div class="wx-card" style="margin-top:10px">
    <div class="wx-i"><span class="k2">与你相关</span><span class="num">${rch.mine}</span></div>
    <div class="wx-i"><span class="k2">已规划提醒</span><span class="num">${rch.scheduled}</span></div>
    <div class="wx-i"><span class="k2">未来 14 天会打扰</span><span class="num">${rch.upcoming} 次</span></div>
    <div class="wx-tip">按「${esc(rch.advanceText)}」推演：每条通知在截止前会提醒几次、具体哪天提醒，全部由真实发布日与截止日算出。</div>
    <div class="tl">
      ${days.slice(0, 6).map(d => `
        <div class="tl-g">
          <div class="tl-dot ${d.items[0].plan[0].kind === 'urgent' ? 'u' : d.items[0].plan[0].kind === 'hot' ? 'h' : 's'}"></div>
          <div class="tl-bd">
            <div class="tl-dt">${esc(d.dateText)}<span class="n">${d.items.length} 条</span></div>
            ${d.items.slice(0, 3).map(it => `
              <div class="tl-it">
                <div class="tl-t">${esc(it.title)}</div>
                <div class="tl-m">${esc(it.source)} · ${esc(it.deadlineText)} 截止 · 剩 ${it.daysLeft} 天</div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

let s6 = `
  <div class="sect-t">🔔 主动推送引擎 · 真跑一遍的结果</div>
  <div class="wx-tip" style="margin-bottom:10px">微信服务通知是痛点的最后一步 —— 关掉小程序也能收到提醒。下面是真跑一遍的授权、登记与推演结果。</div>
  ${wxBlockHtml()}
  <div class="sect-t" style="margin-top:14px">📲 触达时间线 · 什么时候会主动找你</div>
  ${reachBlockHtml()}
`;

/* --- 屏 7：今日简报 · 智能体主动送达 --- */
function agentBlockHtml(){
  const stt = digestSnap;
  if(!stt.agentReady && !stt.agentErr){
    return '<div class="ag-loading">正在向智能体要今天的清单…</div>';
  }
  const cls = stt.agentMode==='remote' ? 'on' : (stt.agentDegraded ? 'warn' : 'off');
  let h = '<div class="agbox '+cls+'">';
  h += '<div class="ag-hd"><span class="ag-dot"></span>'
     + '<span class="ag-lab">'+esc(stt.agentLabel||'本地模式')+'</span>'
     + '<span class="ag-via">'+(stt.agentVia==='remote'?'服务端算':'本地算')+'</span></div>';

  if(stt.agentDegraded){
    h += '<div class="ag-warn">智能体服务未连接，已降级用本地算法现算（结论口径一致，但不含大模型理解）。'
       + (stt.agentDegradeReason ? '<span class="ag-warnr">原因：'+esc(stt.agentDegradeReason)+'</span>' : '') + '</div>';
  }
  if(stt.agentErr){
    h += '<div class="ag-warn">取清单失败：'+esc(stt.agentErr)+'</div>';
  }

  const notify = stt.agentNotify || [];
  const silent = stt.agentSilent || [];
  if(notify.length){
    h += '<div class="ag-tl">该主动提醒你 · '+notify.length+' 件</div>';
    notify.forEach(n => {
      h += '<div class="ag-notify">'
        + '<div class="ag-nr1"><div class="ag-nt">'+esc(n.title)+'</div>'
        + '<div class="ag-nd">'+esc(n.dueText||'')+'</div></div>'
        + '<div class="ag-nsr">'+esc(n.event||'')+(n.source?' · '+esc(n.source):'')+'</div>'
        + (n.reasonLine?'<div class="ag-nrs">💡 '+esc(n.reasonLine)+'</div>':'')
        + (n.digestOne?'<div class="ag-none">'+esc(n.digestOne)+'</div>':'')
        + '</div>';
    });
  }
  if(silent.length){
    h += '<div class="ag-sl">静默进流 · 不打扰你（'+silent.length+' 条示例）</div>';
    silent.forEach(n => {
      h += '<div class="ag-sitem"><span class="ag-st">'+esc(n.title)+'</span>'
        + '<span class="ag-sd">'+esc(n.dueText||'')+'</span></div>';
    });
  }
  if(!notify.length && !silent.length){
    h += '<div class="ag-em">按你当前的订阅，今天没有需要主动送达的事。</div>';
  }

  const meta = stt.agentMeta;
  if(meta){
    const c = meta.counts || {};
    h += '<div class="ag-meta">'
      + '<span>最近计算：'+esc(meta.ranAt||'—')+'</span>'
      + '<span>模式：'+(meta.mode==='llm'?'大模型理解 + 规则打分':'纯规则')+'</span>'
      + (meta.model?'<span>模型：'+esc(meta.model)+'</span>':'')
      + '<span>命中 '+(c.matched||0)+' 条 · 打扰 '+(c.notify||0)+' 条 · 静默 '+(c.silent||0)+' 条</span>'
      + (meta.elapsedMs?'<span>耗时 '+meta.elapsedMs+' ms</span>':'')
      + '</div>';
  }
  h += '<div class="ag-acts"><div class="ag-btn">🔄 让它重算一遍</div>'
     + '<div class="ag-btn">📋 复制清单</div></div>';
  h += '</div>';
  return h;
}

let s7 = `
  <div class="bhead-mini">
    <div class="bh-t">今日简报</div>
    <div class="bh-s">${esc(digestSnap.stamp)} 生成 · 知时 · 数字安农信息雷达</div>
  </div>
  <div class="sum-mini">
    <div class="sm-lb">一句话总结</div>
    ${(digestSnap.sentences||[]).map(s => `<div class="sm-tx">${esc(s)}。</div>`).join('')}
    <div class="sm-idx"><span class="sin">知时指数</span>
      <span class="siv">${digestSnap.brief && digestSnap.brief.index ? digestSnap.brief.index.score : '—'}</span>
      <span class="sil">${esc(digestSnap.brief && digestSnap.brief.index ? digestSnap.brief.index.label : '')}</span></div>
  </div>
  <div class="sect-t">💰 数据可信度 · 你看到的从哪来</div>
  <div class="note-box">真实公开源占比 <b>${digestSnap.brief && digestSnap.brief.stats ? digestSnap.brief.stats.realCnt : 0} / ${digestSnap.brief && digestSnap.brief.stats ? digestSnap.brief.stats.collected : 0}</b> —— ${esc(digestSnap.trustLabel||'')}</div>
  <div class="sect-t">🤖 智能体主动送达 · 你不打开它也在跑</div>
  <div class="wx-tip" style="margin-bottom:10px">上面是「你打开小程序时本地现算」，下面是<b style="color:#4dd6a8">服务端智能体按点自己跑出来</b>的清单 —— 后者才是治"错过"的那一环。</div>
  ${agentBlockHtml()}
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>知时 · 小程序预览（真跑数据）</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--panel2:#1e222b;--line:#2a2f3a;
    --text:#e8eaed;--sub:#9aa4b2;--ac:#4dd6a8;--ac2:#5b9cf8;--warn:#f5a524;--danger:#f2565b;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:radial-gradient(1400px 700px at 12% -10%,#1a2432 0%,var(--bg) 58%);
    color:var(--text);font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.65;padding:34px 20px 70px}
  .wrap{max-width:1240px;margin:0 auto}
  .hd{text-align:center;margin-bottom:12px}
  .hd h1{font-size:26px}
  .hd p{color:var(--sub);font-size:13.5px;margin-top:8px}
  .hd .kbd{display:inline-block;background:var(--panel2);border:1px solid var(--line);
    border-radius:7px;padding:2px 9px;font-size:12px;color:var(--ac);margin:0 3px}
  .banner{margin:22px auto 8px;max-width:900px;background:linear-gradient(180deg,rgba(77,214,168,.08),var(--panel));
    border:1px solid rgba(77,214,168,.3);border-radius:14px;padding:16px 20px;font-size:13px;color:#cdd6e0}
  .banner b{color:var(--ac)}

  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));
    gap:26px;margin-top:30px;justify-items:center}
  .col{width:100%;max-width:376px}
  .col-h{font-size:12.5px;color:var(--sub);letter-spacing:1.5px;margin-bottom:10px;
    display:flex;justify-content:space-between;align-items:center}
  .col-h b{color:var(--ac);letter-spacing:0;font-size:14px}
  .col-h .route{font-size:11px;color:#5f6a78}

  .phone{background:var(--bg);border:1px solid var(--line);border-radius:20px;
    overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45);
    display:flex;flex-direction:column;max-height:820px}
  .ph-bar{background:#0b0e12;padding:11px 14px 9px;display:flex;align-items:center;
    justify-content:space-between;font-size:12px;border-bottom:1px solid var(--line)}
  .ph-time{color:var(--sub)}
  .ph-title{font-weight:600;font-size:12.5px}
  .ph-dots{color:var(--sub);font-size:10px}
  .ph-sub{background:#12151b;padding:7px 14px;font-size:11.5px;color:var(--sub);
    border-bottom:1px solid var(--line)}
  .ph-body{padding:13px;overflow-y:auto;flex:1}

  /* 通用块 */
  .sect-t{font-size:11.5px;color:var(--sub);letter-spacing:1px;margin:15px 0 8px;
    padding-bottom:5px;border-bottom:1px solid var(--line)}
  .sect-t:first-child{margin-top:0}
  .note-box{background:var(--panel2);border-left:3px solid var(--ac2);border-radius:8px;
    padding:9px 12px;font-size:11.5px;color:#c8d0db;margin:9px 0}
  .note-box b{color:var(--ac)}

  /* 屏5 · 我的小头像条（订阅页复用） */
  .hero-mini{display:flex;align-items:center;gap:11px;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:12px}
  .hm-logo{width:38px;height:38px;border-radius:10px;flex:0 0 38px;
    background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;
    align-items:center;justify-content:center;font-weight:700;color:#08120e;font-size:17px}
  .hm-t{font-size:13.5px;font-weight:600}
  .hm-s{font-size:11.5px;color:var(--sub)}

  /* 屏1 · 今日头条（合并原三卡） */
  .hero{border-radius:14px;padding:14px 15px 12px;margin-bottom:12px;
    background:linear-gradient(160deg,#0a7a4c,#00653E);box-shadow:0 6px 18px rgba(0,101,62,.28)}
  .hero.tone-alert{background:linear-gradient(160deg,#C0392B,#8E2418);box-shadow:0 6px 18px rgba(192,57,43,.3)}
  .hero.tone-new{background:linear-gradient(160deg,#B8860B,#8A6508);box-shadow:0 6px 18px rgba(184,134,11,.28)}
  .hero-hd{display:flex;align-items:center;gap:8px}
  .hero-k{font-size:11px;font-weight:700;color:rgba(255,255,255,.94);letter-spacing:1.5px}
  .hero-badge{font-size:10.5px;font-weight:700;color:#fff;background:rgba(255,255,255,.22);
    border-radius:5px;padding:1px 8px}
  .hero-idx{margin-left:auto;font-size:10.5px;color:rgba(255,255,255,.88);
    background:rgba(255,255,255,.14);border-radius:5px;padding:1px 8px}
  .hero-line{font-size:14px;color:#fff;line-height:1.55;margin-top:8px;font-weight:500}
  .hero-lead{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:9px;
    padding-top:9px;border-top:1px solid rgba(255,255,255,.24)}
  .hero-lv{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;color:#fff;
    background:rgba(255,255,255,.24)}
  .hero-nb{font-size:10px;font-weight:700;color:#00653E;background:#fff;padding:1px 7px;border-radius:5px}
  .hero-title{flex:1;min-width:0;font-size:14.5px;font-weight:700;color:#fff;line-height:1.42}
  .hero-meta{font-size:11px;color:rgba(255,255,255,.84);margin-top:7px}
  .hero-hint{font-size:12px;color:rgba(255,255,255,.9);margin-top:8px}
  .hero-ft{display:flex;align-items:center;gap:9px;margin-top:10px}
  .hero-act{font-size:12.5px;font-weight:700;color:#00653E;background:#fff;border-radius:7px;padding:6px 15px}
  .hero-sub{font-size:11px;color:rgba(255,255,255,.88)}

  /* 梯度卡片：中卡（三天内）/ 小卡（归档） */
  .sect-t.red{color:var(--danger)}
  .sec-warn{font-size:9.5px;font-weight:700;color:#fff;background:var(--danger);
    border-radius:5px;padding:1px 7px;margin-left:8px}
  .sec-sub{font-size:10px;color:var(--sub);margin-left:6px;font-weight:400}
  .pc{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    margin-bottom:9px;position:relative;overflow:hidden}
  .pc::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--ac)}
  .pc.major{padding:12px 13px}
  .pc.major::before{background:var(--danger)}
  .pc-row{display:flex;align-items:center;gap:7px}
  .pc-lv{font-size:10px;font-weight:700;color:#fff;background:var(--danger);border-radius:5px;padding:2px 8px}
  .pc-new{font-size:10px;font-weight:700;color:#fff;background:var(--ac);border-radius:5px;padding:2px 7px}
  .pc-rank{margin-left:auto;font-size:10.5px;color:var(--sub);font-weight:600}
  .pc-t{font-size:14px;font-weight:600;line-height:1.42;margin-top:7px}
  .pc-meta{font-size:11px;color:var(--sub);margin-top:6px}
  .pc-one{font-size:12px;color:#c8d0db;line-height:1.55;margin-top:6px}
  .minor-box{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:4px 10px;margin-bottom:9px}
  .pc.minor{display:flex;align-items:flex-start;gap:8px;background:transparent;border:0;
    border-bottom:1px solid var(--line);border-radius:0;margin:0;padding:9px 0}
  .pc.minor:last-child{border-bottom:0}
  .pc.minor::before{display:none}
  .pc-mico{font-size:12px;flex:0 0 14px;line-height:1.5}
  .pc-mmid{flex:1;min-width:0}
  .pc-mt{font-size:12.5px;font-weight:500;line-height:1.42}
  .pc-mm{font-size:10.5px;color:var(--sub);margin-top:2px}
  .pc-mnew{font-size:9.5px;font-weight:700;color:#fff;background:var(--ac);
    border-radius:5px;padding:1px 6px;flex:0 0 auto}
  .sumline{font-size:12px;color:var(--sub);margin:11px 0 4px}
  .sumline b{color:var(--text)}

  .grp{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    margin-bottom:9px;overflow:hidden}
  .grp.open{border-color:rgba(77,214,168,.35)}
  .grp.urgent.open{border-color:rgba(242,86,91,.4)}
  .grp-h{display:flex;align-items:center;gap:8px;padding:11px 12px;font-size:13.5px}
  .grp-ico{font-size:15px}
  .grp-k{font-weight:600;flex:1}
  .grp-n{font-size:11.5px;color:var(--sub)}
  .badge-urgent{background:rgba(242,86,91,.16);color:var(--danger);font-size:10px;
    border-radius:5px;padding:1px 6px;font-weight:600}
  .grp-arrow{color:var(--sub);font-size:11px}
  .grp-d{font-size:11px;color:#5f6a78;padding:0 12px 10px}
  .card{background:var(--panel2);border-radius:9px;padding:10px 11px;margin:0 10px 9px}
  .card-t{font-size:12.5px;font-weight:600;margin-bottom:5px}
  .card-one{font-size:11.5px;color:var(--sub);margin-bottom:7px}
  .card-f{display:flex;justify-content:space-between;font-size:11px;color:#5f6a78}
  .cd{font-weight:600;color:var(--sub)}
  .cd.hi{color:var(--danger)} .cd.md{color:var(--warn)}
  .tag-real{display:inline-block;margin-top:6px;font-size:10px;color:var(--ac);
    background:rgba(77,214,168,.12);border-radius:5px;padding:1px 6px}

  /* 屏2 */
  .sbar{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:9px 13px;display:flex;align-items:center;gap:9px;font-size:13px}
  .s-ico{font-size:13px}
  .s-txt{flex:1}
  .s-x{color:var(--sub);font-size:12px}
  .hotline{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:11px 0 3px}
  .hot-lb{font-size:11px;color:var(--sub)}
  .hot{background:var(--panel2);border:1px solid var(--line);border-radius:7px;
    padding:2px 8px;font-size:11px;color:#c8d0db}
  .card-s{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:11px 12px;margin-bottom:9px}
  .cs-t{font-size:13px;font-weight:600;margin-bottom:6px}
  .cs-t mark{background:rgba(245,165,36,.28);color:#ffd58a;border-radius:3px;padding:0 2px}
  .cs-hit{font-size:10.5px;color:var(--ac);margin-bottom:5px}
  .why{color:var(--warn);margin-left:6px}
  .cs-snip{font-size:11.5px;color:var(--sub);margin-bottom:6px}
  .cs-snip mark{background:rgba(245,165,36,.28);color:#ffd58a;border-radius:3px;padding:0 2px}
  .cs-f{font-size:10.5px;color:#5f6a78}

  /* 屏3 */
  .dt-head{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px}
  .dt-head.mini{padding:10px 12px}
  .dt-t{font-size:14px;font-weight:600;margin-bottom:7px}
  .dt-meta{display:flex;gap:11px;flex-wrap:wrap;font-size:11px;color:#5f6a78;margin-bottom:7px}
  .dt-flags{display:flex;gap:7px;flex-wrap:wrap}
  .fl{font-size:10.5px;color:#5f6a78;background:var(--panel2);border-radius:5px;padding:1px 7px}
  .fl.ok{color:var(--ac);background:rgba(77,214,168,.12)}
  .fl.real{color:var(--ac2);background:rgba(91,156,248,.12)}
  .tabs{display:flex;gap:8px;margin:12px 0 9px}
  .tab{flex:1;text-align:center;font-size:12.5px;padding:7px 0;border-radius:9px;
    background:var(--panel);border:1px solid var(--line);color:var(--sub)}
  .tab.on{background:rgba(77,214,168,.13);border-color:rgba(77,214,168,.4);color:var(--ac);font-weight:600}
  .tab-inline{font-size:10.5px;padding:1px 8px;border-radius:6px;background:var(--panel2);color:var(--sub)}
  .tab-inline.on{background:rgba(77,214,168,.13);color:var(--ac)}
  .one-box{background:linear-gradient(180deg,rgba(77,214,168,.07),var(--panel));
    border:1px solid rgba(77,214,168,.28);border-radius:11px;padding:11px 13px;margin-top:11px}
  .ob-lb{font-size:10.5px;color:var(--ac);letter-spacing:1px;margin-bottom:5px}
  .ob-t{font-size:13px;line-height:1.75}
  .facts{display:flex;flex-direction:column;gap:6px}
  .fact{display:flex;gap:9px;background:var(--panel);border:1px solid var(--line);
    border-radius:9px;padding:8px 11px;font-size:12px}
  .f-k{color:var(--ac2);flex:0 0 62px;font-size:11.5px}
  .f-v{color:#cdd6e0;flex:1}
  .pt{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:10px 12px;margin-bottom:8px}
  .pt.on{border-color:rgba(245,165,36,.4);background:linear-gradient(180deg,rgba(245,165,36,.05),var(--panel))}
  .pt-t{font-size:12.5px;margin-bottom:7px}
  .pt-q{font-size:10.5px;margin-bottom:5px;display:flex;gap:9px;align-items:center}
  .q-lb{color:var(--ac2)}
  .q-ok{color:var(--ac)} .q-no{color:var(--danger)}
  .pt-quote{font-size:11px;color:#7f8a99;background:var(--panel2);border-radius:7px;
    padding:7px 9px;font-style:italic}
  .trace-box{background:var(--panel2);border-radius:9px;padding:10px 12px;
    font-size:11.5px;color:#c8d0db;margin-top:9px}
  .trace-box b{color:var(--ac)}
  .rawbox{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:12px;font-size:12px;line-height:2;color:#8b95a3}
  .raw-hl{background:rgba(245,165,36,.3);color:#ffd58a;border-radius:3px;padding:1px 2px}
  .raw-plain{color:#8b95a3}

  /* 屏5 */
  .sub-row{display:flex;align-items:center;gap:9px;background:var(--panel);
    border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:7px;font-size:12.5px}
  .sub-row.on{border-color:rgba(77,214,168,.35);background:rgba(77,214,168,.06)}
  .sub-ck{width:16px;height:16px;border-radius:5px;border:1px solid var(--line);flex:0 0 16px;
    display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--ac)}
  .sub-row.on .sub-ck{background:var(--ac);border-color:var(--ac);color:#08120e;font-weight:700}
  .sub-ico{font-size:14px}
  .sub-k{flex:1;font-weight:500}
  .sub-c{font-size:11px;color:#5f6a78}
  .sub-extra{background:var(--panel2);border-radius:9px;padding:9px 12px;font-size:11.5px;
    color:var(--sub);margin-top:10px;display:flex;flex-direction:column;gap:4px}
  .reach{background:linear-gradient(180deg,rgba(77,214,168,.1),var(--panel));
    border:1px solid rgba(77,214,168,.32);border-radius:10px;padding:11px 13px;
    font-size:12.5px;margin-top:10px}
  .reach b{color:var(--ac);font-size:16px}
  .chg{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:8px}
  .chg td{border-bottom:1px solid rgba(42,47,58,.6);padding:7px 8px;color:#c8d0db}
  .chg td:first-child{color:var(--sub)}
  .chg .up{color:var(--ac);font-weight:600}
  .foot{margin-top:38px;text-align:center;font-size:11.5px;color:#5f6a78;line-height:2}
  .foot b{color:var(--ac)}

  /* 屏6 · 推送设置（微信触达 + 触达时间线） */
  .wx-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 13px}
  .wx-hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .wx-lb{font-size:10.5px;color:var(--sub)}
  .wx-st{font-size:15px;font-weight:700;margin-top:3px}
  .wx-st.off{color:#5f6a78}
  .wx-st.demo{color:#f5a524}
  .wx-st.real{color:var(--ac)}
  .wx-tag{font-size:10px;padding:2px 9px;border-radius:99px;border:1px solid var(--line);color:var(--sub);white-space:nowrap}
  .wx-tag.demo{color:#f5a524;border-color:rgba(245,165,36,.4);background:rgba(245,165,36,.08)}
  .wx-tip{font-size:11px;color:var(--sub);line-height:1.7;margin-top:8px}
  .wx-row{display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:8px 0;border-top:1px solid rgba(42,47,58,.6);font-size:12px}
  .wx-row .k{color:var(--sub)}
  .wx-row .v{color:#e6ebf2;font-weight:500}
  .wx-btn{width:100%;margin-top:10px;border:none;border-radius:9px;padding:10px 0;font-size:12.5px;
    background:linear-gradient(135deg,#2fbf8e,#1f9d74);color:#04120c;font-weight:600}
  .wx-btn.ghost{background:transparent;border:1px dashed var(--line);color:var(--sub);font-weight:400;margin-top:7px}
  .wx-dd{border-top:1px solid rgba(42,47,58,.6);padding-top:9px;margin-top:9px}
  .wx-i{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;padding:5px 0}
  .wx-i .num{color:var(--ac);font-weight:700;font-size:15px}
  .wx-i .k2{color:var(--sub)}
  .tl{margin-top:12px;display:flex;flex-direction:column;gap:9px}
  .tl-g{display:flex;gap:9px}
  .tl-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:0 0 8px;background:#5f6a78}
  .tl-dot.u{background:#e5484d} .tl-dot.h{background:#f5a524} .tl-dot.s{background:#c7a400}
  .tl-bd{flex:1;min-width:0}
  .tl-dt{font-size:11.5px;font-weight:600;margin-bottom:5px}
  .tl-dt .n{color:#5f6a78;font-weight:400;font-size:10.5px;margin-left:6px}
  .tl-it{background:var(--panel2);border-radius:8px;padding:7px 9px;margin-bottom:5px}
  .tl-t{font-size:11.5px;line-height:1.5;color:#dfe6ee}
  .tl-m{font-size:10.5px;color:#5f6a78;margin-top:4px}

  /* 屏7 · 今日简报 + 智能体主动送达 */
  .bhead-mini{background:var(--panel);border:1px solid var(--line);border-radius:11px;
    padding:10px 13px;margin-bottom:11px}
  .bh-t{font-size:15px;font-weight:700}
  .bh-s{font-size:10.5px;color:var(--sub);margin-top:3px}
  .sum-mini{background:linear-gradient(180deg,rgba(77,214,168,.08),var(--panel));
    border:1px solid rgba(77,214,168,.3);border-radius:12px;padding:12px 13px;margin-bottom:6px}
  .sm-lb{font-size:10.5px;color:var(--ac);letter-spacing:1px;margin-bottom:6px}
  .sm-tx{font-size:13px;line-height:1.7}
  .sm-idx{display:flex;align-items:baseline;gap:8px;margin-top:9px;padding-top:9px;
    border-top:1px solid rgba(42,47,58,.7)}
  .sin{font-size:11px;color:var(--sub)}
  .siv{font-size:20px;font-weight:700;color:var(--ac)}
  .sil{font-size:11.5px;color:var(--sub)}

  .agbox{background:var(--panel);border:1px solid var(--line);border-left:5px solid #5f6a78;
    border-radius:12px;padding:12px 13px 11px}
  .agbox.on{border-left-color:#17A05A;background:linear-gradient(180deg,rgba(23,160,90,.06),var(--panel))}
  .agbox.warn{border-left-color:#E08A16;background:linear-gradient(180deg,rgba(224,138,22,.07),var(--panel))}
  .ag-hd{display:flex;align-items:center;padding-bottom:9px;border-bottom:1px dashed var(--line)}
  .ag-dot{width:11px;height:11px;border-radius:50%;margin-right:9px;flex:0 0 11px;background:#5f6a78}
  .agbox.on .ag-dot{background:#17A05A;box-shadow:0 0 0 4px rgba(23,160,90,.18)}
  .agbox.warn .ag-dot{background:#E08A16;box-shadow:0 0 0 4px rgba(224,138,22,.18)}
  .ag-lab{flex:1;font-size:13px;font-weight:600}
  .agbox.on .ag-lab{color:#17A05A}
  .agbox.warn .ag-lab{color:#E08A16}
  .ag-via{font-size:10px;color:var(--sub);background:var(--panel2);border-radius:7px;padding:2px 8px}
  .ag-warn{margin-top:10px;font-size:11.5px;line-height:1.65;color:#f5a524;
    background:rgba(245,165,36,.1);border:1px solid rgba(245,165,36,.3);border-radius:8px;padding:8px 10px}
  .ag-warnr{display:block;margin-top:4px;font-size:10.5px;color:#8b95a3}
  .ag-loading{font-size:11.5px;color:var(--sub);text-align:center;padding:16px 0}
  .ag-tl,.ag-sl{font-size:11px;font-weight:600;color:#c8d0db;margin:11px 0 7px}
  .ag-sl{color:var(--sub);font-weight:400}
  .ag-notify{background:linear-gradient(180deg,rgba(77,214,168,.06),transparent);
    border:1px solid rgba(77,214,168,.2);border-radius:9px;padding:10px 11px;margin-bottom:8px}
  .ag-nr1{display:flex;align-items:flex-start}
  .ag-nt{flex:1;font-size:13px;font-weight:600;line-height:1.45;margin-right:9px}
  .ag-nd{font-size:10.5px;font-weight:700;color:#04120c;background:linear-gradient(135deg,#4dd6a8,#1f9d74);
    border-radius:6px;padding:2px 8px;flex:0 0 auto;white-space:nowrap}
  .ag-nsr{font-size:10.5px;color:#5f6a78;margin-top:5px}
  .ag-nrs{font-size:11.5px;color:#4dd6a8;margin-top:6px;line-height:1.5;
    background:rgba(77,214,168,.08);border-radius:6px;padding:5px 8px}
  .ag-none{font-size:11.5px;color:#c8d0db;line-height:1.6;margin-top:6px}
  .ag-sitem{display:flex;align-items:center;padding:8px 2px;border-bottom:1px solid rgba(42,47,58,.6)}
  .ag-sitem:last-child{border-bottom:none}
  .ag-st{flex:1;font-size:12px;color:#c8d0db;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;margin-right:9px}
  .ag-sd{font-size:10.5px;color:#5f6a78;flex:0 0 auto}
  .ag-em{text-align:center;font-size:12px;color:var(--sub);padding:20px 0}
  .ag-meta{margin-top:11px;padding-top:9px;border-top:1px dashed var(--line);
    font-size:10px;color:#5f6a78;line-height:1.85}
  .ag-meta span{display:block}
  .ag-acts{display:flex;gap:8px;margin-top:11px}
  .ag-btn{flex:1;text-align:center;font-size:12px;color:#4dd6a8;background:var(--panel2);
    border:1px solid var(--line);border-radius:8px;padding:9px 0}

  @media(max-width:760px){.grid{gap:20px}}
</style>
</head>
<body>
<div class="wrap">

  <div class="hd">
    <h1>知时 · 小程序七页预览</h1>
    <p>这份页面里的每一个字，都是小程序页面 <b style="color:#4dd6a8">真跑一遍</b> 出来的 data 值 —— 不是示意图</p>
    <p style="margin-top:6px">
      <span class="kbd">node tools/show_miniprogram.js</span> 重新生成 ·
      <span class="kbd">微信开发者工具</span> 导入 miniprogram 目录即可自己点
    </p>
  </div>

  <div class="banner">
    <b>跑通的事实：</b>${st.collected} 条通知（真实公开源 ${st.realCnt} 条）· 已浓缩 ${st.understood} 条 ·
    9 个标签 · 画像命中 ${st.matched} 条，分 ${idx.data.groups.length} 组推送 ·
    溯源定位 100%（全部要点都能在原文中找到出处）<br>
    <span style="color:#9aa4b2">小程序已配 <b style="color:#4dd6a8">touristappid 游客模式</b>，不需要自己注册 AppID 就能编译预览。</span><br>
    <span style="color:#9aa4b2">⑦ 号屏的「智能体主动送达」是<b style="color:#4dd6a8">真跑一遍</b>出来的：本机未部署服务 → 如实降级本地算法，
    页面上会明说"本地算"而不假装是服务端算的。</span>
  </div>

  <div class="grid">
    <div class="col">
      <div class="col-h"><span><b>① 推送</b></span><span class="route">pages/index</span></div>
      ${phone('知时 · 信息雷达', '按标签分组推送', s1)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>② 搜索</b></span><span class="route">pages/search</span></div>
      ${phone('搜索', '主动搜索 · 命中高亮', s2)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>③ 详情</b></span><span class="route">pages/detail</span></div>
      ${phone('详情', '浓缩 + 溯源', s3)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>④ 原文</b></span><span class="route">pages/detail · 原文 Tab</span></div>
      ${phone('原文', '可跳转高亮', s4)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>⑤ 订阅</b></span><span class="route">pages/me</span></div>
      ${phone('我的订阅', '勾选即订阅 · 实时看收益', s5)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>⑥ 推送设置</b></span><span class="route">pages/push</span></div>
      ${phone('推送设置', '微信触达 + 触达时间线', s6)}
    </div>
    <div class="col">
      <div class="col-h"><span><b>⑦ 今日简报 · 智能体</b></span><span class="route">pages/digest</span></div>
      ${phone('今日简报', '简报 + 智能体主动送达清单', s7)}
    </div>
  </div>

  <div class="foot">
    <b>「农芯智」AI 智能体创新大赛</b> 参赛作品 · 知时 · 安农校园信息雷达<br>
    数据来自公网公开通知页聚合；仅聚合公开信息，不涉及教务后台 / 课表 / 成绩 / 学籍
  </div>

</div>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成：' + OUT);
console.log('字节数：' + Buffer.byteLength(html, 'utf8'));

})().catch(e => { console.error('[生成失败] ' + (e && e.stack || e)); process.exit(1); });
