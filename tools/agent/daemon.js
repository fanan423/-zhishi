/* 知时 · 服务守护进程
 * 作用：拉起 server.js，服务一旦退出立刻重新拉起，保证手机端连接不断。
 * 日志：项目根目录 知时服务.log
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(__dirname, 'server.js');
const LOG = path.join(ROOT, '知时服务.log');
const HOST = process.env.AGENT_HOST || '0.0.0.0';
const PORT = process.env.AGENT_PORT || '8787';

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}\n`;
  try { fs.appendFileSync(LOG, line); } catch (e) {}
}

let round = 0;
function start() {
  round++;
  log(`---------- 启动 知时服务 第 ${round} 次  ${HOST}:${PORT} ----------`);
  const cp = spawn(process.execPath, [SERVER, '--host', HOST, '--port', PORT], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  cp.stdout.on('data', (d) => { try { fs.appendFileSync(LOG, d); } catch (e) {} });
  cp.stderr.on('data', (d) => { try { fs.appendFileSync(LOG, '[ERR] ' + d); } catch (e) {} });
  cp.on('error', (e) => log('子进程启动失败: ' + e.message));
  cp.on('exit', (code, sig) => {
    log(`服务退出 code=${code} sig=${sig}，2 秒后自动重启`);
    setTimeout(start, 2000);
  });
}

process.on('uncaughtException', (e) => log('守护进程异常: ' + e.message));
start();
