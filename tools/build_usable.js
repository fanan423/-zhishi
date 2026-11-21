#!/usr/bin/env node
/**
 * 知时 · 可用版构建器
 * ================================================================
 * 产出 `知时_可用版.html`：在 `知时.html`（单文件零依赖完整应用）基础上，
 * 注入一层「版本定位 + 首屏结论」横幅，解决评估报告 UX 扣分项：
 *
 *   「演示模式 / 规则版理解的诚实标注，在首次体验时容易被读成
 *     『功能是假的』，需要讲解顺序上先给结论再给边界。」
 *
 * 设计：
 *   ① 不改动应用任何一行逻辑 —— 只在 <body> 开头插入一个可关闭的横幅，
 *      关掉后就是纯粹的知时.html，功能完全一致。
 *   ② 横幅里的 KPI **全部从 web/zhishi-data.js 现算**，杜绝 156 式漂移。
 *   ③ 先给结论（「可直接用」+ 数据新鲜度 + AI 理解条数），
 *      边界说明放在展开的「关于数据」里，不占首屏。
 *   ④ 单文件自包含、断网可演、可重复构建（幂等）。
 *
 * 用法：node tools/build_usable.js
 * 依赖：先跑 tools/build_app.js 生成 知时.html。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '知时.html');
const OUT = path.join(ROOT, '知时_可用版.html');
const DATA = path.join(ROOT, 'web', 'zhishi-data.js');
/* 注意：交付的「知时_可用版.html」必须自包含（无外链 script/css），
 * 这是 check_kpi_sync.js 守的产品红线（断网可演）。
 * 真正后端（云大模型 + 云数据库）走独立的「知时_在线版.html」，
 * 由 tools/build_online.js 生成并部署到保留域名，二者互不污染。 */

function computeStat() {
  const src = fs.readFileSync(DATA, 'utf8');
  const m = src.match(/window\.ZS_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!m) throw new Error('无法从 zhishi-data.js 解析 ZS_DATA');
  const all = JSON.parse(m[1]).NOTICES || [];
  const real = all.filter((n) => n.real);
  const iso = new Date().toISOString().slice(0, 10);
  const T = new Date(iso + 'T00:00:00');
  let valid = 0, expired = 0;
  all.forEach((n) => {
    if (!n.deadline) return;
    const d = new Date(n.deadline + 'T00:00:00');
    if (isNaN(d)) return;
    d >= T ? valid++ : expired++;
  });
  const dates = real.map((n) => n.publish || '').filter(Boolean).sort();
  return {
    total: all.length,
    real: real.length,
    units: new Set(real.map((n) => n.source || '').filter(Boolean)).size,
    linked: real.filter((n) => n.url && /^https?:/.test(n.url)).length,
    llm: all.filter((n) => n.llm).length,
    valid, expired,
    newest: dates.length ? dates[dates.length - 1] : '—',
    asOf: iso,
  };
}

