/* 把散落的 web 资源合并成一个单文件「知时整体Demo.html」
 * 依赖：web/index.html（主链路）+ web/zhishi-core.js + web/zhishi-data.js
 * 产物：知时_整体Demo_单文件.html（双击即用，零服务端、零联网）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

function rd(p) { return fs.readFileSync(path.join(WEB, p), 'utf8'); }

const indexHtml = rd('index.html');
const coreJs = rd('zhishi-core.js');
const dataJs = rd('zhishi-data.js');

/* 1) 把 index.html 里的外链 script 替换成内联 */
let merged = indexHtml;
merged = merged.replace(
  '<script src="zhishi-core.js"></script>',
  '<script>\n' + coreJs + '\n</script>'
);
merged = merged.replace(
  '<script src="zhishi-data.js"></script>',
  '<script>\n' + dataJs + '\n</script>'
);

/* 2) 移除指向 overview.html 的返回链接（单文件里没有这页） */
merged = merged.replace(/<a href="overview\.html"[^>]*>← 返回项目总览<\/a>/g, '');
merged = merged.replace(/<a href="overview\.html"[^>]*>[^<]*← 返回项目总览[^<]*<\/a>/g, '');

/* 3) 提取 index.html 的 <style> 和 <body> 内容 */
const styleMatch = merged.match(/<style>([\s\S]*?)<\/style>/);
const styleCss = styleMatch ? styleMatch[1] : '';
const bodyMatch = merged.match(/<body>([\s\S]*?)<\/body>/);
let bodyHtml = bodyMatch ? bodyMatch[1] : merged;

/* 去掉 body 里可能残留的 <script>（内联主脚本已在 bodyHtml 里，保留即可）
 * 但要去掉 body 里可能有的外链 script 残留（已替换，应无） */

/* 4) 主动通知前端本地模拟的 HTML + JS（零服务端） */
const notifySection = `
    <!-- ============ 主动通知（前端本地模拟，零服务端） ============ -->
    <div class="view" id="v-notify">
      <div class="doc">
        <div class="card">
          <h2>主动通知 · 本地模拟演示</h2>
          <div class="hint">说明：本单文件版<strong>不含服务端</strong>，这里用浏览器本地 JS 完整模拟「授权 → 决策打分 → 生成微信服务通知 → 已读回执」链路。要真实落盘/真调微信，请用带服务端的「知时_整体Demo.zip」。</div>
          <div class="flow" style="grid-template-columns:repeat(5,1fr)">
            <div class="f"><div class="n">1</div><div class="t">授权</div><div class="d">点「开启提醒」模拟授权</div></div>
            <div class="f"><div class="n">2</div><div class="t">登记</div><div class="d">订阅类别 + 提前量入池</div></div>
            <div class="f"><div class="n">3</div><div class="t">打分</div><div class="d">0–100 可解释评分</div></div>
            <div class="f"><div class="n">4</div><div class="t">分档</div><div class="d">今天/3天/7天 五档</div></div>
            <div class="f"><div class="n">5</div><div class="t">送达</div><div class="d">主动档进微信卡片</div></div>
          </div>
          <div class="row" style="margin:14px 0">
            <button class="btn primary" id="nv-auth">开启提醒（模拟授权）</button>
            <button class="btn" id="nv-run">立即跑一轮</button>
            <button class="btn" id="nv-reset">重置</button>
          </div>
          <div class="hint" id="nv-status" style="min-height:20px">未授权，点「开启提醒」开始。</div>
        </div>
        <div class="card">
          <h2>微信服务通知（模拟收件箱）</h2>
          <div class="hint">主动档（今天/3天内要办）会推到这里；其余静默进流。</div>
          <div id="nv-inbox" style="font-size:13px;color:var(--sub)">
            <div class="empty">还没有下发。点上方「开启提醒」再「立即跑一轮」。</div>
          </div>
        </div>
        <div class="card">
          <h2>本次决策明细（可解释）</h2>
          <div class="hint">每条都给出「为什么提醒你」的理由与分数。</div>
          <div id="nv-log"></div>
        </div>
      </div>
    </div>
`;

