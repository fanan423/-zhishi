/**
 * 知时 · 后台主动推送任务（真·系统级打扰）
 * ==========================================
 *
 * 为什么需要它：
 *   知时.html 是单文件网页应用，"应用内推送"只能在你打开它时工作。
 *   关掉浏览器窗口，就没人替你看通知了。
 *
 *   这个脚本是**真实的后台进程**：由 Windows 任务计划定时唤起，
 *   自己读档案 → 读通知池 → 判定该不该打扰 → 弹系统通知 + 落一份推送记录。
 *   于是"推送"这件事就真的独立于你打不打开页面了。
 *
 * 怎么做到"不装任何东西还能弹通知"：
 *   不依赖 node-notifier（要装包），而是用 Windows 自带的 Windows Script Host
 *   （wscript / 一条 mshta 调用）弹原生气泡通知 —— 系统自带，零依赖。
 *   若系统禁用脚本宿主，自动降级为"生成通知文件 + 控制台输出"，绝不静默失败。
 *
 * 数据同源：
 *   · 档案   ← tools/push_profile.json（由网页应用「保存我的档案」时导出）
 *   · 通知池 ← miniprogram/data/notices.js（与小程序/网页完全同一份）
 *   · 推送算法 ← miniprogram/utils/push.js（这里用 Node 版 shim 复刻同源逻辑）
 *
 * 用法：
 *   node tools/push_daemon.js              # 跑一次（任务计划就调这个）
 *   node tools/push_daemon.js --dry        # 只算不弹，看会推什么
 *   node tools/push_daemon.js --install    # 注册到 Windows 任务计划（每天 8 点/20 点）
 *   node tools/push_daemon.js --uninstall  # 解除注册
 *   node tools/push_daemon.js --status     # 看后台推送状态
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.indexOf('--dry') >= 0;

/* ============================================================
 * 一、加载同源数据：通知池（直接 require 小程序的 data/notices.js）
 * ============================================================ */
function loadNotices() {
  const p = path.join(ROOT, 'miniprogram', 'data', 'notices.js');
  const code = fs.readFileSync(p, 'utf8');
  /* notices.js 是 CommonJS：module.exports = { NOTICES: [...] } */
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  const list = mod.exports.NOTICES || [];
  return list;
}

/* ============================================================
 * 二、加载档案：优先 push_profile.json，否则用默认档案
 * ============================================================ */
const PROFILE_FILE = path.join(__dirname, 'push_profile.json');
const DEFAULT_PROFILE = {
  identityType: '本科生', grade: '2025级 · 大一',
  college: '信息与人工智能学院', major: '', campus: '长江西路校区',
  interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'],
  advance: '截止前 7 天 / 3 天 / 1 天',
  channel: '小程序服务通知 + 群内播报',
  /* 后台推送开关与打扰策略由用户决定（可被 push_profile.json 覆盖） */
  daemonEnabled: true,
  notifyLevel: 'hot',       // hot=只打扰三天内 | all=所有 | none=不打扰
  quietHours: [22, 8]       // 免打扰时段 [起, 止)
};

function loadProfile() {
  if (fs.existsSync(PROFILE_FILE)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      return Object.assign({}, DEFAULT_PROFILE, p);
    } catch (e) {}
  }
  return Object.assign({}, DEFAULT_PROFILE);
}

/* ============================================================
 * 三、同源推送算法（与 miniprogram/utils/push.js、web/zhishi-core.js 同口径）
 * ============================================================ */
