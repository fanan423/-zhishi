/**
 * 知时 · 智能体核心引擎（core）
 * ==================================
 *
 * 【这一层存在的理由】
 *   生产环境里，"智能体"必须是**一个能力**，而不是**一个脚本**。
 *   脚本只能人守着一行命令跑；能力才能被 CLI 调、被 HTTP 服务调、被小程序调。
 *   所以本文件把六步链路抽成纯粹的**函数**，不含任何 console 输出、不含任何
 *   进程退出逻辑 —— 输出与进程控制交给上层（cli.js / server.js）。
 *
 * 【六步链路】（每一步都可单独调用，也可整链 runOnce）
 *   ① loadNotices   载入通知池（云端优先，失败降级本地）
 *   ② gateNotices   两道入库闸门（时效 + 价值过滤）
 *   ③ loadProfile   装载用户画像（记忆 > 显式入参 > 内置默认）
 *   ④ understand    真调大模型理解（记忆命中则不调；JSON 容错抠取）
 *   ⑤ matchAndScore 匹配 + 打分 + 分级（复用小程序同源算法）
 *   ⑥ decide        决策：该主动送达的 / 静默进流的
 *
 * 【同源不变式】
 *   ⑤ 的匹配与打分**直接 require 小程序 utils/store.js + push.js**，
 *   不重写一份。所以服务端结论与小程序里看到的必然一致。
 *   tools/checks/check_parity.py 与 check_agent_service.js 共同守卫这一点。
 *
 * 【合规】
 *   只读公网公开数据的云端副本；只把**通知原文**发给大模型做结构化抽取；
 *   绝不发送任何个人私域数据（画像只用于本地匹配，不出本机/不出服务进程）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');

/* ══════════════════════════════════════════════════════════
 * 一、宿主适配层
 * ----------------------------------------------------------
 * 小程序 utils/*.js 依赖全局 wx 与 getApp。Node 端没有，
 * 所以这里搭一个**最小宿主桩**，让同一份算法能在 Node 里跑。
 * ══════════════════════════════════════════════════════════ */

/** 内存存储（进程内），实现 wx storage 三件套 */
function createMemStore() {
  return {};
}

let HOST_INSTALLED = false;
let MEM = null;

/**
 * 安装宿主桩。幂等：重复调用不会覆盖已注入的真实存储。
 * @param {object} [opts] { storage: 外部存储对象（可选，给服务端做跨请求共享） }
 */
function installHost(opts) {
  const o = opts || {};
  if (HOST_INSTALLED) return;
  MEM = o.storage || createMemStore();

  global.wx = {
    getStorageSync: (k) => (k in MEM ? MEM[k] : ''),
    setStorageSync: (k, v) => { MEM[k] = v; },
    removeStorageSync: (k) => { delete MEM[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(MEM) }),
    request: () => {},
    showToast: () => {},
    hideToast: () => {},
    getSystemInfoSync: () => ({ platform: 'node' }),
    getAccountInfoSync: () => ({ miniProgram: { appId: 'node-server', envVersion: 'release' } }),
    setClipboardData: () => {},
    navigateTo: () => {},
    navigateToMiniProgram: () => {},
    getRandomValues: (n) => {
      const b = Buffer.alloc(n);
      // 用 crypto 保证真随机（state 生成需要）
      try { require('crypto').randomFillSync(b); } catch (e) {
        for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
      }
      return new Uint8Array(b);
    },
  };

  /**
   * store.js 的 profileDefaults() 会读 getApp().globalData.profile。
   * globalData.profile 故意留空 → 让 store 回落到它自己的内置默认值；
   * 真正的画像由 loadProfile() 拿到后经 store.saveProfile() 写进存储，
   * 于是 store.getProfile() 读到的就是本轮用的那份画像（单一事实源）。
   */
  global.getApp = () => ({
    globalData: {},
    onLaunch: () => {},
    onShow: () => {},
    onHide: () => {},
    onError: () => {},
  });

  HOST_INSTALLED = true;
}

