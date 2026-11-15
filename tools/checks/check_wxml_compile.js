// 模拟微信 WXML 编译器的属性解析 + 条件链校验
// 重点：复现 "Bad attr `wx:if` with unexpected token `.`" 这类报错
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\新建文件夹\\Claw\\校园信息雷达\\知时小程序-拖入即可运行';

// ---- 表达式合法性检查（模拟 WXML 的 JS 表达式扫描）----
// WXML 插值里必须是合法 JS 表达式；这里用 new Function 做宽松校验
function checkExpr(expr, file, line) {
  const errors = [];
  let e = expr.trim();
  if (!e) return errors;
  try {
    // 包成箭头函数体避免顶层 return 等问题
    new Function('"use strict"; return (' + e + ');');
  } catch (err) {
    // 有些合法 WXML 表达式不是合法 JS 独立表达式（如 a ? b : c 带单引号）
    // 再试一次：把模板里的字符串都当合法处理
    try {
      new Function('"use strict"; const __x={' + e + '};');
    } catch (e2) {
      errors.push(`${file}:${line} 表达式非法: {{${expr}}} -> ${err.message}`);
    }
  }
  return errors;
}

// ---- 属性扫描：找 wx:if / wx:elif / wx:else 及其表达式 ----
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
const ATTR_RE = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

const VOID = new Set(['image', 'input', 'icon', 'progress', 'import', 'include', 'wxs', 'slot']);

let totalErr = 0;
const allErr = [];

for (const f of fs.readdirSync(path.join(ROOT, 'pages'))) {
  const file = path.join(ROOT, 'pages', f, f + '.wxml');
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' ')); // 保留行号
  const rel = `pages/${f}/${f}.wxml`;

  // 1. 表达式检查
  let m;
  const interpRe = /\{\{([\s\S]*?)\}\}/g;
  while ((m = interpRe.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    allErr.push(...checkExpr(m[1], rel, line));
  }

  // 2. 属性解析 + 条件链
  TAG_RE.lastIndex = 0;
  const stack = [];           // 元素栈
  const lastCond = new Map(); // parentId -> 'if'|'elif'|'else'|'plain'
  let idSeq = 0;

  while ((m = TAG_RE.exec(src))) {
    const closing = m[1], rawTag = m[2], attrText = m[3], self = m[4];
    const tag = rawTag.toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;

    if (closing) { stack.pop(); continue; }

    const parentId = stack.length ? stack[stack.length - 1].id : 'ROOT';
    // 解析属性
    const attrs = {};
    ATTR_RE.lastIndex = 0;
    let a;
    while ((a = ATTR_RE.exec(attrText))) {
      attrs[a[1]] = a[3] !== undefined ? a[3] : a[4];
    }
    const cond = attrs['wx:if'] !== undefined ? 'if'
      : attrs['wx:elif'] !== undefined ? 'elif'
        : attrs['wx:else'] !== undefined ? 'else' : 'plain';

    if (cond === 'elif' || cond === 'else') {
      const prev = lastCond.get(parentId);
      if (!prev || (prev !== 'if' && prev !== 'elif')) {
        allErr.push(`${rel}:${line} wx:${cond} 缺前置同层级 wx:if/elif（前一个: ${prev || '无'}）`);
      }
    }

    // 同一标签 wx:for + wx:if 混用告警（非致命）
    if (attrs['wx:for'] !== undefined && (cond === 'if' || cond === 'elif')) {
      allErr.push(`${rel}:${line} 同标签混用 wx:for 与 wx:${cond}（模板可解析但优先级需注意）`);
    }

    lastCond.set(parentId, cond);

    idSeq++;
    if (!self && !VOID.has(tag)) stack.push({ tag, id: idSeq, line });
  }

  if (stack.length) {
    for (const s of stack) allErr.push(`${rel}:${s.line} <${s.tag}> 未闭合`);
  }
}

console.log('='.repeat(68));
console.log('WXML 编译器行为模拟（表达式 + 条件链）');
console.log('='.repeat(68));
if (allErr.length) {
  console.log(`❌ ${allErr.length} 处潜在编译问题：`);
  allErr.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
} else {
  console.log('✅ 所有页面的 WXML 表达式与条件链均可通过编译');
}
console.log('='.repeat(68));
process.exit(allErr.length ? 1 : 0);
