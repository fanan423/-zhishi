/**
 * 知时 · 智能体 HTTP 服务（生产级）
 * =====================================
 *
 * 【定位】
 *   把 core.js 的能力暴露成 HTTP 接口，让**任何客户端**（小程序 / 网页 / 脚本 / 第三方）
 *   都能"问它一句、拿到该主动送达的清单"。
 *   零外部依赖：只用 Node 内置 http/https/fs/path —— 不需要 express，装机即跑。
 *
 * 【为什么不用 express】
 *   本作品要能在断网答辩机上双击启动。express 要 node_modules 完整安装；
 *   内置 http 只要有 node 就能跑。少一个依赖 = 少一个答辩当天起不来的理由。
 *
 * 【接口一览】（全部 JSON in / JSON out）
 *   GET  /healthz              存活探针（不碰任何外部依赖，永远秒回）
 *   GET  /readyz               就绪探针（真探测云服务 + 通知池，慢但诚实）
 *   GET  /api/version          版本与运行环境
 *   GET  /api/notices          通知池（可筛 event / 关键词 / 分页）
 *   GET  /api/notices/:id      单条通知（含溯源与原文）
 *   GET  /api/tags             可用标签词表（供前端渲染订阅选项）
 *   GET  /api/profile          读当前/默认画像
 *   PUT  /api/profile          写画像（存内存 + 可选落盘）
 *   POST /api/understand       理解单条通知（真调大模型，可禁用）
 *   POST /api/recommend        按画像做 AI 推荐（真调大模型，失败自动降级规则）
 *   POST /api/run              跑完整一轮（六步链路）
 *   GET  /api/digest           今日主动送达清单（人可读 + 机器可读）
 *   POST /api/digest/deliver   把清单"落盘送达"（写 push_out/，返回落盘路径）
 *
 * 【生产特性】
 *   - 请求体大小上限（防打爆内存）
 *   - 每接口超时 + 整体并发闸（防大模型把服务拖死）
 *   - 结构化错误：{ ok:false, error:{ code, message, hint } }
 *   - 请求 ID 贯穿日志
 *   - CORS（默认允许，可用 AGENT_CORS_ORIGIN 收紧）
 *   - 优雅退出（SIGINT/SIGTERM 先停接新请求，再等在跑的任务）
 *
 * 【用法】
 *   node tools/agent/server.js                    # 默认 127.0.0.1:8787
 *   node tools/agent/server.js --port 8787 --host 0.0.0.0
 *   AGENT_TOKEN=xxx node tools/agent/server.js    # 开启 Bearer 鉴权
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const core = require('./core.js');
const recommendMod = require('./recommend.js');

/* ══════════════════════════════════════════════════════════
 * 配置（环境变量 > 命令行 > 默认）
 * ══════════════════════════════════════════════════════════ */
const argv = process.argv.slice(2);
function flag(n) { return argv.includes('--' + n); }
function opt(n, d) {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
}

const CONFIG = {
  port: parseInt(opt('port', process.env.AGENT_PORT || '8787'), 10),
  host: opt('host', process.env.AGENT_HOST || '127.0.0.1'),
  token: process.env.AGENT_TOKEN || '',                 // 空 = 不鉴权
  corsOrigin: process.env.AGENT_CORS_ORIGIN || '*',
  bodyLimit: parseInt(process.env.AGENT_BODY_LIMIT || '1048576', 10),   // 1 MiB
  reqTimeoutMs: parseInt(process.env.AGENT_REQ_TIMEOUT || '120000', 10),
  maxConcurrent: parseInt(process.env.AGENT_MAX_CONCURRENT || '4', 10),
  llmDefaultEnabled: process.env.AGENT_LLM_DEFAULT !== '0',             // 环境变量 0 则默认不调模型
  llmMaxBatch: parseInt(process.env.AGENT_LLM_MAX_BATCH || '20', 10),   // 单次最多理解条数
  noticeLimit: parseInt(process.env.AGENT_NOTICE_LIMIT || '500', 10),
  profileStore: opt('profile-store', process.env.AGENT_PROFILE_STORE || path.join(core.ROOT, 'push_out', 'agent_profile.json')),
  quiet: flag('quiet'),
};

const START_AT = new Date().toISOString();
const VERSION = '1.0.0';

/* 安全提示（借鉴 Augur）：默认只绑回环地址；一旦对外暴露且未开鉴权，
 * 必须显式警告，而不是默默把画像读写 / 模型调用接口开放到局域网。 */
