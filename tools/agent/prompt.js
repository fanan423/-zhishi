/**
 * 知时 · 理解层提示词（单一事实来源 · Node 端）
 * ================================================
 *
 * 为什么单独一个文件：
 *   1. 官方技术评分点明写「提示词编写」，提示词必须能被逐字引用、能对照版本迭代，
 *      埋在 600 行 JS 里既不好举证也不好 A/B。
 *   2. 小程序端 `miniprogram/utils/llm_prompt.js` 是同源副本，
 *      `tools/checks/check_llm_pipeline.js` 会守两端 VERSION 与 SYSTEM_PROMPT 逐字一致。
 *   3. 外置后 `tools/agent/core.js` 只负责调用与容错，不再持有任何提示词字面量。
 *
 * 版本历史（对应说明文档「提示词及关键配置优化」一节，可举证）：
 *   v1.0.0  初版：仅要求「抽不到填 null、严格输出 JSON」。
 *   v1.1.0  2026-11-15 依据 38 条真实模型输出暴露的三类问题加固：
 *          ① source_quote 出现空格断裂与「……」省略 → 明令逐字复制、禁止省略与改写；
 *          ② deadline 偶有非标准写法 → 明确 YYYY-MM-DD / null 二选一；
 *          ③ 个别字段出现「据常识推断」的倾向 → 强调不得依据常识补全。
 */

const VERSION = '1.1.0';

/** 输出字段契约：页面与下游脚本都按这组 key 取值，勿随意改名。 */
const FIELD_SCHEMA = Object.freeze({
  event_type: '事件类型（学科竞赛/奖助学金/考试安排/转专业/讲座培训/选课/图书资源/学工事务/校内通知）',
  who: '适用人群（年级/学院/身份）；抽不到填 null',
  what: '要做什么（一句话）',
  where: '在哪办；抽不到填 null',
  deadline: '截止时间 YYYY-MM-DD；没有则 null',
  materials: '所需材料；抽不到填 null',
  summary: '三句话以内的中文摘要',
  source_quote: '支撑结论的原文片段，逐字复制'
});

const SYSTEM_PROMPT =
  '你是校园通知结构化助手。只从给定原文中抽取信息，绝不编造，也不依据常识补全。' +
  '抽不到的字段一律填 null。' +
  'source_quote 必须逐字复制原文中的连续片段，不得改写、概括、插入省略号或删减字符。' +
  'deadline 只能写 YYYY-MM-DD 或 null。' +
  '严格输出 JSON，不要任何额外文字。';

/** 构造用户提示词。maxChars 控制原文截断，避免长通知把上下文撑爆。 */
function buildUserPrompt(notice, maxChars) {
  const cap = maxChars || 3000;
  const keys = Object.keys(FIELD_SCHEMA).join('/');
  return (
    '请从下面这条校园通知原文中抽取结构化字段，输出 JSON：\n' +
    '{"event_type":"事件类型(如 学科竞赛/奖助学金/考试安排/转专业/讲座培训/选课/图书资源/学工事务/校内通知)",' +
    '"who":"适用人群(年级/学院/身份，抽不到填 null)",' +
    '"what":"要做什么(一句话)",' +
    '"where":"在哪办",' +
    '"deadline":"截止时间(YYYY-MM-DD，没有则null)",' +
    '"materials":"所需材料",' +
    '"summary":"三句话以内的中文摘要",' +
    '"source_quote":"支撑结论的原文片段(逐字复制，不得省略)"}\n' +
    '字段集合固定为：' + keys + '。\n\n' +
    '通知标题：' + (notice.title || '') + '\n' +
    '通知原文：\n' + String(notice.raw || notice.digest || '').slice(0, cap)
  );
}

