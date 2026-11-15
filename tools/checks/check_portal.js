/**
 * 统一门户「知时门户.html」真跑校验
 * =================================
 * 门户是把散落的 13 个入口收进「左导航 + 右 iframe」的单文件页。
 * 它最容易出的问题是"看着像、点了不动"：
 *   - 导航项数对不上（漏收某个入口）
 *   - 首屏该自动打开却没打开（hint 一直挡着 iframe）
 *   - 点一项 iframe 的 src 不变（事件没绑上 / closest 失效）
 *   - 高亮没切（点完看不出在哪一页）
 *   - #key 直达失效（贴链接演示时进不去）
 *   - 入口指向不存在的文件（点了 404）
 * 这些都是「静态检查看不出来、必须真建 DOM 真点」的东西，
 * 所以用 jsdom 加载「知时门户.html」逐条断言。
 *
 * 同时反向核对：门户里每个 data-file 都必须在磁盘上真实存在，
 * 且必须与 tools/build_portal.js 的 NAV 清单同集合（防手改漏同步）。
 *
 * 退出码：0 全过 / 1 有失败
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, '知时门户.html');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  ->  ' + extra : '')); }
}

console.log('【统一门户 真跑】');
if (!fs.existsSync(FILE)) {
  console.log('  \u2717 未找到 知时门户.html，先跑 node tools/build_portal.js');
  process.exit(1);
}

const html = fs.readFileSync(FILE, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///' + FILE.replace(/\\/g, '/') });
const { window } = dom;
const doc = window.document;

setTimeout(function () {
  try {
    const nav = doc.getElementById('nav');
    const frame = doc.getElementById('frame');
    const hint = doc.getElementById('hint');
    ck('关键节点齐备（#nav / #frame / #hint）', !!(nav && frame && hint));

    /* ① 侧栏 KPI 卡 4 张，且数字非零/非占位 */
    const sts = doc.querySelectorAll('.brand .stat .st');
    ck('侧栏 KPI 卡 4 张', sts.length === 4, '实际 ' + sts.length);
    const nums = Array.from(sts).map((s) => (s.querySelector('b') || {}).textContent || '');
    ck('KPI「真实通知」非空且为数字', /^\d+$/.test(nums[0]) && parseInt(nums[0], 10) > 0, nums[0]);
    ck('KPI「来源单位」非空且为数字', /^\d+$/.test(nums[1]) && parseInt(nums[1], 10) > 0, nums[1]);
    ck('KPI「带官网链接」非空且为数字', /^\d+$/.test(nums[2]) && parseInt(nums[2], 10) > 0, nums[2]);
    ck('KPI「年份覆盖」为跨度文本', /–|—|-/.test(nums[3]) && nums[3].length >= 5, nums[3]);

    /* ② 导航项与分组 */
    const links = Array.from(nav.querySelectorAll('a.nv'));
    ck('导航入口 >= 12 项', links.length >= 12, '实际 ' + links.length);
    ck('导航分组 >= 3 组（上手/核心/落地/形态）',
      nav.querySelectorAll('.nv-g').length >= 3, '实际 ' + nav.querySelectorAll('.nv-g').length);
    const keys = links.map((a) => a.getAttribute('data-key'));
    ck('每个入口都有 data-key', keys.every(Boolean));
    ck('入口 data-key 不重复', new Set(keys).size === keys.length);
    ck('存在"可用应用"入口（data-key=app）', keys.indexOf('app') >= 0);
    ck('存在"交互 Demo"入口（data-key=demo）', keys.indexOf('demo') >= 0);
    ck('存在"项目总览"入口（data-key=overview）', keys.indexOf('overview') >= 0);
    ck('每个入口都有 data-file', links.every((a) => (a.getAttribute('data-file') || '').length > 0));
    ck('每个入口都有标题与角标',
      links.every((a) => a.querySelector('.nv-t') && a.querySelector('.nv-tg')));

    /* ③ 所有 data-file 在磁盘上真实存在（点了不会 404） */
    const missing = links
      .map((a) => a.getAttribute('data-file'))
      .filter((f) => !fs.existsSync(path.join(ROOT, f)));
    ck('全部入口指向的文件真实存在', missing.length === 0, '缺 ' + missing.join(', '));

    /* ④ 与 build_portal.js 的 NAV 清单同集合（防手改漏同步） */
    let navFiles = [];
    try {
      const src = fs.readFileSync(path.join(ROOT, 'tools', 'build_portal.js'), 'utf8');
      const re = /file:\s*'([^']+)'/g;
      let m;
      while ((m = re.exec(src)) !== null) navFiles.push(m[1]);
    } catch (e) { /* 读不到就跳过这条 */ }
    if (navFiles.length) {
      const a = navFiles.slice().sort().join('|');
      const b = links.map((x) => x.getAttribute('data-file')).sort().join('|');
      ck('门户入口集合 = build_portal.js NAV 清单', a === b,
        '构建清单 ' + navFiles.length + ' / 页面 ' + links.length);
    }

    /* ⑤ 首屏自动打开「可用应用」，hint 隐藏、frame 显示 */
    const firstSrc = frame.getAttribute('src');
    ck('首屏自动打开 app（frame.src = 知时.html）', firstSrc === '知时.html', '实际 ' + firstSrc);
    ck('首屏 frame 显示 / hint 隐藏',
      frame.style.display === 'block' && hint.style.display === 'none',
      'frame=' + frame.style.display + ' hint=' + hint.style.display);
    ck('首屏高亮项恰 1 个且是 app',
      nav.querySelectorAll('a.nv.on').length === 1 &&
      nav.querySelector('a.nv.on').getAttribute('data-key') === 'app');

    /* ⑥ 点另一项（overview）→ frame.src 变、高亮切 */
    const ov = nav.querySelector('a.nv[data-key="overview"]');
    ov.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('点击后 frame.src 切到 web/overview.html',
      frame.getAttribute('src') === 'web/overview.html', '实际 ' + frame.getAttribute('src'));
    ck('点击后高亮唯一且落在 overview',
      nav.querySelectorAll('a.nv.on').length === 1 &&
      nav.querySelector('a.nv.on').getAttribute('data-key') === 'overview');
    ck('顶栏标题随点击更新',
      doc.getElementById('barTitle').textContent.indexOf('项目总览') >= 0,
      doc.getElementById('barTitle').textContent);
    ck('「新窗口打开」链接随点击更新',
      doc.getElementById('openNew').getAttribute('href') === 'web/overview.html');

    /* ⑦ 点击内层元素（.nv-t）也能命中整项 */
    const dig = nav.querySelector('a.nv[data-key="digest"]');
    dig.querySelector('.nv-t').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('点内层 .nv-t 也能切换（closest 生效）',
      frame.getAttribute('src') === 'web/digest.html', '实际 ' + frame.getAttribute('src'));

    /* ⑦b 精简：4 个主推大按钮置顶 */
    const stars = nav.querySelectorAll('a.nv.star');
    ck('主推大按钮 4 个（首屏只放核心入口）', stars.length === 4, '实际 ' + stars.length);
    ck('4 个主推项落在首屏最上（在任一折叠分组之前）',
      (function () {
        const kids = Array.from(nav.children);
        const firstFg = kids.findIndex((k) => k.classList && k.classList.contains('fg'));
        const lastStar = kids.map((k) => k.classList && k.classList.contains('star')).lastIndexOf(true);
        return firstFg > lastStar && lastStar >= 0;
      })());

    /* ⑦c 精简：其余入口默认折叠，点分组头才展开 */
    const fgs = nav.querySelectorAll('.fg');
    ck('折叠分组 3 组', fgs.length === 3, '实际 ' + fgs.length);
    ck('默认仅第一组展开，其余收起',
      fgs[0].classList.contains('open') &&
      fgs[0].querySelector('.fg-b').style.display !== 'none' &&
      !fgs[1].classList.contains('open') &&
      !fgs[2].classList.contains('open') &&
      fgs[1].querySelector('.fg-b').style.display === 'none' &&
      fgs[2].querySelector('.fg-b').style.display === 'none');
    /* 点第 2 组分组头 → 展开 */
    const h2 = fgs[1].querySelector('.fg-h');
    h2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('点分组头可展开收起（切 display 与 open 类）',
      fgs[1].classList.contains('open') &&
      fgs[1].querySelector('.fg-b').style.display === 'block');
    /* 再点一次 → 收起 */
    h2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('再点分组头可收起',
      !fgs[1].classList.contains('open') &&
      fgs[1].querySelector('.fg-b').style.display === 'none');
    /* #key 落在折叠组里会自动展开该组 */
    const domR = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true,
      url: 'file:///' + FILE.replace(/\\/g, '/') + '#rawdata',
    });
    setTimeout(function () {
      try {
        const dR = domR.window.document;
        const raw = dR.querySelector('a.nv[data-key="rawdata"]');
        const grp = raw.closest('.fg');
        ck('#key 落到折叠组时自动展开该组',
          grp && grp.classList.contains('open') &&
          grp.querySelector('.fg-b').style.display === 'block');
      } catch (eR) {
        ck('#key 落到折叠组时自动展开该组', false, eR.message);
      }

      /* ⑧ #key 直达 */
      const dom2 = new JSDOM(html, {
        runScripts: 'dangerously', pretendToBeVisual: true,
        url: 'file:///' + FILE.replace(/\\/g, '/') + '#rawdata',
      });
      setTimeout(function () {
        try {
          const d2 = dom2.window.document;
          const f2 = d2.getElementById('frame');
          ck('#rawdata 直达：直接打开 web/rawdata.html',
            f2.getAttribute('src') === 'web/rawdata.html', '实际 ' + f2.getAttribute('src'));
          ck('#rawdata 直达：高亮落在 rawdata',
            d2.querySelector('a.nv.on') && d2.querySelector('a.nv.on').getAttribute('data-key') === 'rawdata');

          /* ⑨ 未知 hash 不炸，回落到 app */
          const dom3 = new JSDOM(html, {
            runScripts: 'dangerously', pretendToBeVisual: true,
            url: 'file:///' + FILE.replace(/\\/g, '/') + '#nosuchkey',
          });
          setTimeout(function () {
            try {
              const d3 = dom3.window.document;
              ck('未知 #hash 优雅回落（不空白）',
                d3.getElementById('frame').getAttribute('src') !== null &&
                d3.querySelectorAll('a.nv.on').length === 1);

              console.log('\n' + '='.repeat(48));
              console.log('统一门户校验：' + pass + ' 项通过，' + fail + ' 项失败');
              console.log('='.repeat(48));
              process.exit(fail ? 1 : 0);
            } catch (e3) {
              console.log('  \u2717 第三段异常：' + e3.message);
              process.exit(1);
            }
          }, 300);
        } catch (e2) {
          console.log('  \u2717 第二段异常：' + e2.message);
          process.exit(1);
        }
      }, 300);
    }, 300);
  } catch (e) {
    console.log('  \u2717 首段异常：' + e.message + '\n' + e.stack);
    process.exit(1);
  }
}, 300);
