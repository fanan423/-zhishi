/* 启动一个本地静态服务，方便浏览器打开预览文件 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 7788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8'
};

http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/小程序预览.html';
  /* ASCII 短别名，方便自动化工具与命令行直接访问 */
  if (p === '/preview' || p === '/preview.html') p = '/小程序预览.html';
  if (p === '/open' || p === '/open.html') p = '/打开小程序预览.html';
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, function (err, buf) {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', function () {
  console.log('preview server → http://127.0.0.1:' + PORT + '/preview');
  console.log('                 别名 /open → 打开小程序预览.html');
});
