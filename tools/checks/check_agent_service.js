/**
 * 智能体服务接口自测（真打真接口）
 * =====================================
 * 起一个临时服务 → 逐个打接口 → 断言响应结构 → 停服务。
 * 不依赖任何测试框架（只用 Node 内置 http/child_process），答辩机也能跑。
 *
 * 运行：node tools/checks/check_agent_service.js
 * 退出码：0=全过 / 1=有失败
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
/** 与 ROOT 同义的别名（本文件下方新增断言里用 coreROOT 命名，避免与 ROOT 语义混淆） */
const coreROOT = ROOT;
const PORT = parseInt(process.env.AGENT_TEST_PORT || '8799', 10);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (extra ? '  ->  ' + extra : '')); }
}

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    // 路径里的中文必须转义（Node http 会拒绝未转义的 path）
    const safePath = p.replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const r = http.request({
      host: '127.0.0.1', port: PORT, method, path: safePath,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': payload.length } : {},
        headers || {}),
      timeout: 130000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    r.on('timeout', () => { r.destroy(new Error('client timeout')); });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function waitReady(timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      req('GET', '/healthz').then((r) => resolve(r)).catch(() => {
        if (Date.now() - t0 > timeoutMs) return reject(new Error('服务未在 ' + timeoutMs + 'ms 内就绪'));
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

(async () => {
  console.log('='.repeat(60));
  console.log('智能体服务接口自测');
  console.log('='.repeat(60));

  // ── 起服务 ──
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'agent', 'server.js'),
    '--port', String(PORT), '--quiet'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { AGENT_LLM_DEFAULT: '0' }),
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  let exited = false;
  child.on('exit', () => { exited = true; });

  try {
    await waitReady(20000);
    console.log('（服务已就绪 @ ' + BASE + '）\n');

    // ── A. 健康与元信息 ──
    console.log('【A. 健康探针与元信息】');
    let r = await req('GET', '/healthz');
    ok(r.status === 200 && r.json && r.json.ok === true && r.json.status === 'alive',
      'GET /healthz 返回存活', JSON.stringify(r.json));
    ok(!!(r.headers && r.headers['x-request-id']), '响应带 X-Request-Id');

    r = await req('GET', '/readyz');
    ok(r.status === 200 || r.status === 503, 'GET /readyz 有明确状态码', 'status=' + r.status);
    ok(r.json && r.json.checks && typeof r.json.checks.cloud === 'object', 'readyz 含 cloud 检查项');
    ok(r.json && r.json.checks && typeof r.json.checks.notices === 'object', 'readyz 含 notices 检查项');
    ok(r.json && r.json.checks && typeof r.json.checks.engine === 'object', 'readyz 含 engine（同源算法）检查项');

    r = await req('GET', '/api/version');
    ok(r.status === 200 && r.json.ok && r.json.version, 'GET /api/version 返回版本');
    ok(r.json.capabilities && typeof r.json.capabilities.understand === 'boolean', 'version 含能力清单');

    r = await req('GET', '/');
    ok(r.status === 200 && Array.isArray(r.json.endpoints), 'GET / 返回接口索引');
    ok(r.json.endpoints && r.json.endpoints.length >= 10, '接口索引条数 >= 10', '实际 ' + (r.json.endpoints || []).length);

    // ── B. 通知池 ──
    console.log('\n【B. 通知池】');
    r = await req('GET', '/api/notices?limit=10');
    ok(r.status === 200 && r.json.ok === true, 'GET /api/notices 成功');
    ok(Array.isArray(r.json.items) && r.json.items.length > 0, '返回非空通知列表');
    ok(typeof r.json.total === 'number' && r.json.total > 0, '含 total 计数');
    ok(['cloud', 'local', 'merge', 'injected'].includes(r.json.source), '含数据源标识 source=' + r.json.source);
    const sample = (r.json.items || [])[0] || {};
    ok(!!sample.id && !!sample.title, '条目含 id + title');
    ok('deadline' in sample && 'countdown' in sample, '条目含 deadline + countdown');

    r = await req('GET', '/api/notices?limit=5&sort=deadline');
    ok(r.status === 200 && r.json.items.length <= 5, '支持 limit 分页');
    const cds = (r.json.items || []).map((x) => (typeof x.countdown === 'number' ? x.countdown : 99999));
    ok(cds.every((v, i) => i === 0 || cds[i - 1] <= v), 'sort=deadline 按倒计时升序');

    r = await req('GET', '/api/notices?q=考试');
    ok(r.status === 200 && Array.isArray(r.json.items), '支持 q 关键词搜索');

    r = await req('GET', '/api/notices?event=' + encodeURIComponent('学科竞赛'));
    ok(r.status === 200 && (r.json.items || []).every((x) => x.event === '学科竞赛'),
      '支持 event 精确筛选');

    r = await req('GET', '/api/notices?limit=999999');
    ok(r.status === 200 && r.json.limit <= 500, 'limit 超上限被夹到 500');

    r = await req('GET', '/api/notices?offset=-5&limit=0');
    ok(r.status === 200, '非法 offset/limit 被夹为合法值不崩');

    // ── C. 单条通知 ──
    console.log('\n【C. 单条通知与标签】');
    const firstId = sample.id;
    r = await req('GET', '/api/notices/' + encodeURIComponent(firstId));
    ok(r.status === 200 && r.json.ok && r.json.item && r.json.item.id === firstId,
      'GET /api/notices/:id 命中');
    ok(!!r.json.item.url || r.json.item.url === '', '单条含溯源 url 字段');

    r = await req('GET', '/api/notices/不存在的ID_zzz');
    ok(r.status === 404 && r.json.ok === false, '不存在的 id 返回 404');
    ok(r.json.error && r.json.error.code === 'NOT_FOUND', '404 结构含 error.code');
    ok(r.json.error && typeof r.json.error.hint === 'string', '404 含 hint 提示');

    r = await req('GET', '/api/tags');
    ok(r.status === 200 && r.json.ok && Array.isArray(r.json.items) && r.json.items.length > 0,
      'GET /api/tags 返回标签词表');
    ok((r.json.items || []).every((t) => t.key), '标签项含 key');

    // ── D. 画像 ──
    console.log('\n【D. 用户画像】');
    r = await req('GET', '/api/profile');
    ok(r.status === 200 && r.json.ok && r.json.profile, 'GET /api/profile 成功');
    ok(Array.isArray(r.json.profile.interests), '画像含 interests 数组');

    r = await req('PUT', '/api/profile', {
      profile: { identityType: '本科', grade: '2025级', college: '信息与人工智能学院',
                 interests: ['考试安排', '学科竞赛'], keywords: ['正大杯'] },
    });
    ok(r.status === 200 && r.json.ok, 'PUT /api/profile 写入成功');
    ok(r.json.profile.college === '信息与人工智能学院', '写入生效（college）');
    ok(JSON.stringify(r.json.profile.keywords) === JSON.stringify(['正大杯']), '关键词写入生效');

    r = await req('PUT', '/api/profile', { profile: { interests: '不是数组' } });
    ok(r.status === 400 && r.json.error.code === 'BAD_REQUEST', '非法画像被拒（400）');

    r = await req('PUT', '/api/profile', { profile: { interests: new Array(200).fill('x') } });
    ok(r.status === 400, '超长 interests 被拒');

    r = await req('GET', '/api/profile');
    ok(r.json.profile.college === '信息与人工智能学院', '画像已持久到服务内存（GET 复核）');

    // ── E. 理解层（规则降级，因测试环境 AGENT_LLM_DEFAULT=0）──
    console.log('\n【E. 理解层】');
    r = await req('POST', '/api/understand', { id: firstId });
    ok(r.status === 200 && r.json.ok, 'POST /api/understand 成功');
    ok(r.json.mode === 'rule' && r.json.fields === null,
      'useLLM 未开时如实返回 rule + fields=null（不伪装）');

    r = await req('POST', '/api/understand', { id: firstId, useLLM: true });
    ok(r.status === 200 || r.status === 503, 'useLLM=true 有明确结果或明确错误', 'status=' + r.status);
    if (r.status === 200) {
      ok(r.json.mode === 'llm', '开启后返回 mode=llm');
      ok(typeof r.json.success === 'boolean', '含 success 字段');
    } else {
      ok(r.json.error.code === 'UPSTREAM_UNAVAILABLE', '不可用时报 UPSTREAM_UNAVAILABLE');
      ok(!!r.json.error.hint, '错误含 hint 指引');
    }

    r = await req('POST', '/api/understand', {
      notice: { title: '临时通知', raw: '这是一条临时通知的原文，用于测试 adhoc 路径。' },
      useLLM: false,
    });
    ok(r.status === 200 && r.json.ok, 'adhoc notice 路径可用');

    r = await req('POST', '/api/understand', {});
    ok(r.status === 400 && r.json.error.code === 'BAD_REQUEST', '缺参数被拒（400）');

    // ── F. 跑一轮 ──
    console.log('\n【F. 整链 run】');
    r = await req('POST', '/api/run', { useLLM: false });
    ok(r.status === 200 && r.json.ok === true, 'POST /api/run 成功');
    ok(typeof r.json.pool === 'number' && r.json.pool > 0, '含 pool');
    ok(typeof r.json.matched === 'number', '含 matched');
    ok(Array.isArray(r.json.notify), '含 notify 数组');
    ok(Array.isArray(r.json.silent), '含 silent 数组');
    ok(!!r.json.steps && !!r.json.steps.load && !!r.json.steps.gate, '含六步明细 steps');
    ok(r.json.steps.understand && r.json.steps.understand.mode === 'rule',
      '未开 LLM 时 steps.understand.mode=rule（诚实）');
    ok(!!(r.json.summaryLine), '含 summaryLine 一句话口径');
    ok(typeof r.json.elapsedMs === 'number', '含耗时 elapsedMs');
    ok(r.json.profile && r.json.profile.college === '信息与人工智能学院',
      'run 复用服务端已存画像');
    if (r.json.notify[0]) {
      const c = r.json.notify[0];
      ok(typeof c.score === 'number' && c.score > 0, '推送卡含 0-100 分数');
      ok(!!c.levelLabel, '推送卡含等级标签');
      ok(Array.isArray(c.reasons) && c.reasons.length > 0, '推送卡含"凭什么推"理由链');
      ok(typeof c.reasonLine === 'string', '推送卡含一句话理由');
    }

    r = await req('POST', '/api/run', { useLLM: false, profile: { college: '农学院', interests: ['讲座培训'] } });
    ok(r.status === 200 && r.json.profile.college === '农学院', 'run 支持临时覆盖画像（不污染服务端）');
    r = await req('GET', '/api/profile');
    ok(r.json.profile.college === '信息与人工智能学院', '临时覆盖画像未污染服务端画像');

    // ── G. 今日清单 ──
    console.log('\n【G. 今日送达清单】');
    r = await req('GET', '/api/digest');
    ok(r.status === 200 && r.json.ok === true, 'GET /api/digest 成功');
    ok(typeof r.json.text === 'string' && r.json.text.length > 20, '含人可读 text');
    ok(r.json.meta && r.json.meta.counts, '含 meta.counts 计数');
    ok(Array.isArray(r.json.notify), '含结构化 notify');
    ok(r.json.text.includes('凭什么推') || r.json.notify.length === 0,
      '文本清单含"凭什么推"（或有 0 条时跳过）');

    const cliJson = path.join(coreROOT, 'push_out', 'agent_run.json');
    const cliBefore = fs.existsSync(cliJson) ? fs.readFileSync(cliJson, 'utf8') : null;

    r = await req('POST', '/api/digest/deliver', { useLLM: false });
    ok(r.status === 200 && r.json.ok === true, 'POST /api/digest/deliver 成功');
    ok(r.json.files && r.json.files.latest, '返回落盘文件路径');
    ok(typeof r.json.delivered === 'number', '返回送达条数');

    /* 关键不变式：服务端落盘**不能覆盖** CLI 的 agent_run.json。
     * 两个生产者结构不同（CLI=runOnce 六步；服务=/api/digest 响应），
     * 早期写同一文件，谁后跑谁覆盖谁 —— 参赛自检读到的结构会漂。
     * 这里断言"服务端跑完后，CLI 的文件字节未变"。 */
    ok(String(r.json.files.machine).indexOf('agent_deliver.json') >= 0,
      '服务端落盘到 agent_deliver.json（与 CLI 的 agent_run.json 分家）',
      'machine=' + r.json.files.machine);
    const cliAfter = fs.existsSync(cliJson) ? fs.readFileSync(cliJson, 'utf8') : null;
    ok(cliBefore === cliAfter,
      '服务端落盘未改动 CLI 的 agent_run.json',
      cliBefore === null ? '（CLI 尚未跑过，跳过对比）' : '字节一致');

    // ── H. 错误处理 ──
    console.log('\n【H. 错误处理与边界】');
    r = await req('GET', '/api/不存在的接口');
    ok(r.status === 404 && r.json.error.code === 'NOT_FOUND', '未知接口 404');

    r = await req('POST', '/api/run', {}, { 'Content-Type': 'application/json' });
    ok(r.status === 200 && r.json.steps.understand.mode === 'rule',
      '显式 useLLM 缺省时受 AGENT_LLM_DEFAULT=0 约束走规则版',
      'mode=' + (r.json.steps && r.json.steps.understand && r.json.steps.understand.mode));

    // 真正空 body（无 Content-Length）也不该崩
    r = await new Promise((resolve) => {
      const rr = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/run',
        headers: { 'Content-Type': 'application/json' } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) {}
          resolve({ status: res.statusCode, json: j });
        });
      });
      rr.on('error', () => resolve({ status: 0, json: null }));
      rr.end();
    });
    ok(r.status === 200 || r.status === 0, '空 body（无 Content-Length）不崩', 'status=' + r.status);

    // 超大 body
    const big = { notice: { title: 'x', raw: 'y'.repeat(2 * 1024 * 1024) }, useLLM: false };
    try {
      r = await req('POST', '/api/understand', big);
      ok(r.status === 413 || r.status === 400, '超大请求体被拒（413/400）', 'status=' + r.status);
    } catch (e) {
      ok(true, '超大请求体导致连接中断（可接受）');
    }

    // 非法 JSON
    r = await new Promise((resolve) => {
      const rr = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/run',
        headers: { 'Content-Type': 'application/json' } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) {}
          resolve({ status: res.statusCode, json: j });
        });
      });
      rr.write('{不是合法JSON');
      rr.end();
    });
    ok(r.status === 400 && r.json.error.code === 'BAD_REQUEST', '非法 JSON 返回 400');

    r = await req('DELETE', '/api/notices');
    ok(r.status === 404, '不支持的 HTTP 方法返回 404');

    // ── I. 鉴权（本测试未开 token，验证豁免）──
    console.log('\n【I. 鉴权行为】');
    r = await req('GET', '/healthz', undefined, { Authorization: 'Bearer wrong' });
    ok(r.status === 200, '未配 token 时 healthz 不受鉴权影响');

    // ── J. 错误响应契约统一 ──
    console.log('\n【J. 错误响应契约】');
    const errResp = await req('GET', '/api/notices/nope');
    ok(errResp.json && errResp.json.ok === false, '错误响应 ok:false');
    ok(errResp.json && errResp.json.error && errResp.json.error.code && errResp.json.error.message,
      '错误响应含 error.code + error.message');
    ok(errResp.json && errResp.json.reqId, '错误响应含 reqId（可追查）');

  } catch (e) {
    fail++;
    console.log('  ✗ 测试流程异常：' + (e && e.message));
    if (stderr) console.log('    服务 stderr：' + stderr.slice(-600));
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
      await new Promise((res) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} res(); }, 3000);
        child.on('exit', () => { clearTimeout(t); res(); });
      });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('智能体服务接口自测：' + pass + ' 项通过，' + fail + ' 项失败');
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})();