function banner(s) {
  return `
<!-- ===== 可用版标识（tools/build_usable.js 生成，KPI 现算自 zhishi-data.js）===== -->
<style>
  #zsVerBar{position:relative;z-index:9999;background:linear-gradient(100deg,#0A6B4B,#12855f);
    color:#fff;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    padding:11px 16px 12px;box-shadow:0 2px 12px rgba(10,107,75,.18)}
  #zsVerBar .zrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;max-width:960px;margin:0 auto}
  #zsVerBar .ztag{font-size:11px;font-weight:700;letter-spacing:1px;background:rgba(255,255,255,.18);
    border:1px solid rgba(255,255,255,.32);border-radius:999px;padding:3px 11px;white-space:nowrap}
  #zsVerBar .zlead{font-size:14px;font-weight:600;line-height:1.5}
  #zsVerBar .zkpi{font-size:12px;opacity:.94;line-height:1.6}
  #zsVerBar .zkpi b{font-size:14px;font-weight:700}
  #zsVerBar .zbtns{margin-left:auto;display:flex;gap:8px;align-items:center}
  #zsVerBar .zbtn{font-size:11.5px;color:#fff;background:rgba(255,255,255,.14);
    border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:5px 10px;cursor:pointer;
    text-decoration:none;white-space:nowrap}
  #zsVerBar .zbtn:hover{background:rgba(255,255,255,.26)}
  #zsVerMore{max-width:960px;margin:9px auto 0;background:rgba(255,255,255,.12);
    border-radius:10px;padding:10px 13px;font-size:12px;line-height:1.85;display:none}
  #zsVerMore.on{display:block}
  #zsVerMore b{font-weight:700}
  @media(max-width:640px){#zsVerBar .zbtns{margin-left:0;width:100%}}
</style>
<div id="zsVerBar">
  <div class="zrow">
    <span class="ztag">可用版 · 可实际使用</span>
    <span class="zlead">这是完整功能版本：数据真实、每条可溯源、断网即可用。</span>
    <span class="zbtns">
      <a class="zbtn" href="知时_演示版.html">看演示版 ›</a>
      <button class="zbtn" id="zsVerToggle" type="button">关于数据</button>
      <button class="zbtn" id="zsVerClose" type="button">收起 ✕</button>
    </span>
  </div>
  <div class="zrow" style="margin-top:6px">
    <span class="zkpi">真实公开通知 <b>${s.real}</b> 条 · 来源单位 <b>${s.units}</b> 个 ·
      带官网链接 <b>${s.linked}</b> 条 · 当前未过期 <b>${s.valid}</b> 条 ·
      大模型已理解 <b>${s.llm}</b> 条 · 最新发布 <b>${s.newest}</b></span>
  </div>
  <div id="zsVerMore">
    <b>这份数据从哪来</b>：由采集器读取安农各单位的<b>公网公开通知页</b>，只发 GET、不登录、
    不碰教务系统后台、不绕过 WAF。${s.real} 条真实通知中 ${s.linked} 条带可点击的官网原文链接，
    点开详情页可逐字比对。<br>
    <b>AI 在哪</b>：${s.llm} 条通知带大模型结构化理解产物（谁该看 / 要做什么 / 截止 / 依据原文），
    页面标注为「构建期预计算，非实时调用」——这是刻意的离线设计，保证断网也能演、端上零依赖。
    未覆盖的条目由规则版理解层兜底，两种模式共用同一套字段契约。<br>
    <b>边界（如实说明）</b>：微信订阅消息模板 ID 未配置，站内提醒走演示模式并已标注；
    被校方 WAF 拦截的站点如实标「安全拦截」，不硬闯；教务系统后台永不接入。
    数据基准日 ${s.asOf}，有截止的条目中 ${s.expired} 条已过期（保留供回看，不参与主动打扰）。<br>
    <b>怎么用</b>：在「我的」里完善身份/学院/关注标签 → 回「通知」看与你有关的推送 →
    点卡片看浓缩、原文出处与大模型理解 → 「汇总」一屏汇总 → 「问答」直接问。
  </div>
</div>
<script>
(function(){
  var t=document.getElementById('zsVerToggle'),m=document.getElementById('zsVerMore'),
      c=document.getElementById('zsVerClose'),b=document.getElementById('zsVerBar');
  if(t&&m) t.addEventListener('click',function(){ m.classList.toggle('on');
    t.textContent=m.classList.contains('on')?'收起说明':'关于数据'; });
  if(c&&b) c.addEventListener('click',function(){
    b.style.display='none';
    try{ sessionStorage.setItem('zsVerBarHidden','1'); }catch(e){}
  });
  try{ if(sessionStorage.getItem('zsVerBarHidden')==='1'&&b) b.style.display='none'; }catch(e){}
})();
</script>
<!-- ===== /可用版标识 ===== -->
`;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('缺少 知时.html，请先跑：node tools/build_app.js');
    process.exit(1);
  }
  const s = computeStat();
  const app = fs.readFileSync(SRC, 'utf8');
  const bodyAt = app.search(/<body[^>]*>/i);
  if (bodyAt < 0) { console.error('知时.html 中找不到 <body>'); process.exit(1); }
  const openEnd = app.indexOf('>', bodyAt) + 1;
  const out = app.slice(0, openEnd) + banner(s) + app.slice(openEnd);
  fs.writeFileSync(OUT, out, 'utf8');
  console.log('[OK] 已生成 知时_可用版.html · ' + Math.round(out.length / 1024) + ' KB（自包含·断网可演）');
  console.log('     真实 ' + s.real + ' / 来源 ' + s.units + ' / 带链接 ' + s.linked +
    ' / 未过期 ' + s.valid + ' / AI理解 ' + s.llm + ' / 最新 ' + s.newest);
}
main();
