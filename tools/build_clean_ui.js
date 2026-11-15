/* 把知时.html（用户端完整应用）的 UI 收敛成「简洁版」：
 * 主色 #00653E -> #0A6B4B，去掉渐变/投影，绿色只留状态与可点元素。
 * 与资料库「知时_UI预览」页视觉一致，产出真正可运行的实装版。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, '知时.html');
const out = path.join(ROOT, '知时_实装版.html');

let t = fs.readFileSync(src, 'utf8');

/* 1) 主色变量（浅色 + 深色） */
t = t.replace(/--brand:#00653E; --brand-2:#0A7A4C;/g, '--brand:#0A6B4B; --brand-2:#0A6B4B;');
t = t.replace(/--brand:#2FBF82; --brand-2:#23A06B;/g, '--brand:#4CC79A; --brand-2:#4CC79A;');

/* 2) 去掉所有 linear-gradient / radial-gradient（改纯色）：
 * 这些渐变几乎都是 "从 brand-2 到 brand"，收敛成纯 brand 色即可。
 * 用占位符保护，避免正则误伤 */
t = t.replace(/linear-gradient\(135deg,var\(--brand-2\),var\(--brand\)\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\(160deg,var\(--brand-2\),var\(--brand\)\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\(90deg,var\(--brand-2\),var\(--brand\)\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\(180deg,var\(--brand-2\),var\(--brand\)\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\(135deg,var\(--gold\),var\(--brand\)\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\(90deg,var\(--gold\),var\(--brand\)\)/g, 'var(--brand)');

/* 剩余渐变（告警/金色/品牌色混合等）——统一收敛成对应主色 */
t = t.replace(/linear-gradient\(160deg,#F08A4B,var\(--alert\)\)/g, 'var(--alert)');
t = t.replace(/linear-gradient\(160deg,#E8A317,var\(--gold\)\)/g, 'var(--gold)');
t = t.replace(/linear-gradient\(160deg,#C0392B,#8E2418\)/g, 'var(--alert)');
t = t.replace(/linear-gradient\(180deg,var\(--gold\),var\(--brand\)\)/g, 'var(--brand)');

/* 校徽里的小渐变（crest/bhead logo）也收敛 */
t = t.replace(/linear-gradient\(135deg,#0A7A4C,#00653E\)/g, 'var(--brand)');

/* 兜底：任何残留的 linear-gradient(…) 含 var(--brand 的都收敛成 var(--brand) */
t = t.replace(/linear-gradient\([^)]*var\(--brand-2\)[^)]*\)/g, 'var(--brand)');
t = t.replace(/linear-gradient\([^)]*var\(--brand\)[^)]*\)/g, 'var(--brand)');

/* 3) 去掉投影（改细边框或直接去投影，简洁版不用 box-shadow 做卡片） */
t = t.replace(/box-shadow:0 8px 22px rgba\(0,101,62,\.22\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:0 4px 14px rgba\(0,101,62,\.20\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:0 4px 12px rgba\(0,101,62,\.22\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:0 4px 14px rgba\(192,57,43,\.22\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:0 4px 12px rgba\(0,101,62,\.22\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:var\(--shadow\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:var\(--card-shadow\)/g, 'box-shadow:none');
t = t.replace(/box-shadow:0 1px 3px rgba\(0,0,0,\.22\)/g, 'box-shadow:none');
/* 手机壳外框投影保留（那是展示容器，不是卡片装饰） */
t = t.replace(/box-shadow:0 24px 70px rgba\(6,40,26,\.22\)/g, 'box-shadow:0 24px 70px rgba(6,40,26,.18)');

/* 4) 圆角统一：14px/13px/18px 等杂圆角 -> 16px 主圆角（预览页是 16rpx≈16px） */
t = t.replace(/border-radius:14px/g, 'border-radius:16px');
t = t.replace(/border-radius:13px/g, 'border-radius:16px');
t = t.replace(/border-radius:18px/g, 'border-radius:16px');

/* 5) 深色主题 body 背景渐变去掉（改用纯色） */
t = t.replace(/background:linear-gradient\(160deg,#E9EFE9,#F4F7F4 60%,#E6EDE6\)/g, 'background:#F4F7F4');
t = t.replace(/background:linear-gradient\(160deg,#081410,#0C1A14 60%,#081410\)/g, 'background:#0C1A14');

fs.writeFileSync(out, t, 'utf8');

/* 统计残留 */
const gradLeft = (t.match(/linear-gradient/g) || []).length;
const shadLeft = (t.match(/box-shadow:(?!none)/g) || []).length;
console.log('生成：' + out);
console.log('大小：' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
console.log('残留 linear-gradient：' + gradLeft);
console.log('残留 box-shadow（非 none）：' + shadLeft);
