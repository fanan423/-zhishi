/**
 * 知时 · 自定义关键词订阅（单一事实来源）
 * ==========================================
 *
 * 【为什么单独抽一个文件】
 *   "订阅"有两层：
 *     ① 固定 9 类标签（tags.js 管）—— 我们替你分好的类；
 *     ② 自定义关键词（本文件管）—— 你自己敲进去的具体名词。
 *
 *   用户的原话很直白：
 *     "我参加了正大杯，我输入'正大杯'，以后有相关通知你就主动推给我。"
 *   具体赛事 / 具体项目 / 具体实验室的名字，固定标签覆盖不到，
 *   必须给用户一个输入框。
 *
 * 【为什么要独立成层（而不是塞进 push.js 或 store.js）】
 *   push.js 需要它（算 KW_MATCH 推送理由），
 *   store.js 也需要它（把命中关键词的通知纳入"与我有关"的候选池）。
 *   若把函数写在 push.js 里，store.js 就得 require push.js，
 *   而 push.js 已经 require store.js —— 形成循环依赖，
 *   在小程序的模块缓存下会拿到半初始化的空对象（真会出诡异 bug）。
 *   所以抽成**无依赖的纯函数层**，双方各自 require 本文件，谁也不依赖谁。
 *
 * 【命中口径】与检索层（search.js）同源：标题 / 浓缩 / 要点 / 标签 / 来源 / 原文。
 *   两边必须一致，否则会出现"搜索搜得到、订阅却推不到"的分裂。
 */

/**
 * 归一化关键词：去掉所有空白 + 转小写（英文/数字大小写不敏感）。
 * 非字符串一律转成字符串再处理，绝不抛异常。
 */
function normKeyword(k) {
  if (k === null || k === undefined) return '';
  return String(k).replace(/\s+/g, '').toLowerCase();
}

/**
 * 一条通知的"可命中文本"（小写，供包含匹配）。
 * 范围与 search.js 的检索口径一致：标题 / 浓缩一句话 / 要点 / 标签 / 来源 / 原文。
 */
function noticeHaystack(n) {
  if (!n) return '';
  return [
    String(n.title || ''),
    String(n.digestOne || ''),
    (n.points || []).join(' '),
    String(n.event || ''),
    String(n.source || ''),
    String(n.raw || '')
  ].join(' ').toLowerCase();
}

/**
 * 用户关键词的归一化去重列表（供上层做包含匹配）。
 * @returns {string[]} 全部小写、无空白、去重后的关键词
 */
function keywordList(profile) {
  const kws = (profile && Array.isArray(profile.keywords)) ? profile.keywords : [];
  const out = [];
  kws.forEach(k => {
    const n = normKeyword(k);
    if (n && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/**
 * 这条通知命中了哪个关键词？（返回**最长**的那个，因为它最说明问题）
 * 例：用户同时订了"杯"和"正大杯"，命中"正大杯通知"时应返回"正大杯"。
 * @returns {string} 命中的原始关键词（保留用户输入的大小写与写法）；没命中返回 ''
 */
function matchKeyword(n, profile) {
  const kws = (profile && Array.isArray(profile.keywords)) ? profile.keywords : [];
  if (!kws.length || !n) return '';
  const hay = noticeHaystack(n);
  let best = '';
  let bestLen = 0;
  for (let i = 0; i < kws.length; i++) {
    const raw = String(kws[i] === null || kws[i] === undefined ? '' : kws[i]).trim();
    const k = normKeyword(raw);
    if (!k) continue;
    if (hay.indexOf(k) >= 0 && k.length > bestLen) { best = raw; bestLen = k.length; }
  }
  return best;
}

/**
 * 布尔版：这条是否命中任一自定关键词（供候选池过滤用，比 matchKeyword 略快）。
 */
function hitKeyword(n, profile) {
  const list = keywordList(profile);
  if (!list.length || !n) return false;
  const hay = noticeHaystack(n);
  for (let i = 0; i < list.length; i++) {
    if (hay.indexOf(list[i]) >= 0) return true;
  }
  return false;
}

/**
 * 清洗用户输入的关键词（保存到画像前调用）。
 * 规则：去首尾空白、去内部空白、截断到 20 字、去重、丢弃空串。
 * 之所以要洗：用户可能粘进来一整句，或带表情/换行，脏数据会污染匹配。
 * @returns {string[]} 干净的、保持原大小写的关键词列表（最多 12 个）
 */
function sanitizeKeywords(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const seen = {};
  const out = [];
  list.forEach(k => {
    let s = String(k === null || k === undefined ? '' : k).replace(/\s+/g, '');
    if (!s) return;
    if (s.length > 20) s = s.slice(0, 20);
    const key = s.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    out.push(s);
  });
  return out.slice(0, 12);
}

/* 关键词上限（供 UI 提示与校验共用，避免"能存不能写"的不一致） */
const MAX_KEYWORDS = 12;

module.exports = {
  MAX_KEYWORDS,
  normKeyword,
  noticeHaystack,
  keywordList,
  matchKeyword,
  hitKeyword,
  sanitizeKeywords
};
