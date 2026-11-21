#!/usr/bin/env node
/**
 * 知时 · 两版交付打包器
 * ================================================================
 * 产出两个**独立、可直接解压使用**的 zip：
 *
 *   ① dist/知时_演示版.zip —— 给评委 / 答辩投屏 / 录视频
 *      演示版 HTML + 可用版 HTML（第 6 屏跳转目标）+ 两版说明 + 逐镜脚本
 *      特点：轻量、单文件、断网可演
 *
 *   ② dist/知时_可用版.zip —— 给师生真正使用 / 参赛「访问入口」
 *      完整可运行程序：两版 HTML + 小程序源码 + 网页数据与算法 + 工具链 + 文档
 *      特点：全量、可复现、可继续开发
 *
 * 为什么不用官方命名：官方要求 `队长学号+队名+作品名+访问入口`，
 * 学号 / 队名属于个人信息，本脚本**不伪造**，改用通用命名。
 * 正式提交时跑 `tools/pack_submission.py --sid <学号> --team <队名>` 即可按官方格式产出。
 *
 * 用法：node tools/build_two_versions.js
 */

const fs = require('fs');
const path = require('path');
const { createZip } = require('./lib/zip_writer');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const R = (p) => path.join(ROOT, p);

/* 通用排除规则（与 .gitignore / pack_submission.py 对齐） */
const EXCLUDE_DIRS = new Set([
  'node_modules', '__pycache__', '.git', 'dist', '_backups',
  '_原始材料', '_extract', 'push_out', '_rename_backup',
  // 历史快照目录
  '正大杯', '知时_web', '知时_带智能体小程序', '知时_收集卡',
  '知时_体验版', '知时_线上', '知时_整体Demo', '知时_主动通知Demo',
  '知时_自己能用', '知时小程序_源码', '知时小程序_源码2', '知时小程序_源码3',
  '知时小程序_源码4', '知时小程序-拖入即可运行',
]);
const EXCLUDE_SUFFIX = new Set(['.pyc', '.log', '.tmp', '.zip']);
const EXCLUDE_NAMES = new Set([
  'cloud.local.json', '项目评估报告_2026-11-15.md',
  // 内部评估/复核材料：含自评与风险判断，不进任何提交包
  '扣分点优化复核_2026-11-15.md',
  '_diag.js', 'push_state.json', '_tmpl.docx',
  // 一次性文案改名工具与其报告（含旧词映射），仅本地留档，不进交付包
  '_rename_ui.py', '_rename_ui_report.txt',
]);
const isProbe = (name) => /^_probe.*\.(js|py)$/.test(name);

function shouldInclude(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
  const name = parts[parts.length - 1];
  if (EXCLUDE_SUFFIX.has(path.extname(name).toLowerCase())) return false;
  if (EXCLUDE_NAMES.has(name) || isProbe(name)) return false;
  return true;
}

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? path.join(base, e.name) : e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(abs, rel, out);
    } else if (e.isFile() && shouldInclude(rel)) {
      out.push({ abs, rel });
    }
  }
}

/**
 * 纯 Node 打包（零外部进程）
 * ----------------------------------------------------------------
 * 旧实现调 `powershell.exe -Command Compress-Archive`，在本工作区必失败：
 *   · 工作区路径 D:\新建文件夹\... 含中文，-Command 参数按系统 ANSI(GBK)
 *     解码成 mojibake，PowerShell 写出的 zip 名与 Node 侧 UTF-8 路径对不上
 *     → 末尾 fs.statSync(outFile) 抛 ENOENT。
 *   · `-LiteralPath 'stage\*'` 不展开通配符，目录内容压不进去。
 * 现在直接读文件进内存，用 tools/lib/zip_writer.js 写标准 ZIP：
 * 不 spawn 任何进程 → 无编码/引号/代码页问题；文件名 UTF-8 + flag 0x0800
 * → Windows 资源管理器 / 7-Zip / Python zipfile 解压均不乱码。
 */