function isLoopbackHost(h){
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}
const EXPOSED_WITHOUT_AUTH = !isLoopbackHost(CONFIG.host) && !CONFIG.token;
if (EXPOSED_WITHOUT_AUTH) {
  process.stderr.write(JSON.stringify({
    t: new Date().toISOString(), level: 'warn',
    msg: '安全警告：服务绑定非本机地址且未开启鉴权，局域网内任何人可读写画像并触发模型调用。请设置 AGENT_TOKEN 或改回 127.0.0.1。',
    extra: { host: CONFIG.host, port: CONFIG.port }
  }) + '\n');
}

/* ══════════════════════════════════════════════════════════
 * 日志（结构化，带请求 ID）
 * ══════════════════════════════════════════════════════════ */
let REQ_SEQ = 0;
function nextReqId() { return 'r' + (++REQ_SEQ).toString(36) + '-' + Date.now().toString(36); }

function log(level, reqId, msg, extra) {
  if (CONFIG.quiet && level === 'info') return;
  const line = { t: new Date().toISOString(), level, reqId: reqId || '-', msg };
  if (extra) line.extra = extra;
  const s = JSON.stringify(line);
  if (level === 'error') process.stderr.write(s + '\n');
  else process.stdout.write(s + '\n');
}

/* ══════════════════════════════════════════════════════════
 * 错误模型
 * ══════════════════════════════════════════════════════════ */
class ApiError extends Error {
  constructor(code, message, status, hint) {
    super(message);
    this.code = code;
    this.status = status || 400;
    this.hint = hint || '';
  }
}

const ERR = {
  BAD_REQUEST: (m, h) => new ApiError('BAD_REQUEST', m || '请求参数不合法', 400, h),
  NOT_FOUND: (m, h) => new ApiError('NOT_FOUND', m || '资源不存在', 404, h),
  UNAUTHORIZED: (m) => new ApiError('UNAUTHORIZED', m || '缺少或错误的访问令牌', 401,
    '请求头加 Authorization: Bearer <token>'),
  PAYLOAD_TOO_LARGE: (m) => new ApiError('PAYLOAD_TOO_LARGE', m || '请求体过大', 413),
  UPSTREAM_UNAVAILABLE: (m, h) => new ApiError('UPSTREAM_UNAVAILABLE', m || '上游（云服务/大模型）暂不可用', 503, h),
  OVERLOADED: (m) => new ApiError('OVERLOADED', m || '服务繁忙，请稍后重试', 429, '降低并发或稍后重试'),
  TIMEOUT: (m, h) => new ApiError('TIMEOUT', m || '请求处理超时', 504, h),
  INTERNAL: (m) => new ApiError('INTERNAL', m || '服务内部错误', 500),
};

/* ══════════════════════════════════════════════════════════
 * 运行时状态（进程内）
 * ══════════════════════════════════════════════════════════ */
const RUNTIME = {
  inFlight: 0,
  draining: false,
  counters: { requests: 0, errors: 0, runs: 0, llmCalls: 0 },
  lastRun: null,            // 最近一次 runOnce 结果摘要
  lastError: null,
  /* 画像：服务端跨请求共享，落盘可持久 */
  profile: null,
  profileSource: null,
};

/* 服务端专用存储：让 core 的 installHost 使用它，跨请求共享画像 */
const SERVER_STORAGE = {};
core.installHost({ storage: SERVER_STORAGE });

/* 启动时尝试恢复落盘画像 */
(function restoreProfile() {
  try {
    if (CONFIG.profileStore && fs.existsSync(CONFIG.profileStore)) {
      const j = JSON.parse(fs.readFileSync(CONFIG.profileStore, 'utf8'));
      RUNTIME.profile = j;
      RUNTIME.profileSource = 'file:' + path.relative(core.ROOT, CONFIG.profileStore);
    }
  } catch (e) { /* 忽略：用默认画像 */ }
})();

