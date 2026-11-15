/**
 * 校验：入口层（双击就能碰到的那些文件）自洽
 * ============================================
 * 守的是什么
 * ----------
 * 用户真正双击的是「打开总览.html / 打开小程序预览.html / 一键运行.bat /
 * tools 下的 .bat / 推送通知.vbs」这一层 —— 不是 web/ 里的页面。
 * 但这一层此前**没有任何校验**：跳转目标写错、bat 引用的脚本被改名/删掉，
 * 都不会被任何脚本发现，只会在用户双击的那一刻炸。
 *
 * 本脚本把这层锁死：
 *   A. 根目录启动页：是合法 HTML、有跳转逻辑、跳转目标确实存在
 *   B. 一键运行.bat：引用的每个路径（serve.js / web 目录 / overview.html …）都存在
 *   C. tools 下推送相关 .bat / .vbs：互相引用的文件都在（含"无 Node 退路"）
 *   D. 单文件应用 知时.html 存在且自包含（无外链、有 UTF-8 声明）
 *
 * 用法：node tools/checks/check_entry.js
 * 退出码：0=全部通过，1=有失败
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  console.log((cond ? '[OK]   ' : '[FAIL] ') + name + (extra ? ' — ' + extra : ''));
  if (cond) pass++; else fail++;
}

const exists = p => fs.existsSync(path.join(ROOT, p));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ============================================================
 * A. 根目录启动页
 * ============================================================ */
/* 启动页 = 负责"中转/开场"的根文件，双击后跳到真正的内容页 */
const LAUNCHERS = {
  '打开总览.html': '知时门户.html',
  '打开小程序预览.html': '小程序预览.html'
};

Object.entries(LAUNCHERS).forEach(([file, target]) => {
  if (!exists(file)) { t('启动页存在：' + file, false); return; }
  const html = read(file);
  const isHtml = /<!DOCTYPE html>/i.test(html) && /<\/html>/i.test(html);
  const hasJump = html.includes('location.replace') || /<meta[^>]+http-equiv=["']?refresh/i.test(html);
  /* 跳转目标：从 location.replace / href 里取出全部 .html / 目录引用 */
  const refs = [];
  const reRep = /location\.replace\(\s*["']([^"']+)["']/g;
  const reHref = /href\s*=\s*["']([^"'#]+)["']/g;
  let m;
  while ((m = reRep.exec(html))) refs.push(m[1]);
  while ((m = reHref.exec(html))) refs.push(m[1]);
  const htmlRefs = refs.filter(r => /\.html$/i.test(r));

  let allOk = true;
  htmlRefs.forEach(r => { if (!exists(r)) { allOk = false; t('  ' + file + ' 指向 ' + r + ' 存在', false); } });

  t('启动页合法且带跳转：' + file, isHtml && hasJump);
  t('启动页跳转目标都在：' + file,
    allOk && htmlRefs.includes(target),
    htmlRefs.join(' / ') || '无');
});

/* ============================================================
 * B. 一键运行.bat —— 引用的路径都要在
 * ============================================================ */
{
  const bat = '一键运行.bat';
  if (!exists(bat)) { t('一键运行.bat 存在', false); }
  else {
    const s = read(bat);
    t('一键运行.bat 存在', true);
    /* 关键引用：serve.js、知时门户.html、tools\注册后台推送.bat、知时.html */
    const mustRefs = [
      ['tools\\serve.js', 'tools/serve.js'],
      ['知时门户.html', '知时门户.html'],
      ['注册后台推送.bat', 'tools/注册后台推送.bat'],
      ['知时.html', '知时.html']
    ];
    mustRefs.forEach(([needle, fsPath]) => {
      const mentioned = s.includes(needle);
      const onDisk = exists(fsPath);
      t('一键运行.bat 引用「' + needle + '」且文件存在',
        mentioned && onDisk,
        mentioned ? (onDisk ? 'ok' : '文件缺失！') : '未提及');
    });
    t('一键运行.bat 提供了 python / node 双退路',
      s.includes('where python') && s.includes('where node'));
  }
}

/* ============================================================
 * C. tools 下推送相关脚本：互相引用都在（含"无 Node 退路"）
 * ============================================================ */
{
  /* 开始推送.bat 在"没装 Node"时引导双击 推送通知.vbs —— 这个退路必须真的存在 */
  const startBat = 'tools/开始推送.bat';
  const vbs = 'tools/推送通知.vbs';
  const daemon = 'tools/push_daemon.js';

  if (!exists(startBat)) t('tools/开始推送.bat 存在', false);
  else {
    const s = read(startBat);
    t('tools/开始推送.bat 存在', true);
    const mentionsVbs = s.includes('推送通知.vbs');
    const mentionsDaemon = s.includes('push_daemon.js');
    t('开始推送.bat 提到无 Node 退路（推送通知.vbs）', mentionsVbs);
    t('无 Node 退路文件确实存在（推送通知.vbs）', exists(vbs),
      mentionsVbs && !exists(vbs) ? '⚑ bat 引导双击，但文件不存在 —— 用户会扑空' : 'ok');
    t('开始推送.bat 引用的 push_daemon.js 存在',
      !mentionsDaemon || exists(daemon));
  }

  /* 注册后台推送.bat 引用的 push_daemon.js */
  const regBat = 'tools/注册后台推送.bat';
  if (exists(regBat)) {
    const s = read(regBat);
    t('注册后台推送.bat 引用的 push_daemon.js 存在',
      !s.includes('push_daemon.js') || exists(daemon));
  }

  /* 推送通知.vbs 自己引用的记录文件目录约定 */
  if (exists(vbs)) {
    const s = read(vbs);
    t('推送通知.vbs 读的记录路径与 push_daemon 写的一致（push_out\\今日推送.txt）',
      s.includes('push_out') && s.includes('今日推送.txt'));
    t('推送通知.vbs 有"记录不存在"的如实提示（不静默失败）',
      s.includes('还没生成推送记录'));
    t('推送通知.vbs 不内嵌中文到临时 PS（避开编码坑，走环境变量）',
      s.includes('ZHISHI_RECORD'));
  }
}

/* ============================================================
 * D. 单文件应用 知时.html
 * ============================================================ */
{
  const app = '知时.html';
  if (!exists(app)) t('知时.html 存在', false);
  else {
    const html = read(app);
    t('知时.html 存在且自包含',
      /^<!DOCTYPE html>/i.test(html.trim()) && html.includes('charset="UTF-8"') &&
      !/<link[^>]+stylesheet/i.test(html) && !/<script[^>]+src=/i.test(html),
      (html.length / 1024).toFixed(1) + ' KB');
  }
}

console.log('\n======== 入口层校验：' + pass + ' 通过 / ' + fail + ' 失败 ========');
process.exit(fail ? 1 : 0);