/* 5) 组装最终单文件 */
const shellCss = `
/* ── 整体 Demo 壳样式 ── */
.shell-bar { background:#fff; border-bottom:1px solid #E6E9E6; padding:0 20px;
  display:flex; align-items:center; gap:16px; position:sticky; top:0; z-index:50; }
.shell-logo { width:34px; height:34px; border-radius:9px; background:#0A6B4B; color:#fff;
  display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; flex:none; }
.shell-brand { font-weight:650; font-size:15px; line-height:1.2; }
.shell-brand small { display:block; color:#6B7280; font-weight:400; font-size:11px; }
.shell-tabs { display:flex; gap:2px; margin-left:auto; align-self:stretch; }
.shell-tab { border:none; background:none; padding:0 14px; font-size:13.5px; color:#6B7280;
  cursor:pointer; position:relative; font-family:inherit; white-space:nowrap; }
.shell-tab:hover { color:#1F2328; }
.shell-tab.on { color:#0A6B4B; font-weight:650; }
.shell-tab.on::after { content:""; position:absolute; left:10px; right:10px; bottom:0;
  height:3px; border-radius:3px 3px 0 0; background:#0A6B4B; }
.shell-view { display:none; }
.shell-view.on { display:block; }
.doc { max-width:1000px; margin:0 auto; padding:28px 24px 60px; font:14px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:#1F2328; }
.doc .hero { background:linear-gradient(135deg,#0A6B4B,#0E8A5F); color:#fff; border-radius:16px; padding:30px 32px; margin-bottom:22px; }
.doc .hero h1 { margin:0 0 8px; font-size:24px; font-weight:700; }
.doc .hero p { margin:0; opacity:.92; font-size:14px; line-height:1.8; }
.doc .flow { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin:22px 0; }
.doc .f { background:#fff; border:1px solid #E6E9E6; border-radius:12px; padding:16px 14px; }
.doc .f .n { width:22px; height:22px; border-radius:6px; background:#EAF4EF; color:#0A6B4B;
  font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; margin-bottom:8px; }
.doc .f .t { font-weight:650; font-size:13.5px; color:#1F2328; }
.doc .f .d { color:#6B7280; font-size:11.5px; margin-top:4px; line-height:1.6; }
.doc .card { background:#fff; border:1px solid #E6E9E6; border-radius:12px; padding:20px; margin-bottom:16px; }
.doc .card h2 { font-size:15px; margin:0 0 6px; color:#1F2328; }
.doc .card .hint { color:#6B7280; font-size:12.5px; margin:0 0 14px; line-height:1.7; }
.doc .pill { display:inline-block; padding:2px 9px; border-radius:6px; font-size:11.5px;
  background:#EAF4EF; color:#0A6B4B; margin-right:6px; margin-bottom:4px; }
.doc .stat { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:14px 0; }
.doc .stat .s { background:#EAF4EF; border-radius:10px; padding:14px 16px; text-align:center; }
.doc .stat .s b { display:block; font-size:26px; color:#0A6B4B; font-weight:700; }
.doc .stat .s span { font-size:12px; color:#6B7280; }
.doc .btn { border:1px solid #E6E9E6; background:#fff; color:#1F2328; padding:8px 15px;
  border-radius:9px; font-size:13px; cursor:pointer; font-family:inherit; }
.doc .btn.primary { background:#0A6B4B; border-color:#0A6B4B; color:#fff; }
.doc .btn:hover { border-color:#0A6B4B; }
.doc .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.doc .empty { text-align:center; color:#98A49C; font-size:12.5px; padding:28px 8px; line-height:1.9; }
.doc code { background:#F1F4F1; border:1px solid #E6E9E6; border-radius:4px; padding:0 5px;
  font-size:12px; color:#0A6B4B; font-family:ui-monospace,"SF Mono",Consolas,monospace; }
@media (max-width:800px){ .doc .flow { grid-template-columns:repeat(2,1fr); } .doc .stat { grid-template-columns:1fr; } }
`;

