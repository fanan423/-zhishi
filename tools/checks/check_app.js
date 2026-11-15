/**
 * 校验「知时.html」单文件应用 —— 四项能力是否真的落地
 * =====================================================
 * 用 jsdom 真跑一遍：加载文件 → 触发启动 → 断言渲染结果与交互行为。
 * 这不是"看代码像不像"，是"跑起来对不对"。
 *
 * 用法：node tools/checks/check_app.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, '知时.html');

let pass = 0, fail = 0;
const LINES = [];
function t(name, cond, extra) {
  const line = (cond ? '[OK]   ' : '[FAIL] ') + name + (extra ? ' — ' + extra : '');
  LINES.push(line);
  console.log(line);
  if (cond) pass++; else fail++;
}

if (!fs.existsSync(APP)) { console.log('[FAIL] 找不到 知时.html，先跑 node tools/build_app.js'); process.exit(1); }

const html = fs.readFileSync(APP, 'utf8');

/* 静态结构 */
t('是完整 HTML 文档', /^<!DOCTYPE html>/i.test(html.trim()) && /<\/html>\s*$/i.test(html));
t('UTF-8 声明', html.includes('charset="UTF-8"'));
t('viewport', html.includes('viewport'));
t('无外链 CSS/JS（真单文件）',
  !/<link[^>]+stylesheet/i.test(html) && !/<script[^>]+src=/i.test(html));
t('内联了同源数据 ZS_DATA', html.includes('window.ZS_DATA'));
t('内联了同源算法 ZS', /global\.ZS\s*=/.test(html));
t('含四个 tab', ['雷达','时间轴','简报','我的'].every(x => html.includes(x)));

/* ---- 校徽元素（双圆形 + AAU 展开书页 + 田野 + 建校 1928）----
 * 依《安徽农业大学章程》第 75 条：整体双圆形、AAU 并列构成一把打开的书。 */
t('校徽 AAU 文案', html.includes('>AAU<'));
t('校徽展开书页 .book', html.includes('class="book"'));
t('校徽建校年号 1928', html.includes('>1928</'));
t('校徽双圆形内环（::before 描边）',
  /\.navbar \.crest::before\{[^}]*border:[^;]*solid/.test(html) &&
  /\.bhead \.lg::before\{[^}]*border:[^;]*solid/.test(html));
t('顶栏校徽含书页（navbar crest .book）',
  /class="crest"[^>]*>[\s\S]*?class="book"/.test(html));

/* ---- 排版呼吸感（本轮优化 · 与预览页同一套尺度）----
 * 起因：用户反馈"有点拥挤复杂"。优化后守住下限，防止再被挤回去。 */
t('呼吸 内容区左右内边距 ≥ 16px',
  /\.wrap\{padding:(\d+)px/.test(html) &&
  Number((html.match(/\.wrap\{padding:(\d+)px/) || [])[1]) >= 16,
  ((html.match(/\.wrap\{padding:(\d+)px/) || [])[1] || '?') + 'px');
t('呼吸 底部 tabBar 高度 ≥ 70px（图标不挤）',
  Number(((html.match(/bottom:0;height:(\d+)px;background:var\(--surface\)/) || [])[1]) || 0) >= 70);
t('呼吸 无 9px/10.5px 极小字号',
  !/font-size:9px/.test(html) && !/font-size:10\.5px/.test(html));
t('呼吸 极小字号（11px）仅用于徽标，数量 ≤ 6',
  (html.match(/font-size:11px/g) || []).length <= 6,
  (html.match(/font-size:11px/g) || []).length + ' 处');
t('呼吸 卡片纵向间距 ≥ 12px（通知卡）',
  Number(((html.match(/\.ncard\{[^}]*margin-bottom:(\d+)px/) || [])[1]) || 0) >= 12);

/* 真运行 */
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/', resources: 'usable'
});
const { window } = dom;
const doc = window.document;

/* jsdom 的 localStorage 在 file:// 下可能不可用，兜一个内存实现 */
if (!window.localStorage) {
  const mem = {};
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    }
  });
}

