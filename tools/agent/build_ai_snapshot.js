#!/usr/bin/env node
/**
 * 知时 · 构建期 AI 推荐快照生成器
 * ============================================================================
 *
 * 【用途】
 *   真调一次大模型，对「网页默认画像」下规则排序靠前的 N 条通知做
 *   「通知 × 画像」相关性判断，产出 web/zhishi-ai.js（window.ZS_AI）。
 *   实用版断网打开时读取该快照，也能展示**真实的 AI 推荐结果**，
 *   并如实标注「构建期预计算（非实时调用）」。
 *
 * 【为什么用 vm 加载网页同源库】
 *   快照里的 id 必须和页面 buildPush() 产出的卡片逐条对得上，否则命中率为 0。
 *   所以在 Node 里用 vm 把 web/zhishi-data.js + web/zhishi-core.js 跑起来，
 *   用与页面**完全相同**的引擎算候选，而不是另写一套排序。
 *
 * 【诚实性】
 *   模型没调通 / 全部失败 → 不产出（或不更新）快照，页面自动降级规则推荐，
 *   绝不拿规则分冒充模型分；每次运行都写 push_out/ 下两份留痕供举证。
 *
 * 【与演示版的关系】
 *   演示版构建器 build_presentation.js 只读 zhishi-data.js，不引用本脚本产物，
 *   因此本脚本对演示版零影响。
 *
 * 用法：node tools/agent/build_ai_snapshot.js
 *       AI_SNAPSHOT_LIMIT=24（默认，范围 1..40）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const core = require('./core.js');
const rec = require('./recommend.js');

const ROOT = core.ROOT;
const WEB = path.join(ROOT, 'web');
const OUT_JS = path.join(WEB, 'zhishi-ai.js');
const OUT_JSON = path.join(ROOT, 'push_out', 'ai_recommend_snapshot.json');
const LIMIT = Math.max(1, Math.min(40, parseInt(process.env.AI_SNAPSHOT_LIMIT || '24', 10)));

function loadWeb() {
  const sandbox = {
    console, Date, Math, JSON,
    setTimeout, clearTimeout,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Array, Object, RegExp, Error,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(WEB, 'zhishi-data.js'), 'utf8'),
    sandbox, { filename: 'zhishi-data.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(WEB, 'zhishi-core.js'), 'utf8'),
    sandbox, { filename: 'zhishi-core.js' }
  );
  if (!sandbox.ZS || !sandbox.ZS_DATA) throw new Error('网页同源库加载失败（ZS / ZS_DATA 缺失）');
  return { ZS: sandbox.ZS, NOTICES: sandbox.ZS_DATA.NOTICES || [] };
}

function itemRaw(n, c) {
  return n.raw || n.digest || n.content || n.body
      || c.digestOne || n.digestOne || n.title || '';
}

async function main() {
  const { ZS, NOTICES } = loadWeb();

  /* 与 tools/app_shell.html 的 DEFAULT_PROFILE 保持一致，保证 id 对齐 */
  const profile = {
    identityType: '本科生',
    grade: '2025级 · 大一',
    college: '信息与人工智能学院',
    interests: ZS.TAGS.slice(0, 4).map((t) => t.key),
    keywords: [],
  };

  const built = ZS.buildPush(NOTICES, { profile, limit: 60 });
  const cards = (built.notify || []).concat(built.silent || []).slice(0, LIMIT);
  const byId = {};
  NOTICES.forEach((n) => { byId[String(n.id)] = n; });

  const candidates = cards.map((c) => {
    const f = byId[String(c.id)] || {};
    return {
      id: c.id,
      title: c.title,
      event: c.event || f.event,
      deadline: c.deadline || f.deadline,
      countdown: (typeof c.countdown === 'number') ? c.countdown
                : (typeof c._cd === 'number' ? c._cd : null),
      audience: f.audience || (f.llm && f.llm.who) || null,
      raw: itemRaw(f, c),
      digestOne: c.digestOne || f.digestOne || '',
      llm_fields: f.llm || null,
    };
  });

  console.log('[快照] 画像:', JSON.stringify(profile));
  console.log('[快照] 通知池', NOTICES.length, '条 → 规则候选', candidates.length, '条');
  console.log('[快照] 开始真调大模型…');

  const r = await rec.recommend(candidates, profile, { limit: LIMIT });
  console.log('[快照] 模型:', r.model, '| mode:', r.mode,
    '| tried:', r.tried, '| ok:', r.okCount, '| failed:', r.failed,
    '| 耗时:', r.elapsedMs, 'ms');
  if (r.reason) console.log('[快照] 说明:', r.reason);

  /* 运行留痕（与服务端共用一份 history） */
  rec.writeRunLog(r, profile);

  /* 快照专属留痕：完整逐条结果，供答辩举证 */
  try {
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify({
      generatedAt: r.ranAt, mode: r.mode, model: r.model,
      modelName: r.modelName, promptVersion: r.promptVersion,
      profile, tried: r.tried, okCount: r.okCount, failed: r.failed,
      reason: r.reason, elapsedMs: r.elapsedMs, results: r.results,
    }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[快照] 留痕写入失败:', e.message);
  }

  if (!r.ok || r.mode !== 'llm' || r.okCount === 0) {
    console.error('[快照] 未产出 AI 快照：模型未返回有效结果。'
      + '页面将自动降级为规则推荐（不伪造产物）。');
    process.exitCode = 1;
    return;
  }

  const items = r.results.filter((x) => x.ok).map((x) => ({
    id: x.id,
    relevance: x.relevance,
    reason: x.reason,
    evidence: x.evidence,
  }));

  const payload = {
    mode: 'llm',
    generatedAt: r.ranAt,
    model: r.model,
    modelName: r.modelName,
    promptVersion: r.promptVersion,
    tried: r.tried,
    okCount: r.okCount,
    failed: r.failed,
    profile: {
      identityType: profile.identityType, grade: profile.grade,
      college: profile.college, interests: profile.interests,
    },
    items,
  };

  const js = '/* 知时 · 构建期 AI 推荐快照（自动生成，请勿手改）\n'
    + ' * 由 tools/agent/build_ai_snapshot.js 真调大模型产出。\n'
    + ' * 实用版断网时读取本快照展示 AI 推荐，属**非实时调用**，页面会如实标注。\n'
    + ' * 生成时间 ' + r.ranAt + ' · 模型 ' + (r.model || 'unknown')
    + ' · 提示词 v' + r.promptVersion + ' · 成功 ' + r.okCount + '/' + r.tried + '\n'
    + ' */\n'
    + 'window.ZS_AI = ' + JSON.stringify(payload, null, 2) + ';\n';
  fs.writeFileSync(OUT_JS, js, 'utf8');

  console.log('[快照] 已产出 → web/zhishi-ai.js（' + items.length + ' 条 AI 推荐，'
    + (fs.statSync(OUT_JS).size / 1024).toFixed(1) + ' KB）');
  console.log('[快照] 留痕 → push_out/ai_recommend_snapshot.json、ai_recommend_run.json');
}

main().catch((e) => {
  console.error('[快照] 失败:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