function daysUntil(deadline) {
  if (!deadline) return null;
  const d = new Date(String(deadline).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

/* 与 miniprogram/utils/identity.js 同源 —— 注意「本科生、研究生」是并列范围，不得错杀 */
function passesIdentity(n, p) {
  const a = String((n.audience && n.audience !== '原文未明确说明') ? n.audience : (n.title || ''));
  if (!a) return true;

  const isBen = /本科/.test(a);
  const isGrad = /研究生|硕士|博士/.test(a);
  const isStaffOnly = /教职工|教师|在职/.test(a) && !isBen && !isGrad;
  const myType = String(p.identityType || '');
  const mineGrad = /研究生|硕士|博士/.test(myType);

  if (isStaffOnly) {
    if (myType !== '教职工') return false;
  } else if (isBen && isGrad) {
    if (myType === '教职工') return false;
  } else if (isGrad && !isBen) {
    if (!mineGrad) return false;
  } else if (isBen && !isGrad) {
    if (mineGrad || myType === '教职工') return false;
  }

  const GK = [['2025级', '2025级 · 大一'], ['2026级', '2026级 · 大一'],
    ['2024级', '2024级 · 大二'], ['2023级', '2023级 · 大三'], ['2022级', '2022级 · 大四']];
  const hits = GK.filter(g => a.indexOf(g[0]) >= 0);
  const myGrade = String(p.grade || '');
  if (hits.length) {
    if (!hits.some(g => myGrade.indexOf(g[0]) >= 0 || myGrade === g[1])) return false;
  } else if (/大一/.test(a) && /新生/.test(a)) {
    if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大一') < 0) return false;
  } else if (/毕业生|大四/.test(a) && !/就业|招聘/.test(a)) {
    if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大四') < 0 && myGrade.indexOf('研') < 0) return false;
  }
  return true;
}

function levelOfCd(cd) {
  if (typeof cd !== 'number') return 'far';
  if (cd < 0) return 'far';
  if (cd <= 1) return 'now';
  if (cd <= 3) return 'hot';
  if (cd <= 7) return 'soon';
  if (cd <= 30) return 'plan';
  return 'far';
}

const LEVEL_LABEL = {
  now: '今天就要办', hot: '三天内要办', soon: '一周内', plan: '本月内', far: '长期有效'
};

function pushScore(n, p) {
  let s = 0;
  const cd = n.countdown;
  if (typeof cd === 'number' && cd >= 0) {
    if (cd <= 3) s += 50;
    if (cd <= 1) s += 30;
  }
  const hay = String((n.audience && n.audience !== '原文未明确说明' ? n.audience : '')) + ' ' + String(n.title || '');
  const gradeNum = (String(p.grade || '').match(/(\d{4})/) || [])[1];
  if (gradeNum && hay.indexOf(gradeNum + '级') >= 0) s += 20;
  if (p.college && hay.indexOf(p.college) >= 0) s += 20;
  if (n.priority === 'high') s += 10;
  if (n.real === true && n.url) s += 8;
  return s;
}

function pushReason(n, p) {
  const cd = n.countdown;
  if (typeof cd === 'number' && cd >= 0 && cd === 0) return '今天截止';
  if (typeof cd === 'number' && cd > 0 && cd <= 3) return '还剩 ' + cd + ' 天';
  const hay = String((n.audience || '')) + ' ' + String(n.title || '');
  const gradeNum = (String(p.grade || '').match(/(\d{4})/) || [])[1];
  if (gradeNum && hay.indexOf(gradeNum + '级') >= 0) return '点名了 ' + gradeNum + '级';
  if (p.college && hay.indexOf(p.college) >= 0) return '点名了 ' + p.college;
  return '你关注了「' + n.event + '」';
}

/* 后台推送状态留痕（与本目录下 push_state.json 对应） */
const STATE_FILE = path.join(__dirname, 'push_state.json');
function readState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
  }
  return { pushedIds: [], runs: 0, lastRunAt: 0, totalNotified: 0 };
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

/* ============================================================
 * 四、构建推送决策
 * ============================================================ */
function build(profile, notices) {
  const state = readState();
  const seen = {};
  (state.pushedIds || []).forEach(x => { seen[x] = 1; });

  /* 实时刷新倒计时（同源自纠：以 deadline 为准） */
  const pool = notices.map(n => {
    const o = Object.assign({}, n);
    const cd = daysUntil(n.deadline);
    if (typeof cd === 'number') o.countdown = cd;
    return o;
  });

  const feed = pool
    .filter(n => (profile.interests || []).indexOf(n.event) >= 0)
    .filter(n => passesIdentity(n, profile));

  const cards = feed.map(n => {
    const lv = levelOfCd(n.countdown);
    return Object.assign({}, n, {
      pushLevel: lv,
      pushLevelLabel: LEVEL_LABEL[lv],
      pushScore: pushScore(n, profile),
      pushReason: pushReason(n, profile),
      isNew: !seen[n.id],
      shouldNotify: lv === 'now' || lv === 'hot'
    });
  });

  cards.sort((a, b) => {
    if (b.pushScore !== a.pushScore) return b.pushScore - a.pushScore;
    const ca = typeof a.countdown === 'number' ? a.countdown : 9999;
    const cb = typeof b.countdown === 'number' ? b.countdown : 9999;
    if (ca !== cb) return ca - cb;
    return String(b.publish).localeCompare(String(a.publish));
  });
  cards.forEach((c, i) => { c.rank = i + 1; });

  return {
    cards,
    notify: cards.filter(c => c.shouldNotify),
    silent: cards.filter(c => !c.shouldNotify),
    newCount: cards.filter(c => c.isNew).length,
    state
  };
}

/* 是否处于免打扰时段 */
function inQuietHours(profile, now) {
  const qh = profile.quietHours;
  if (!Array.isArray(qh) || qh.length !== 2) return false;
  const h = now.getHours();
  const [from, to] = qh;
  /* 跨午夜：22 → 8 */
  if (from > to) return h >= from || h < to;
  return h >= from && h < to;
}

/* ============================================================
 * 五、弹系统通知（零依赖，用 Windows 自带脚本宿主）
 * ============================================================ */
function toastWin(title, body) {
  /* 用 PowerShell 弹一个原生气泡：Windows 10+ 走 BurntToast 风格的回退方案，
     这里用最稳的 System.Windows.Forms NotifyIcon —— 系统自带 .NET，无需装任何东西。 */
  const esc = s => String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$n = New-Object System.Windows.Forms.NotifyIcon;',
    '$n.Icon = [System.Drawing.SystemIcons]::Information;',
    '$n.BalloonTipTitle = "' + esc(title) + '";',
    '$n.BalloonTipText = "' + esc(body) + '";',
    '$n.Visible = $true;',
    '$n.ShowBalloonTip(10000);',
    'Start-Sleep -Seconds 6;',
    '$n.Dispose();'
  ].join(' ');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================================================
 * 六、输出：控制台 + 推送记录文件（永不静默）
 * ============================================================ */
function stamp(d) {
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function writeRecord(r, profile, notified, quiet) {
  const outDir = path.join(ROOT, 'push_out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const now = new Date();
  const lines = [];
  lines.push('知时 · 主动推送记录');
  lines.push('生成时间：' + stamp(now));
  lines.push('推送对象：' + [profile.identityType, profile.grade, profile.college].filter(Boolean).join(' · '));
  lines.push('关注标签：' + (profile.interests || []).join(' / '));
  lines.push('打扰策略：' + (profile.notifyLevel || 'hot') + (quiet ? '（当前处于免打扰时段）' : ''));
  lines.push('命中总数：' + r.cards.length + ' 条，其中紧急 ' + r.notify.length + ' 条，新收录 ' + r.newCount + ' 条');
  lines.push('');
  if (notified.length) {
    lines.push('=== 本次打扰（' + notified.length + ' 条）===');
    notified.forEach(c => {
      lines.push('· [' + c.pushLevelLabel + '] ' + c.title);
      lines.push('  为什么推：' + c.pushReason);
      lines.push('  截止：' + (c.deadline || '长期') + (typeof c.countdown === 'number' ? '（还剩 ' + c.countdown + ' 天）' : ''));
      lines.push('  来源：' + (c.source || '') + (c.url ? '  🔗 ' + c.url : '  （未留存链接）'));
    });
    lines.push('');
  }
  lines.push('=== 静默推送（进流不打扰，' + r.silent.length + ' 条）===');
  r.silent.slice(0, 20).forEach(c => {
    lines.push('· [' + c.pushLevelLabel + '] ' + c.title + ' —— ' + c.pushReason);
  });
  lines.push('');
  lines.push('说明：本记录由后台推送任务自动生成。每一条都挂着判定依据，可复核。');
  lines.push('数据来源：安徽农业大学公网公开通知页（ahau.edu.cn）。仅聚合公开信息。');

  const txt = lines.join('\n');
  fs.writeFileSync(path.join(outDir, '今日推送.txt'), txt, 'utf8');
  fs.writeFileSync(path.join(outDir, '推送记录_' + stamp(now).replace(/[: ]/g, '-') + '.txt'), txt, 'utf8');
  return txt;
}

/* ============================================================
 * 七、注册/解除 Windows 任务计划
 * ============================================================ */
const TASK_NAME = 'ZhishiActivePush';
const SCRIPT = path.join(__dirname, 'push_daemon.js');

function installTask() {
  const node = process.execPath;
  /* 每天 8:00 和 20:00 各跑一次 —— 早上提醒今天要办什么，晚上提醒明天别忘 */
  const ps = [
    '$a = New-ScheduledTaskAction -Execute "' + node + '" -Argument "\\"' + SCRIPT + '\\"" -WorkingDirectory "' + ROOT + '";',
    '$t1 = New-ScheduledTaskTrigger -Daily -At 8:00am;',
    '$t2 = New-ScheduledTaskTrigger -Daily -At 8:00pm;',
    'Register-ScheduledTask -TaskName "' + TASK_NAME + '" -Action $a -Trigger @($t1,$t2) -Force | Out-Null;',
    'Get-ScheduledTask -TaskName "' + TASK_NAME + '" | Select-Object TaskName,State | Format-List'
  ].join(' ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    console.log('[知时] 已注册后台推送任务：每天 08:00 / 20:00 自动检查并推送');
    console.log(out.trim());
    console.log('\n管理方式：');
    console.log('  查看：schtasks /query /tn ' + TASK_NAME);
    console.log('  立即跑一次：schtasks /run /tn ' + TASK_NAME);
    console.log('  解除：node tools/push_daemon.js --uninstall');
    return true;
  } catch (e) {
    console.log('[知时] 注册任务计划失败（可能需要管理员权限）：');
    console.log('  ' + (e.message || e));
    console.log('  可手动双击运行 tools/注册后台推送.bat');
    return false;
  }
}

function uninstallTask() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'Unregister-ScheduledTask -TaskName "' + TASK_NAME + '" -Confirm:$false'],
      { encoding: 'utf8', stdio: 'pipe' });
    console.log('[知时] 已解除后台推送任务');
    return true;
  } catch (e) {
    console.log('[知时] 解除失败或任务本就不存在：' + (e.message || e));
    return false;
  }
}