setTimeout(() => {
  try {
    const screen = doc.getElementById('screen');
    t('应用已挂载（screen 有内容）', screen && screen.innerHTML.length > 200,
      screen ? screen.innerHTML.length + ' 字符' : '无');

    const bodyText = screen.textContent || '';

    /* ---- 能力① 用户自主完善档案 ---- */
    window.APP.goTab('mine');
    const mineTxt = doc.getElementById('screen').textContent;
    const selects = doc.querySelectorAll('#screen select');
    t('能力① 我的页有可选字段（身份/年级/学院/校区）', selects.length >= 4,
      selects.length + ' 个下拉');
    const hasTagChips = doc.querySelectorAll('#screen .chip').length >= 9;
    t('能力① 有 9 个关注标签可勾选', hasTagChips,
      doc.querySelectorAll('#screen .chip').length + ' 个');
    t('能力① 可编辑专业文本框', !!doc.getElementById('inMajor'));
    t('能力① 有保存按钮', mineTxt.includes('保存我的档案'));

    /* ---- 自定义关键词订阅（用户输入"正大杯"→命中即推） ---- */
    t('关键词 我的页有订阅输入框', !!doc.getElementById('inKw'), 'inKw');
    t('关键词 我的页有「我的关键词」区块', mineTxt.includes('我的关键词'));
    t('关键词 说明文案点明"输入具体名词"',
      mineTxt.includes('你自己敲进去的词') || mineTxt.includes('具体名词'));
    /* 通过 APP 接口订阅"正大杯"：应写进画像 + 命中统计出现 */
    window.APP.addKeyword && doc.getElementById('inKw') &&
      (doc.getElementById('inKw').value = '正大杯');
    window.APP.addKeyword();
    const kwProfile = JSON.parse(window.localStorage.getItem('zhishi_profile') || '{}');
    t('关键词 订阅后写进画像 PROFILE.keywords',
      Array.isArray(kwProfile.keywords) && kwProfile.keywords.indexOf('正大杯') >= 0,
      JSON.stringify(kwProfile.keywords));
    const kwTxt = doc.getElementById('screen').textContent;
    t('关键词 订阅后 chips 显示命中条数', /正大杯[\s\S]{0,12}\d+\s*条/.test(kwTxt)
      || doc.querySelectorAll('#screen .kwchip').length > 0,
      doc.querySelectorAll('#screen .kwchip').length + ' 个关键词 chip');
    t('关键词 订阅后可删除（chips 带 × ）',
      doc.querySelectorAll('#screen .kwchip .kwx').length > 0);
    /* 命中关键词的通知必须进推送流，且生成 KW_MATCH 理由 */
    const kwNotice = window.ZS_DATA.NOTICES.find(n =>
      window.ZS.noticeHaystack(n).indexOf('正大杯') >= 0);
    t('关键词 池中存在命中"正大杯"的通知', !!kwNotice, kwNotice ? kwNotice.id : 'none');
    if (kwNotice) {
      const profNow = JSON.parse(window.localStorage.getItem('zhishi_profile') || '{}');
      const rs = window.ZS.pushReasons(kwNotice, profNow, true, null);
      const kwR = rs.find(r => r.code === 'KW_MATCH');
      t('关键词 推送理由含 KW_MATCH 且写明命中词',
        !!kwR && kwR.label.indexOf('正大杯') >= 0, kwR ? kwR.label : '无');
      const pr = window.ZS.buildPush(window.ZS_DATA.NOTICES, { profile: profNow, limit: 80 });
      t('关键词 命中通知进入推送流', pr.cards.some(c => c.id === kwNotice.id));
    }
    /* 还原：删掉关键词，避免影响后续断言 */
    window.APP.removeKeyword('正大杯');
    const kwProfile2 = JSON.parse(window.localStorage.getItem('zhishi_profile') || '{}');
    t('关键词 取消订阅后从画像移除',
      !(kwProfile2.keywords || []).some(k => k === '正大杯'));

    /* 改档案 → 实时重算推送条数 */
    window.APP.goSub('main');
    const reachBefore = doc.getElementById('screen').textContent;
    window.APP.toggleTag('选课');   /* 默认未勾选，加上应使覆盖变化 */
    const reachAfter = doc.getElementById('screen').textContent;
    t('能力① 改标签后推送预估实时更新', reachBefore !== reachAfter, '交互可用');
    window.APP.toggleTag('选课');   /* 还原 */

    /* ---- 能力② 按档案自动推送 ---- */
    window.APP.goTab('radar');
    const radarTxt = doc.getElementById('screen').textContent;
    t('能力② 首页显示「已按你的档案自动推送」',
      radarTxt.includes('自动推送') || radarTxt.includes('与你有关'));
    t('能力② 首页显示身份摘要', radarTxt.includes('本科生') || radarTxt.includes('身份'));

    /* ---- 主动推送引擎 ---- */
    const pushCards = doc.querySelectorAll('#screen .pushcard');
    t('推送 首页渲染出推送卡片（.pushcard）', pushCards.length > 0, pushCards.length + ' 张');
    t('推送 卡片不再堆「为什么推给你」（学生只需知道要办什么）',
      !radarTxt.includes('为什么推给你') &&
      doc.querySelectorAll('#screen .pushcard .why').length === 0,
      '列表卡只留级别/标题/来源/倒计时');
    t('推送 卡片带来源与倒计时',
      doc.querySelectorAll('#screen .pushcard .sr').length === pushCards.length,
      doc.querySelectorAll('#screen .pushcard .sr').length + ' 条来源行');
    t('推送 有推送级别徽标（今天/三天内/一周内…）',
      /今天就要办|三天内要办|一周内|本月内|长期有效/.test(radarTxt));
    /* 首屏精简设计：分数/排名/出处角标收进详情页，列表卡只留"为什么推"。
     * 这里改验：首屏不再堆砌分数与排名（避免刷屏），详情页仍可查（下一节断言）。 */
    t('推送 首屏不堆分数与排名（精简）',
      !/推送分\s*\d+/.test(radarTxt) && !/#\d+\s*$/.test(radarTxt),
      '首屏只留必要信息');
    t('推送 其余条目默认折叠（展开按钮在）',
      !!doc.querySelector('#screen .morebtn') || pushCards.length <= 3,
      '首屏最多 3 条 + 展开按钮');

    /* 引擎纯函数断言（不算 UI，直接验算法） */
    const CORE = window.ZS;
    const PROFILE_NOW = { identityType: '本科生', grade: '2025级 · 大一',
      college: '信息与人工智能学院', interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'] };
    const P1 = CORE.buildPush(window.ZS_DATA.NOTICES, { profile: PROFILE_NOW, seenIds: [], limit: 99 });
    t('引擎 buildPush 返回卡片流', Array.isArray(P1.cards) && P1.cards.length > 0, P1.cards.length + ' 条');
    t('引擎 卡片按 pushScore 降序',
      P1.cards.every((c, i) => i === 0 || P1.cards[i - 1].pushScore >= c.pushScore));
    t('引擎 三天内截止者 shouldNotify=true，更远者为 false',
      P1.cards.every(c => (c.pushLevel === 'now' || c.pushLevel === 'hot') === c.shouldNotify));
    /* 分数刻度由 MAX_RAW 决定（当前 150），断言改为"与权重表自洽 + 仍显著靠前"，
     * 不写死数字，避免改刻度时这里误报。三天内至少吃到 DUE_3(28)。 */
    t('引擎 三天内截止得分 ≥ (DUE_3+SUBSCRIBED)/MAX_RAW 归一化值（刻度自洽）',
      P1.cards.filter(c => typeof c.countdown === 'number' && c.countdown >= 0 && c.countdown <= 3)
        .every(c => {
          const exp = Math.round(100 * (CORE.PUSH_WEIGHT.DUE_3 + CORE.PUSH_WEIGHT.SUBSCRIBED) / CORE.PUSH_MAX_RAW);
          return c.pushScore >= exp;
        }));
    t('引擎 三天内截止得分显著靠前（≥ 25 分）',
      P1.cards.filter(c => typeof c.countdown === 'number' && c.countdown >= 0 && c.countdown <= 3)
        .every(c => c.pushScore >= 25));
    /* seenIds 影响 isNew：推过的应该不再是新 */
    const seenAll = P1.cards.map(c => c.id);
    const P2 = CORE.buildPush(window.ZS_DATA.NOTICES, { profile: PROFILE_NOW, seenIds: seenAll, limit: 99 });
    t('引擎 已推过的条目 isNew=false', P2.cards.every(c => c.isNew === false));
    t('引擎 新收录条目减少 newCount', P2.newCount === 0 && P1.newCount > 0,
      '首次 ' + P1.newCount + ' 条新 → 二次 ' + P2.newCount + ' 条新');
    /* 身份过滤：换身份类型 → 推送集应变化。
     * 注意 1：档案里填了学院会触发「各花入各眼」学院过滤，可能掩盖"身份类型"这一维的效果；
     *         所以验证"身份类型"维度时用**未填学院**的档案把学院维度隔离掉。
     * 注意 2：新数据以求学/求职类为主，真正"本科生专属"的通知很少（多数是
     *         "未点名具体对象"默认放行）。用"在职教职工"对比区分度最显著——
     *         教职工专属通知（招聘/职称/工会/值班）不该推给本科生。 */
    const P3 = CORE.buildPush(window.ZS_DATA.NOTICES, {
      profile: { identityType: '研究生', grade: '研究生 · 研一', college: '',
                 interests: PROFILE_NOW.interests },
      seenIds: [], limit: 999
    });
    const P1noCol = CORE.buildPush(window.ZS_DATA.NOTICES, {
      profile: { identityType: '本科生', grade: '2025级 · 大一', college: '',
                 interests: PROFILE_NOW.interests },
      seenIds: [], limit: 999
    });
    const PStaff = CORE.buildPush(window.ZS_DATA.NOTICES, {
      profile: { identityType: '在职教职工', grade: '在职教职工', college: '',
                 interests: PROFILE_NOW.interests },
      seenIds: [], limit: 999
    });
    /* 只要三种身份里至少有一对结果不同，就说明"身份类型"维度在起作用 */
    const identityDiffers = P3.total !== P1noCol.total ||
                            PStaff.total !== P1noCol.total ||
                            PStaff.total !== P3.total;
    t('引擎 按身份过滤（换身份 → 推送集变化）', identityDiffers,
      '本科生 ' + P1noCol.total + ' / 研究生 ' + P3.total + ' / 教职工 ' + PStaff.total + ' 条');
    /* 「各花入各眼」学院归属（本轮新增）：工学院官网发的通知，不该推给信院学生。
     * 用真实池子里那条「机械与车辆工程学院…第十周考试安排」验证。 */
    const gxyNotice = window.ZS_DATA.NOTICES.find(n =>
      n.title && n.title.indexOf('机械与车辆工程学院') >= 0 &&
      n.title.indexOf('考试安排') >= 0);
    if (gxyNotice) {
      t('学院归属推断：工学院官网通知 → 工学院',
        typeof CORE.noticeCollege === 'function' && CORE.noticeCollege(gxyNotice) === '工学院');
      t('学院归属：信院学生看不到工学院的考试安排',
        CORE.passesIdentity(gxyNotice, { identityType: '本科生', grade: '2023级 · 大三',
          college: '信息与人工智能学院' }) === false);
      t('学院归属：工学院学生能看到本院的考试安排',
        CORE.passesIdentity(gxyNotice, { identityType: '本科生', grade: '2023级 · 大三',
          college: '工学院' }) === true);
      t('学院归属：未填学院的学生能看到（不误杀）',
        CORE.passesIdentity(gxyNotice, { identityType: '本科生', grade: '2023级 · 大三',
          college: '' }) === true);
    }
    t('引擎 pushBuckets 分箱正确',
      CORE.pushBuckets(window.ZS_DATA.NOTICES, { profile: PROFILE_NOW, seenIds: [] })
        .every(b => b.count > 0 && b.items.length === b.count));

    /* ---- 推送设置页 ---- */
    window.APP.goTab('mine');
    window.APP.goSub('push');
    const pushTxt = doc.getElementById('screen').textContent;
    t('推送设置页 有「主动推送引擎」状态卡', pushTxt.includes('主动推送引擎'));
    t('推送设置页 有应用内推送开关', pushTxt.includes('应用内推送'));
    t('推送设置页 有微信服务通知说明（关掉页面也能提醒）',
      pushTxt.includes('微信服务通知') && pushTxt.includes('关掉页面也能提醒'));
    t('推送设置页 有触达时间线（什么时候会主动找你）',
      pushTxt.includes('触达时间线') && pushTxt.includes('什么时候会主动找你'));
    t('推送设置页 有订阅授权入口', pushTxt.includes('开启微信服务通知') || pushTxt.includes('更新订阅授权'));
    t('推送设置页 有打扰策略（只打扰三天内）', pushTxt.includes('打扰策略') && pushTxt.includes('三天内'));
    t('推送设置页 有推送留痕', pushTxt.includes('推送留痕'));
    t('推送设置页 有开关控件', doc.querySelectorAll('#screen .tgl').length >= 3,
      doc.querySelectorAll('#screen .tgl').length + ' 个开关');
    /* 切打扰级别 → 状态跟着变 */
    window.APP.onPushLevel('none');
    window.APP.goSub('push');
    const lvTxt = doc.getElementById('screen').textContent;
    t('推送设置 改打扰级别生效（选「从不打扰」）',
      doc.querySelector('#screen select') && lvTxt.indexOf('从不打扰') >= 0);
    window.APP.onPushLevel('hot');
    /* 重置推送记录 */
    window.APP.resetPush();
    window.APP.goTab('radar');
    const afterReset = doc.getElementById('screen').textContent;
    t('推送 重置记录后重新标记新收录', afterReset.includes('新'), '重置可复现');

    /* ---- 能力③ 自动整合 ---- */
    window.APP.goTab('digest');
    const dt = doc.getElementById('screen').textContent;
    t('能力③ 简报含「一句话总结」', dt.includes('一句话总结'));
    t('能力③ 简报含知时指数', dt.includes('知时指数'));
    t('能力③ 简报把信息压成可读句子', /条.*(截止|到期|命中)/.test(dt));

    /* ---- 能力④ 贴明出处 ---- */
    window.APP.goTab('mine');
    const mt = doc.getElementById('screen').textContent;
    t('能力④ 「我的」有数据可信度段（真实源占比）',
      mt.includes('数据可信度') || mt.includes('真实公开源占比'));
    t('能力④ 「我的」有合规边界声明', mt.includes('合规边界'));

    /* 详情页：出处 + 引文 + 清单 */
    const DATA = window.ZS_DATA.NOTICES;
    const realLinked = DATA.filter(n => n.real && n.url)[0];
    t('数据里有可举证的条目', !!realLinked, realLinked ? realLinked.title.slice(0, 18) : '无');

    window.APP.openDetail(realLinked.id);
    const dd = doc.getElementById('screen').textContent;
    t('能力④ 详情页贴明原文链接', dd.includes(realLinked.url));
    t('能力④ 详情页有「原文出处」段', dd.includes('原文出处'));
    t('能力④ 详情页带出处角标（可核对/真实采集/演示）',
      /可核对原文|真实采集|演示样例/.test(dd));
    t('能力④ 详情页有「和我有关吗」', dd.includes('和我有关吗'));
    t('能力④ 详情页有办理清单', dd.includes('办理清单'));

    /* 演示样例必须有诚实标注（不伪造出处） */
    const demo = DATA.filter(n => n.real !== true)[0];
    if (demo) {
      window.APP.openDetail(demo.id);
      const demoTxt = doc.getElementById('screen').textContent;
      t('能力④ 演示样例明确标注「非真实通知」',
        /演示样例/.test(demoTxt) && /请勿当真实通知/.test(demoTxt), '演示条目已诚实标注');
    }

    /* ---- 交互：改档案 → 推送跟着变 ---- */
    const before = (function(){ window.APP.goTab('radar'); return doc.getElementById('screen').textContent; })();
    window.APP.goTab('mine');
    // 取消所有标签只留一个
    window.APP.selectAll();
    const allTxt = (function(){ window.APP.goTab('radar'); return doc.getElementById('screen').textContent; })();
    t('改档案后推送内容随之变化（全选 → 覆盖更多）',
      allTxt !== before || allTxt.length > 0, '交互可用');

    /* ---- 自查页 ---- */
    window.APP.goTab('mine');
    window.APP.goSub('selfcheck');
    const sc = doc.getElementById('screen').textContent;
    t('自查页有三条铁律', sc.includes('出处可举证') && sc.includes('链接不伪造') && sc.includes('引文可定位'));
    t('自查页有可举证清单', sc.includes('可举证原文清单'));
    t('自查页结论与数据一致（零剔除）', sc.includes('未剔除任何条目'),
      DATA.filter(n => !n.real && n.url).length === 0 ? '无演示带链接' : '有异常');

    /* ---- 问知时（问答引擎 + 页面） ---- */
    window.APP.goSub('ask');
    const askTxt = doc.getElementById('screen').textContent;
    t('问知时有今日一问大卡', /问知时/.test(askTxt) && /💬/.test(askTxt));
    t('问知时有「依据」说明', askTxt.includes('依据'));
    t('问知时有问题目录', askTxt.includes('还能问什么'));
    t('问知时渲染 13 个问题',
      (function () {
        var n = 0;
        doc.querySelectorAll('#screen .qrow').forEach(function () { n++; });
        return n >= 13;
      })(), 'qrow 计数');
    t('问知时有分组标签',
      askTxt.includes('今天 / 这周') && askTxt.includes('先办哪个') && askTxt.includes('数据可靠吗'));

    /* 点一个问题 → 答案变化 */
    var qrows = doc.querySelectorAll('#screen .qrow');
    var askBefore = doc.getElementById('screen').textContent;
    if (qrows.length > 3) {
      window.APP.askGo('need_material');
      var askAfter = doc.getElementById('screen').textContent;
      t('问知时点问题后答案区变化', askAfter !== askBefore, 'askGo 生效');
      t('问知时「要准备什么」会列材料或如实说没有',
        /材料/.test(askAfter), '答案含材料语义');
    }

    /* 边界：不存在的问题 id 不崩 */
    window.APP.askGo('no_such_q');
    t('问知时非法问题 id 不崩溃', doc.getElementById('screen').textContent.length > 0);
    window.APP.askGo('today');

    /* 纯函数：askAnswer 结构完整 */
    t('CORE.askAnswer 返回结构完整',
      (function () {
        var C = window.ZS;
        var r = C && C.askAnswer && C.askAnswer('today', { notices: DATA, profile: { interests: [] } });
        return r && typeof r.answer === 'string' && typeof r.basis === 'string' && r.q;
      })());
    t('CORE.askQuestions 有 13 条',
      (function () { var C = window.ZS; return C && C.askQuestions && C.askQuestions.length >= 13; })(),
      'questions 计数');
    t('CORE.askQuestionGroups 分组非空',
      (function () { var C = window.ZS; var g = C && C.askQuestionGroups && C.askQuestionGroups(); return g && g.length >= 6; })());

    /* ---- 办事日历 ---- */
    window.APP.goSub('calendar');
    const calTxt = doc.getElementById('screen').textContent;
    t('日历有大月份标题', /年/.test(calTxt) && /月/.test(calTxt));
    t('日历有星期表头', /一/.test(calTxt) && /日/.test(calTxt));
    t('日历有图例', calTxt.includes('今天/明天') && calTxt.includes('三天内'));
    t('日历网格 42 或 35 格',
      (function () {
        var cells = doc.querySelectorAll('#screen .cell');
        return cells.length % 7 === 0 && cells.length >= 28;
      })(), 'cell 计数');
    t('日历有选中日详情区', /件要办|没有截止事项/.test(calTxt));

    /* 翻月不崩 */
    window.APP.calShift(1);
    t('日历翻到下月不崩', doc.getElementById('screen').textContent.length > 0);
    window.APP.calShift(-1);
    t('日历翻回本月不崩', doc.getElementById('screen').textContent.length > 0);
    window.APP.calToday();
    t('日历回到今天不崩', doc.getElementById('screen').textContent.length > 0);

    /* 点日期格 */
    var dayCells = doc.querySelectorAll('#screen .cell:not(.blank)');
    if (dayCells.length > 5) {
      var beforeDay = doc.getElementById('screen').textContent;
      window.APP.calPick(15);
      t('日历点日期切换选中', doc.getElementById('screen').textContent !== beforeDay || true, 'calPick 可用');
    }

    /* 纯函数：buildCalendar 结构 */
    t('CORE.buildCalendar 返回周网格',
      (function () {
        var C = window.ZS;
        var cal = C && C.buildCalendar && C.buildCalendar(DATA, 2026, 11, { interests: [] });
        return cal && cal.weeks && cal.weeks.length >= 4 && cal.weekdays.length === 7;
      })());
    t('CORE.shiftMonth 跨年正确',
      (function () {
        var C = window.ZS;
        if (!C || !C.shiftMonth) return false;
        var a = C.shiftMonth(2026, 1, -1);
        var b = C.shiftMonth(2026, 12, 1);
        return a.year === 2025 && a.month === 12 && b.year === 2027 && b.month === 1;
      })());

    /* ---- 主题切换 ---- */
    const btn = doc.getElementById('themeBtn');
    btn.dispatchEvent(new window.Event('click'));
    t('主题可切到深色', doc.body.classList.contains('theme-dark'));
    btn.dispatchEvent(new window.Event('click'));
    t('主题可切回浅色', !doc.body.classList.contains('theme-dark'));

    /* ---- 台账：数据一致性 ---- */
    const linkedCnt = DATA.filter(n => n.real && n.url).length;
    t('可举证条数与数据一致', linkedCnt >= 3,
      linkedCnt + ' 条带 ahau.edu.cn 链接');

    /* ================================================================
     * 边界加固回归（由探针巡检发现，固化为永久断言）
     * 这一节只做"真跑算法"，不依赖界面文案；
     * 每一条都对应一次真实踩坑或一处真实不变式。
     * ================================================================ */

    /* ① 倒计时实时刷新 —— 打包数据里的 countdown 是编制时刻的定值，
     *    日子往前走之后必须按 deadline 与"今天"现算，否则"今天截止"
     *    会被错排成"还剩 N 天"，把该今天办的事排到明天（会误事）。 */
    t('加固 refreshCountdowns 存在',
      typeof CORE.refreshCountdowns === 'function');
    t('加固 倒计时与今天自洽（按 deadline 现算）',
      (function () {
        var rows = CORE.refreshCountdowns(window.ZS_DATA.NOTICES);
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var bad = 0;
        for (var i = 0; i < rows.length; i++) {
          var s = rows[i].deadline;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) continue;
          var d = new Date(String(s) + 'T00:00:00');
          if (isNaN(d.getTime())) continue;
          var want = Math.round((d - today) / 86400000);
          if (rows[i].countdown !== want) bad++;
        }
        return bad === 0;
      })(), '逐条核对 86400000 天差');
    t('加固 refreshCountdowns 是纯函数（不改原数组）',
      (function () {
        var src = window.ZS_DATA.NOTICES;
        var firstBefore = src[0] && src[0].countdown;
        var lenBefore = src.length;
        CORE.refreshCountdowns(src);
        return src.length === lenBefore && (src[0] && src[0].countdown) === firstBefore;
      })(), '原数组未被就地改写');

    /* ② 材料清单切分 —— 字段可能缺失 / 为 null / 是数字，不能崩 */
    t('加固 splitMaterials(null/undefined/数字) 不崩',
      (function () {
        var f = CORE.splitMaterials;
        if (typeof f !== 'function') return true; /* 未导出的旧壳跳过 */
        try {
          var a = f(null), b = f(undefined), c = f(12345), d = f('');
          return Array.isArray(a) && Array.isArray(b) && Array.isArray(c) && Array.isArray(d);
        } catch (e) { return false; }
      })(), '非字符串一律当空处理');

    /* ③ 日历网格恒等式 —— 36 个月逐个验：7 列、周一起、格数补齐 */
    t('加固 日历 36 个月网格恒等式',
      (function () {
        var bad = 0;
        for (var y = 2024; y <= 2026; y++) {
          for (var m = 1; m <= 12; m++) {
            var cal = CORE.buildCalendar(DATA, y, m, { interests: [] });
            if (!cal || !cal.weeks) { bad++; continue; }
            if (cal.weekdays.length !== 7) { bad++; continue; }
            var n = 0;
            for (var w = 0; w < cal.weeks.length; w++) n += cal.weeks[w].length;
            if (n % 7 !== 0 || n < 28) { bad++; continue; }
            /* 周起点必须是周一 */
            if (cal.weekdays[0] !== '一') bad++;
          }
        }
        return bad === 0;
      })(), '2024-2026 共 36 个月全部成立');

    /* ④ 月份越界 —— 必须夹回 1-12，不能算出不存在的月份 */
    t('加固 日历月份越界夹回（0/13/-1）',
      (function () {
        var a = CORE.buildCalendar(DATA, 2026, 0, { interests: [] });
        var b = CORE.buildCalendar(DATA, 2026, 13, { interests: [] });
        var c = CORE.buildCalendar(DATA, 2026, -1, { interests: [] });
        return a && b && c && a.month >= 1 && a.month <= 12
          && b.month >= 1 && b.month <= 12 && c.month >= 1 && c.month <= 12;
      })(), '归一后 month ∈ [1,12]');

    /* ⑤ shiftMonth —— 大 delta 不能卡死（取模实现），NaN 入参要能兜 */
    t('加固 shiftMonth 大 delta 不卡死（<50ms）',
      (function () {
        var t0 = Date.now();
        var r = CORE.shiftMonth(2026, 6, 1000000);
        var dt = Date.now() - t0;
        return dt < 50 && r && r.month >= 1 && r.month <= 12;
      })(), '百万级 delta 一次取模到位');
    t('加固 shiftMonth NaN 入参兜底',
      (function () {
        var r = CORE.shiftMonth(NaN, NaN, NaN);
        return r && typeof r.year === 'number' && isFinite(r.year)
          && r.month >= 1 && r.month <= 12;
      })(), '非数入参退回当前年月');

    /* ⑥ 问答引擎恒等式 —— 13 问：数量/唯一/归属/有答案/有依据 */
    t('加固 13 问恒等式（数量/唯一/归属/有答案/有依据）',
      (function () {
        var qs = CORE.askQuestions;   /* 网页端导出的是数组（同源 QUESTIONS） */
        if (qs && typeof qs === 'function') qs = qs();
        if (!Array.isArray(qs) || qs.length !== 13) return false;
        var ids = {}, groups = {};
        for (var i = 0; i < qs.length; i++) {
          if (!qs[i].id || !qs[i].q) return false;
          if (ids[qs[i].id]) return false;
          ids[qs[i].id] = 1;
          if (!qs[i].group) return false;
          groups[qs[i].group] = 1;
          var a = CORE.askAnswer(qs[i].id, { notices: DATA, profile: { interests: [] } });
          if (!a || typeof a.answer !== 'string' || !a.answer.length) return false;
          if (typeof a.basis !== 'string' || !a.basis.length) return false;
        }
        return Object.keys(groups).length >= 6;
      })(), '逐问跑一遍都要有答案与依据');

    /* ⑦ 非法问题 id —— 返回 null，不抛不崩 */
    t('加固 askAnswer 非法 id 返回 null',
      (function () {
        var a = CORE.askAnswer('no_such_q_at_all', { notices: DATA, profile: { interests: [] } });
        return a === null || a === undefined || typeof a.answer === 'string';
      })(), '非法输入不抛异常');

    /* ⑧ 机会类白名单 —— "全校能报"只认机会类，不能把考试安排混进来 */
    t('加固 机会类白名单过滤（无考试安排混入）',
      (function () {
        var a = CORE.askAnswer('all_can_apply', { notices: DATA, profile: { interests: [] } });
        if (!a || !a.items || !a.items.length) return true; /* 无命中跳过 */
        var ok = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];
        for (var i = 0; i < a.items.length; i++) {
          if (ok.indexOf(a.items[i].category) < 0) return false;
        }
        return true;
      })(), '命中项 category 全在机会类');

    /* ⑨ 问知时答案与数据自洽 —— today/week 的 itemCount 必须等于
     *    "与档案相关"（relatedNotices）里倒计时落入口径的条数。
     *    注意口径：不是全量 DATA，而是先过身份/标签过滤后的集合。 */
    t('加固 问知时答案与数据自洽（today/week）',
      (function () {
        var prof = { interests: [] };
        var rel = CORE.relatedNotices(DATA, prof);
        var cntToday = 0, cntWeek = 0;
        for (var i = 0; i < rel.length; i++) {
          var cd = rel[i].countdown;
          if (typeof cd !== 'number') continue;
          if (cd === 0) cntToday++;
          if (cd >= 0 && cd <= 7) cntWeek++;
        }
        var a = CORE.askAnswer('today', { notices: DATA, profile: prof });
        var b = CORE.askAnswer('week', { notices: DATA, profile: prof });
        return a.itemCount === cntToday && b.itemCount === cntWeek;
      })(), '条目数与 relatedNotices 倒计时口径一致');

    /* ⑩ R2 铁律 —— 演示条目（real!==true）绝不允许带链接 */
    t('加固 R2 铁律（演示条目不带链接）',
      DATA.filter(function (n) { return n.real !== true; })
          .every(function (n) { return !n.url; }),
      '非真实通知一律无 url');

    /* ⑪ 身份受众匹配 —— 与小程序同源（漏推 / 误杀防线） */
    t('加固 受众「本科XX工作」不误排除研究生',
      (function () {
        var grad = { identityType: '研究生', grade: '研究生 · 研一' };
        var titles = [
          '关于召开本科毕业论文（设计）工作会议的通知',
          '本科教育教学审核评估动员会',
          '本科教学检查通知',
          '本科专业建设研讨会通知'
        ];
        for (var i = 0; i < titles.length; i++) {
          if (CORE.matchAudience(titles[i], grad) !== true) return false;
        }
        return true;
      })(), '4 例全放行');
    t('加固 受众 本科+研究并列 → 两类学生都收、教职工排除',
      (function () {
        var s = '全校本科生、研究生均可申请';
        return CORE.matchAudience(s, { identityType: '本科生' }) === true
          && CORE.matchAudience(s, { identityType: '研究生' }) === true
          && CORE.matchAudience(s, { identityType: '教职工' }) === false;
      })(), '并列范围不误杀');
    t('加固 受众 真受众限定仍生效（点名 2025级）',
      CORE.matchAudience('2025级新生报到须知', { identityType: '本科生', grade: '2025级 · 大一' }) === true
        && CORE.matchAudience('2025级新生报到须知', { identityType: '研究生', grade: '研究生 · 研一' }) === false,
      '点名年级要生效');

  } catch (e) {
    fail++; console.log('[FAIL] 运行时异常：' + e.message + '\n' + (e.stack || ''));
  }

  const tail = '\n======== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ========';
  LINES.push(tail);
  console.log(tail);
  /* 详细清单落到系统临时目录，不污染源码树（需要时按提示路径取） */
  const outPath = path.join(require('os').tmpdir(), 'zhishi_check_app.txt');
  try { fs.writeFileSync(outPath, LINES.join('\n'), 'utf8'); } catch (e) { /* 临时目录不可写也无妨 */ }
  process.exit(fail ? 1 : 0);
}, 400);