function persistProfile(p) {
  try {
    const dir = path.dirname(CONFIG.profileStore);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.profileStore, JSON.stringify(p, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

function effectiveProfile() {
  if (RUNTIME.profile) return RUNTIME.profile;
  const { profile } = core.loadProfile({});
  return profile;
}

/* ══════════════════════════════════════════════════════════
 * HTTP 小工具
 * ══════════════════════════════════════════════════════════ */
function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendError(res, reqId, err) {
  const e = (err instanceof ApiError) ? err : ERR.INTERNAL(err && err.message);
  RUNTIME.counters.errors++;
  RUNTIME.lastError = { at: new Date().toISOString(), code: e.code, message: e.message };
  log('error', reqId, e.code + ': ' + e.message);
  sendJson(res, e.status, {
    ok: false,
    error: { code: e.code, message: e.message, hint: e.hint || undefined },
    reqId,
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(ERR.PAYLOAD_TOO_LARGE()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(ERR.BAD_REQUEST('请求体不是合法 JSON：' + e.message)); }
    });
    req.on('error', (e) => reject(ERR.BAD_REQUEST('读取请求体失败：' + e.message)));
  });
}

function authGuard(req) {
  if (!CONFIG.token) return;      // 未配置 token = 不鉴权（本地开发/答辩机）
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== CONFIG.token) throw ERR.UNAUTHORIZED();
}

/* ── 参数校验小工具 ── */
function asInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}
function asBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}
function asStr(v, dflt) {
  if (v === undefined || v === null) return dflt;
  return String(v);
}
function validateProfile(p) {
  if (!p || typeof p !== 'object') throw ERR.BAD_REQUEST('profile 必须是对象');
  const out = {};
  const allow = ['identityType', 'grade', 'college', 'campus', 'major', 'interests', 'keywords', 'advance', 'channel'];
  for (const k of allow) if (p[k] !== undefined) out[k] = p[k];
  if (out.interests !== undefined && !Array.isArray(out.interests)) {
    throw ERR.BAD_REQUEST('profile.interests 必须是数组');
  }
  if (out.keywords !== undefined && !Array.isArray(out.keywords)) {
    throw ERR.BAD_REQUEST('profile.keywords 必须是数组');
  }
  if (out.interests && out.interests.length > 50) throw ERR.BAD_REQUEST('profile.interests 过多（>50）');
  if (out.keywords && out.keywords.length > 50) throw ERR.BAD_REQUEST('profile.keywords 过多（>50）');
  for (const k of ['identityType', 'grade', 'college', 'campus', 'major', 'advance', 'channel']) {
    if (out[k] !== undefined && typeof out[k] !== 'string') throw ERR.BAD_REQUEST('profile.' + k + ' 必须是字符串');
  }
  return out;
}

/* ══════════════════════════════════════════════════════════
 * 业务处理器
 * ══════════════════════════════════════════════════════════ */

/** 通知池（云端优先，结果在进程内短缓存，避免每次翻页都打云端） */
let NOTICE_CACHE = { at: 0, source: null, notices: [], warn: null };
const NOTICE_TTL_MS = parseInt(process.env.AGENT_NOTICE_TTL || '60000', 10);

async function getNotices(force) {
  if (!force && NOTICE_CACHE.notices.length && (Date.now() - NOTICE_CACHE.at) < NOTICE_TTL_MS) {
    return NOTICE_CACHE;
  }
  const loaded = await core.loadNotices({ limit: CONFIG.noticeLimit });
  NOTICE_CACHE = { at: Date.now(), source: loaded.source, notices: loaded.notices, warn: loaded.warn };
  return NOTICE_CACHE;
}

async function handleNotices(reqId, query) {
  const cache = await getNotices(asBool(query.refresh, false));
  let list = cache.notices;

  const ev = asStr(query.event, '');
  if (ev) list = list.filter((n) => n.event === ev);

  const kw = String(asStr(query.q, '')).trim();
  if (kw) {
    const low = kw.toLowerCase();
    list = list.filter((n) =>
      (n.title || '').toLowerCase().includes(low) ||
      (n.raw || '').toLowerCase().includes(low) ||
      (n.digestOne || '').toLowerCase().includes(low));
  }

  const withDeadline = asBool(query.withDeadline, false);
  if (withDeadline) list = list.filter((n) => !!n.deadline);

  const sort = asStr(query.sort, 'deadline');
  if (sort === 'deadline') {
    list = list.slice().sort((a, b) => {
      const ca = typeof a.countdown === 'number' ? a.countdown : 99999;
      const cb = typeof b.countdown === 'number' ? b.countdown : 99999;
      return ca - cb;
    });
  }

  const total = list.length;
  const offset = asInt(query.offset, 0, 0, 1e6);
  const limit = asInt(query.limit, 50, 1, 500);
  const page = list.slice(offset, offset + limit);

  return {
    ok: true,
    source: cache.source,
    warn: cache.warn || undefined,
    total,
    offset,
    limit,
    items: page.map((n) => ({
      id: n.id, title: n.title, event: n.event, deadline: n.deadline,
      countdown: n.countdown, publish: n.publish, source: n.source,
      site: n.site, unit: n.unit, url: n.url, real: n.real,
      digestOne: n.digestOne || undefined,
    })),
  };
}

