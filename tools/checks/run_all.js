/**
 * 一键全量校验 —— 23 个校验脚本一次跑完，最后给一张总账
 * ========================================================
 * 为什么要有它
 * ----------
 * 校验脚本散在 tools/checks/ 下，23 个 js/py 混着，
 * 谁跑全、谁漏跑全靠记性。这个脚本把清单写死成代码：
 * 全部跑一遍 → 汇总通过/失败 → 打印总账 → 退出码反映结果。
 *
 * 用法：node tools/checks/run_all.js
 * 退出码：0=全部通过，1=有失败
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const C = path.join('tools', 'checks');

/**
 * 挑一个可用的 Python 解释器。
 * 不同机器 PATH 里的 `python` 可能没有 python-docx（如 Microsoft Store 版），
 * 所以优先用项目约定的解释器，再退回 PATH。
 */
function pickPython() {
  const cands = [
    'C:\\hclaw\\python\\python.exe',
    process.platform === 'win32' ? 'python' : 'python3',
    'python3',
    'python',
  ];
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['-c', 'import sys;print(sys.version_info[0])'],
                          { encoding: 'utf8', timeout: 20000 });
      if (r.status === 0) return c;
    } catch (_) { /* 试下一个 */ }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}
const PYTHON = pickPython();

/* 清单即真理：新增校验脚本时在这里加一行 */
const SUITE = [
  /* —— 静态 —— */
  ['py', 'check_miniprogram.py', '小程序代码自检（11 节）'],
  ['py', 'check_all_pages.py', '全部展示页可打开'],
  ['py', 'check_links.py', '页面互链完整'],
  ['py', 'check_wxml.py', 'wxml 绑定变量存在'],
  ['py', 'check_digest.py', '理解层浓缩与出处'],
  ['py', 'check_demo.py', 'Demo 数据合规'],
  ['js', 'check_entry.js', '入口层自洽（启动页/bat/无Node退路）'],
  /* —— 同源 —— */
  ['py', 'check_parity.py', '两端同源守卫'],
  /* —— 动态·逻辑 —— */
  ['js', 'verify_web.js', '网页版逻辑层实跑'],
  ['js', 'verify_search.js', '小程序逻辑层实跑'],
  ['js', 'verify_multisource_push.js', '多信息源×推送端到端（真实性/多源/定向/溯源）'],
  /* —— 动态·智能体服务 —— */
  ['js', 'check_agent_service.js', '智能体 HTTP 服务真起真打（冒烟/契约/错误码/边界）'],
  ['js', 'check_agent_clients.js', '智能体两端客户端（本地/远端/降级/无fetch/渲染/摘除）'],
  ['py', 'check_agent_preview.py', '小程序预览第7屏（智能体区块诚实性）'],
  /* —— 动态·真渲染/真运行 —— */
  ['js', 'check_render.js', '网页版真渲染'],
  ['js', 'check_app.js', '单文件应用真运行'],
  ['js', 'run_miniprogram.js', '小程序十页真运行'],
  ['js', 'check_preview.js', '预览页十三屏结构'],
  ['js', 'check_preview_style.js', '预览页十三屏样式'],
  ['js', 'check_demo_interactive.js', '交互 Demo 真点击'],
  ['js', 'check_portal.js', '统一门户真点击'],
  /* —— 交付就绪 —— */
  ['py', 'check_submission.py', '参赛交付就绪自检（通告/八章/打包器/程序/合规）'],
  /* —— 不变式 —— */
  ['js', 'check_daydrift.js', '倒计时日子前行不变式'],
  /* —— 大模型理解层 —— */
  ['js', 'check_llm_pipeline.js', '大模型产物回流（同源/引文诚实/端上契约/报告一致）'],
  /* —— 数据血缘 / 宣传物料同源（数据漂移守卫） —— */
  ['js', 'check_kpi_sync.js', 'KPI 同源守卫（物料/门户/数据源数字一致 + AI 区块透传）'],
  ['js', 'check_data_lineage.js', '数据血缘守卫（SSOT 派生关系/时效/LLM 产物诚实性）']
];

const results = [];
let pass = 0, fail = 0;

for (const [kind, file, desc] of SUITE) {
  const rel = path.join(C, file);
  const cmd = kind === 'py' ? PYTHON : process.execPath;
  const t0 = Date.now();
  const r = spawnSync(cmd, [rel], { cwd: ROOT, encoding: 'utf8' });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (ok) pass++; else fail++;
  results.push({ file, desc, ok, ms, status: r.status });
  console.log((ok ? '[OK]   ' : '[FAIL] ') + file.padEnd(26) + ' — ' + desc + '  (' + ms + 'ms)');
  if (!ok) {
    const tail = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-6).join('\n      ');
    console.log('      ' + tail);
  }
}

console.log('\n================ 全量校验总账 ================');
for (const x of results) {
  console.log((x.ok ? '  通过  ' : '  失败  ') + x.file.padEnd(26) + (x.ok ? '' : ' exit=' + x.status));
}
console.log('----------------------------------------------');
console.log('  合计：' + results.length + ' 个脚本 —— ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('==============================================');

process.exit(fail ? 1 : 0);