function status() {
  const profile = loadProfile();
  const st = readState();
  console.log('==== 知时 · 后台主动推送状态 ====');
  console.log('推送对象：' + [profile.identityType, profile.grade, profile.college].filter(Boolean).join(' · '));
  console.log('关注标签：' + (profile.interests || []).join(' / '));
  console.log('打扰策略：' + (profile.notifyLevel || 'hot') + '（免打扰 ' + (profile.quietHours || []).join(':00 - ') + ':00）');
  console.log('档案来源：' + (fs.existsSync(PROFILE_FILE) ? 'push_profile.json（由网页应用导出）' : '内置默认档案'));
  console.log('累计运行：' + (st.runs || 0) + ' 次，最近一次：' + (st.lastRunAt ? stamp(new Date(st.lastRunAt)) : '从未'));
  console.log('累计打扰：' + (st.totalNotified || 0) + ' 条');
  console.log('已推记录：' + (st.pushedIds || []).length + ' 条 id');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      'try { (Get-ScheduledTask -TaskName "' + TASK_NAME + '").State } catch { "未注册" }'],
      { encoding: 'utf8' });
    console.log('任务计划：' + out.trim());
  } catch (e) { console.log('任务计划：未注册'); }
  return true;
}

/* ============================================================
 * 八、主流程
 * ============================================================ */
