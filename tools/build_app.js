/**
 * 生成「知时.html」—— 单文件可运行应用
 * =====================================
 *
 * 为什么要有这个生成器：
 *   用户要的是「一份有功能的程序」，而不是需要装微信开发者工具才能看的东西。
 *   这个脚本把同源数据（web/zhishi-data.js）+ 同源算法（web/zhishi-core.js）
 *   + 应用外壳（本文件里的 HTML/CSS/JS）**内联**成一个单独的 .html，
 *   双击就能在浏览器里真的用起来。
 *
 * 之所以用生成而不是手写：
 *   数据一改（改小程序 data/notices.js → 跑 export_mp_data_to_web.py），
 *   这里重跑一次，应用里的数据就跟着变。同源，不用手工同步。
 *
 * 用法：node tools/build_app.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, '知时.html');

const dataJs = fs.readFileSync(path.join(WEB, 'zhishi-data.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(WEB, 'zhishi-core.js'), 'utf8');
/* 智能体客户端（网页侧）：可选注入 —— 文件不在也不报错，只是页面上少了那一块。
 * 之所以可选：万一用户裁掉这个文件，单文件应用仍应能完整跑起来。 */
let agentJs = '';
try {
  agentJs = fs.readFileSync(path.join(WEB, 'zhishi-agent.js'), 'utf8');
} catch (e) {
  agentJs = '/* web/zhishi-agent.js 未找到 —— 智能体区块将不渲染（不影响其余功能） */';
}
const shell = fs.readFileSync(path.join(__dirname, 'app_shell.html'), 'utf8');

const out = shell
  .replace('/*__DATA__*/', () => dataJs)
  .replace('/*__AGENT__*/', () => agentJs)
  .replace('/*__CORE__*/', () => coreJs);

fs.writeFileSync(OUT, out, 'utf8');
const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('已生成 → ' + OUT + '（' + kb + ' KB）' + (agentJs.slice(0, 12) === '/* web/zhish' ? ' · 未含智能体客户端' : ' · 已含智能体客户端'));
