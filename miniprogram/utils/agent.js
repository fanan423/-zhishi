/**
 * 知时 · 智能体客户端（小程序侧）
 * ==================================
 *
 * 【这一层解决什么】
 *   前面的 push.js / store.js 都是"在小程序里自己算"——它们算得对，
 *   但只在你**打开小程序**时才算。用户真正的痛点是"我不打开也想被提醒"。
 *
 *   智能体服务（tools/agent/server.js）就是干这个的：它在服务端常驻，
 *   按点自己跑一轮，把"该主动送达的清单"算好。本文件是**小程序侧的对讲机**：
 *   打开小程序时问它一句"今天有什么"，拿到清单直接渲染。
 *
 * 【可降级适配（与 cloud.js 同一设计哲学）】
 *   本文件有两套实现，对外接口完全一致：
 *     - remote：智能体服务可达 → 调它的 HTTP 接口（结论权威、含真实 LLM 理解）
 *     - local ：服务不可达 → 用本地同源算法（store + push）现算
 *   所以**没部署服务也照样能跑**，页面代码一行都不用改。
 *
 * 【合规】
 *   只把通知原文（公网公开数据）与用户主动填的画像发给服务端；
 *   服务端用完即算，画像只用于匹配，不做任何其他用途。
 *   不发送课表/成绩/学籍/一卡通等任何私域数据。
 *
 * 【配置】
 *   AGENT_BASE 默认为空 = 直接用 local（未部署时的开箱默认）。
 *   部署后把服务地址填进 AGENT_BASE（或由 app.js 注入），自动切 remote。
 */

const store = require('./store.js');
const push = require('./push.js');

 /* ============================================================
 * 配置：服务端地址（三级来源，优先级从高到低）
 * ------------------------------------------------------------
 *   ① 硬编码常量 AGENT_BASE_HARD（本文件里，一般留空）
 *   ② app.globalData.agentBase（推荐：集中配置在 app.js，见下方 resolveBase()）
 *   ③ 本地 storage 的 agentBase 键（便于「我的」页运行时填写，免发版）
 *
 * 留空 = 用本地算法（未部署时的默认，保证开箱即用）。
 * 部署智能体服务后填地址，例如：
 *   http://127.0.0.1:8787      （本机开发；小程序真机需同网段 IP）
 *   https://xxx.example.com    （线上）
 * 注意：小程序正式环境要求 **https**，且域名必须加进
 * 「微信公众平台 → 开发 → 开发设置 → 服务器域名 → request 合法域名」，
 * 否则 wx.request 直接被拦。开发阶段可勾「不校验合法域名」。
 * ============================================================ */
const AGENT_BASE_HARD = '';

const TIMEOUT_MS = 20000;

/** 解析当前生效的服务地址（见上方三级来源） */
function resolveBase() {
  if (AGENT_BASE_HARD) return String(AGENT_BASE_HARD).trim();
  try {
    const app = (typeof getApp === 'function') ? getApp() : null;
    const g = app && app.globalData && app.globalData.agentBase;
    if (g) return String(g).trim();
  } catch (e) { /* 非小程序环境（Node 测试）忽略 */ }
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const s = wx.getStorageSync('agentBase');
      if (s) return String(s).trim();
    }
  } catch (e) { /* 忽略 */ }
  return '';
}

/* 兼容旧引用：AGENT_BASE 为「模块加载时」的快照，仅供外部读，运行期判断一律用 resolveBase() */
const AGENT_BASE = resolveBase();

/* ============================================================
 * 通用请求（wx.request 包装：超时 / 错误归一 / JSON 解析）
 * ============================================================ */
function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const base = resolveBase();
    if (!base) return reject(new Error('AGENT_BASE_EMPTY'));
    let url = base.replace(/\/+$/, '') + path;

    wx.request({
      url,
      method,
      data: data || undefined,
      timeout: TIMEOUT_MS,
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
        const err = new Error((body && body.error && body.error.message) || ('HTTP ' + res.statusCode));
        err.code = (body && body.error && body.error.code) || ('HTTP_' + res.statusCode);
        err.status = res.statusCode;
        err.hint = body && body.error && body.error.hint;
        reject(err);
      },
      fail: (e) => {
        const err = new Error((e && e.errMsg) || '网络请求失败');
        err.code = 'NETWORK_ERROR';
        reject(err);
      },
    });
  });
}

/* ============================================================
 * 本地实现（服务不可达时的降级）
 * ============================================================ */
