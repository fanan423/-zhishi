/**
 * 知时 · 智能体运行器（命令行）
 * ==================================
 *
 * 【这一层现在很薄】
 *   六步链路全部在 tools/agent/core.js 里（服务端与 CLI 共用同一份）。
 *   本文件只做三件事：解析命令行 → 调 core → 打印与落盘。
 *   这样"命令行跑出来的结论"与"HTTP 服务返回的结论"**必然一致**，
 *   因为它们是同一段代码算的。
 *
 * 【用法】
 *   node tools/agent.js                          # 跑一轮（纯规则）
 *   node tools/agent.js --llm                    # 真调大模型理解（结果进记忆）
 *   node tools/agent.js --llm --limit 8          # 只理解前 8 条"没理解过的"
 *   node tools/agent.js --profile tools/agent_profile.json
 *   node tools/agent.js --dry                    # 只跑不落盘
 *   node tools/agent.js --quiet                  # 只落盘不刷屏（定时任务用）
 *   node tools/agent.js --every 60 --llm --quiet # 常驻：每 60 分钟自己跑一轮
 *   node tools/agent.js --serve [--port 8787]    # 起 HTTP 服务（等价 server.js）
 *   node tools/agent.js --json                   # 输出机器可读 JSON
 *
 * 【降级诚实】
 *   未加 --llm、或云端不可用时：如实标注"规则版理解"，绝不假装调过模型。
 */

const fs = require('fs');
const path = require('path');

const core = require('./agent/core.js');

/* ────────────────────────── 参数 ────────────────────────── */
const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function opt(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}

const USE_LLM = flag('llm');
const DRY = flag('dry');
const QUIET = flag('quiet');
const AS_JSON = flag('json');
const SERVE = flag('serve');
const LLM_LIMIT = parseInt(opt('limit', '8'), 10);
const PROFILE_PATH = opt('profile', '');
const WATCH_MIN = parseFloat(opt('every', '0')) || 0;

/* ── --serve：转交 HTTP 服务 ── */
if (SERVE) {
  const extra = [];
  if (opt('port', '')) extra.push('--port', opt('port', '8787'));
  if (opt('host', '')) extra.push('--host', opt('host', '127.0.0.1'));
  if (QUIET) extra.push('--quiet');
  process.argv = [process.argv[0], path.join(__dirname, 'agent', 'server.js'), ...extra];
  require(path.join(__dirname, 'agent', 'server.js'));
  return;
}

/* ── --quiet：静默（定时任务）── */
const realLog = console.log.bind(console);
if (QUIET) console.log = () => {};

const line = '─'.repeat(64);