async function handleNoticeById(reqId, id) {
  const cache = await getNotices(false);
  const n = cache.notices.find((x) => x.id === id);
  if (!n) throw ERR.NOT_FOUND('没有 id = ' + id + ' 的通知', '用 GET /api/notices 查看可用 id');
  return {
    ok: true,
    item: {
      id: n.id, title: n.title, event: n.event, audience: n.audience,
      deadline: n.deadline, countdown: n.countdown, publish: n.publish,
      source: n.source, site: n.site, unit: n.unit, url: n.url,
      materials: n.materials, entry: n.entry, priority: n.priority,
      digestOne: n.digestOne, digestPoints: n.digestPoints,
      raw: n.raw, real: n.real,
      llm: n.llm_fields || null,
    },
  };
}

function handleTags() {
  const tags = require(path.join(core.MP, 'utils', 'tags.js'));
  const list = (tags.TAGS || []).map((t) => ({
    key: t.key, desc: t.desc || '', icon: t.icon || '',
  }));
  return { ok: true, count: list.length, items: list };
}

async function handleUnderstand(reqId, body) {
  const id = asStr(body.id, '');
  const useLLM = asBool(body.useLLM, CONFIG.llmDefaultEnabled);
  let notice = null;

  if (id) {
    const cache = await getNotices(false);
    notice = cache.notices.find((x) => x.id === id);
    if (!notice) throw ERR.NOT_FOUND('没有 id = ' + id + ' 的通知');
  } else if (body.notice && typeof body.notice === 'object') {
    const n = body.notice;
    if (!n.title && !n.raw) throw ERR.BAD_REQUEST('body.notice 至少要给 title 或 raw');
    notice = core.normalizeRow({
      id: n.id || 'adhoc-' + Date.now(),
      title: n.title, raw: n.raw, digest_one: n.digestOne,
      event: n.event, deadline: n.deadline, source: n.source, url: n.url,
    });
  } else {
    throw ERR.BAD_REQUEST('需要 body.id 或 body.notice', '例：{"id":"ahau-026"} 或 {"notice":{"title":"…","raw":"…"}}');
  }

  if (!useLLM) {
    return {
      ok: true, model: null, mode: 'rule',
      reason: '未启用大模型（useLLM=false）',
      fields: null,
    };
  }

  if (!core.cloudAvailable()) {
    throw ERR.UPSTREAM_UNAVAILABLE('云服务不可用，无法调用大模型',
      '检查 node_modules 是否装了 @tencent-ai/workbuddy-cloud-sdk，且 miniprogram/utils/cloud.js 里 publicConfig 有值');
  }

  const r = await core.understand([notice], { limit: 1, persistMemory: true });
  RUNTIME.counters.llmCalls += r.tried || 0;

  if (!r.ok) {
    throw ERR.UPSTREAM_UNAVAILABLE('理解失败：' + (r.reason || '未知原因'),
      '可稍后重试；或改用 POST /api/run 走规则版理解');
  }
  const first = (r.results || [])[0];
  if (!first || !first.ok) {
    return {
      ok: true, model: r.model, mode: 'llm', success: false,
      error: first ? first.error : '模型未返回结果',
      fields: null,
    };
  }
  return {
    ok: true, model: r.model, modelName: r.modelName, mode: 'llm', success: true,
    noticeId: notice.id, fields: first.fields,
  };
}

async function handleRun(reqId, body) {
  if (RUNTIME.inFlight >= CONFIG.maxConcurrent) throw ERR.OVERLOADED();
  RUNTIME.inFlight++;
  const t0 = Date.now();
  try {
    const profile = body.profile ? validateProfile(body.profile) : undefined;
    const useLLM = asBool(body.useLLM, CONFIG.llmDefaultEnabled);
    let llmLimit = asInt(body.llmLimit, 8, 0, CONFIG.llmMaxBatch);

    const useProfile = (profile && Object.keys(profile).length)
      ? Object.assign({}, effectiveProfile(), profile)
      : effectiveProfile();

    const r = await core.withTimeout(
      core.runOnce({
        profile: useProfile,
        useLLM,
        llmLimit,
        persistMemory: asBool(body.persistMemory, true),
      }),
      CONFIG.reqTimeoutMs, 'api.run');

    RUNTIME.counters.runs++;
    RUNTIME.lastRun = {
      at: r.ranAt, mode: r.mode, pool: r.pool, matched: r.matched,
      notify: r.notify.length, elapsedMs: r.elapsedMs,
    };
    log('info', reqId, 'run done', { mode: r.mode, notify: r.notify.length, ms: Date.now() - t0 });
    return { ok: true, source: (r.steps.load && r.steps.load.source) || 'unknown', ...r };
  } finally {
    RUNTIME.inFlight--;
  }
}

