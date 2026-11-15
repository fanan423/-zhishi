/**
 * 知时 · 理解层提示词（同源副本 · 小程序端）
 * ================================================
 *
 * 与 `tools/agent/prompt.js` 逐字同源。小程序不能 require 项目根目录外的文件，
 * 因此保留一份副本；`tools/checks/check_llm_pipeline.js` 会守两端
 * VERSION 与 SYSTEM_PROMPT 完全一致，改提示词必须同时改这两处。
 *
 * 版本历史：
 *   v1.0.0  初版：仅要求「抽不到填 null、严格输出 JSON」。
 *   v1.1.0  2026-11-15 依据 38 条真实模型输出加固：
 *          ① source_quote 逐字复制、禁止省略与改写；
 *          ② deadline 明确 YYYY-MM-DD / null；
 *          ③ 不得依据常识补全。
 */

const VERSION = '1.1.0';

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

module.exports = { VERSION, FIELD_SCHEMA, SYSTEM_PROMPT, buildUserPrompt };