const localImpl = {
  name: 'local',

  async digest() {
    const profile = store.getProfile();
    const matched = store.matchNotices();
    const built = push.buildPush({ profile, limit: 60 });

    // 用本地算法拼出与远端同构的结构（字段名保持一致，页面不用改）
    const toCard = (c) => ({
      id: c.id,
      title: c.title,
      score: c.pushScore,
      level: c.pushLevel,
      levelLabel: c.pushLevelLabel,
      countdown: (typeof c.countdown === 'number') ? c.countdown : null,
      deadline: c.deadline || null,
      source: c.source || c.unit || '',
      site: c.site || '',
      url: c.url || '',
      reasonLine: c.pushReasonLine || '',
      reasons: (c.pushReasons || []).map((r) => r.label || r.code),
      isNew: !!c.isNew,
      event: c.event || '',
      digestOne: c.digestOne || '',
      llm: null,
    });

    return {
      ok: true,
      source: 'local',
      via: 'local',
      meta: {
        ranAt: new Date().toISOString(),
        mode: 'rule',
        model: null,
        elapsedMs: 0,
        summaryLine: built.summary && built.summary.line,
        summaryTone: built.summary && built.summary.tone,
        counts: { matched: matched.length, cards: built.cards.length,
                  notify: built.notify.length, silent: built.silent.length },
        profile,
      },
      notify: built.notify.map(toCard),
      silent: built.silent.map(toCard),
    };
  },

  async notices(query) {
    let list = store.allNotices() || [];
    const q = (query && query.q) || '';
    if (q) {
      const low = String(q).toLowerCase();
      list = list.filter((n) => (n.title || '').toLowerCase().indexOf(low) >= 0);
    }
    const limit = (query && query.limit) || 50;
    return { ok: true, source: 'local', total: list.length, items: list.slice(0, limit) };
  },

  /** AI 推荐：本地模式不调模型，如实降级为规则推荐（与远端同构）。 */
  async recommend(query) {
    const profile = store.getProfile();
    const built = push.buildPush({ profile, limit: 60 });
    const cards = (built.notify || []).concat(built.silent || []);
    const limit = (query && query.limit) || 12;
    const picked = cards.slice(0, limit);
    const itemOf = (c) => ({
      id: c.id, title: c.title,
      score: c.pushScore, relevance: c.pushScore,
      reason: c.pushReasonLine || '', evidence: null, source: 'rule',
      level: c.pushLevel, levelLabel: c.pushLevelLabel,
      countdown: (typeof c.countdown === 'number') ? c.countdown : null,
      deadline: c.deadline || null, event: c.event || '',
      digestOne: c.digestOne || '', url: c.url || '',
      sourceUnit: c.source || c.unit || '',
    });
    return {
      ok: true, source: 'local', via: 'local',
      mode: 'rule', aiPowered: false, offline: false,
      model: null, promptVersion: null,
      reason: '本地模式不调用大模型（未部署智能体服务）',
      items: picked.map(itemOf),
      meta: {
        ranAt: new Date().toISOString(), mode: 'rule', model: null, elapsedMs: 0,
        counts: { pool: cards.length, ai: 0, rule: picked.length }, profile,
      },
    };
  },

  async understand() {
    // 本地不做真 LLM 抽取：如实返回 null（不假装）
    return { ok: true, mode: 'rule', fields: null,
             reason: '本地模式不调用大模型（未部署智能体服务）' };
  },

  async health() {
    return { ok: true, status: 'local-only', cloud: false };
  },
};

/* ============================================================
 * 远端实现（调智能体服务）
 * ============================================================ */
const remoteImpl = {
  name: 'remote',

  async digest(query) {
    const useLLM = (query && query.useLLM) ? 'true' : 'false';
    const r = await request('GET', '/api/digest?useLLM=' + useLLM);
    // 保留服务端给的数据源标识（cloud 更有信息量），但同时标注"来自远端"
    return Object.assign({}, r, { via: 'remote' });
  },

  async notices(query) {
    const qs = [];
    if (query && query.q) qs.push('q=' + encodeURIComponent(query.q));
    if (query && query.limit) qs.push('limit=' + query.limit);
    if (query && query.event) qs.push('event=' + encodeURIComponent(query.event));
    const r = await request('GET', '/api/notices' + (qs.length ? '?' + qs.join('&') : ''));
    return Object.assign({}, r, { via: 'remote' });
  },

  async recommend(query) {
    const q = query || {};
    const r = await request('POST', '/api/recommend', {
      useLLM: q.useLLM !== false,
      limit: q.limit || 12,
      profile: q.profile || undefined,
    });
    return Object.assign({}, r, { via: 'remote' });
  },

  async understand(idOrNotice, useLLM) {
    const body = (typeof idOrNotice === 'string') ? { id: idOrNotice } : { notice: idOrNotice };
    body.useLLM = useLLM !== false;
    return await request('POST', '/api/understand', body);
  },

  async health() {
    return await request('GET', '/readyz');
  },

  async run(patch) {
    return await request('POST', '/api/run', { profile: patch, useLLM: false });
  },

  async saveProfile(profile) {
    return await request('PUT', '/api/profile', { profile });
  },

  async version() {
    return await request('GET', '/api/version');
  },
};

/* ============================================================
 * 对外统一接口
 * ============================================================ */

/** 当前是否有配置远端服务 */
function isConfigured() { return !!resolveBase(); }

