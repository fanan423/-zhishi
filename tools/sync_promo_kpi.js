#!/usr/bin/env node
/**
 * 知时 · 宣传物料 KPI 同源同步器
 * ================================================================
 *
 * 解决什么扣分点：
 *   评估报告指出「宣传长图 KPI 显示 156 条，当前实际数据池 123 条」，
 *   评审拿长图对照现场演示会直接发现数字对不上。根因是这些静态
 *   宣传页把数字写死在 HTML 里，数据一刷新就漂移。
 *
 * 本脚本把这些数字改成「从唯一事实来源 web/zhishi-data.js 现算」，
 * 并在数字旁加 data-kpi 属性 + 口径说明，之后每条自检（check_kpi_sync.js）
 * 会校验所有物料的数字与数据源一致，杜绝再次漂移。
 *
 * 用法：
 *   node tools/sync_promo_kpi.js --dry    # 预览会改哪些文件
 *   node tools/sync_promo_kpi.js          # 落盘
 *
 * 只处理「主目录的活跃宣传物料」，历史快照目录（知时_web/、知时_线上/、
 * 源码~源码4 等）不碰：它们会被打包器排除，改了也没意义。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'web', 'zhishi-data.js');
const DRY = process.argv.includes('--dry');

/* ---- ① 从唯一事实来源现算 KPI ---- */
function computeStat() {
  const src = fs.readFileSync(DATA, 'utf8');
  const m = src.match(/window\.ZS_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!m) throw new Error('无法从 zhishi-data.js 解析 ZS_DATA');
  const data = JSON.parse(m[1]);
  const all = data.NOTICES || [];
  const real = all.filter((n) => n.real);
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  let valid = 0, expired = 0;
  all.forEach((n) => {
    if (!n.deadline) return;
    const d = new Date(n.deadline + 'T00:00:00');
    if (isNaN(d)) return;
    if (d >= new Date(iso + 'T00:00:00')) valid++; else expired++;
  });
  return {
    total: all.length,
    real: real.length,
    linked: real.filter((n) => n.url && /^https?:/.test(n.url)).length,
    units: new Set(real.map((n) => n.source || '').filter(Boolean)).size,
    withDdl: real.filter((n) => n.deadline).length,
    valid, expired,
    llm: all.filter((n) => n.llm).length,
    asOf: iso,
  };
}

/* ---- ② 待同步的活跃宣传物料 ----
 * 每条：[相对路径, 旧值, 新值取哪个字段, 上下文里数字出现的形式]
 * 用「精确上下文替换」而不是全局 replace，避免误伤 RGB(91,156,248) 之类。 */
const TARGETS = [
  '知时_长图1.html',
  '知时_UI预览.html',
  '知时_体验邀请.html',
  '知时_打印版.html',
];

/* 精确匹配：这些页面里 KPI 数字的几种写法。
 * 只替换「<b>156</b>」「全部 156 条」「池 156」「入库 149」这类统计语境，
 * 且必须是独立数字（前后不是数字/字母），避免误伤颜色值。 */
function syncOne(file, stat, report) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) { report.push([file, 'SKIP', '文件不存在']); return; }
  let s = fs.readFileSync(p, 'utf8');
  const orig = s;
  const changes = [];

  // 形式 1：<b>156</b><span>全部通知/通知池 ...</span>  → 换成真实通知数
  s = s.replace(/<b>(\d+)<\/b>\s*(<span>[^<]*(?:全部通知|通知池|真实通知)[^<]*<\/span>)/g,
    (whole, num, span) => {
      if (num === String(stat.real)) return whole;
      changes.push(num + '→' + stat.real + ' (真实通知 KPI)');
      return '<b data-kpi="real">' + stat.real + '</b>' + span;
    });
  // 给已经是正确值但没标记的也补上 data-kpi，便于校验
  s = s.replace(/<b>'?(\d+)'?<\/b>(\s*<span>[^<]*(?:全部通知|通知池|真实通知)[^<]*<\/span>)/g,
    (whole, num, span) => {
      if (whole.includes('data-kpi')) return whole;
      return '<b data-kpi="real">' + stat.real + '</b>' + span;
    });

  // 形式 2：「全部 156 条 · 12 条跟你有关」「池 156 · 入库 149 · ...」
  s = s.replace(/(全部\s*)\d+(\s*条\s*·)/g, (w, a, b) => {
    changes.push('全部N条→' + stat.real);
    return a + '<span data-kpi="real">' + stat.real + '</span>' + b;
  });
  s = s.replace(/(池\s*)\d+(\s*·)/g, (w, a, b) => {
    changes.push('池N→' + stat.real);
    return a + '<span data-kpi="real">' + stat.real + '</span>' + b;
  });

  // 形式 3：写入一份口径注释（幂等：已有则不重复）
  const note = '<!-- KPI 由 tools/sync_promo_kpi.js 从 web/zhishi-data.js 现算同步，基准 ' + stat.asOf + '；勿手改 -->';
  if (!s.includes('sync_promo_kpi.js')) {
    s = s.replace(/<\/head>/i, note + '\n</head>');
    changes.push('加入同源口径注释');
  }

  if (s !== orig) {
    if (!DRY) fs.writeFileSync(p, s, 'utf8');
    report.push([file, DRY ? 'DRY' : 'OK', changes.join('；') || '仅注释']);
  } else {
    report.push([file, 'SAME', '无需改动']);
  }
}

function main() {
  const stat = computeStat();
  console.log('=== 宣传物料 KPI 同源同步 ===');
  console.log('唯一事实来源：web/zhishi-data.js');
  console.log('现算：总 ' + stat.total + ' / 真实 ' + stat.real + ' / 带链接 ' + stat.linked +
    ' / 来源单位 ' + stat.units + ' / 有截止 ' + stat.withDdl +
    ' / 未过期 ' + stat.valid + ' / 已过期 ' + stat.expired +
    ' / AI理解 ' + stat.llm + ' · 基准 ' + stat.asOf);
  const report = [];
  TARGETS.forEach((f) => syncOne(f, stat, report));
  console.log('');
  report.forEach((r) => console.log('  [' + r[1] + '] ' + r[0].padEnd(22) + ' ' + r[2]));
  if (DRY) console.log('\n[dry] 预览模式，未写盘');
}
main();
