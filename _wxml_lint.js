// WXML 表达式体检：找出小程序 WXML 不支持的写法
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '知时小程序-拖入即可运行', 'pages');

function walk(dir, out) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.wxml$/.test(n)) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
let totalExpr = 0;
const bad = [];

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m;
  let line = 1;
  while ((m = re.exec(txt))) {
    const expr = m[1];
    const upto = txt.slice(0, m.index);
    const ln = upto.split('\n').length;
    totalExpr++;
    const reasons = [];
    // 函数调用：标识符/成员后紧跟 (
    if (/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/.test(expr)) {
      // 排除纯分组括号（前面不是标识符的情况已由正则保证）
      reasons.push('函数调用');
    }
    if (/\[\s*\]/.test(expr)) reasons.push('空数组字面量 []');
    if (/\?\?|\?\./.test(expr)) reasons.push('?? 或 ?.');
    if (/=>/.test(expr)) reasons.push('箭头函数');
    if (/`/.test(expr)) reasons.push('模板字符串');
    if (/\bnew\s+[A-Za-z_$]/.test(expr)) reasons.push('new 表达式');
    if (/;/.test(expr)) reasons.push('语句分号');
    if (reasons.length) {
      bad.push({ file: path.relative(ROOT, f), line: ln, expr: expr.trim().slice(0, 110), reasons });
    }
  }
}
console.log('WXML 文件数:', files.length, ' 表达式总数:', totalExpr);
if (!bad.length) {
  console.log('✅ 未发现 WXML 不支持的写法');
} else {
  console.log('⚠ 可疑表达式', bad.length, '处：');
  for (const b of bad) console.log(`  ${b.file}:${b.line} [${b.reasons.join(',')}]  ${b.expr}`);
}
