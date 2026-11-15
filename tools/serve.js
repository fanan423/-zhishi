/**
 * 极简静态服务器（零依赖，只用 Node 内置模块）
 * ================================================
 * 用途：一键运行.bat 在没装 python 时的退路。
 * 默认服务 web/ 目录、以 overview.html 为首页；
 * 也接受命令行参数覆盖根目录与首页（一键运行.bat 现在指向项目根目录 + 知时门户.html）。
 *
 * 用法：node tools/serve.js [port] [rootDir] [indexFile]
 *   例：node tools/serve.js 8420                    → 服务 web/，首页 overview.html
 *       node tools/serve.js 8420 . 知时门户.html     → 服务项目根，首页 知时门户.html
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8420;
const ROOT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(__dirname, '..', 'web');
const INDEX = process.argv[4] || 'overview.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/' + INDEX;

  /* 防目录穿越 */
  const target = path.normalize(path.join(ROOT, rel));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 越界访问被拒绝');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 未找到：' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('知时 · 本地预览服务已启动');
  console.log('  http://127.0.0.1:' + PORT + '/' + INDEX);
  console.log('  根目录: ' + ROOT);
  console.log('  （按 Ctrl+C 停止）');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，换一个：node tools/serve.js 8421');
  } else {
    console.error('服务启动失败：' + e.message);
  }
  process.exit(1);
});