/**
 * 运行时改服务地址（「我的 → 智能体服务」里填写；写 storage，免发版）
 * 传空字符串 = 清回本地模式。
 */
function setBase(base) {
  const v = base ? String(base).trim().replace(/\/+$/, '') : '';
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync('agentBase', v);
  } catch (e) { /* 忽略 */ }
  try {
    const app = (typeof getApp === 'function') ? getApp() : null;
    if (app && app.globalData) app.globalData.agentBase = v;
  } catch (e) { /* 忽略 */ }
  _probe = null;   // 地址变了，探测缓存作废
  return v;
}

/**
 * 探测远端是否可达（带缓存，避免每次调用都打一次网络）。
 * @returns {Promise<{reachable:boolean, impl:object, mode:string, error?:string}>}
 */
let _probe = null;   // { at, reachable, error }
const PROBE_TTL = 30000;

async function resolveImpl(force) {
  if (!isConfigured()) return { reachable: false, impl: localImpl, mode: 'local' };
  if (!force && _probe && (Date.now() - _probe.at) < PROBE_TTL) {
    return { reachable: _probe.reachable, impl: _probe.reachable ? remoteImpl : localImpl,
             mode: _probe.reachable ? 'remote' : 'local', error: _probe.error };
  }
  try {
    await request('GET', '/healthz');
    _probe = { at: Date.now(), reachable: true, error: null };
    return { reachable: true, impl: remoteImpl, mode: 'remote' };
  } catch (e) {
    _probe = { at: Date.now(), reachable: false, error: e.message };
    return { reachable: false, impl: localImpl, mode: 'local', error: e.message };
  }
}

/**
 * 今日主动送达清单（页面主入口）。
 * 远端可达用远端（结论权威），不可达自动降级本地（保证不白屏）。
 *
 * 返回里三种"来源"标识要分清（页面据此如实告知用户）：
 *   mode   页面视角的运行模式：remote / local
 *   via    实际执行者：remote / local
 *   degraded + degradeReason  仅当**配了服务但没连上**或**远端调用失败**时出现
 */
async function digest(query) {
  const { impl, mode, error } = await resolveImpl();
  try {
    const r = await impl.digest(query);
    const out = Object.assign({ ok: true }, r, { mode });
    // 配了服务却没连上 → 明确标记降级（不能假装一切正常）
    if (mode === 'local' && isConfigured()) {
      out.degraded = true;
      out.degradeReason = error || '智能体服务不可达';
    }
    return out;
  } catch (e) {
    // 远端偶发失败 → 降级本地，并如实标注
    const r = await localImpl.digest(query);
    return Object.assign(r, {
      mode: 'local',
      degraded: true,
      degradeReason: e.message,
    });
  }
}

async function notices(query) {
  const { impl } = await resolveImpl();
  try { return await impl.notices(query); }
  catch (e) { return await localImpl.notices(query); }
}

async function understand(idOrNotice, useLLM) {
  const { impl, mode } = await resolveImpl();
  if (mode !== 'remote') return await localImpl.understand();
  try { return await impl.understand(idOrNotice, useLLM); }
  catch (e) {
    return { ok: false, mode: 'rule', fields: null,
             error: { code: e.code || 'REMOTE_ERROR', message: e.message, hint: e.hint } };
  }
}

/** AI 推荐：远端可达用模型，不可达/失败自动降级本地规则（与 digest 同语义）。 */
async function recommend(query) {
  const { impl, mode, error } = await resolveImpl();
  try {
    const r = await impl.recommend(query);
    const out = Object.assign({ ok: true }, r);
    if (mode === 'local' && isConfigured()) {
      out.degraded = true;
      out.degradeReason = error || '智能体服务不可达';
    }
    return out;
  } catch (e) {
    const r = await localImpl.recommend(query);
    return Object.assign(r, { degraded: true, degradeReason: '远端推荐失败：' + e.message });
  }
}

/**
 * 服务状态（供「我的」页如实显示"到底连没连上智能体"）
 */
async function status() {
  const base = resolveBase();
  const configured = !!base;
  const { reachable, error } = await resolveImpl(configured);
  let ready = null;
  if (reachable) {
    try { ready = await remoteImpl.health(); } catch (e) { ready = { ok: false, error: e.message }; }
  }
  let version = null;
  if (reachable) {
    try { version = await remoteImpl.version(); } catch (e) { version = null; }
  }
  return {
    configured,
    reachable,
    mode: reachable ? 'remote' : 'local',
    base: base || null,
    error: error || null,
    ready,
    version,
    // 给页面一句人话
    label: !configured ? '本地模式（未部署智能体服务）'
         : reachable ? '已连接智能体服务'
         : '服务未连接（已降级本地算法）',
  };
}

module.exports = {
  AGENT_BASE,
  resolveBase,
  setBase,
  isConfigured,
  resolveImpl,
  digest,
  recommend,
  notices,
  understand,
  status,
  // 便于测试与页面直接引用
  localImpl,
  remoteImpl,
};
