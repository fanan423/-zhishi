/**
 * 知时 · 检索层
 * ============
 *
 * 三个能力：
 *   ① search()      全文检索（标题 / 摘要 / 原文 / 标签 / 来源都能命中）
 *   ② highlight()   把命中词切成分片，交给 wxml 做高亮渲染
 *   ③ snippet()     从原文里截出「命中词所在的上下文」，让你一眼看到为什么它被搜出来
 *
 * 设计取向：
 *   - 不做分词库（体积大、小程序不划算），用**多关键词逐字包含**匹配，中文场景够用
 *   - 排序 = 标题命中 > 摘要命中 > 原文命中，同档比命中次数，再比新鲜度
 *   - 结果里永远带 source / publish / 出处锚点，**搜索结果本身可溯源**
 */

const tags = require('./tags.js');

/* 把查询串拆成关键词（空格分隔；中文整串也作为一个词） */
function splitQuery(q) {
  const s = String(q || '').trim();
  if (!s) return [];
  const parts = s.split(/[\s,，、+]+/).filter(Boolean);
  // 去重 + 去单字噪声（保留 1 字词，但排序靠后）
  const seen = {};
  const out = [];
  parts.forEach(p => {
    const k = p.toLowerCase();
    if (!seen[k]) { seen[k] = 1; out.push(p); }
  });
  return out;
}

/* 统计 hay 中命中词数 + 次数 */
function countHit(hay, words) {
  if (!hay) return { n: 0, c: 0 };
  const h = String(hay).toLowerCase();
  let n = 0, c = 0;
  words.forEach(w => {
    const wl = w.toLowerCase();
    let idx = h.indexOf(wl);
    let hit = 0;
    while (idx >= 0) { hit++; idx = h.indexOf(wl, idx + wl.length); }
    if (hit > 0) { n++; c += hit; }
  });
  return { n, c };
}

/**
 * 从原文里截出命中上下文
 * @returns { text, hitWords:[], prefix:'…', suffix:'…' }
 */
function snippet(raw, words, radius = 60) {
  const r = String(raw || '');
  if (!r) return { text: '', hitWords: [] };
  const lower = r.toLowerCase();

  let best = -1, bestWord = '';
  for (const w of words) {
    const i = lower.indexOf(w.toLowerCase());
    if (i >= 0 && (best < 0 || i < best)) { best = i; bestWord = w; }
  }
  if (best < 0) {
    return { text: r.slice(0, radius * 2), hitWords: [] };
  }
  const start = Math.max(0, best - radius);
  const end = Math.min(r.length, best + bestWord.length + radius);
  return {
    text: r.slice(start, end),
    prefix: start > 0 ? '…' : '',
    suffix: end < r.length ? '…' : '',
    hitWords: words
  };
}

/**
 * 主检索
 * @param {Array} notices 通知池
 * @param {String} q      查询串
 * @param {Object} opt    { tag, onlyFormal }
 */
function search(notices, q, opt) {
  opt = opt || {};
  const words = splitQuery(q);
  const tagFilter = opt.tag || '';

  const list = (notices || []).filter(n => {
    if (tagFilter && n.event !== tagFilter) return false;
    return true;
  });

  // 无关键词：退化为「按标签浏览」
  if (words.length === 0) {
    return list
      .slice()
      .sort((a, b) => String(b.publish).localeCompare(String(a.publish)))
      .map(n => decorate(n, [], 0));
  }

  const scored = [];
  list.forEach(n => {
    const t = countHit(n.title, words);
    const one = countHit(n.digestOne, words);
    const pts = countHit((n.points || []).join(' '), words);
    const raw = countHit(n.raw, words);
    const src = countHit(n.source, words);
    const ev = countHit(n.event, words);

    // 必须至少命中一个词
    const totalN = t.n + one.n + pts.n + raw.n + src.n + ev.n;
    if (totalN === 0) return;

    // 加权：标题 10 / 标签 6 / 摘要 5 / 要点 3 / 来源 2 / 原文 1
    const score =
      t.n * 10 + t.c * 2 +
      ev.n * 6 +
      one.n * 5 +
      pts.n * 3 +
      src.n * 2 +
      raw.n * 1;

    scored.push({ n, score, words });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.n.publish).localeCompare(String(a.n.publish));
  });

  return scored.map(s => decorate(s.n, s.words, s.score));
}

