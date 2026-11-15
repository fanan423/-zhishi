// 真机式加载测试：模拟小程序环境，把所有 utils/data 模块真正 require 一遍
// 目的：抓出「模块加载期就抛错」的问题（编译期/启动期最容易挂的地方）
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = 'D:\\新建文件夹\\Claw\\校园信息雷达\\知时小程序-拖入即可运行';

// ---- 伪造小程序环境 ----
const storage = {};
let wxStub = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  request: (o) => { if (o.fail) o.fail({ errMsg: 'request:fail mock' }); },
  getAccountInfoSync: () => ({ miniProgram: { appId: 'touristappid' } }),
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.5.5' }),
  getRandomValues: () => new Uint8Array(16),
  navigateToMiniProgram: () => {},
  showToast: () => {}, showModal: () => {}, navigateTo: () => {},
  setNavigationBarTitle: () => {}, setClipboardData: () => {},
  getClipboardData: () => ({ data: '' }),
  canIUse: () => true, nextTick: (fn) => fn && fn(),
};

global.wx = wxStub;
global.App = (cfg) => { global.__APP__ = cfg; };
global.Page = (cfg) => { global.__PAGE__ = cfg; };
global.Component = (cfg) => { global.__COMP__ = cfg; };
global.getApp = () => global.__APP__ || { globalData: {} };
global.getCurrentPages = () => [];
global.console = console;

const results = [];
function tryRequire(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { results.push(['SKIP', rel, '文件不存在']); return; }
  try {
    delete require.cache[require.resolve(full)];
    require(full);
    results.push(['OK  ', rel, '']);
  } catch (e) {
    results.push(['FAIL', rel, e.message]);
  }
}

// ---- 1. 先加载 data ----
console.log('='.repeat(66));
console.log('【1】数据模块加载');
console.log('='.repeat(66));
for (const f of ['data/notices.js']) tryRequire(f);

// ---- 2. 加载所有 utils ----
const utilsDir = path.join(ROOT, 'utils');
console.log('='.repeat(66));
console.log('【2】utils 模块加载');
console.log('='.repeat(66));
for (const f of fs.readdirSync(utilsDir).filter(x => x.endsWith('.js'))) {
  tryRequire('utils/' + f);
}

// ---- 3. 加载 app.js ----
console.log('='.repeat(66));
console.log('【3】app.js');
console.log('='.repeat(66));
tryRequire('app.js');
if (global.__APP__ && typeof global.__APP__.onLaunch === 'function') {
  try {
    global.__APP__.onLaunch.call(global.__APP__);
    results.push(['OK  ', 'app.js onLaunch()', '']);
  } catch (e) {
    results.push(['FAIL', 'app.js onLaunch()', e.message]);
  }
}

// ---- 4. 加载每个页面的 js，并尝试 hook 出 Page 配置 ----
const pagesDir = path.join(ROOT, 'pages');
console.log('='.repeat(66));
console.log('【4】页面注册与 Page 配置');
console.log('='.repeat(66));
for (const d of fs.readdirSync(pagesDir)) {
  const rel = `pages/${d}/${d}.js`;
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  delete global.__PAGE__;
  tryRequire(rel);
  if (global.__PAGE__) {
    const cfg = global.__PAGE__;
    const hasData = cfg.data && typeof cfg.data === 'object';
    // 尝试跑 onLoad（带假参数）
    if (typeof cfg.onLoad === 'function') {
      const inst = Object.assign({}, cfg);
      inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
      inst.setData = function (patch, cb) {
        Object.assign(this.data, patch || {});
        if (cb) cb();
      };
      inst.selectComponent = () => null;
      inst.route = rel;
      try {
        cfg.onLoad.call(inst, {});
        results.push(['OK  ', rel + ' onLoad()', hasData ? `${Object.keys(cfg.data).length} 个 data 字段` : '无 data']);
      } catch (e) {
        results.push(['FAIL', rel + ' onLoad()', e.message]);
      }
    } else {
      results.push(['OK  ', rel, '无 onLoad']);
    }
  } else {
    results.push(['WARN', rel, '未捕获到 Page(...) 调用']);
  }
}

// ---- 汇总 ----
console.log('='.repeat(66));
const fails = results.filter(r => r[0] === 'FAIL');
const warns = results.filter(r => r[0] === 'WARN');
for (const [st, name, msg] of results) {
  if (st === 'FAIL' || st === 'WARN') console.log(`[${st}] ${name}\n        ${msg}`);
}
console.log('='.repeat(66));
console.log(`总计 ${results.length} 项  |  OK: ${results.filter(r=>r[0]==='OK  ').length}  FAIL: ${fails.length}  WARN: ${warns.length}`);
if (fails.length) {
  console.log('\n【失败明细】');
  fails.forEach(r => console.log('  - ' + r[1] + ' :: ' + r[2]));
}
process.exit(fails.length ? 1 : 0);