/** 惰性 require 同源算法（必须 installHost 之后才能 require，否则 store.js 顶部会炸） */
let _store = null;
let _push = null;
function store() { if (!_store) _store = require(path.join(MP, 'utils', 'store.js')); return _store; }
function push() { if (!_push) _push = require(path.join(MP, 'utils', 'push.js')); return _push; }

/* ══════════════════════════════════════════════════════════
 * 二、云服务客户端（惰性 + 单例）
 * ══════════════════════════════════════════════════════════ */

function loadPublicConfig() {
  /* 配置外置（对应评估报告 P2）：密钥不再硬编码在会进提交包的 cloud.js 里。
   * 优先级：环境变量 > config/cloud.local.json > 回退到 cloud.js 正则（兼容旧部署）。
   * config/cloud.local.json 已被 .gitignore 与 pack_submission.py 排除。 */
  if (process.env.ZHISHI_CLOUD_ENDPOINT && process.env.ZHISHI_CLOUD_KEY) {
    return {
      endpoint: process.env.ZHISHI_CLOUD_ENDPOINT,
      publishableKey: process.env.ZHISHI_CLOUD_KEY,
      workBuddyOAuthClientId: process.env.ZHISHI_CLOUD_CLIENT_ID || undefined,
    };
  }
  const local = path.join(ROOT, 'config', 'cloud.local.json');
  if (fs.existsSync(local)) {
    try {
      const j = JSON.parse(fs.readFileSync(local, 'utf8'));
      if (j.endpoint && j.publishableKey) {
        return {
          endpoint: j.endpoint,
          publishableKey: j.publishableKey,
          workBuddyOAuthClientId: j.workBuddyOAuthClientId || undefined,
        };
      }
    } catch (_) { /* 配置损坏则继续回退 */ }
  }
  /* 兼容回退：旧版本把值直接写在 cloud.js 里 */
  const f = path.join(MP, 'utils', 'cloud.js');
  const src = fs.readFileSync(f, 'utf8');
  const ep = src.match(/endpoint:\s*'([^']+)'/);
  const pk = src.match(/publishableKey:\s*'([^']+)'/);
  const oid = src.match(/workBuddyOAuthClientId:\s*'([^']+)'/);
  if (!ep || !pk || !pk[1]) return null;
  return {
    endpoint: ep[1],
    publishableKey: pk[1],
    workBuddyOAuthClientId: oid ? oid[1] : undefined,
  };
}

let _cloud = null;
function cloudClient() {
  if (_cloud !== null) return _cloud || null;
  try {
    const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');
    const cfg = loadPublicConfig();
    if (!cfg) { _cloud = false; return null; }
    _cloud = createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      publishableKey: cfg.publishableKey,
    });
    return _cloud;
  } catch (e) {
    _cloud = false;
    return null;
  }
}

/** 云端是否可用（真探测过一次，不是猜） */
function cloudAvailable() { return !!cloudClient(); }

/* ══════════════════════════════════════════════════════════
 * 三、工具函数
 * ══════════════════════════════════════════════════════════ */