function todayStr() {
  const d = new Date();
  const z = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function stamp() {
  const d = new Date();
  const z = (x) => String(x).padStart(2, '0');
  return todayStr() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}

/* ────────────────────────── 渲染 ────────────────────────── */
function renderHuman(r, llmResults) {
  console.log(line);
  console.log('知时 · 智能体运行器  —— 自己跑完一轮，不需要人问');
  console.log(line);
  console.log('运行时间：' + r.date + '   模式：' +
    (r.mode === 'llm' ? '规则 + 真·大模型理解' : '纯规则（未调模型）'));
  if (DRY) console.log('（--dry：只跑不落盘）');

  console.log('\n① 载入通知池：' + r.steps.load.count + ' 条（数据源：' + r.steps.load.source + '）');
  if (r.steps.load.warn) console.log('   ⚠ ' + r.steps.load.warn);
  console.log('② 两道闸门：放行 ' + r.steps.gate.passed + ' 条 · 拦下 ' + r.steps.gate.blocked + ' 条');
  console.log('③ 用户画像（来自：' + r.profile.source + '）');
  console.log('   身份 ' + r.profile.identityType + ' · ' + r.profile.grade + ' · ' + r.profile.college +
    ' · 订阅 ' + (r.profile.interests || []).join('/') +
    (r.profile.keywords && r.profile.keywords.length ? ' · 关键词 ' + r.profile.keywords.join('/') : ''));

  const u = r.steps.understand;
  if (USE_LLM) {
    if (u.memoryHits) console.log('④ 记忆命中 ' + u.memoryHits + ' 条（上次已理解，不重复花钱）');
    if (u.mode !== 'llm') {
      console.log('④ ✗ 大模型不可用：' + (u.reason || '未知'));
      console.log('   → 如实降级为纯规则理解（不假装调过模型）');
    } else if (u.tried === 0) {
      console.log('④ ✓ 模型 ' + u.modelName + '（' + u.model + '）· 本轮无新条目，全部来自记忆');
    } else {
      console.log('④ ✓ 模型 ' + u.modelName + '（' + u.model + '）');
      console.log('   ✓ 尝试 ' + u.tried + ' 条 · 成功 ' + u.okCount + ' 条' +
        (u.failed ? ' · 失败 ' + u.failed + ' 条（如实计入，未编造）' : '') + ' · 已写入记忆');
      (llmResults || []).forEach((x) => {
        if (x.ok) {
          const f = x.fields;
          console.log('     · [' + x.id + '] ' + String(x.title || '').slice(0, 26));
          console.log('        类型=' + (f.event_type || '-') + ' · 截止=' + (f.deadline || '无') +
            ' · 受众=' + String(f.who || '-').slice(0, 18));
          if (f.summary) console.log('        摘要：' + String(f.summary).slice(0, 60));
        } else {
          console.log('     ✗ [' + x.id + '] 失败：' + x.error);
        }
      });
    }
  } else {
    console.log('④ 理解层：规则版（未加 --llm，未调模型）' +
      (u.memoryHits ? '；记忆里已有 ' + u.memoryHits + ' 条大模型理解结果可直接用' : ''));
  }

  console.log('⑤ 匹配：与你相关 ' + r.matched + ' 条（同源算法 store.matchNotices）');
  console.log('   打分：候选 ' + r.cards + ' 张推送卡（MAX_RAW 归一化 0-100）');
  console.log('   首页一句话：' + r.summaryLine);
  console.log('\n⑥ 决策：该主动送达 ' + r.notify.length + ' 条 · 静默进流 ' + r.silent.length + ' 条');

  console.log('\n' + line);
  console.log('【今日该主动送达的通知】');
  console.log(line);
  if (!r.notify.length) {
    console.log('  今天没有需要打扰你的通知。');
    console.log('  —— 这不是"没干活"：静默是设计的一部分，宁可少打扰一次，');
  } else {
    r.notify.slice(0, 12).forEach((c) => {
      console.log('  ▸ [' + c.score + '分 · ' + c.levelLabel + '] ' + String(c.title).slice(0, 40));
      console.log('     来源：' + (c.source || '-') + ' · 倒计时：' +
        (typeof c.countdown === 'number' ? c.countdown + ' 天' : '无截止'));
      console.log('     凭什么推：' + (c.reasonLine || '-'));
      if ((c.reasons || []).length) console.log('     全部理由：' + c.reasons.join(' + '));
    });
    if (r.notify.length > 12) console.log('  … 另有 ' + (r.notify.length - 12) + ' 条');
  }
  console.log('\n' + line);
  console.log('本轮耗时 ' + r.elapsedMs + ' ms · 模式 ' + r.mode);
  console.log(line);
}

function renderText(r) {
  const lines = [
    '知时 · 今日主动送达清单',
    '生成时间：' + r.ranAt,
    '模式：' + (r.mode === 'llm'
      ? '真·大模型理解（' + r.model + '）+ 规则打分'
      : '规则版理解（未调模型）'),
    '画像：' + r.profile.identityType + ' · ' + r.profile.grade + ' · ' + r.profile.college,
    '口径：' + r.summaryLine,
    '─'.repeat(40),
    '',
  ];
  if (!r.notify.length) {
    lines.push('（今天没有需要打扰的通知 —— 静默也是设计的一部分）');
    lines.push('');
  }
  r.notify.forEach((c, i) => {
    lines.push('【' + (i + 1) + '】' + c.title);
    lines.push('    分数：' + c.score + ' 分 · 等级：' + c.levelLabel);
    lines.push('    来源：' + (c.source || '-') + ' · 倒计时：' +
      (typeof c.countdown === 'number' ? c.countdown + ' 天' : '无截止'));
    lines.push('    凭什么推：' + (c.reasonLine || '-'));
    if ((c.reasons || []).length) lines.push('    全部理由：' + c.reasons.join(' + '));
    if (c.url) lines.push('    原文：' + c.url);
    lines.push('');
  });
  lines.push('─'.repeat(40));
  lines.push('静默进流（不打扰，但已备好）：' + r.silent.length + ' 条');
  lines.push('');
  lines.push('本清单由 tools/agent.js（核心 tools/agent/core.js）自动生成 · 打分匹配复用小程序同源算法');
  return lines.join('\r\n');
}

/* ────────────────────────── 主流程 ────────────────────────── */
async function runOne() {
  const t0 = Date.now();

  const r = await core.runOnce({
    useLLM: USE_LLM,
    llmLimit: LLM_LIMIT,
    profilePath: PROFILE_PATH || undefined,
    persistMemory: !DRY,
  });

  if (AS_JSON) {
    realLog(JSON.stringify(r, null, 2));
  } else {
    renderHuman(r, (r.steps.understand.results || []));
  }

  if (!DRY) {
    const outDir = path.join(core.ROOT, 'push_out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, 'agent_run.json');
    fs.writeFileSync(outFile, JSON.stringify(r, null, 2), 'utf8');

    const txt = path.join(outDir, '今日推送.txt');
    fs.writeFileSync(txt, renderText(r), 'utf8');

    const stampName = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, '推送记录_' + stampName + '.txt'), renderText(r), 'utf8');

    // 落盘提示即使在 quiet 下也应可见（用 realLog 直出）
    realLog('已落盘：' + path.relative(core.ROOT, outFile));
    realLog('已落盘：' + path.relative(core.ROOT, txt));
  }

  return { r, ms: Date.now() - t0 };
}

/* ── 常驻模式 ── */
if (WATCH_MIN > 0) {
  realLog('知时 · 进入常驻模式：每 ' + WATCH_MIN + ' 分钟自动跑一轮（Ctrl+C 退出）');
  let round = 0;
  const tick = async () => {
    round++;
    try {
      const { ms } = await runOne();
      realLog('[' + stamp() + '] 第 ' + round + ' 轮完成（' + ms + ' ms）');
    } catch (e) {
      console.error('[' + stamp() + '] 第 ' + round + ' 轮失败：' + (e && (e.stack || e.message)));
    }
  };
  tick();
  const timer = setInterval(tick, WATCH_MIN * 60 * 1000);
  process.on('SIGINT', () => { clearInterval(timer); realLog('\n已退出常驻模式。'); process.exit(0); });
} else {
  runOne().then(() => process.exit(0)).catch((e) => {
    console.error('运行失败：', e && (e.stack || e.message));
    process.exit(1);
  });
}
