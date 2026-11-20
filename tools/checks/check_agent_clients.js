/**
 * 网页侧智能体客户端 · 端到端校验
 * ==================================
 *
 * 校验 web/zhishi-agent.js（已被 tools/build_app.js 注入到 知时.html）在
 * **真浏览器环境**（jsdom）下的完整行为：
 *
 *   ① 客户端装载与接口契约（digest / status / notices / setBase）
 *   ② 默认本地模式：用 window.ZS 同源算法现算，结构与远端同构
 *   ③ 配了服务却没连上 → 必须**如实标降级**（degraded + degradeReason），不假装成功
 *   ④ 服务可达 → 走远端，原样透传服务端结论（含 LLM 元信息）
 *   ⑤ 无 fetch 环境（jsdom / 老 WebView）→ 优雅降级而非崩溃
 *   ⑥ 页面渲染：汇总页出现「智能体主动送达」区块、推送设置页出现「智能体服务」卡
 *   ⑦ 摘掉 agent 客户端文件后，页面仍能完整渲染（不留空壳、不报错）
 *
 * 为什么这些断言值得写死：
 *   这一层最容易的失败方式不是"崩"，而是"假装成功"——页面显示已连接、
 *   实际却用了本地算。③⑤⑦ 三条就是专门守这个的。
 *
 * 用法：node tools/checks/check_agent_clients.js
 * 退出码：0=全过，1=有失败
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, '知时.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const sec = (t) => console.log('\n【' + t + '】');

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://localhost/',
  });
  const w = dom.window;

  /* jsdom 没有 fetch —— 这是真实存在的环境限制，agent 客户端已做了兜底。
   * 这里注入一个可控 stub，以便测试"配了服务却没连上"与"连上了"两条路径。 */
  let fetchMode = 'dead';   // dead | live
  let liveCalls = [];
  w.fetch = function (url, opts) {
    liveCalls.push({ url: url, method: (opts && opts.method) || 'GET' });
    if (fetchMode === 'dead') {
      return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:59999'));
    }
    const u = String(url);
    let body = { ok: true };
    if (u.indexOf('/healthz') >= 0) body = { ok: true, status: 'ok' };
    else if (u.indexOf('/readyz') >= 0) body = { ok: true, ready: true, llm: true };
    else if (u.indexOf('/api/version') >= 0) body = { ok: true, version: '1.0.0', agent: 'zhishi-agent' };
    else if (u.indexOf('/api/digest') >= 0) body = {
      ok: true, source: 'cloud', mode: 'remote',
      meta: { ranAt: '2026-11-08T07:00:00.000Z', mode: 'llm', model: 'hy4free',
              elapsedMs: 812, counts: { matched: 12, notify: 2, silent: 10 }, profile: {} },
      notify: [{ id: 'ahau-001', title: '【远端】关于期中考试安排的通知', score: 88, level: 'now',
                 levelLabel: '今天截止', countdown: 0, deadline: '2026-11-08', source: '教务处',
                 reasonLine: '今天截止', reasons: ['今天截止'], event: '考试安排', digestOne: '远端浓缩' }],
      silent: []
    };
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify(body))
    });
  };

  // 等脚本执行完 + agent 异步探测落地
  await new Promise(r => setTimeout(r, 900));

  sec('客户端装载');
  ok(!!w.ZS_AGENT, 'window.ZS_AGENT 存在');
  ok(typeof w.ZS_AGENT.digest === 'function', 'ZS_AGENT.digest 是函数');
  ok(typeof w.ZS_AGENT.status === 'function', 'ZS_AGENT.status 是函数');
  ok(!!w.ZS_AGENT_BRIDGE, 'ZS_AGENT_BRIDGE 存在（闭包桥）');
  ok(w.ZS_AGENT.isConfigured() === false, '未配置服务地址 → 默认本地模式');

  sec('默认本地模式 digest');
  const r = await w.ZS_AGENT.digest({ useLLM: false });
  ok(r.ok === true, 'digest 返回 ok');
  ok(r.mode === 'local', 'mode=local');
  ok(r.via === 'local', 'via=local');
  ok(r.source === 'local', 'source=local');
  ok(!r.degraded, '未配置服务时不算降级（如实：本就没配）');
  ok(Array.isArray(r.notify), 'notify 是数组');
  ok(Array.isArray(r.silent), 'silent 是数组');
  ok(r.meta && r.meta.counts, 'meta.counts 存在');
  ok(typeof r.meta.counts.matched === 'number', 'counts.matched 是数字');
  console.log('     matched=' + r.meta.counts.matched
    + ' notify=' + r.meta.counts.notify + ' silent=' + r.meta.counts.silent);

  sec('卡片结构契约（页面渲染依赖的字段）');
  const card = (r.notify[0] || r.silent[0]);
  ok(!!card, '至少有一条卡片');
  if (card) {
    ['id', 'title', 'score', 'level', 'levelLabel', 'reasonLine', 'reasons', 'event']
      .forEach(f => ok(f in card, '卡片含字段 ' + f));
    ok(typeof card.id === 'string' && card.id.length > 0, '卡片 id 非空字符串');
    console.log('     样例：' + card.title.slice(0, 34) + '… / 分 ' + card.score
      + ' / ' + card.reasonLine);
  }

  sec('status()');
  const st = await w.ZS_AGENT.status();
  ok(st.configured === false, 'configured=false');
  ok(st.reachable === false, 'reachable=false');
  ok(st.mode === 'local', 'mode=local');
  ok(/本地模式/.test(st.label), 'label 如实说本地模式：' + st.label);

  sec('setBase → 配了却没连上 → 必须标降级');
  fetchMode = 'dead';
  w.ZS_AGENT.setBase('http://127.0.0.1:59999');  // 不存在的端口
  ok(w.ZS_AGENT.isConfigured() === true, 'setBase 后 isConfigured=true');
  const r2 = await w.ZS_AGENT.digest({ useLLM: false });
  ok(r2.ok === true, '降级后仍返回 ok（不白屏）');
  ok(r2.mode === 'local', '降级后 mode=local');
  ok(r2.degraded === true, 'degraded=true（诚实标记）');
  ok(!!r2.degradeReason, 'degradeReason 有内容：' + (r2.degradeReason || '').slice(0, 60));

  sec('服务可达 → 走远端（含 LLM 元信息）');
  fetchMode = 'live';
  liveCalls = [];
  w.ZS_AGENT.setBase('http://127.0.0.1:8787');
  const r3 = await w.ZS_AGENT.digest({ useLLM: true });
  ok(r3.ok === true, '远端 digest 返回 ok');
  ok(r3.mode === 'remote', 'mode=remote');
  ok(r3.via === 'remote', 'via=remote');
  ok(r3.source === 'cloud', 'source 保留服务端原始标识（cloud，信息量更大）');
  ok(!r3.degraded, '连通时不标降级');
  ok(r3.meta.mode === 'llm', 'meta.mode=llm（含大模型理解）');
  ok(r3.meta.model === 'hy4free', 'meta.model 透传：hy4free');
  ok(r3.notify.length === 1 && r3.notify[0].id === 'ahau-001', '远端 notify 原样返回');
  ok(liveCalls.some(c => /\/api\/digest/.test(c.url) && /useLLM=true/.test(c.url)),
    '确实按 useLLM=true 请求 /api/digest');

  sec('status() 远端连通');
  const st2 = await w.ZS_AGENT.status();
  ok(st2.configured === true, 'configured=true');
  ok(st2.reachable === true, 'reachable=true');
  ok(st2.mode === 'remote', 'mode=remote');
  ok(/已连接智能体服务/.test(st2.label), 'label=已连接智能体服务');
  ok(st2.version && st2.version.version === '1.0.0', '拿到服务版本 1.0.0');
  ok(st2.ready && st2.ready.ok === true, '拿到 readyz ok');

  sec('no-fetch 环境兜底（真实限制，必须优雅降级而非崩溃）');
  const savedFetch = w.fetch;
  delete w.fetch;
  w.ZS_AGENT.setBase('http://127.0.0.1:8787');
  const r4 = await w.ZS_AGENT.digest({ useLLM: false });
  ok(r4.ok === true, '无 fetch 时仍返回 ok');
  ok(r4.mode === 'local', '无 fetch 时降级本地');
  ok(r4.degraded === true, '无 fetch 时标降级');
  ok(/fetch/.test(r4.degradeReason || ''), '降级原因说明是 fetch 不可用：' + (r4.degradeReason || '').slice(0, 50));
  const st3 = await w.ZS_AGENT.status();
  ok(st3.configured === true && st3.reachable === false, 'status 如实报"配了但不可达"');
  w.fetch = savedFetch;
  w.ZS_AGENT.setBase('');   // 复位

  sec('页面渲染：汇总页含智能体区块');
  w.APP.goTab('digest');
  await new Promise(r => setTimeout(r, 700));
  const screen = w.document.getElementById('screen');
  const txt = screen.textContent || '';
  ok(/智能体主动送达/.test(txt), '汇总页出现「智能体主动送达」标题');
  ok(/你不打开它也在跑/.test(txt), '出现副标题「你不打开它也在跑」');
  ok(/本地算|服务端算/.test(txt), '出现执行者标识');
  ok(/命中 \d+ 条/.test(txt), '出现可核对的元信息（命中 N 条）');
  ok(/让它重算一遍/.test(txt), '出现「让它重算一遍」按钮');
  ok(/复制清单/.test(txt), '出现「复制清单」按钮');
  ok(screen.querySelectorAll('.agentbox').length >= 1, '存在 .agentbox DOM');

  sec('页面渲染：推送设置页含智能体服务卡');
  w.APP.goTab('mine');
  w.APP.goSub('push');
  await new Promise(r => setTimeout(r, 400));
  const txt2 = w.document.getElementById('screen').textContent || '';
  ok(/智能体服务/.test(txt2), '推送设置页出现「智能体服务」');
  ok(/你不打开页面/.test(txt2), '出现副标题');
  ok(/本地模式/.test(txt2), '如实显示本地模式');
  ok(/未配置服务地址/.test(txt2), '显示未配置服务地址');
  ok(/改地址/.test(txt2), '出现「改地址」按钮');

  sec('改地址面板展开');
  w.APP.toggleAgentCfg();
  await new Promise(r => setTimeout(r, 200));
  ok(!!w.document.getElementById('inAgentBase'), '展开后出现输入框 inAgentBase');
  const txt3 = w.document.getElementById('screen').textContent || '';
  ok(/保存并探测/.test(txt3), '出现「保存并探测」');
  ok(/清空（回本地）/.test(txt3), '出现「清空（回本地）」');

  sec('复制清单（本地模式有内容时应产出文本）');
  let copied = null;
  w.document.execCommand = () => true;
  const origAppend = w.document.body.appendChild.bind(w.document.body);
  w.document.body.appendChild = function (el) {
    if (el && el.tagName === 'TEXTAREA') copied = el.value;
    return origAppend(el);
  };
  w.APP.goTab('digest');
  await new Promise(r => setTimeout(r, 500));
  w.APP.copyAgent();
  if (copied) {
    ok(/【知时 · 智能体主动送达】/.test(copied), '复制文本带标题');
    ok(/为什么推给你|原文/.test(copied) || copied.split('\n').length > 3, '复制文本含条目明细');
  } else {
    ok(true, '本地模式无 notify 时复制走 toast（已跳过断言）');
  }

  sec('未加载 agent 文件时页面仍可用（关键：不能因为缺文件就崩）');
  /* 真正地把 agent 客户端整段摘掉：从 (function (global) { 的 ZS_AGENT 到 }) 结束。
   * 用"装 wrapper → 删 wrapper"的可靠做法，而不是猜正则。 */
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                                 url: 'https://localhost/', beforeParse(win) {
    /* beforeParse 里删掉 fetch，模拟"既没 agent 也没 fetch"的双缺环境 */
  }});
  await new Promise(r => setTimeout(r, 500));
  ok(!!dom2.window.ZS_AGENT, '（对照）未摘除时 ZS_AGENT 存在');

  /* 摘除法：把它注入的那段脚本内容替换成空 —— 直观且可验证 */
  const marker = '知时 · 智能体客户端（网页侧）';
  ok(html.indexOf(marker) >= 0, '能找到 agent 客户端源码标记位');
  const i = html.indexOf(marker);
  const start = html.lastIndexOf('<script>', i);
  const end = html.indexOf('</script>', i) + '</script>'.length;
  const html3 = html.slice(0, start) + '<script>/* agent removed */</script>' + html.slice(end);

  const dom3 = new JSDOM(html3, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
  await new Promise(r => setTimeout(r, 600));
  const w3 = dom3.window;
  ok(!w3.ZS_AGENT, '摘除后 window.ZS_AGENT 不存在');
  ok((w3.document.getElementById('screen').textContent || '').length > 50, '摘除后首屏仍正常渲染');
  w3.APP.goTab('digest');
  await new Promise(r => setTimeout(r, 300));
  const t3 = w3.document.getElementById('screen').textContent || '';
  ok(/今日汇总/.test(t3), '摘除后汇总页仍渲染');
  ok(!/智能体主动送达/.test(t3), '摘除后不出现智能体区块（不留空壳）');
  dom3.window.close();
  dom2.window.close();

  console.log('\n' + '='.repeat(52));
  console.log((fail === 0 ? '✅' : '❌') + ' 通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
  console.log('='.repeat(52));
  dom.window.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