async function handleDigest(reqId, query) {
  const useLLM = asBool(query.useLLM, CONFIG.llmDefaultEnabled);
  const profile = RUNTIME.profile || core.loadProfile({}).profile;

  const r = await core.withTimeout(
    core.runOnce({ profile, useLLM, llmLimit: asInt(query.llmLimit, 6, 0, CONFIG.llmMaxBatch) }),
    CONFIG.reqTimeoutMs, 'api.digest');

  const lines = [];
  lines.push('知时 · 今日主动送达清单');
  lines.push('生成时间：' + r.ranAt);
  lines.push('模式：' + (r.mode === 'llm' ? '真·大模型理解（' + r.model + '）+ 规则打分' : '规则版理解（未调模型）'));
  lines.push('画像：' + r.profile.identityType + ' · ' + r.profile.grade + ' · ' + r.profile.college);
  lines.push('口径：' + r.summaryLine);
  lines.push('');
  if (!r.notify.length) {
    lines.push('（今天没有需要打扰的通知 —— 静默也是设计的一部分）');
  } else {
    r.notify.forEach((c, i) => {
      lines.push('【' + (i + 1) + '】' + c.title);
      lines.push('    分数：' + c.score + ' 分 · 等级：' + c.levelLabel);
      lines.push('    来源：' + (c.source || '-') + ' · 倒计时：' +
        (typeof c.countdown === 'number' ? c.countdown + ' 天' : '无截止'));
      lines.push('    凭什么推：' + (c.reasonLine || '-'));
      lines.push('    全部理由：' + (c.reasons || []).join(' + '));
      if (c.url) lines.push('    原文：' + c.url);
      lines.push('');
    });
  }
  lines.push('静默进流（不打扰，但已备好）：' + r.silent.length + ' 条');

  return {
    ok: true,
    source: (r.steps.load && r.steps.load.source) || 'unknown',
    via: 'remote',
    meta: {
      ranAt: r.ranAt, mode: r.mode, model: r.model, elapsedMs: r.elapsedMs,
      summaryLine: r.summaryLine, summaryTone: r.summaryTone,
      counts: { pool: r.pool, passed: r.passed, matched: r.matched, cards: r.cards,
                notify: r.notify.length, silent: r.silent.length },
      profile: r.profile,
      understand: r.steps.understand,
    },
    notify: r.notify,
    silent: r.silent,
    text: lines.join('\n'),
  };
}

/**
 * AI 推荐（POST /api/recommend）
 * ----------------------------------------------------------------
 * 设计要点：
 *   ① 规则结果**始终先算**，既是降级保底，也是模型的候选池来源；
 *   ② 模型只对候选池前 N 条做「通知 × 画像」相关性判断，产出分 + 理由 + 逐字引文；
 *   ③ 模型不可用 / 全失败 → 如实返回 mode=rule + degraded，绝不拿规则分冒充模型分；
 *   ④ 成功时按 relevance 重排，但**保留规则分 score** 供对照与可解释性；
 *   ⑤ 每次运行写 push_out/ai_recommend_run.json，可逐条举证。
 *
 * 入参：{ useLLM?:bool, limit?:1..20, profile?:{...} }
 */