function run() {
  const now = new Date();
  const profile = loadProfile();
  const notices = loadNotices();
  const r = build(profile, notices);

  const quiet = inQuietHours(profile, now);
  const levelOn = profile.daemonEnabled !== false;

  /* 决定本次真正"打扰"哪些 */
  let notified = [];
  if (levelOn && !quiet) {
    if (profile.notifyLevel === 'all') notified = r.cards.slice(0, 5);
    else if (profile.notifyLevel === 'none') notified = [];
    else notified = r.notify.slice(0, 5);   // 默认：只打扰三天内
  }

  /* 控制台如实汇报 */
  const lines = [];
  lines.push('==== 知时 · 主动推送 · ' + stamp(now) + ' ====');
  lines.push('档案：' + [profile.identityType, profile.grade, profile.college].filter(Boolean).join(' · '));
  lines.push('命中 ' + r.cards.length + ' 条（紧急 ' + r.notify.length + ' · 新收录 ' + r.newCount + '）');
  if (!levelOn) lines.push('后台推送已关闭（push_profile.json 里 daemonEnabled=false）');
  else if (quiet) lines.push('当前处于免打扰时段 ' + profile.quietHours.join(':00-') + ':00，本次静默');
  else lines.push('本次打扰 ' + notified.length + ' 条');
  lines.push('');
  r.cards.slice(0, 8).forEach(c => {
    lines.push('  [' + String(c.rank).padStart(2, ' ') + '] ' + c.pushLevelLabel + ' · ' + c.title);
    lines.push('       为什么推：' + c.pushReason + (c.isNew ? '（新收录）' : ''));
  });
  const report = lines.join('\n');
  console.log(report);

  /* 弹系统通知（真打扰） */
  if (notified.length && !DRY) {
    const title = '知时 · ' + notified.length + ' 条要在三天内办完';
    const body = notified.slice(0, 3).map(c => '· ' + c.title + '（' + c.pushReason + '）').join('\n')
      + (notified.length > 3 ? '\n…等共 ' + notified.length + ' 条' : '');
    const ok = toastWin(title, body);
    console.log(ok ? '[知时] 已弹出系统通知' : '[知时] 系统通知弹出失败，已改为写入推送记录文件');
  }

  /* 写推送记录（永不静默失败） */
  const text = writeRecord(r, profile, notified, quiet);
  if (!DRY) console.log('[知时] 推送记录已写入 push_out/今日推送.txt');

  /* 留痕 */
  const st = readState();
  const seenSet = {};
  (st.pushedIds || []).forEach(x => { seenSet[x] = 1; });
  notified.forEach(c => { seenSet[c.id] = 1; });
  /* 也把静默的标为已见——它们已经在"记录"里出现过，用户能看到 */
  r.silent.forEach(c => { seenSet[c.id] = 1; });
  writeState({
    pushedIds: Object.keys(seenSet).slice(-500),
    runs: (st.runs || 0) + 1,
    lastRunAt: Date.now(),
    totalNotified: (st.totalNotified || 0) + notified.length
  });

  return 0;
}

/* ---------- 命令行分发 ---------- */
const argv = process.argv.slice(2);
if (argv.indexOf('--install') >= 0) { installTask(); process.exit(0); }
if (argv.indexOf('--uninstall') >= 0) { uninstallTask(); process.exit(0); }
if (argv.indexOf('--status') >= 0) { status(); process.exit(0); }
process.exit(run());
