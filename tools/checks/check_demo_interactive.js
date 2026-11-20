/**
 * 交互 Demo 真跑校验
 * ==================
 * 用 jsdom 真建 DOM、真加载「交互Demo.html」，断言：
 *  ① 首屏渲染出推送卡（含理由链、分数）
 *  ② tab 切换（搜索/问答/订阅）都能渲染
 *  ③ 搜索有结果且带"命中来源"
 *  ④ 详情页显示浓缩要点 + 原文出处定位
 *  ⑤ 长按 → ActionSheet 能打开；已读/删除生效
 *  ⑥ 切档案（年级）后通知列表重排
 *  ⑦ 问答回答 + 日历渲染
 * 退出码：0 全过 / 1 有失败
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, '交互Demo.html');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ->  ' + extra : '')); }
}

console.log('【交互 Demo 真跑】');
if (!fs.existsSync(FILE)) { console.log('  ✗ 未找到 交互Demo.html，先跑 tools/build_demo.py'); process.exit(1); }

const html = fs.readFileSync(FILE, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

/* 等脚本执行完 */
setTimeout(function () {
  try {
    const view = doc.getElementById('view');
    ck('首屏 #view 存在且有内容', view && view.innerHTML.length > 200);

    /* ① 推送卡 + 来源/倒计时（不再展示"为什么推给你"理由链） */
    const cards = view.querySelectorAll('.card[data-open]');
    ck('通知页渲染出推送卡 >= 3 张', cards.length >= 3, '实际 ' + cards.length);
    ck('推送卡不再堆"为什么推给你"理由链',
      view.querySelectorAll('.whyb').length === 0 &&
      !view.innerHTML.includes('为什么推给你'),
      '理由标签 ' + view.querySelectorAll('.whyb').length);
    ck('卡片带来源或倒计时元信息', view.querySelectorAll('.cmeta').length >= 3);
    ck('卡片展示分数', /分</.test(view.innerHTML));
    ck('存在主次梯度分区「优先办」「稍后看」',
      view.innerHTML.indexOf('优先办') >= 0 && view.innerHTML.indexOf('稍后看') >= 0);
    /* 已截止条目单列成"可回看"段，且视觉上与待办区分（expired 类 + 已截止字样） */
    const hasExpSec = view.innerHTML.indexOf('已截止') >= 0;
    ck('已截止条目单列成「可回看」段（若流内有过期条目）',
      hasExpSec || view.querySelectorAll('.card.expired').length === 0);
    ck('过期卡带 expired 类（灰化视觉区分）',
      (() => {
        const expCards = view.querySelectorAll('.card.expired');
        // 有 expired 卡时，其内文必须出现"已截止 N 天"
        for (const el of expCards) {
          if (!/已截止\s*\d+\s*天/.test(el.textContent)) return false;
        }
        return true;
      })());

    /* ② tab 切换 */
    function clickTab(t) {
      const el = doc.querySelector('.tab[data-tab="' + t + '"]');
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      return doc.getElementById('view').innerHTML;
    }
    let hSearch = clickTab('search');
    ck('切到搜索页：有搜索框与热词',
      hSearch.indexOf('searchbox') >= 0 && hSearch.indexOf('data-hot') >= 0);
    let hAsk = clickTab('ask');
    ck('切到问答：有今日一问 + 问题清单 + 日历',
      hAsk.indexOf('今日一问') >= 0 && hAsk.indexOf('data-ask') >= 0 && hAsk.indexOf('cal-grid') >= 0);
    let hMe = clickTab('me');
    ck('切到订阅页：有档案维度（身份/年级/学院/标签）',
      hMe.indexOf('data-set') >= 0 && hMe.indexOf('data-tag') >= 0 && hMe.indexOf('千人千面') >= 0);
    /* 自定义关键词订阅：输入框 + 推荐词 + 添加交互 */
    ck('订阅页有「我的关键词」输入框',
      hMe.indexOf('我的关键词') >= 0 && hMe.indexOf('id="inKw"') >= 0);
    ck('订阅页有推荐词（data-addkw）', hMe.indexOf('data-addkw') >= 0);
    /* 点推荐词 → 关键词进入画像 chips，且带命中条数 */
    const sugEl = doc.querySelector('[data-addkw]');
    const sugWord = sugEl ? sugEl.getAttribute('data-addkw') : '';
    sugEl && sugEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let hMe2 = doc.getElementById('view').innerHTML;
    ck('点推荐词后出现已订关键词 chip（带 × 删除）',
      hMe2.indexOf('data-rmkw') >= 0 && hMe2.indexOf('kwchip') >= 0, sugWord);
    ck('关键词 chip 显示命中条数或"暂无命中"',
      hMe2.indexOf('kwn') >= 0);
    /* 关键词订阅要能影响通知列表：确认 core 的 buildPush 把命中项算进来 */
    ck('（逻辑层）命中关键词的通知会进通知列表',
      (() => {
        try {
          const prof = JSON.parse(JSON.stringify(window.ZS_DATA.PROFILE));
          prof.keywords = [sugWord];
          const r = window.ZS.buildPush(window.ZS_DATA.NOTICES,
            { profile: prof, limit: 999 });
          return r.cards.some(c => window.ZS.matchKeyword(c, prof) === sugWord);
        } catch (e) { return false; }
      })(), 'sug=' + sugWord);
    /* 删掉关键词，避免影响后续断言 */
    const rmEl = doc.querySelector('[data-rmkw]');
    rmEl && rmEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    /* 新增：数据源页 */
    let hData = clickTab('data');
    ck('切到数据源页：有采集概览 KPI 区',
      hData.indexOf('采集概览') >= 0 && hData.indexOf('kpi') >= 0);
    ck('数据源页有来源单位分布（柱状）',
      hData.indexOf('来源单位分布') >= 0 && hData.indexOf('class="bar"') >= 0);
    ck('数据源页有内容标签分布',
      hData.indexOf('内容标签分布') >= 0);
    ck('数据源页有年份分布',
      hData.indexOf('发布年份跨度') >= 0 && hData.indexOf('yearline') >= 0);
    ck('数据源页如实标注被 WAF 拦截的站点',
      hData.indexOf('站点接入状态') >= 0 && hData.indexOf('安全拦截') >= 0);
    ck('数据源页 KPI 数字非零（真实条数）',
      /class="kv">\d+</.test(hData));

    /* ③ 搜索：点第一个热词，应出结果 + 命中来源。
     * 注意：热词现在会传池筛选，所以"点第一个热词必出结果"是真实保证，
     * 这条断言同时验证了 hotWords(pool) 的过滤生效。 */
    clickTab('search');
    const hot = doc.querySelector('[data-hot]');
    ck('搜索页热词条非空', !!hot);
    hot.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let hs = doc.getElementById('view').innerHTML;
    const sres = doc.getElementById('view').querySelectorAll('.card[data-open]');
    ck('点热词后有搜索结果', sres.length >= 1, '结果 ' + sres.length);
    ck('搜索结果标注"命中"来源', hs.indexOf('命中') >= 0);

    /* ④ 打开详情：浓缩要点 + 原文定位 */
    const firstCard = doc.getElementById('view').querySelector('.card[data-open]');
    firstCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let hd = doc.getElementById('view').innerHTML;
    ck('详情页显示浓缩要点标题', hd.indexOf('浓缩要点') >= 0);
    ck('详情页显示原文核对区', hd.indexOf('原文') >= 0);
    ck('详情页有已读/删除操作按钮',
      hd.indexOf('data-act="togread"') >= 0 && hd.indexOf('data-act="togdel"') >= 0);

    /* ⑤ 详情页点"标记已读" */
    const tr = doc.querySelector('[data-act="togread"]');
    tr.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let hd2 = doc.getElementById('view').innerHTML;
    ck('点已读后按钮态变化（出现"已读"词）', hd2.indexOf('已读') >= 0);

    /* ⑥ 档案切换 → 通知列表重排 */
    clickTab('me');
    const before = window.__ZS_DEMO__.state.profile.grade;
    const gchip = Array.from(doc.querySelectorAll('[data-set="grade"]')).find(el => el.getAttribute('data-v') !== before);
    gchip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('点击年级 chip 后 profile 改变',
      window.__ZS_DEMO__.state.profile.grade !== before,
      before + ' -> ' + window.__ZS_DEMO__.state.profile.grade);
    clickTab('index');
    ck('切回通知页仍能渲染推送卡',
      doc.getElementById('view').querySelectorAll('.card[data-open]').length >= 1);

    /* ⑦ 问答：点一个问题，出回答 + 依据 */
    clickTab('ask');
    const qb = doc.querySelector('[data-ask]');
    qb.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let ha = doc.getElementById('view').innerHTML;
    ck('点问题后出现"回答"区块', ha.indexOf('回答') >= 0);
    ck('回答附"依据"说明', ha.indexOf('依据') >= 0);

    /* ⑧ 日历翻月 */
    const navBtn = doc.querySelector('[data-cal="1"]');
    navBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ck('日历翻月后仍渲染网格', doc.getElementById('view').innerHTML.indexOf('cal-week') >= 0);

    /* ⑨ 长按卡片 → ActionSheet */
    clickTab('index');
    const card2 = doc.getElementById('view').querySelector('.card[data-open]');
    const id2 = card2.getAttribute('data-id');
    const PD = window.PointerEvent ? new window.PointerEvent('pointerdown', { bubbles: true })
                                   : new window.MouseEvent('pointerdown', { bubbles: true });
    card2.dispatchEvent(PD);

    setTimeout(function () {
      try {
        const sheet = doc.getElementById('sheet');
        ck('长按后 ActionSheet 打开', sheet.classList.contains('show'));
        ck('ActionSheet 含已读/删除选项',
          sheet.innerHTML.indexOf('data-sheet="togread"') >= 0 && sheet.innerHTML.indexOf('data-sheet="del"') >= 0);
        /* 点删除 */
        const delBtn = sheet.querySelector('[data-sheet="del"]');
        delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        ck('ActionSheet 删除后该条进入 hiddenIds',
          !!window.__ZS_DEMO__.state.hiddenIds[id2]);
        ck('ActionSheet 已关闭', !sheet.classList.contains('show'));

        /* 订阅页显示已删除可找回 */
        clickTab('me');
        ck('订阅页显示"已删除"且可找回',
          doc.getElementById('view').innerHTML.indexOf('已删除') >= 0);

        console.log('\n' + '='.repeat(48));
        console.log('交互 Demo 校验：' + pass + ' 项通过，' + fail + ' 项失败');
        console.log('='.repeat(48));
        process.exit(fail ? 1 : 0);
      } catch (e2) {
        console.log('  ✗ 后段异常：' + e2.message);
        process.exit(1);
      }
    }, 700);
  } catch (e) {
    console.log('  ✗ 前段异常：' + e.message + '\n' + e.stack);
    process.exit(1);
  }
}, 400);
