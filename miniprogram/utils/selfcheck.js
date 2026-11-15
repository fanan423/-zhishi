/**
 * 知时 · 自查自纠系统（自证层）
 * ============================
 *
 * 为什么要有它：
 *   一个"聚合公开通知"的工具，最致命的失败不是页面丑，而是**把不可靠的东西
 *   当成可靠的给用户看**。伪造出处、把演示数据当真实通知、链接近似但内容对不上——
 *   这些错误一旦发出，用户就再也不会信第二次。
 *
 *   所以我们在运行时自带一套"审计员"：每次数据进入展示层之前，先自己查一遍，
 *   查出来的问题不是删掉就算了，而是**分级处理 + 留痕 + 可复现**。
 *
 * 三条铁律（对应 reliability 红线）：
 *   R1 出处可举证：real=true 且声明了 url 的，url 必须是 ahau.edu.cn 域名。
 *   R2 链接不伪造：演示样例（real≠true）**绝不能**带 url。
 *   R3 引文可定位：digestPoints 的每条 quote 必须能在 raw 里原样找到。
 *
 * 分级：
 *   fatal  —— 触犯铁律，直接剔除该条（宁缺毋滥：不可靠的通知不如不给）
 *   warn   —— 可疑但不致命（如真采集却缺链接），保留展示但如实标注
 *   info   —— 提醒（如 countdown 与 deadline 推算不一致），自动纠正
 *
 * 自动纠正（自纠）：
 *   · countdown 与 deadline 对不上 → 以 deadline 为准重算
 *   · real=true 但无 url/site → 降级为 warn，展示为"未留存链接"
 *   · raw 过短（< 40 字）无法支撑溯源 → 标记，提示看原文
 *
 * 留痕：审计结果写入本地存储（zhishi_audit_log），含时间戳与命中的 id，
 *      便于"我上次看到的那条怎么没了"这类追问——可解释，不神秘。
 */

const STORAGE_KEY = 'zhishi_audit_log';

/* 允许的域名（安农官网）—— 白名单而不是黑名单，宁可严格 */
const ALLOWED_HOSTS = [
  'ahau.edu.cn',
  'jwc.ahau.edu.cn',
  'xxb.ahau.edu.cn',
  'zsb.ahau.edu.cn',
  'xgb.ahau.edu.cn'
];

/* 免责声明/演示标记：出现在正文里就说明不是正式通知 */
const DEMO_MARKERS = ['演示样例', '示例数据', '仅供演示', '（样例）'];

/* ============ 工具 ============ */

/* 取 host */
function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/* 域名是否在白名单内 */
function hostAllowed(url) {
  const h = hostOf(url);
  if (!h) return false;
  return ALLOWED_HOSTS.some(a => h === a || h.endsWith('.' + a));
}

