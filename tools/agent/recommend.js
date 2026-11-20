#!/usr/bin/env node
/**
 * 知时 · AI 推荐引擎（Node 端：服务端实时调用 + 构建期离线快照共用）
 * ============================================================================
 *
 * 【它和理解层的区别】
 *   understand()  输入「一条通知」        → 输出「这条通知讲了什么」（结构化字段）
 *   recommend()   输入「通知 + 学生画像」→ 输出「对这位学生有多相关、为什么」
 *
 * 【诚实性约定】
 *   - 模型没调通 / 返回非法 JSON / 字段不合法 → 逐条如实记 failed，
 *     绝不拿规则分冒充模型分，也不替模型补一个理由。
 *   - 每次运行写 push_out/ai_recommend_run.json（保留最近 20 轮），
 *     含模型、提示词版本、逐条结果、耗时、画像摘要 —— 可逐条举证。
 *
 * 【为什么单独一个文件】
 *   推荐是可选增强能力，不该把 880 行的理解层 core.js 再撑大；
 *   复用它已导出的 cloudClient / pickModel / extractJson / withTimeout。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core.js');
const {
  RECOMMEND_VERSION,
  RECOMMEND_SYSTEM_PROMPT,
  buildRecommendPrompt,
} = require('./prompt.js');

const OUT_DIR = path.join(core.ROOT, 'push_out');
const RUN_LOG = path.join(OUT_DIR, 'ai_recommend_run.json');

function now() { return new Date().toISOString(); }

/**
 * 真调大模型，对一批通知按画像做个性化相关性判断。
 *
 * @param notices 通知数组（至少含 id；建议带 title/raw/event/deadline/countdown）
 * @param profile 学生画像 { identityType, grade, college, interests, keywords }
 * @param opts    { limit, perItemTimeout, timeout }
 * @returns { ok, mode:'llm'|'rule', model, modelName, promptVersion, ranAt,
 *            tried, okCount, failed, results:[{id,ok,relevance,reason,evidence}|{id,ok:false,error}],
 *            reason, elapsedMs }
 */
async function recommend(notices, profile, opts) {
  const o = opts || {};
  const limit = o.limit == null ? 12 : o.limit;
  const todo = (notices || []).filter((n) => n && n.id).slice(0, limit);
  const t0 = Date.now();

  const out = {
    ok: false, mode: 'llm', model: null, modelName: null,
    promptVersion: RECOMMEND_VERSION, ranAt: now(),
    tried: 0, okCount: 0, failed: 0, results: [],
    reason: null, elapsedMs: 0,
  };
  const done = (patch) => {
    Object.assign(out, patch || {});
    out.elapsedMs = Date.now() - t0;
    return out;
  };

  if (!todo.length) return done({ ok: true, reason: '没有待推荐的通知' });

  const cloud = core.cloudClient();
  if (!cloud) return done({ mode: 'rule', reason: '云服务不可用（SDK 未安装或 publicConfig 缺失）' });

  let model;
  try {
    model = await core.pickModel(cloud, o.timeout || 20000);
  } catch (e) {
    return done({ mode: 'rule', reason: '取模型列表失败：' + (e && e.message) });
  }
  if (!model) return done({ mode: 'rule', reason: '云端未返回可用模型' });
  out.model = model.id;
  out.modelName = model.name || model.id;

  async function askOne(n) {
    let answer = '';
    try {
      const stream = cloud.llm.chat.completions.create({
        model: model.id,
        messages: [
          { role: 'system', content: RECOMMEND_SYSTEM_PROMPT },
          { role: 'user', content: buildRecommendPrompt(n, profile) },
        ],
        stream: true,
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });
      for await (const chunk of stream) {
        const d = chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) answer += d.content;
      }
    } catch (e) {
      return { ok: false, error: (e && e.error && e.error.code) || (e && e.message) || String(e) };
    }
    const parsed = core.extractJson(answer);
    if (!parsed) {
      return { ok: false, error: '输出非合法 JSON（' + answer.length + ' 字符）' };
    }
    const rel = Number(parsed.relevance);
    if (!isFinite(rel)) return { ok: false, error: 'relevance 非数值' };
    return {
      ok: true,
      relevance: Math.max(0, Math.min(100, Math.round(rel))),
      reason: String(parsed.reason || '').slice(0, 120),
      evidence: (parsed.evidence == null || parsed.evidence === '')
        ? null : String(parsed.evidence).slice(0, 400),
    };
  }

  out.tried = todo.length;
  for (const n of todo) {
    let r;
    try {
      r = await core.withTimeout(askOne(n), o.perItemTimeout || 60000, 'llm.chat.recommend');
    } catch (e) {
      r = { ok: false, error: (e && e.message) || 'unknown' };
    }
    /* 截断/超时是首因，重试一次（与理解层同款容错） */
    if (!r.ok && /非合法 JSON|TIMEOUT/.test(r.error)) {
      try {
        const r2 = await core.withTimeout(askOne(n), o.perItemTimeout || 60000, 'llm.chat.recommend.retry');
        if (r2.ok) r = r2;
      } catch (e) { /* 保持原失败 */ }
    }
    if (r.ok) {
      out.results.push({
        id: n.id, ok: true, title: n.title || '',
        relevance: r.relevance, reason: r.reason, evidence: r.evidence,
      });
    } else {
      out.results.push({ id: n.id, ok: false, error: r.error });
    }
  }

  out.okCount = out.results.filter((x) => x.ok).length;
  out.failed = out.results.length - out.okCount;
  out.ok = true;
  if (out.okCount === 0) out.reason = '模型未返回任何有效结果（' + out.failed + ' 条全部失败）';
  return done({});
}

/** 写运行留痕（保留最近 20 轮），供答辩逐条举证。失败不影响主流程。 */
function writeRunLog(r, profile) {
  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    let history = [];
    try {
      history = JSON.parse(fs.readFileSync(RUN_LOG, 'utf8')).history || [];
    } catch (e) { history = []; }
    const entry = {
      ranAt: r.ranAt, mode: r.mode, model: r.model, modelName: r.modelName,
      promptVersion: r.promptVersion, tried: r.tried, okCount: r.okCount,
      failed: r.failed, reason: r.reason, elapsedMs: r.elapsedMs,
      profile: {
        identityType: profile && profile.identityType,
        grade: profile && profile.grade,
        college: profile && profile.college,
        interests: profile && profile.interests,
        keywords: profile && profile.keywords,
      },
      results: r.results,
    };
    history.unshift(entry);
    fs.writeFileSync(
      RUN_LOG,
      JSON.stringify({ last: entry, history: history.slice(0, 20) }, null, 2),
      'utf8'
    );
    return RUN_LOG;
  } catch (e) {
    return null;
  }
}

module.exports = { recommend, writeRunLog, RECOMMEND_VERSION, RUN_LOG };