/** 超时包装：任何外部调用都不许无限挂着（生产红线） */
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('TIMEOUT:' + (label || 'op') + ' exceeded ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/** 带指数退避的重试 */
async function withRetry(fn, { tries = 3, base = 300, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, base * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/**
 * 从模型输出里"尽力"抠出一个合法 JSON 对象。
 * 真实模型（流式 + 中文长文本）常见三种脏输出：
 *   ① 包了 ```json 代码围栏  ② 前后带解释性散文  ③ 被 max_tokens 截断（右括号缺失）
 * 由严到松多级尝试，**绝不静默编造**：抠不出来就老实返回 null。
 */
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try { return JSON.parse(s); } catch (e) {}

  const start = s.indexOf('{');
  if (start < 0) return null;

  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const cand = end > 0 ? s.slice(start, end + 1) : s.slice(start);
  try { return JSON.parse(cand); } catch (e) {}

  /* ── 截断修复（逐级，只补结构、绝不补内容）──────────────────
   * 顺序很关键：**先闭合字符串，再补括号**。
   * 顺序反了会把"未收尾的中文摘要"当成坏值整段砍掉，白丢一段已抽出的内容。
   * 每一级修完就试一次 parse，成功即返回；全败则返回 null（合规降级，让上层重试）。 */

  function tryFix(base) {
    let f = base;
    // ① 去尾随逗号 / 悬空冒号
    f = f.replace(/[,:]\s*$/, '');
    // ② 若末尾有未闭合的字符串 → 补引号
    const unescaped = f.replace(/\\\\/g, '').replace(/\\"/g, '');
    if ((unescaped.match(/"/g) || []).length % 2 === 1) f += '"';
    // ③ 先补数组再补对象（内层先闭合）
    const needBrack = (f.match(/\[/g) || []).length - (f.match(/\]/g) || []).length;
    for (let i = 0; i < needBrack; i++) f += ']';
    const needBrace = (f.match(/{/g) || []).length - (f.match(/}/g) || []).length;
    for (let i = 0; i < needBrace; i++) f += '}';
    return JSON.parse(f);
  }

  // 级 1：直接补（覆盖"缺尾括号""悬空值"两类）
  try { return tryFix(cand); } catch (e) {}

  // 级 2：丢掉最后一个不完整的键值对，再补（覆盖"值本身截断成半截字符串"）
  let base = cand;
  for (let guard = 0; guard < 5; guard++) {
    const cut = base.lastIndexOf(',');
    if (cut <= 0) break;
    base = base.slice(0, cut);
    try { return tryFix(base); } catch (e) {}
  }

  return null;
}

/** FNV-1a 哈希：用于"原文变了才重理解"的失效检测 */
function bodyHash(n) {
  const s = String(n.title || '') + '\u0000' + String(n.raw || n.digest || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/* ══════════════════════════════════════════════════════════
 * 四、持久记忆
 * ══════════════════════════════════════════════════════════ */

const MEMORY_FILE = () => path.join(ROOT, 'push_out', 'agent_memory.json');

function loadMemory(file) {
  const f = file || MEMORY_FILE();
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (e) {}
  return {};
}

function saveMemory(mem, file) {
  const f = file || MEMORY_FILE();
  try {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(mem, null, 1), 'utf8');
    return true;
  } catch (e) { return false; }
}

/** 把记忆命中挂到通知对象上（与本次新理解的结果同构） */
function applyMemory(notices, mem) {
  let hit = 0;
  for (const n of notices) {
    const m = mem[n.id];
    if (m && m.hash === bodyHash(n) && m.fields) {
      n.llm_fields = m.fields;
      n.llm_from = 'memory';
      hit++;
    }
  }
  return hit;
}

/* ══════════════════════════════════════════════════════════
 * 五、① 载入通知池
 * ══════════════════════════════════════════════════════════ */

/**
 * 归一化云端行 → 通知对象（字段口径与 store.js 完全一致）。
 * 云端返回的是 snake_case，小程序内部用 camelCase 的 publish/digestOne…
 */
function normalizeRow(r) {
  const fmt = (s) => (s ? String(s).slice(0, 10) : '');
  const deadline = fmt(r.deadline);
  let cd = r.countdown;
  if (typeof cd !== 'number') {
    cd = deadline ? (() => {
      const d = new Date(deadline + 'T00:00:00');
      if (isNaN(d.getTime())) return null;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return Math.round((d - today) / 86400000);
    })() : null;
  }
  return {
    id: r.id,
    real: r.real !== false,
    source: r.source || '',
    publish: fmt(r.publish_date),
    publishDate: fmt(r.publish_date),
    title: r.title || '',
    event: r.event || '校内通知',
    audience: r.audience || '',
    deadline,
    countdown: typeof cd === 'number' ? cd : null,
    materials: r.materials || '',
    entry: r.entry || '',
    confidence: r.confidence,
    priority: r.priority || '',
    points: r.points || [],
    digestOne: r.digest_one || '',
    digestPoints: r.digest_points || [],
    raw: r.raw || '',
    url: r.url || '',
    site: r.site || '',
    unit: r.unit || '',
  };
}

/**
 * 载入通知池。**云端优先，失败降级本地**（可降级适配）。
 *
 * @param {object} [opts]
 *   notices        显式注入（最高优先级，测试常用）
 *   source         'cloud' | 'local' | 'merge'（默认 merge）
 *   preferCloud    是否尝试云端（默认 true）
 *   limit          云端拉取上限
 *
 * 数据源语义（重要）：
 *   cloud  —— 只信任云端（33 条真实采集，口径最严）
 *   local  —— 只用打包进代码的本地池（123 条，面试/断网用）
 *   merge  —— 云端 ∪ 本地（默认）。理由：云端是"近期真采集"，本地是
 *             "历史积累 + 决赛演示兜底"。**并集才能既不漏新、又不丢旧**。
 *             同 id 以云端为准（云端更新）。
 * @returns {{notices:Array, source:'cloud'|'local'|'merge', warn:string|null, count:number, detail:object}}
 */
async function loadNotices(opts) {
  const o = opts || {};
  installHost(o.host);

  // 显式传入的池（最高优先级，测试常用）
  if (Array.isArray(o.notices)) {
    return { notices: o.notices, source: 'injected', warn: null, count: o.notices.length, detail: {} };
  }

  const mode = o.source || process.env.AGENT_SOURCE || 'merge';
  let cloudRows = null;
  let cloudErr = null;

  if (o.preferCloud !== false && mode !== 'local') {
    const cloud = cloudClient();
    if (cloud) {
      try {
        const res = await withRetry(
          () => withTimeout(
            cloud.database.from('zhishi_notices').select('*')
              .order('publish_date', { ascending: false }).limit(o.limit || 500),
            o.timeout || 15000, 'notices.select'),
          { tries: o.retries == null ? 2 : o.retries, label: 'notices' });
        const rows = (res && res.data) || [];
        if (rows.length) {
          cloudRows = rows.map(normalizeRow);
          if (res && res.error) cloudErr = res.error.code || res.error.message;
        }
      } catch (e) {
        cloudErr = e && e.message;
      }
    } else {
      cloudErr = '云服务不可用（SDK 未安装或 publicConfig 缺失）';
    }
  }

  const local = localNotices();

  // cloud only
  if (mode === 'cloud') {
    if (cloudRows && cloudRows.length) {
      return { notices: cloudRows, source: 'cloud', warn: cloudErr, count: cloudRows.length,
               detail: { cloud: cloudRows.length, local: 0 } };
    }
    return { notices: local, source: 'local',
             warn: cloudErr ? ('云端不可用，已降级本地：' + cloudErr) : '云端无数据，已降级本地',
             count: local.length, detail: { cloud: 0, local: local.length } };
  }

  // local only
  if (mode === 'local') {
    return { notices: local, source: 'local', warn: null, count: local.length,
             detail: { cloud: 0, local: local.length } };
  }

  // merge（默认）：云端 ∪ 本地，同 id 以云端为准
  if (cloudRows && cloudRows.length) {
    const byId = {};
    local.forEach((n) => { byId[n.id] = n; });
    cloudRows.forEach((n) => { byId[n.id] = n; });       // 云端覆盖同 id
    const merged = Object.values(byId);
    return { notices: merged, source: 'merge', warn: cloudErr, count: merged.length,
             detail: { cloud: cloudRows.length, local: local.length, merged: merged.length } };
  }

  return { notices: local, source: 'local',
           warn: cloudErr ? ('云端不可用，仅用本地池：' + cloudErr) : null,
           count: local.length, detail: { cloud: 0, local: local.length } };
}

function localNotices() {
  installHost();
  // 本地池 = store 已加载的那一份（已过自查闸门 + 倒计时刷新）
  try { return store().allNotices() || []; } catch (e) { return []; }
}

/* ══════════════════════════════════════════════════════════
 * 六、② 两道入库闸门
 * ══════════════════════════════════════════════════════════ */

const FRESH_AFTER = '2025-01-01';
const LOW_VALUE_RE = /(招聘会|招标|采购公告|询价|中标|废标|项目验收)/;
const NONSTUDENT_NEWS_RE = /(校领导|党委常委会|理论学习|巡视|巡察|民主生活会)/;

function gateOne(n) {
  const reasons = [];
  const pd = n.publish || n.publish_date || n.date || '';
  if (pd && pd < FRESH_AFTER) reasons.push('时效闸门：发布日早于 ' + FRESH_AFTER);
  const t = (n.title || '') + (n.digest || '') + (n.raw || '');
  if (LOW_VALUE_RE.test(t)) reasons.push('价值过滤：命中低价值规则');
  if (NONSTUDENT_NEWS_RE.test(t)) reasons.push('价值过滤：命中非学生事项规则');
  return { pass: reasons.length === 0, reasons };
}

/**
 * @returns {{passed:Array, gated:Array, blocked:number}}
 */
function gateNotices(notices) {
  const passed = [];
  const gated = [];
  for (const n of notices || []) {
    const g = gateOne(n);
    if (g.pass) passed.push(n); else gated.push({ id: n.id, title: n.title, reasons: g.reasons });
  }
  return { passed, gated, blocked: gated.length };
}

/* ══════════════════════════════════════════════════════════
 * 七、③ 装载画像
 * ══════════════════════════════════════════════════════════ */

const DEFAULT_PROFILE = {
  identityType: '本科',
  grade: '2025级',
  college: '工学院',
  campus: '长江西路校区',
  major: '',
  interests: ['学科竞赛', '奖助学金', '考试安排', '转专业'],
  keywords: [],
  advance: '3,1',
  channel: '小程序服务通知 + 群内播报',
};

/**
 * @param {object} [opts] { profile: 显式画像, profilePath: 文件路径 }
 * @returns {{profile, source:string}}
 */
function loadProfile(opts) {
  const o = opts || {};
  installHost(o.host);

  // ① 显式入参（HTTP 请求体带的画像）
  if (o.profile && typeof o.profile === 'object') {
    return { profile: Object.assign({}, DEFAULT_PROFILE, o.profile), source: 'request' };
  }

  // ② 文件（CLI --profile）
  if (o.profilePath) {
    const p = path.isAbsolute(o.profilePath) ? o.profilePath : path.join(ROOT, o.profilePath);
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        return { profile: Object.assign({}, DEFAULT_PROFILE, j), source: path.relative(ROOT, p) };
      } catch (e) {
        return { profile: { ...DEFAULT_PROFILE }, source: '内置默认（文件解析失败）' };
      }
    }
    return { profile: { ...DEFAULT_PROFILE }, source: '内置默认（未找到 ' + o.profilePath + '）' };
  }

  // ③ 存储里已保存的（服务端跨请求 / 小程序已存）
  try {
    const saved = store().getProfile();
    if (saved && saved.identityType) return { profile: saved, source: 'store' };
  } catch (e) {}

  return { profile: { ...DEFAULT_PROFILE }, source: '内置默认' };
}

/**
 * 把画像写进 store，让同源算法读到同一份（单一事实源）。
 * 必须在 matchAndScore 之前调用。
 */
function activateProfile(profile) {
  installHost();
  try { store().saveProfile(profile); } catch (e) { /* 降级：store 用内置默认 */ }
  try { return store().getProfile(); } catch (e) { return profile; }
}

/* ══════════════════════════════════════════════════════════
 * 八、④ 大模型理解层
 * ══════════════════════════════════════════════════════════ */

/* 提示词外置到 tools/agent/prompt.js：带版本号、可逐字举证、可与小程序端
 * miniprogram/utils/llm_prompt.js 做同源比对（见 check_llm_pipeline.js）。
 * 这里只保留调用，不再持有任何提示词字面量。 */
const { VERSION: PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } = require('./prompt.js');

let _modelCache = null;
async function pickModel(cloud, timeoutMs) {
  if (_modelCache) return _modelCache;
  const models = await withTimeout(cloud.llm.models.list(), timeoutMs, 'llm.models.list');
  if (!models || !models.length) return null;
  const m = models.find((x) => x.disabled !== true && x.enabled !== false);
  if (m) _modelCache = m;
  return m || null;
}

/**
 * 真调大模型理解一批通知。
 * @returns {{ok, model, modelName, results, tried, okCount, failed, memorized, allFromMemory, memoryHits, reason?}}
 */
async function understand(notices, opts) {
  const o = opts || {};
  const limit = o.limit == null ? 8 : o.limit;
  const mem = o.memory || loadMemory(o.memoryFile);

  // 记忆优先：命中的直接挂上 llm_fields，不进 todo
  const memoryHits = applyMemory(notices, mem);

  const out = {
    ok: false, model: null, modelName: null, results: [],
    tried: 0, okCount: 0, failed: 0, memorized: 0, memoryHits, reason: null,
  };

  if (o.enabled === false) { out.reason = '未启用大模型（enabled=false）'; return out; }

  const cloud = cloudClient();
  if (!cloud) { out.reason = '云服务不可用（SDK 未安装或 publicConfig 缺失）'; return out; }

  let model;
  try {
    model = await pickModel(cloud, o.timeout || 20000);
  } catch (e) {
    out.reason = '取模型列表失败：' + (e && e.message);
    return out;
  }
  if (!model) { out.reason = '云端未返回可用模型'; return out; }

  out.model = model.id;
  out.modelName = model.name || model.id;

  const todo = notices
    .filter((n) => (n.raw || n.digest) && !n.llm_fields)
    .slice(0, limit);

  if (!todo.length) {
    out.ok = true;
    out.allFromMemory = true;
    return out;
  }

  out.tried = todo.length;

  async function askOne(n) {
    let answer = '';
    try {
      const stream = cloud.llm.chat.completions.create({
        model: model.id,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(n) },
        ],
        stream: true,
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });
      // 整条流的超时（防止模型卡死把服务拖住）
      const guard = setTimeout(() => { /* 交给外层 withTimeout 的 reject 兜底 */ }, 0);
      clearTimeout(guard);
      for await (const chunk of stream) {
        const d = chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) answer += d.content;
      }
    } catch (e) {
      return { ok: false, error: (e.error && e.error.code) || e.message || String(e) };
    }
    const parsed = extractJson(answer);
    if (!parsed) {
      return { ok: false, error: '输出非合法 JSON（' + answer.length + ' 字符，已尝试配平修复）' };
    }
    return { ok: true, fields: parsed };
  }

  for (const n of todo) {
    let r;
    try {
      r = await withTimeout(askOne(n), o.perItemTimeout || 60000, 'llm.chat');
    } catch (e) {
      r = { ok: false, error: (e && e.message) || 'unknown' };
    }
    // 失败重试一次（截断是首因）
    if (!r.ok && /非合法 JSON|TIMEOUT/.test(r.error)) {
      try {
        const r2 = await withTimeout(askOne(n), o.perItemTimeout || 60000, 'llm.chat.retry');
        if (r2.ok) r = r2;
      } catch (e) { /* 保持原失败 */ }
    }
    if (!r.ok) { out.results.push({ id: n.id, ok: false, error: r.error }); continue; }
    out.results.push({ id: n.id, ok: true, fields: r.fields, title: n.title });
    /* 记忆里带上提示词版本与模型，产物回流时可逐条举证；
     * 老记忆没有这两个字段，回流器会如实标 unknown，绝不替它补一个版本。 */
    mem[n.id] = {
      hash: bodyHash(n), fields: r.fields,
      promptVersion: PROMPT_VERSION, model: out.model,
      at: new Date().toISOString()
    };
    n.llm_fields = r.fields;
  }

  out.ok = true;
  out.okCount = out.results.filter((x) => x.ok).length;
  out.failed = out.results.length - out.okCount;
  out.memorized = out.okCount;

  if (o.persistMemory !== false) saveMemory(mem, o.memoryFile);
  return out;
}

/* ══════════════════════════════════════════════════════════
 * 九、⑤ 匹配 + 打分 + 分级（同源算法）
 * ══════════════════════════════════════════════════════════ */

/**
 * @returns {{matched:Array, cards:Array, notify:Array, silent:Array, summary, total}}
 */
function matchAndScore(profile, opts) {
  const o = opts || {};
  installHost(o.host);

  /* 关键：把"这一轮真正用的通知池"注入同源算法。
   * 不注入的话 store.matchNotices() 读的仍是打包进代码的本地池，
   * 会出现"digest 里的 id 在 /api/notices 里找不到"的分裂（真 bug）。
   * 池子与数据源标签由调用方（runOnce / 服务端）给出。 */
  if (Array.isArray(o.notices)) {
    try { store().setActiveNotices(o.notices, o.source || 'injected'); } catch (e) {}
  }

  const eff = activateProfile(profile);

  const matched = store().matchNotices();
  const built = push().buildPush({ profile: eff, limit: o.limit || 60 });

  return {
    matched,
    cards: built.cards || [],
    notify: built.notify || [],
    silent: built.silent || [],
    summary: built.summary,
    total: built.total,
    profile: eff,
  };
}

/* ══════════════════════════════════════════════════════════
 * 十、⑥ 决策 + 整链
 * ══════════════════════════════════════════════════════════ */

function stripCard(c) {
  return {
    id: c.id,
    title: c.title,
    score: c.pushScore,
    level: c.pushLevel,
    levelLabel: c.pushLevelLabel,
    countdown: typeof c.countdown === 'number' ? c.countdown : null,
    deadline: c.deadline || null,
    source: c.source || c.unit || '',
    site: c.site || '',
    url: c.url || '',
    reasonLine: c.pushReasonLine || '',
    reasons: (c.pushReasons || []).map((r) => r.label || r.code).filter(Boolean),
    isNew: !!c.isNew,
    event: c.event || '',
    digestOne: c.digestOne || '',
    llm: c.llm_fields || null,
  };
}

function decide(scored) {
  return {
    notify: (scored.notify || []).map(stripCard),
    silent: (scored.silent || []).map(stripCard),
    summary: scored.summary,
  };
}

/**
 * 跑完整一轮（六步链路）。
 *
 * @param {object} [opts]
 *   @param {Array}   notices      显式通知池（跳过云端）
 *   @param {object}  profile      显式画像
 *   @param {string}  profilePath  画像文件路径
 *   @param {boolean} useLLM       是否真调大模型
 *   @param {number}  llmLimit     一次最多理解几条
 *   @param {boolean} persistMemory 是否写记忆
 *   @param {object}  storage      外部存储（服务端跨请求共享）
 *   @param {boolean} preferCloud  是否优先云端（默认 true）
 *   @returns {Promise<object>} 结构化结果（可直接 JSON 序列化）
 */
async function runOnce(opts) {
  const o = opts || {};
  const t0 = Date.now();
  installHost(o.host);

  const steps = {};

  // ① 载入
  const loaded = await loadNotices(o);
  steps.load = { count: loaded.count, source: loaded.source, warn: loaded.warn };

  // ② 过闸
  const g = gateNotices(loaded.notices);
  steps.gate = { passed: g.passed.length, blocked: g.blocked, gated: g.gated };

  // ③ 画像
  const { profile, source: profileSource } = loadProfile(o);
  steps.profile = { source: profileSource };

  // ④ 理解
  const llm = o.useLLM
    ? await understand(g.passed, {
        limit: o.llmLimit, memory: o.memory, memoryFile: o.memoryFile,
        persistMemory: o.persistMemory,
      })
    : { ok: false, reason: '未启用大模型', results: [], memoryHits: applyMemory(g.passed, o.memory || loadMemory(o.memoryFile)) };
  steps.understand = {
    mode: llm.ok ? 'llm' : 'rule',
    model: llm.model || null,
    modelName: llm.modelName || null,
    promptVersion: PROMPT_VERSION,
    tried: llm.tried || 0,
    okCount: llm.okCount || 0,
    failed: llm.failed || 0,
    memoryHits: llm.memoryHits || 0,
    reason: llm.reason || null,
    /* 明细给 CLI 渲染用；HTTP 返回时自动带上（体积可控：最多 llmLimit 条） */
    results: (llm.results || []).map((x) => (x.ok
      ? { id: x.id, ok: true, title: x.title, fields: x.fields }
      : { id: x.id, ok: false, error: x.error })),
  };

  // ⑤ 匹配 + 打分（把本轮池注入同源算法，保证 id 与数据源一致）
  const scored = matchAndScore(profile, Object.assign({}, o, {
    notices: g.passed,
    source: loaded.source,
  }));
  steps.match = { matched: scored.matched.length, cards: scored.cards.length };

  // ⑥ 决策
  const decision = decide(scored);
  steps.decide = { notify: decision.notify.length, silent: decision.silent.length };

  const eff = scored.profile;
  return {
    ranAt: new Date().toISOString(),
    date: todayStr(),
    mode: llm.ok ? 'llm' : 'rule',
    model: llm.model || null,
    steps,
    profile: {
      identityType: eff.identityType,
      grade: eff.grade,
      college: eff.college,
      campus: eff.campus,
      interests: eff.interests || [],
      keywords: eff.keywords || [],
      advance: eff.advance,
      source: profileSource,
    },
    pool: loaded.notices.length,
    passed: g.passed.length,
    matched: scored.matched.length,
    cards: scored.cards.length,
    summaryLine: scored.summary && scored.summary.line,
    summaryTone: scored.summary && scored.summary.tone,
    /* notify / silent 是**明细数组**（每条带 reasons，「理由即分数」的落点）。
     * notify_items 是历史别名（早期版本用 notify 表示条数、notify_items 表示明细），
     * 为兼容参赛自检与既有消费方而保留；notify_count 是便于阅读的条数。 */
    notify: decision.notify,
    silent: decision.silent,
    notify_items: decision.notify,
    silent_items: decision.silent,
    notify_count: decision.notify.length,
    silent_count: decision.silent.length,
    elapsedMs: Date.now() - t0,
  };
}

function todayStr() {
  const d = new Date();
  const z = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* ══════════════════════════════════════════════════════════
 * 十一、对外接口
 * ══════════════════════════════════════════════════════════ */

module.exports = {
  // 宿主
  installHost,
  // 六步（可单独调）
  loadNotices,
  gateNotices,
  loadProfile,
  activateProfile,
  understand,
  matchAndScore,
  decide,
  runOnce,
  // 云端
  cloudAvailable,
  cloudClient,
  loadPublicConfig,
  normalizeRow,
  // 记忆
  loadMemory,
  saveMemory,
  applyMemory,
  bodyHash,
  // 工具（供测试与上层复用）
  extractJson,
  withTimeout,
  withRetry,
  pickModel,
  stripCard,
  DEFAULT_PROFILE,
  todayStr,
  // 常量
  FRESH_AFTER,
  ROOT,
  MP,
};