async function handleRecommend(reqId, body) {
  const useLLM = asBool(body.useLLM, CONFIG.llmDefaultEnabled);
  const limit = asInt(body.limit, 12, 1, CONFIG.llmMaxBatch);

  let profile;
  try {
    profile = body.profile
      ? validateProfile(body.profile)
      : (RUNTIME.profile || core.loadProfile({}).profile);
  } catch (e) {
    throw ERR.BAD_REQUEST('画像不合法：' + (e && e.message));
  }

  /* 规则基线：与 /api/digest 同源，保证两种模式口径一致 */
  const base = await handleDigest(reqId, { useLLM: 'false', llmLimit: '0' });
  const cards = (base.notify || []).concat(base.silent || []);
  const full = (await getNotices(false)).notices || [];
  const rawById = {};
  full.forEach((n) => { rawById[String(n.id)] = n; });

  const toItem = (c, ai) => ({
    id: c.id,
    title: c.title,
    score: c.score,                                   // 规则分，保留可对照
    relevance: ai ? ai.relevance : c.score,
    reason: ai ? ai.reason : (c.reasonLine || ''),
    evidence: ai ? ai.evidence : null,
    source: ai ? 'llm' : 'rule',
    level: c.level,
    levelLabel: c.levelLabel,
    countdown: c.countdown,
    deadline: c.deadline,
    event: c.event || '',
    digestOne: c.digestOne || '',
    url: c.url || '',
    sourceUnit: c.source || '',
  });

  /* limit 同时约束「返回条数」与「模型判断条数」，两端契约一致 */
  const scoped = cards.slice(0, limit);
  const ruleItems = scoped.map((c) => toItem(c, null));
  const meta = {
    ranAt: new Date().toISOString(),
    profile,
    counts: { pool: cards.length, returned: scoped.length, ai: 0, rule: scoped.length },
  };

  if (!useLLM) {
    return {
      ok: true, mode: 'rule', aiPowered: false, via: 'remote',
      model: null, promptVersion: null,
      reason: '未启用大模型（useLLM=false）',
      items: ruleItems, meta,
    };
  }
  if (!core.cloudAvailable()) {
    return {
      ok: true, mode: 'rule', aiPowered: false, via: 'remote',
      degraded: true, degradeReason: '云服务不可用，已降级规则推荐',
      model: null, promptVersion: null, items: ruleItems, meta,
    };
  }

  /* 候选：规则排序靠前的 N 条，补上原文供模型逐字引用 */
  const candidates = scoped.map((c) => {
    const f = rawById[String(c.id)] || {};
    return {
      id: c.id, title: c.title,
      event: c.event || f.event,
      deadline: c.deadline || f.deadline,
      countdown: c.countdown,
      audience: f.audience || null,
      raw: f.raw || f.digest || c.digestOne || '',
      digestOne: c.digestOne || '',
      llm_fields: f.llm_fields || null,
    };
  });

  const r = await core.withTimeout(
    recommendMod.recommend(candidates, profile, { limit }),
    CONFIG.reqTimeoutMs, 'api.recommend'
  );
  RUNTIME.counters.llmCalls += r.tried || 0;
  recommendMod.writeRunLog(r, profile);

  if (!r.ok || r.mode !== 'llm' || r.okCount === 0) {
    return {
      ok: true, mode: 'rule', aiPowered: false, via: 'remote',
      degraded: true,
      degradeReason: (r.reason || '模型未返回有效结果') + '，已降级规则推荐',
      model: r.model || null, promptVersion: r.promptVersion,
      items: ruleItems,
      meta: Object.assign({}, meta, {
        llmAttempt: { tried: r.tried, okCount: r.okCount, failed: r.failed, elapsedMs: r.elapsedMs },
      }),
    };
  }

  const aiById = {};
  r.results.forEach((x) => { if (x.ok) aiById[String(x.id)] = x; });
  const items = scoped.map((c) => toItem(c, aiById[String(c.id)] || null));
  items.sort((a, b) => b.relevance - a.relevance);
  const aiCount = items.filter((x) => x.source === 'llm').length;

  log('info', reqId, 'recommend done', {
    mode: 'llm', model: r.model, tried: r.tried, okCount: r.okCount,
    ms: r.elapsedMs,
  });
  return {
    ok: true, mode: 'llm', aiPowered: true, via: 'remote',
    model: r.model, modelName: r.modelName, promptVersion: r.promptVersion,
    items,
    meta: Object.assign({}, meta, {
      ranAt: r.ranAt, elapsedMs: r.elapsedMs,
      counts: { pool: cards.length, returned: items.length, ai: aiCount, rule: items.length - aiCount },
      llmAttempt: { tried: r.tried, okCount: r.okCount, failed: r.failed },
    }),
  };
}