/* ============================================================
 * 推荐层提示词（v1.0.0）—— 与上面的「理解层」刻意分开
 * ------------------------------------------------------------
 * 理解层回答「这条通知讲了什么」；推荐层回答「这条通知对**这个学生**
 * 有多相关、为什么」。两者输入不同（推荐层多了用户画像），因此另立一套
 * 常量，不复用 VERSION / SYSTEM_PROMPT，避免 check_llm_pipeline.js 的
 * 两端同源守卫把「理解层版本」与「推荐层版本」混为一谈。
 *
 * 推荐层只在 Node 端运行（tools/agent/server.js 与构建期快照脚本调用），
 * 小程序端不持有，故不进双端逐字比对；但仍守同一套规矩：带版本号、
 * 字段契约固定、逐字引文、不得编造、严格 JSON。
 * ============================================================ */
const RECOMMEND_VERSION = '1.0.0';

const RECOMMEND_FIELD_SCHEMA = Object.freeze({
  relevance: '0-100 的整数：这条通知对该学生的相关 / 值得优先处理程度',
  reason: '一句话（不超过 60 字）说明为什么这样判断，必须同时依据画像和通知原文',
  evidence: '通知原文中支撑判断的连续片段，逐字复制、不得改写或省略；确实没有则填 null'
});

const RECOMMEND_SYSTEM_PROMPT =
  '你是校园通知个性化推荐助手。依据「学生画像」和「通知原文」判断这条通知对该学生的相关程度。' +
  '只依据给定的画像字段和通知原文，绝不编造画像里没有的信息，也不依据常识补全。' +
  'relevance 只能是 0-100 的整数：与该学生直接相关、且临近截止或需本人办理的给高分；' +
  '与该学生无关、面向学院/老师报送、或已过期的给低分。' +
  'evidence 必须逐字复制原文中的连续片段，不得改写、概括、插入省略号或删减字符；没有合适片段就填 null。' +
  'reason 用中文，一句话，不超过 60 字，必须能在画像或原文里找到依据。' +
  '严格输出 JSON，不要任何额外文字。';

/** 构造推荐层用户提示词。画像与原文都截断，避免上下文过长。 */
function buildRecommendPrompt(notice, profile, maxChars) {
  const cap = maxChars || 1800;
  const p = profile || {};
  const keys = Object.keys(RECOMMEND_FIELD_SCHEMA).join('/');
  const interests = Array.isArray(p.interests) ? p.interests.join('、') : '';
  const keywords = Array.isArray(p.keywords) ? p.keywords.join('、') : '';
  return (
    '请判断下面这条校园通知对「这位学生」的相关程度，输出 JSON：\n' +
    '{"relevance":"0-100 整数","reason":"一句话理由（不超过60字）","evidence":"原文连续片段，逐字复制；无则 null"}\n' +
    '字段集合固定为：' + keys + '。\n\n' +
    '【学生画像】\n' +
    '身份：' + (p.identityType || '未填') + '\n' +
    '年级：' + (p.grade || '未填') + '\n' +
    '学院：' + (p.college || '未填') + '\n' +
    '兴趣标签：' + (interests || '无') + '\n' +
    '订阅关键词：' + (keywords || '无') + '\n\n' +
    '【通知】\n' +
    '标题：' + (notice.title || '') + '\n' +
    '事件类型：' + (notice.event || '未标注') + '\n' +
    '截止时间：' + (notice.deadline || '无') + '\n' +
    '倒计时天数：' + (typeof notice.countdown === 'number' ? notice.countdown : '无') + '\n' +
    '适用人群：' + (notice.audience || (notice.llm_fields && notice.llm_fields.who) || '未标注') + '\n' +
    '通知原文：\n' + String(notice.raw || notice.digest || notice.digestOne || '').slice(0, cap)
  );
}

module.exports = {
  VERSION, FIELD_SCHEMA, SYSTEM_PROMPT, buildUserPrompt,
  RECOMMEND_VERSION, RECOMMEND_FIELD_SCHEMA, RECOMMEND_SYSTEM_PROMPT, buildRecommendPrompt,
};