/* 从 deadline 推算 countdown */
function daysUntil(deadline) {
  if (!deadline) return null;
  const d = new Date(String(deadline).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

/* ============ 单条审计 ============ */

/**
 * 审计一条通知。
 * @returns { id, level, issues:[{code, msg}], fixed:{...} }
 *          level: 'ok' | 'warn' | 'fatal'
 */
function auditNotice(n) {
  const issues = [];
  const fixed = {};
  const id = n && n.id;

  if (!n || !id) {
    return { id: id || '(无id)', level: 'fatal', issues: [{ code: 'NO_ID', msg: '缺少唯一 id' }], fixed };
  }

  const isReal = n.real === true;
  const hasUrl = !!(n.url && String(n.url).trim());

  /* ---- R2 链接不伪造：演示样例不能带 url ---- */
  if (!isReal && hasUrl) {
    issues.push({ code: 'R2_DEMO_HAS_URL', msg: '演示样例带 url（伪造出处风险）', fatal: true });
  }

  /* ---- R1 出处可举证：real 的 url 必须白名单域名 ---- */
  if (isReal && hasUrl) {
    if (!hostAllowed(n.url)) {
      issues.push({ code: 'R1_BAD_HOST', msg: 'url 非安农官网域名：' + hostOf(n.url), fatal: true });
    }
  }

  /* ---- real 但缺链接：warn（保留但如实标注） ---- */
  if (isReal && !hasUrl) {
    issues.push({ code: 'R_NO_URL', msg: '真实采集但未留存原文链接', fatal: false });
  }

  /* ---- R3 引文可定位 ---- */
  const pts = Array.isArray(n.digestPoints) ? n.digestPoints : [];
  const raw = String(n.raw || '');
  if (pts.length && raw) {
    let missCnt = 0;
    pts.forEach(p => {
      const q = String((p && p.quote) || '');
      if (!q) return;
      /* 去空白后包含判断：与 store.locateQuote 的三级兜底口径一致 */
      const norm = s => s.replace(/\s+/g, '');
      const hit = raw.indexOf(q) >= 0 || norm(raw).indexOf(norm(q.replace(/…+$/, ''))) >= 0;
      if (!hit) missCnt++;
    });
    if (missCnt > 0) {
      issues.push({ code: 'R3_QUOTE_MISS', msg: missCnt + '/' + pts.length + ' 条引文无法在原文定位', fatal: missCnt === pts.length });
    }
  }

  /* ---- 基础字段完整性 ---- */
  if (!String(n.title || '').trim()) {
    issues.push({ code: 'NO_TITLE', msg: '缺标题', fatal: true });
  }
  if (isReal && !String(n.source || '').trim()) {
    issues.push({ code: 'NO_SOURCE', msg: '真实采集却缺来源单位', fatal: false });
  }

  /* ---- 演示标记泄漏到正文 ---- */
  if (raw && DEMO_MARKERS.some(m => raw.indexOf(m) >= 0)) {
    issues.push({ code: 'DEMO_MARKER', msg: '正文含演示标记词', fatal: false });
  }

  /* ---- 自纠①：countdown 与 deadline 不一致 → 以 deadline 为准 ----
   * 注意：数据是"编制时刻"写的定值，日子一天天过，必然对不上。
   * 这不是错误，是**该刷新**。所以分级为 info（自动纠正，不报警）。
   * 只有偏差特别离谱（>60天）才升为 warn，提示可能数据本身写错了。 */
  const cd = n.countdown;
  const expect = daysUntil(n.deadline);
  if (typeof cd === 'number' && typeof expect === 'number' && cd !== expect) {
    fixed.countdown = expect;
    const drift = Math.abs(cd - expect);
    issues.push({
      code: 'CD_REFRESH',
      msg: `倒计时按今天刷新：${cd} → ${expect} 天（截止 ${String(n.deadline).slice(0, 10)}）`,
      fatal: false,
      info: drift <= 60 ? true : false
    });
  }

  /* ---- 自纠②：raw 过短无法支撑溯源 ---- */
  if (raw && raw.length < 40) {
    issues.push({ code: 'RAW_TOO_SHORT', msg: '原文过短（<40字），溯源支撑弱', fatal: false });
  }

  const hasFatal = issues.some(i => i.fatal === true);
  /* info 级问题（如按今天刷新倒计时）不算"有疑点"，只是自动纠正 */
  const hasWarn = issues.some(i => i.fatal !== true && i.info !== true);
  const level = hasFatal ? 'fatal' : (hasWarn ? 'warn' : 'ok');
  return { id, level, issues, fixed };
}

/* ============ 全池审计 + 自纠 ============ */

/**
 * 审计整个通知池，并返回"纠正后"的可用池。
 * @returns { clean:[...], dropped:[...], warned:[...], stats:{...}, log:{...} }
 *   clean   放行展示（fatal 的已剔除，warn 的保留但带 audit 标记）
 *   dropped 被剔除的条目（含原因）
 *   warned  有 warn 级问题的条目 id
 */
function auditPool(notices, opts) {
  opts = opts || {};
  const list = Array.isArray(notices) ? notices : [];
  const clean = [], dropped = [], warned = [];
  const ts = Date.now();

  list.forEach(n => {
    const r = auditNotice(n);
    if (r.level === 'fatal') {
      dropped.push({ id: r.id, title: (n && n.title) || '', issues: r.issues });
      return;
    }
    /* 应用自纠：把修正值写进副本，不改动原始数据源 */
    const item = Object.assign({}, n);
    if (r.fixed && typeof r.fixed.countdown === 'number') {
      item.countdown = r.fixed.countdown;
    }
    /* 挂审计标记：展示层据此决定角标措辞 */
    item.audit = {
      level: r.level,
      verifiable: !!(n.real === true && n.url && hostAllowed(n.url)),
      issues: r.issues.map(i => i.code)
    };
    if (r.level === 'warn') warned.push(r.id);
    clean.push(item);
  });

  const verifiable = clean.filter(x => x.audit.verifiable).length;
  const realCnt = clean.filter(x => x.real === true).length;

  const log = {
    ts,
    total: list.length,
    passed: clean.length,
    dropped: dropped.length,
    warned: warned.length,
    verifiable,
    realCnt,
    demoCnt: clean.length - realCnt,
    droppedIds: dropped.map(d => d.id),
    warnedIds: warned
  };

  /* 留痕：把最近一次审计结论落到本地，便于追问"这条为什么没了" */
  if (opts.persist !== false) {
    try {
      const prev = wx.getStorageSync(STORAGE_KEY);
      const hist = Array.isArray(prev) ? prev : [];
      hist.unshift(log);
      wx.setStorageSync(STORAGE_KEY, hist.slice(0, 20));
    } catch (e) {}
  }

  return { clean, dropped, warned, stats: log, log };
}

/* ============ 自查报告（供页面展示） ============ */

/**
 * 生成一份可读的自查报告，供"设置/关于"页展示。
 * 让用户看到：我们自己查出过什么问题、扔掉了什么。
 */
function selfReport(notices) {
  const a = auditPool(notices, { persist: false });
  const s = a.stats;

  const lines = [];
  lines.push(`共审计 ${s.total} 条`);
  lines.push(`放行 ${s.passed} 条（其中可举证原文 ${s.verifiable} 条）`);
  if (s.dropped) lines.push(`剔除 ${s.dropped} 条不可靠条目`);
  if (s.warned) lines.push(`${s.warned} 条有疑点，已如实标注`);

  /* 按问题类型统计 */
  const CODE_TEXT = {
    R1_BAD_HOST: '链接域名不在安农官网白名单',
    R2_DEMO_HAS_URL: '演示样例被塞了出处链接',
    R3_QUOTE_MISS: '引文无法在原文中定位',
    R_NO_URL: '真实采集但未留存原文链接',
    NO_SOURCE: '真实采集却缺来源单位',
    NO_TITLE: '缺标题',
    NO_ID: '缺唯一标识',
    CD_REFRESH: '倒计时已按今天刷新（非错误）',
    RAW_TOO_SHORT: '原文过短，溯源支撑弱',
    DEMO_MARKER: '正文含演示标记词'
  };

  /* 只把 fatal/warn 计入"问题"，info 单独说明 */
  const issueCodes = {};
  a.clean.forEach(x => (x.audit.issues || []).forEach(c => { issueCodes[c] = (issueCodes[c] || 0) + 1; }));
  a.dropped.forEach(d => (d.issues || []).forEach(i => { issueCodes[i.code] = (issueCodes[i.code] || 0) + 1; }));

  const problemLines = [];
  const infoLines = [];
  Object.keys(issueCodes).forEach(k => {
    const line = `· ${CODE_TEXT[k] || k}：${issueCodes[k]} 条`;
    if (k === 'CD_REFRESH') infoLines.push(line);
    else problemLines.push(line);
  });

  /* healthy 的判定口径很重要：
   *   "通过" = 没有任何条目因触犯铁律被剔除（dropped===0）。
   *   像 R_NO_URL（真实采集但没留链接）这种是**如实标注**，不是失败——
   *   把它判成"不健康"会让诚实变成一种惩罚，反而鼓励我们藏起来。
   *   所以 healthy 只卡"剔除"，疑点单独列出，由用户自己判断。 */
  const droppedCnt = a.dropped.length;
  return {
    stats: s,
    lines,
    issueLines: problemLines,
    infoLines,
    dropped: a.dropped.map(d => ({ id: d.id, title: d.title, why: (d.issues || []).map(i => CODE_TEXT[i.code] || i.code).join('；') })),
    healthy: droppedCnt === 0
  };
}

/* 读历史审计留痕 */
function auditHistory() {
  try {
    const h = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(h) ? h : [];
  } catch (e) { return []; }
}

module.exports = {
  auditNotice,
  auditPool,
  selfReport,
  auditHistory,
  hostAllowed,
  hostOf,
  ALLOWED_HOSTS
};