/* 6) 通知模拟 JS */
const notifyJs = `
<script>
(function(){
  var NOTICES = (window.ZS_DATA && ZS_DATA.NOTICES) || [];
  var PROFILE = (window.ZS_DATA && ZS_DATA.PROFILE) || { interests:['学科竞赛','奖助学金','考试安排','讲座培训'] };
  var INTERESTS = PROFILE.interests || [];
  var inbox = [];      // 已下发（主动档）
  var log = [];        // 决策明细
  var authed = false;

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // 打分：命中订阅标签 +5分/个，倒计时越近越高，有明确截止日再加分
  function score(n){
    var s = 0;
    if (INTERESTS.indexOf(n.event) >= 0) s += 30;
    if (typeof n.countdown === 'number'){
      if (n.countdown < 0) s += 0;
      else if (n.countdown <= 3) s += 60;
      else if (n.countdown <= 7) s += 40;
      else if (n.countdown <= 30) s += 20;
      else s += 5;
    }
    if (n.deadline) s += 10;
    return Math.min(100, s);
  }
  function levelOf(n){
    if (typeof n.countdown === 'number'){
      if (n.countdown < 0) return 'lo';
      if (n.countdown <= 3) return 'hi';
      if (n.countdown <= 7) return 'md';
    }
    return 'lo';
  }

  function renderStatus(){
    var el = $('nv-status');
    if (!authed){ el.innerHTML = '未授权。点「开启提醒」开始。'; return; }
    el.innerHTML = '已授权 · 订阅类别 <b style="color:#0A6B4B">' + esc(INTERESTS.join(' / ')) + '</b> · 已下发 <b style="color:#0A6B4B">' + inbox.length + '</b> 条主动提醒';
  }

  function renderInbox(){
    var el = $('nv-inbox');
    if (!inbox.length){
      el.innerHTML = '<div class="empty">还没有下发。点「立即跑一轮」。</div>'; return;
    }
    var html = '';
    inbox.forEach(function(m){
      html += '<div style="background:#fff;border:1px solid #E6E9E6;border-radius:10px;padding:12px 14px;margin-bottom:10px;' + (m.read?'opacity:.6':'') + '">'
        + '<div style="font-size:11.5px;color:#98A49C">微信服务通知 · 知时</div>'
        + '<div style="font-weight:650;font-size:13.5px;margin:6px 0 4px">' + esc(m.title) + '</div>'
        + '<div style="font-size:12px;color:#6B7280;line-height:1.6">' + esc(m.digest) + '</div>'
        + '<div style="font-size:11px;color:#0A6B4B;margin-top:7px;font-weight:600">' + esc(m.reason) + ' · 剩 ' + m.countdown + ' 天</div>'
        + (m.read ? '' : '<button class="btn" style="margin-top:8px" data-read="'+m.id+'">标为已读</button>')
        + '</div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-read]').forEach(function(b){
      b.addEventListener('click', function(){
        inbox.forEach(function(m){ if (m.id === b.getAttribute('data-read')) m.read = true; });
        renderInbox();
      });
    });
  }

  function renderLog(){
    var el = $('nv-log');
    if (!log.length){ el.innerHTML = '<div class="empty">跑一轮后，这里显示每条通知的评分与理由。</div>'; return; }
    var html = '';
    log.forEach(function(l){
      var c = l.level==='hi' ? '#B42318' : l.level==='md' ? '#B7791F' : '#0A6B4B';
      html += '<div style="border-left:3px solid '+c+';background:#fff;border:1px solid #E6E9E6;border-left:3px solid '+c+';border-radius:8px;padding:10px 14px;margin-bottom:8px">'
        + '<div style="display:flex;justify-content:space-between;gap:10px"><span style="font-weight:650;font-size:13px">'+esc(l.title)+'</span>'
        + '<span style="font-weight:700;color:'+c+';white-space:nowrap">'+l.score+' 分 · '+l.label+'</span></div>'
        + '<div style="font-size:12px;color:#6B7280;margin-top:4px">'+esc(l.reason)+'</div></div>';
    });
    el.innerHTML = html;
  }

  $('nv-auth').addEventListener('click', function(){
    authed = true; renderStatus();
  });
  $('nv-run').addEventListener('click', function(){
    if (!authed){ $('nv-status').innerHTML='请先点「开启提醒（模拟授权）」。'; return; }
    inbox = []; log = [];
    var sent = 0, skipped = 0;
    NOTICES.forEach(function(n){
      if (INTERESTS.indexOf(n.event) < 0) return;   // 只处理订阅标签
      var sc = score(n); var lv = levelOf(n);
      var reason = '命中订阅「'+n.event+'」';
      if (typeof n.countdown === 'number' && n.countdown >= 0) reason += ' · 剩 '+n.countdown+' 天';
      if (lv === 'hi'){  // 主动档：今天/3天内
        var m = { id: n.id, title: n.title, digest: n.digestOne||'', reason: reason, countdown: n.countdown, read:false };
        inbox.push(m); sent++;
        log.push({ title:n.title, score:sc, label:'主动提醒', reason:reason, level:lv });
      } else if (lv === 'md'){ // 中档：静默，但记明细
        skipped++;
        log.push({ title:n.title, score:sc, label:'静默进流', reason:reason+' · 未达主动打扰阈值', level:lv });
      }
    });
    $('nv-status').innerHTML = '本轮：命中 <b style="color:#0A6B4B">'+ (sent+skipped) +'</b> 条 · 主动提醒 <b style="color:#B42318">'+sent+'</b> 条 · 静默进流 '+skipped+' 条';
    renderInbox(); renderLog();
  });
  $('nv-reset').addEventListener('click', function(){
    authed=false; inbox=[]; log=[]; renderStatus(); renderInbox(); renderLog();
  });

  renderStatus(); renderInbox(); renderLog();
})();
</script>
`;