/* 给结果补充展示字段：命中词、出处切片、标签元信息 */
function decorate(n, words, score) {
  const snip = words.length ? snippet(n.raw, words) : null;
  const m = tags.meta(n.event);

  /* 命中来源：告诉用户"为什么这条被搜出来"
     如果标题和原文片段都没有可见命中，必须如实说明是标签命中——
     否则用户会看到一条"没有高亮"的结果，莫名其妙。 */
  const hitInTitle = words.some(w =>
    n.title && n.title.toLowerCase().indexOf(w.toLowerCase()) >= 0);
  const hitInSnippet = !!(snip && words.some(w =>
    snip.text.toLowerCase().indexOf(w.toLowerCase()) >= 0));

  const hitSources = [];
  if (hitInTitle) hitSources.push('标题');
  if (words.some(w => String(n.event || '').indexOf(w) >= 0)) hitSources.push('标签');
  if (words.some(w => String(n.digestOne || '').indexOf(w) >= 0)) hitSources.push('浓缩');
  if (words.some(w => (n.points || []).join(' ').indexOf(w) >= 0)) hitSources.push('要点');
  if (words.some(w => String(n.source || '').indexOf(w) >= 0)) hitSources.push('来源单位');
  if (hitInSnippet) hitSources.push('原文');

  return {
    id: n.id,
    title: n.title,
    source: n.source,
    publish: n.publish,
    event: n.event,
    icon: m.icon,
    real: !!n.real,
    /* 带出 url/site，让结果卡能如实区分「可核对」与「仅采集」 */
    url: n.url || '',
    site: n.site || '',
    raw: !!n.raw,
    digestOne: n.digestOne || '',
    deadline: n.deadline || '',
    countdown: (typeof n.countdown === 'number') ? n.countdown : null,
    hitWords: words,
    score: score,
    hitSources,
    hitInTitle,
    hitInSnippet,
    /* 需要显式说明命中来源 = 标题和片段都没可见高亮 */
    needExplain: words.length > 0 && !hitInTitle && !hitInSnippet,
    snippet: snip ? snip.text : '',
    snippetPrefix: snip && snip.prefix ? snip.prefix : '',
    snippetSuffix: snip && snip.suffix ? snip.suffix : ''
  };
}

/**
 * 高亮切分：把一段文本按关键词切成 [{text, hl}]
 * 用于 wxml wx:for 渲染
 */
function highlight(text, words) {
  const s = String(text || '');
  if (!words || !words.length || !s) return [{ text: s, hl: false }];

  const lower = s.toLowerCase();
  const ranges = [];
  words.forEach(w => {
    const wl = w.toLowerCase();
    if (!wl) return;
    let i = lower.indexOf(wl);
    while (i >= 0) {
      ranges.push([i, i + wl.length]);
      i = lower.indexOf(wl, i + wl.length);
    }
  });
  if (!ranges.length) return [{ text: s, hl: false }];

  // 合并重叠区间
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  let cur = ranges[0];
  for (let i = 1; i < ranges.length; i++) {
    const r = ranges[i];
    if (r[0] <= cur[1]) cur[1] = Math.max(cur[1], r[1]);
    else { merged.push(cur); cur = r; }
  }
  merged.push(cur);

  const segs = [];
  let cursor = 0;
  merged.forEach(m => {
    if (m[0] > cursor) segs.push({ text: s.slice(cursor, m[0]), hl: false });
    segs.push({ text: s.slice(m[0], m[1]), hl: true });
    cursor = m[1];
  });
  if (cursor < s.length) segs.push({ text: s.slice(cursor), hl: false });
  return segs;
}

/* 热门搜索词：优先给"真的搜得到"的词。
 * 传了 notices 时逐个试搜，命中 <1 的剔除（避免点了个空词）；
 * 若全不命中（数据不寻常）则退回静态候选，保证永远有点的。
 * ★ 与 web/zhishi-core.js 的 hotWords 同源，改动需两端同步。 */
const HOT_WORDS = ['转专业', '奖学金', '竞赛', '考试安排', '讲座', '选课', '图书馆', '招聘'];
function hotWords(notices) {
  if (!notices || !notices.length) return HOT_WORDS.slice();
  let live = HOT_WORDS.filter(w => {
    try { return search(notices, w, {}).length > 0; } catch (e) { return false; }
  });
  /* 命中太多词（>6）时按池内出现频次取前 6，保持热词条不被挤爆 */
  if (live.length > 6) {
    live = live.map(w => {
      let n = 0;
      try { n = search(notices, w, {}).length; } catch (e) { n = 0; }
      return { w, n };
    }).sort((a, b) => b.n - a.n).slice(0, 6).map(x => x.w);
  }
  return live.length ? live : HOT_WORDS.slice();
}

module.exports = { search, highlight, snippet, splitQuery, hotWords };