function makeZip(files, outFile, extraNote) {
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  const entries = files.map((f) => ({
    name: f.rel,
    data: fs.readFileSync(f.abs),
    mtime: fs.statSync(f.abs).mtime,
  }));
  if (extraNote) {
    entries.push({
      name: extraNote.name,
      data: Buffer.from(extraNote.content, 'utf8'),
      mtime: new Date(),
    });
  }
  fs.writeFileSync(outFile, createZip(entries));
  return fs.statSync(outFile).size;
}

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const must = ['知时_演示版.html', '知时_可用版.html', 'docs/两版交付说明.md'];
  const absent = must.filter((f) => !fs.existsSync(R(f)));
  if (absent.length) {
    console.error('缺少必需产物：' + absent.join('、'));
    console.error('请先跑：node tools/build_usable.js && node tools/build_presentation.js');
    process.exit(1);
  }

  /* ---------- ① 演示版包（轻量） ---------- */
  const demoFiles = [
    { abs: R('知时_演示版.html'), rel: '知时_演示版.html' },
    { abs: R('知时_可用版.html'), rel: '知时_可用版.html' },
    /* 屏 6「现场演示」的按钮 href 与 iframe src 都指向 知时_可用版.html（已含）。
       知时.html 是应用内核，随包保留以便按 docs/两版交付说明.md 第五节复现重建。 */
    { abs: R('知时.html'), rel: '知时.html' },
    { abs: R('docs/两版交付说明.md'), rel: '两版交付说明.md' },
    { abs: R('docs/演示视频脚本.md'), rel: '演示视频脚本.md' },
  ];
  const demoZip = path.join(DIST, '知时_演示版.zip');
  const demoSize = makeZip(demoFiles, demoZip, {
    name: 'README_演示版.txt',
    content: [
      '知时 · 安农校园信息雷达 —— 演示版',
      '',
      '双击「知时_演示版.html」即可打开（无需联网、无需安装）。',
      '键盘 ← → / 空格 / PageUp / PageDown 翻页；URL #N 直达第 N 屏（1 起，',
      '  与右下角页码一致），例如 #6 = AI 举证屏、#7 = 现场演示屏。',
      '第 7 屏「现场演示」会内嵌预览并新窗口打开同目录的「知时_可用版.html」；',
      '  该文件已随包附上；另附 知时.html 应用内核便于复现重建。',
      '  file:// 下若 iframe 被浏览器拦截，请用左侧按钮新窗口打开。',
      '',
      '录演示视频：演示版屏序已对齐「演示视频脚本.md」的逐镜顺序（4分45秒）。',
      '正式提交命名：跑 tools/pack_submission.py --sid <学号> --team <队名>。',
      '',
      '详见「两版交付说明.md」。',
    ].join('\r\n'),
  });

  /* ---------- ② 可用版包（全量可运行程序） ---------- */
  const full = [];
  const TOP_FILES = [
    '知时_可用版.html', '知时_演示版.html', '知时_在线版.html', '知时.html', '交互Demo.html',
    '知时门户.html', '小程序预览.html', '打开总览.html', '打开小程序预览.html',
    '一键运行.bat', '一键启动_AI版.bat', 'package.json', '.gitignore', 'CHANGELOG.md', 'README.md',
  ];
  TOP_FILES.forEach((f) => { if (fs.existsSync(R(f))) full.push({ abs: R(f), rel: f }); });
  ['web', 'miniprogram', 'tools', 'docs', 'data', 'config'].forEach((d) => {
    if (fs.existsSync(R(d))) walk(R(d), d, full);
  });
  // 去重（tools/README.md 之类可能被重复收集）
  const seen = new Set();
  const fullFiles = full.filter((f) => {
    const k = f.rel.replace(/\\/g, '/');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const usableZip = path.join(DIST, '知时_可用版.zip');
  const usableSize = makeZip(fullFiles, usableZip, {
    name: 'README_可用版.txt',
    content: [
      '知时 · 安农校园信息雷达 —— 可用版（完整可运行程序）',
      '',
      '最快上手：双击「知时_可用版.html」，零依赖、断网可用。',
      '  · 在「我的」完善身份/学院/关注 → 「通知」看定向推送',
      '  · 点卡片看浓缩要点、原文出处、大模型理解与依据引文',
      '  · 「汇总」一屏汇总 / 「问答」自然语言问答 / 日历',
      '',
      '其它形态：',
      '  · 小程序：微信开发者工具导入 miniprogram/ 目录编译',
      '  · 交互 Demo：双击「交互Demo.html」',
      '  · 统一门户：双击「知时门户.html」',
      '  · 演示版：双击「知时_演示版.html」（答辩/录视频用）',
      '  · 在线真后端：知时_在线版.html，部署于保留域名，免密钥云大模型 + 云数据库（补充入口）',
      '    在线访问：https://zhishi-06927.app.workbuddy.host/?sharecode=F7FFH6SCQF',
      '    现场自检：在上面链接后加 &selftest=1',
      '',
      '重建与自检：见 docs/两版交付说明.md 第五节、docs/数据血缘与单一事实来源.md。',
      '官方提交命名：tools/pack_submission.py --sid <学号> --team <队名>',
    ].join('\r\n'),
  });

  console.log('=== 两版交付打包完成 ===');
  console.log('① 演示版  dist/知时_演示版.zip  ' + kb(demoSize) + '  （' + demoFiles.length + ' 个内容文件 + 说明）');
  console.log('② 可用版  dist/知时_可用版.zip  ' + kb(usableSize) + '  （' + fullFiles.length + ' 个文件）');
  console.log('注意：均为通用命名。正式提交请用 pack_submission.py 按官方格式命名，');
  console.log('      演示视频 / 学号 / 队名 / 电话 / 云盘上传 / 群内回复 仍需人工完成（不伪造）。');
}
main();