/* 7) 壳的 body 结构 */
const overview = `
    <div class="shell-view on" data-view="overview">
      <div class="doc">
        <div class="hero">
          <h1>一个文件，看懂「知时」全貌</h1>
          <p>把学校分散在十几个官网、公众号里的公开通知，自动抓取 → 结构化 → 按「与我有关」打分分档 → 只把<strong>今天/三天内要办的事</strong>主动推到你微信里；其余静默进流，随时可搜可查。</p>
        </div>
        <div class="flow">
          <div class="f"><div class="n">1</div><div class="t">抓取</div><div class="d">定时采集教务处/学工/团委等公开通知</div></div>
          <div class="f"><div class="n">2</div><div class="t">理解</div><div class="d">抽取事件/对象/截止日，生成可溯源摘要</div></div>
          <div class="f"><div class="n">3</div><div class="t">匹配</div><div class="d">按订阅标签+身份判断「与我有关吗」</div></div>
          <div class="f"><div class="n">4</div><div class="t">打分</div><div class="d">0–100 可解释评分，五档打扰级别</div></div>
          <div class="f"><div class="n">5</div><div class="t">送达</div><div class="d">主动档推微信，其余静默进流</div></div>
        </div>
        <div class="card">
          <h2>本文件能亲手操作什么</h2>
          <div class="hint">顶部五个标签对应完整闭环，点开就能玩：</div>
          <div class="stat">
            <div class="s"><b id="ov-total">–</b><span>条结构化通知</span></div>
            <div class="s"><b>9</b><span>个订阅标签</span></div>
            <div class="s"><b>5</b><span>步决策链路</span></div>
          </div>
          <p class="note" style="color:#98A49C;font-size:12px;line-height:1.7">「主链路」标签：点「运行智能体」看聚合→理解→归类→推送，搜通知、点开溯源原文；「主动通知」标签：本地模拟授权→打分→微信服务通知收件箱。零服务端、零联网，双击即用。</p>
        </div>
      </div>
    </div>
    <div class="shell-view" data-view="data">
      <div class="doc">
        <div class="card">
          <h2>数据从哪来</h2>
          <div class="hint">只采<strong>学校官方公开信息</strong>，不碰任何私域数据。每条带出处链接，可回原文核对。</div>
          <div style="margin:8px 0 4px">数据源覆盖：</div>
          <div><span class="pill">教务处</span><span class="pill">本科生院</span><span class="pill">研究生院</span><span class="pill">学生处/学工部</span><span class="pill">团委</span><span class="pill">图书馆</span><span class="pill">信息化办公室</span><span class="pill">就业指导</span><span class="pill">各学院官网</span></div>
          <div class="hint" style="margin-top:16px">采集脚本 <code>tools/collect_notices.py</code> 输出结构化 JSON，同源注入网页版与小程序——<strong>两端一套数据口径</strong>。</div>
        </div>
        <div class="card">
          <h2>一条通知长这样</h2>
          <div class="hint">机器字段 + 人话摘要 + 可溯源要点，三者都有：</div>
          <div style="font-size:12.5px;color:#6B7280;line-height:2"><code>title</code> 标题 · <code>source</code> 来源 · <code>event</code> 归类 · <code>audience</code> 对象 · <code>deadline</code> 截止 · <code>countdown</code> 倒计时 · <code>entry</code> 入口 · <code>priority</code> 优先级 · <code>confidence</code> 置信度 · <code>digestOne</code> 摘要 · <code>digestPoints</code> 可溯源要点 · <code>url</code> 原文链接</div>
        </div>
      </div>
    </div>
    <div class="shell-view" data-view="main">
      ${bodyHtml}
    </div>
    <div class="shell-view" data-view="notify">
      ${notifySection}
    </div>
    <div class="shell-view" data-view="arch">
      <div class="doc">
        <div class="card">
          <h2>技术架构</h2>
          <div class="hint">本单文件版是「零依赖展示版」；完整版另带 Node 服务端（一个端口同时出页面+API）。</div>
          <div class="flow">
            <div class="f"><div class="n">A</div><div class="t">数据层</div><div class="d">Python 采集 + 结构化 JSON（真实 123 条）</div></div>
            <div class="f"><div class="n">B</div><div class="t">算法层</div><div class="d">标签/检索/溯源/分组，网页与小程序同源</div></div>
            <div class="f"><div class="n">C</div><div class="t">服务层</div><div class="d">Node 内置 http，暴露 digest/notices/notify 接口</div></div>
            <div class="f"><div class="n">D</div><div class="t">通知层</div><div class="d">可插拔 sender：默认落盘，配置后真调微信</div></div>
            <div class="f"><div class="n">E</div><div class="t">展示层</div><div class="d">网页 Demo + 微信小程序（同源算法）</div></div>
          </div>
        </div>
        <div class="card">
          <h2>合规与诚实</h2>
          <div class="hint">采集对象仅为公网公开通知页，等同「人工翻官网」的自动化，不碰教务系统后台、不取私域数据；AI 浓缩每句挂原文出处，抽不到的字段写「原文未明确说明」，不推测、不伪造。</div>
        </div>
      </div>
    </div>
`;

const finalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>知时 · 安农校园信息雷达 —— 整体 Demo（单文件版）</title>
<style>${styleCss}</style>
<style>${shellCss}</style>
</head>
<body>
<div class="shell-bar">
  <div class="shell-logo">知</div>
  <div class="shell-brand">知时 · 安农校园信息雷达<small>校园公开信息的智能聚合与个性化提醒智能体</small></div>
  <div class="shell-tabs">
    <button class="shell-tab on" data-view="overview">总览</button>
    <button class="shell-tab" data-view="data">数据从哪来</button>
    <button class="shell-tab" data-view="main">主链路</button>
    <button class="shell-tab" data-view="notify">主动通知</button>
    <button class="shell-tab" data-view="arch">技术架构</button>
  </div>
</div>
${overview}
${notifyJs}
<script>
(function(){
  // 壳标签切换
  var tabs = document.querySelectorAll('.shell-tab');
  var views = document.querySelectorAll('.shell-view');
  function activate(v){
    tabs.forEach(function(t){ t.classList.toggle('on', t.getAttribute('data-view')===v); });
    views.forEach(function(w){ w.classList.toggle('on', w.getAttribute('data-view')===v); });
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ activate(t.getAttribute('data-view')); }); });

  // 总览页实时统计
  try {
    var N = (window.ZS_DATA && ZS_DATA.NOTICES) || [];
    var el = document.getElementById('ov-total');
    if (el) el.textContent = N.length;
  } catch(e){}
})();
</script>
</body>
</html>
`;

const out = path.join(ROOT, '知时_整体Demo_单文件.html');
fs.writeFileSync(out, finalHtml, 'utf8');
console.log('生成：' + out);
console.log('大小：' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
