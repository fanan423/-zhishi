const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = 'D:\\新建文件夹\\Claw\\校园信息雷达\\知时小程序-拖入即可运行';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let bad = 0;
console.log('='.repeat(64));
console.log('JS 语法校验（Node vm.Script）');
console.log('='.repeat(64));
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(src, { filename: f });
    console.log('[OK  ] ' + rel);
  } catch (e) {
    bad++;
    console.log('[FAIL] ' + rel);
    console.log('       ' + e.message);
  }
}
console.log('='.repeat(64));
console.log(bad ? `❌ ${bad} 个文件语法错误` : '✅ 全部 ' + files.length + ' 个 JS 文件语法通过');
process.exit(bad ? 1 : 0);
