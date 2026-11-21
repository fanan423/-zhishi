#!/usr/bin/env node
/**
 * 知时 · 在线版构建器（真正后端 / 免密钥大模型 + 云数据库）
 * ================================================================
 * 产出 `知时_在线版.html`：在 `知时.html`（自包含完整应用）基础上注入
 * WorkBuddy 云服务的官方 CDN SDK + 云端客户端 + 公开配置，部署到应用
 * 保留域名后即可真调免密钥大模型做 AI 推荐，并把画像 / 留痕写入云数据库。
 *
 * 【与另外两版的关系 —— 边界清晰】
 *   知时.html        自包含基座，无云依赖（build_app.js 产出）
 *   知时_可用版.html  自包含 + 结论横幅，断网可演（build_usable.js 产出，参赛交付）
 *   知时_演示版.html  答辩演示页，纯离线（build_presentation.js 产出，零改动）
 *   知时_在线版.html  本脚本产出，内联官方 SDK 全局包，仅在保留域名在线运行（真后端入口）
 *
 *   本脚本只读 知时.html / config / web / node_modules 文件，不改动上述任何一版。
 *
 * 【为什么内联 SDK 而不是外链 CDN】
 *   官方规定单文件 HTML 用 index.global.js 全局包（IIFE 暴露 WorkBuddyCloud）。
 *   这里把同一份脚本内联，而非用 <script src> 外链：① 评审现场 CDN 不可达也能加载；
 *   ② 在线版加载 100% 可靠；③ 交付的可用版/演示版仍保持零外链（check_kpi_sync 守卫），
 *   在线版本身是联网应用，二者互不冲突。
 *
 * 用法：node tools/build_online.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, '知时.html');
const OUT = path.join(ROOT, '知时_在线版.html');
const CLOUD_CFG = path.join(ROOT, 'config', 'cloud.service.json');
const CLOUD_JS = path.join(ROOT, 'web', 'zhishi-cloud.js');
/* 官方 CDN 全局包（IIFE，暴露 WorkBuddyCloud）。这里直接内联而非外链：
 * ① 避免评审现场 CDN 不可达导致云能力失效；② 在线版加载 100% 可靠；
 * ③ 单文件 HTML 官方允许全局包形式，内联只是把同一份脚本搬进页面。 */
const SDK_JS = path.join(ROOT, 'node_modules', '@tencent-ai', 'workbuddy-cloud-sdk', 'lib', 'index.global.js');

function main() {
  [SRC, CLOUD_CFG, CLOUD_JS, SDK_JS].forEach(function (p) {
    if (!fs.existsSync(p)) { console.error('缺少文件：' + p); process.exit(1); }
  });
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CLOUD_CFG, 'utf8').trim()); }
  catch (e) { console.error('云配置解析失败：' + e.message); process.exit(1); }
  if (!cfg.endpoint || !cfg.publishableKey) {
    console.error('云配置缺 endpoint / publishableKey'); process.exit(1);
  }
  const publicCfg = {
    endpoint: cfg.endpoint,
    oauthRelayBaseUrl: cfg.oauthRelayBaseUrl || '',
    publishableKey: cfg.publishableKey
  };
  const cloudJs = fs.readFileSync(CLOUD_JS, 'utf8');
  const sdkJs = fs.readFileSync(SDK_JS, 'utf8');
  if (/<\/script/i.test(sdkJs)) { console.error('SDK 含 </script，不能直接内联'); process.exit(1); }
  const app = fs.readFileSync(SRC, 'utf8');

  /* CDN 异步加载：onload 后轮询等 ZS_CLOUD 鉴权就绪，就绪则让页面重拉一次 AI 推荐。
   * 首屏可能早于 SDK 完成（defer + 云 models.list 往返），这一步保证在线版最终走真调。
   * 离线或 Origin 不匹配时 available() 恒 false，不刷新、不报错、自动降级。 */
  const bootJs = [
    'window.__ZS_ONLINE=1;',
    '(function(){',
    '  var tries=0;',
    '  function tick(){',
    '    if(!window.ZS_CLOUD || typeof ZS_CLOUD.status!=="function"){ if(tries++<40) setTimeout(tick,300); return; }',
    '    ZS_CLOUD.status().then(function(s){',
    '      if(s && s.ok){',
    '        /* 云就绪后：刷新页面 AI 推荐区块；同时直调一次确保在线版打开必有真调留痕 */',
    '        if(window.APP && typeof APP.refreshRecommend==="function") APP.refreshRecommend();',
    '        ZS_CLOUD.recommend({limit:3}).catch(function(){});',
    '        /* 在线自检模式 ?selftest=1：把真调结果直接显示出来，供评审现场核验真后端 */',
    '        if(/selftest=1/.test(location.search)){',
    '          ZS_CLOUD.recommend({limit:2}).then(function(r){',
    '            var d=document.createElement("div");',
    '            d.style.cssText="position:fixed;left:12px;bottom:12px;z-index:99999;background:#064e3b;color:#fff;padding:12px 16px;border-radius:10px;font:14px sans-serif;max-width:360px";',
    '            d.textContent="云端自检 · "+(r.channel||"-")+" · "+(r.model||"-")+" · "',
    '              +((r.meta&&r.meta.counts&&r.meta.counts.ai)||0)+" 条AI真调 · "+((r.meta&&r.meta.elapsedMs)||0)+"ms";',
    '            d.id="zs-selftest-result"; document.body.appendChild(d);',
    '          }).catch(function(e){',
    '            var d=document.createElement("div"); d.id="zs-selftest-result";',
    '            d.style.cssText="position:fixed;left:12px;bottom:12px;z-index:99999;background:#7f1d1d;color:#fff;padding:12px 16px;border-radius:10px;font:14px sans-serif";',
    '            d.textContent="云端自检失败 · "+((e&&e.message)||"未知"); document.body.appendChild(d);',
    '          });',
    '        }',
    '        return;',
    '      }',
    '      if(tries++<40) setTimeout(tick,300);',
    '    }).catch(function(){ if(tries++<40) setTimeout(tick,300); });',
    '  }',
    '  if(window.addEventListener) window.addEventListener("load",function(){setTimeout(tick,100);});',
    '  else setTimeout(tick,100);',
    '})();'
  ].join('\n');

  const inject = '\n<!-- ===== 在线后端：WorkBuddy 免密钥大模型 + 云数据库（tools/build_online.js 注入）===== -->\n'
    + '<script>' + sdkJs + '</script>\n'
    + '<script>window.ZS_CLOUD_CONFIG=' + JSON.stringify(publicCfg) + ';</script>\n'
    + '<script>' + cloudJs + '</script>\n'
    + '<script>' + bootJs + '</script>\n'
    + '<!-- ===== /在线后端 ===== -->\n';

  const out = app.replace('</body>', inject + '</body>');
  if (out === app) { console.error('未找到 </body>，无法注入'); process.exit(1); }
  fs.writeFileSync(OUT, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log('[OK] 已生成 知时_在线版.html → ' + OUT + '（' + kb + ' KB）');
  console.log('     endpoint=' + cfg.endpoint + ' · app=' + (cfg.appName || '知时'));
  console.log('     部署到该应用保留域名后，AI 推荐走云端免密钥大模型真调。');
}
main();