async function handleDeliver(reqId, body) {
  const useLLM = asBool(body.useLLM, false);
  const digest = await handleDigest(reqId, { useLLM: String(useLLM), llmLimit: String(body.llmLimit || 6) });

  const outDir = path.join(core.ROOT, 'push_out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  /* 文件名刻意与 CLI 的产物**分开**：
   *   CLI（tools/agent.js）      → agent_run.json（runOnce 六步结构，含 pool/passed/matched/mode）
   *   服务端（本文件）           → agent_deliver.json（/api/digest 的响应结构，含 text 全文）
   * 早期两者写同一个文件，导致"谁后跑谁的格式覆盖谁" ——
   * 参赛自检读 agent_run.json 时会因为跑过一次服务而被写成另一种结构。
   * 这是真踩到的坑，故物理分家，谁也别覆盖谁。 */
  const txtPath = path.join(outDir, '今日推送.txt');
  const jsonPath = path.join(outDir, 'agent_deliver.json');
  const snapPath = path.join(outDir, '推送记录_' + stamp + '.txt');

  fs.writeFileSync(txtPath, digest.text, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(digest, null, 2), 'utf8');
  fs.writeFileSync(snapPath, digest.text, 'utf8');

  log('info', reqId, 'delivered', { notify: digest.notify.length });
  return {
    ok: true,
    delivered: digest.notify.length,
    files: {
      latest: path.relative(core.ROOT, txtPath),
      machine: path.relative(core.ROOT, jsonPath),
      snapshot: path.relative(core.ROOT, snapPath),
    },
    text: digest.text,
  };
}

function handleHealth() {
  return { ok: true, status: 'alive', uptimeSec: Math.round(process.uptime()), at: new Date().toISOString() };
}

async function handleReady() {
  const checks = {};
  // 云服务
  checks.cloud = { ok: core.cloudAvailable() };
  // 通知池（真读一次）
  try {
    const cache = await getNotices(true);
    checks.notices = { ok: cache.notices.length > 0, count: cache.notices.length, source: cache.source, warn: cache.warn || undefined };
  } catch (e) {
    checks.notices = { ok: false, error: e.message };
  }
  // 同源算法
  try {
    const s = core.matchAndScore(effectiveProfile(), {});
    checks.engine = { ok: true, matched: s.matched.length };
  } catch (e) {
    checks.engine = { ok: false, error: e.message };
  }
  const allOk = Object.values(checks).every((c) => c.ok);
  return { ok: allOk, checks, at: new Date().toISOString() };
}

function handleVersion() {
  return {
    ok: true,
    name: '知时·智能体服务',
    version: VERSION,
    node: process.version,
    startedAt: START_AT,
    uptimeSec: Math.round(process.uptime()),
    config: {
      host: CONFIG.host, port: CONFIG.port,
      auth: CONFIG.token ? 'bearer' : 'none',
      llmDefaultEnabled: CONFIG.llmDefaultEnabled,
      noticeLimit: CONFIG.noticeLimit,
    },
    capabilities: {
      notices: true, tags: true, understand: core.cloudAvailable(),
      run: true, digest: true, deliver: true,
      recommend: core.cloudAvailable(),
    },
  };
}

function handleProfileGet() {
  const p = effectiveProfile();
  return { ok: true, profile: p, source: RUNTIME.profileSource || 'default' };
}

function handleProfilePut(reqId, body) {
  const patch = validateProfile(body.profile || body);
  const next = Object.assign({}, effectiveProfile(), patch);
  RUNTIME.profile = next;
  RUNTIME.profileSource = 'runtime';
  const persisted = persistProfile(next);
  // 同步进 core 的存储，让 matchAndScore 立即生效
  core.activateProfile(next);
  return { ok: true, profile: next, persisted };
}

/* ══════════════════════════════════════════════════════════
 * 路由
 * ══════════════════════════════════════════════════════════ */
const ROUTES = {
  'GET /healthz': (reqId) => handleHealth(),
  'GET /readyz': (reqId) => handleReady(),
  'GET /api/version': (reqId) => handleVersion(),
  'GET /api/notices': (reqId, body, query) => handleNotices(reqId, query),
  'GET /api/tags': (reqId) => handleTags(),
  'GET /api/profile': (reqId) => handleProfileGet(),
  'PUT /api/profile': (reqId, body) => handleProfilePut(reqId, body),
  'POST /api/understand': (reqId, body) => handleUnderstand(reqId, body),
  'POST /api/run': (reqId, body) => handleRun(reqId, body),
  'GET /api/digest': (reqId, body, query) => handleDigest(reqId, query),
  'POST /api/digest/deliver': (reqId, body) => handleDeliver(reqId, body),
  'POST /api/recommend': (reqId, body) => handleRecommend(reqId, body),
};

function matchRoute(method, pathname) {
  // 精确
  const key = method + ' ' + pathname;
  if (ROUTES[key]) return { handler: ROUTES[key], params: {} };
  // /api/notices/:id
  const m = pathname.match(/^\/api\/notices\/([^\/]+)$/);
  if (m && method === 'GET') {
    return { handler: (reqId) => handleNoticeById(reqId, decodeURIComponent(m[1])), params: { id: m[1] } };
  }
  return null;
}

const DOC_INDEX = () => ({
  ok: true,
  service: '知时·智能体服务',
  version: VERSION,
  endpoints: Object.keys(ROUTES).concat(['GET /api/notices/:id']),
  docs: 'docs/智能体接入与部署.md',
  health: ['GET /healthz', 'GET /readyz'],
});

/* ══════════════════════════════════════════════════════════
 * 服务器
 * ══════════════════════════════════════════════════════════ */
const server = http.createServer(async (req, res) => {
  const reqId = nextReqId();
  RUNTIME.counters.requests++;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', CONFIG.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Request-Id', reqId);

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  // 整体请求超时
  const killer = setTimeout(() => {
    if (!res.headersSent) sendError(res, reqId, ERR.TIMEOUT('请求超过 ' + CONFIG.reqTimeoutMs + ' ms'));
  }, CONFIG.reqTimeoutMs);
  res.on('close', () => clearTimeout(killer));

  try {
    if (RUNTIME.draining) throw ERR.OVERLOADED('服务正在关闭，不再接受新请求');

    // 根路径：接口索引（方便人手探）
    if (req.method === 'GET' && (pathname === '/' || pathname === '/api')) {
      clearTimeout(killer);
      return sendJson(res, 200, DOC_INDEX());
    }

    const route = matchRoute(req.method, pathname);
    if (!route) {
      throw ERR.NOT_FOUND('没有这个接口：' + req.method + ' ' + pathname,
        'GET / 可看全部接口清单');
    }

    // 鉴权（健康探针豁免，方便负载均衡探测）
    if (pathname !== '/healthz' && pathname !== '/readyz') authGuard(req);

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readBody(req, CONFIG.bodyLimit);
    }

    const result = await route.handler(reqId, body, query);
    clearTimeout(killer);
    if (!res.headersSent) sendJson(res, 200, result);
  } catch (e) {
    clearTimeout(killer);
    if (!res.headersSent) sendError(res, reqId, e);
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

/* 优雅退出 */
function shutdown(signal) {
  if (RUNTIME.draining) return;
  RUNTIME.draining = true;
  log('info', '-', '收到 ' + signal + '，停止接受新请求…', { inFlight: RUNTIME.inFlight });
  server.close(() => {
    log('info', '-', '服务已关闭');
    process.exit(0);
  });
  // 兜底：10 秒内没退就强退（避免在跑的长任务无限拖）
  setTimeout(() => {
    log('error', '-', '优雅退出超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(CONFIG.port, CONFIG.host, () => {
  log('info', '-', '知时·智能体服务已启动', {
    url: 'http://' + CONFIG.host + ':' + CONFIG.port,
    version: VERSION,
    node: process.version,
    auth: CONFIG.token ? 'bearer' : 'none',
    cloud: core.cloudAvailable(),
  });
  if (!CONFIG.quiet) {
    process.stdout.write(
      '\n  知时·智能体服务 v' + VERSION + '\n' +
      '  ─────────────────────────────────────\n' +
      '  地址    http://' + CONFIG.host + ':' + CONFIG.port + '\n' +
      '  接口    http://' + CONFIG.host + ':' + CONFIG.port + '/  （索引）\n' +
      '  健康    http://' + CONFIG.host + ':' + CONFIG.port + '/healthz\n' +
      '  就绪    http://' + CONFIG.host + ':' + CONFIG.port + '/readyz\n' +
      '  云端    ' + (core.cloudAvailable() ? '可用' : '不可用（降级本地池）') + '\n' +
      '  鉴权    ' + (CONFIG.token ? 'Bearer（已开启）' : (EXPOSED_WITHOUT_AUTH ? '未开启（⚠ 对外暴露）' : '未开启（本地模式）')) + '\n' +
      '  ─────────────────────────────────────\n' +
      '  Ctrl+C 优雅退出\n\n'
    );
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log('error', '-', '端口 ' + CONFIG.port + ' 已被占用', { hint: '换端口：--port 8788' });
  } else {
    log('error', '-', '服务启动失败：' + e.message);
  }
  process.exit(1);
});

module.exports = { server, CONFIG, RUNTIME };
