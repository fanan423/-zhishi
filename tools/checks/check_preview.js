/* 用 jsdom 静态渲染 小程序预览.html，检查元素是否齐全、主题切换是否生效 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = path.join(__dirname, '..', '..', '小程序预览.html');
const html = fs.readFileSync(file, 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const doc = dom.window.document;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('[OK]  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); }
}

/* 1. 手机壳数量 */
const phones = doc.querySelectorAll('.phone');
t('十三个手机壳', phones.length === 13, '实际 ' + phones.length);

/* 2. 默认浅色 */
t('默认全是浅色主题', doc.querySelectorAll('.phone.light').length === 13,
  'light ' + doc.querySelectorAll('.phone.light').length + ' / dark ' + doc.querySelectorAll('.phone.dark').length);

/* 3. 校徽（双圆形 + AAU 展开书页 + 麦金朝阳点 + 田野横纹 + 建校 1928）
      —— 首页 / 订阅页 / 简报页各一个，依《安徽农业大学章程》第 75 条 */
const styleTxt = doc.querySelector('style').textContent;
const crests = doc.querySelectorAll('.lg .aa');
t('校徽意象 logo 存在', crests.length === 3, '共 ' + crests.length + ' 处（首页 + 订阅页 + 简报页）');
t('校徽 AAU 文案', Array.from(crests).every(function(e){ return e.textContent.trim() === 'AAU'; }));
t('校徽麦金朝阳点', doc.querySelectorAll('.lg .sun').length === 3);
t('校徽展开书页（AAU 构成书籍）', doc.querySelectorAll('.lg .book').length === 3,
  '共 ' + doc.querySelectorAll('.lg .book').length + ' 处');
t('校徽建校年号 1928', doc.querySelectorAll('.lg .y').length === 3 &&
  Array.from(doc.querySelectorAll('.lg .y')).every(function(e){ return e.textContent.trim() === '1928'; }));
const crestStyle = styleTxt;
t('校徽为双圆形（内环 ::before 描边）',
  /\.hd \.crest::before\{[^}]*border:[^;]*solid/.test(crestStyle) &&
  /\.mhead \.lg::before\{[^}]*border:[^;]*solid/.test(crestStyle) &&
  /\.bhead \.lg::before\{[^}]*border:[^;]*solid/.test(crestStyle));
t('页头大徽含书页与年号', doc.querySelectorAll('.hd .crest .book').length === 1 &&
  doc.querySelectorAll('.hd .crest .y').length === 1);
t('顶栏提到「校徽双圆形意象」', /校徽双圆形意象/.test(doc.body.textContent));

/* 4. 安农 VI 色值出现在样式里 */
t('安农绿 #00653E', styleTxt.indexOf('#00653E') >= 0);
t('麦穗金 #F3AE00', styleTxt.indexOf('#F3AE00') >= 0);
t('朝阳橙红 #E77844', styleTxt.indexOf('#E77844') >= 0);

/* 5. 双主题变量 */
t('浅色主题变量块', /\.phone\.light\s*\{[^}]*--brand:#00653E/i.test(styleTxt));
t('深色主题变量块', /\.phone\.dark\s*\{[^}]*--brand:#2FBF82/i.test(styleTxt));

/* 6. 主题切换按钮 */
const btnL = doc.getElementById('btnLight'), btnD = doc.getElementById('btnDark');
t('主题切换按钮存在', !!btnL && !!btnD);
t('浅色按钮默认选中', btnL && btnL.classList.contains('on'));

/* 7. 模拟点深色 → 所有手机壳应变深色 */
if (btnD) {
  btnD.dispatchEvent(new dom.window.Event('click'));
  const d = doc.querySelectorAll('.phone.dark').length;
  t('切深色后十三屏变深色', d === 13, 'dark ' + d);
  t('深色按钮获得选中态', btnD.classList.contains('on'));
  t('深色页头按钮文案切换', doc.querySelector('.tbtn').textContent.indexOf('深色') >= 0,
    doc.querySelector('.tbtn').textContent.trim());
  /* 切回浅色 */
  btnL.dispatchEvent(new dom.window.Event('click'));
  t('切回浅色成功', doc.querySelectorAll('.phone.light').length === 13);
}

/* 8. 十三屏关键内容 */
t('屏1 关注流三档分区', doc.querySelectorAll('.fsec').length === 3,
  '分区 ' + doc.querySelectorAll('.fsec').length);
t('屏1 概况统计卡', doc.querySelectorAll('#p1 .stat .it').length === 3);
t('屏2 标签分组卡', doc.querySelectorAll('#p2 .grp').length >= 4);
t('屏2 紧急徽标', doc.querySelectorAll('#p2 .grp-h .bd').length >= 1);
t('屏3 关键信息卡四行', doc.querySelectorAll('#p3 .kcard .krow').length === 4);
t('屏3 浓缩要点卡', doc.querySelectorAll('#p3 .pt').length === 5);
t('屏3 溯源说明', doc.querySelectorAll('#p3 .pt .q .ok').length === 5);
t('屏4 搜索命中高亮', doc.querySelectorAll('#p4 .scard .t mark').length >= 1);
t('屏4 为什么搜到说明', doc.querySelectorAll('#p4 .whybox').length === 1);
t('屏5 订阅勾选行 9 个', doc.querySelectorAll('#p5 .subrow').length === 9);
t('屏5 已勾选 4 项', doc.querySelectorAll('#p5 .subrow.on').length === 4);
t('屏5 我的关键词输入框', doc.querySelectorAll('#p5 .kwin').length === 1);
t('屏5 已订关键词 chips ≥ 2', doc.querySelectorAll('#p5 .kwchip').length >= 2,
  doc.querySelectorAll('#p5 .kwchip').length + ' 个');
t('屏5 关键词带命中条数', doc.querySelectorAll('#p5 .kwchip .kwn').length >= 2);
t('屏5 关键词可删（× 存在）', doc.querySelectorAll('#p5 .kwchip .kwx').length >= 2);
t('屏5 推荐词', doc.querySelectorAll('#p5 .kwsug-w').length >= 2);
t('屏5 收藏行', doc.querySelectorAll('#p5 .frow').length === 2);
t('屏5 收益变化表', doc.querySelectorAll('#p5 .chg tr').length === 5);

/* 8b. 屏⑥ 时间轴 */
t('屏6 知时指数卡', doc.querySelectorAll('#p6 .idxcard').length === 1);
t('屏6 指数三项指标', doc.querySelectorAll('#p6 .idxmets .im').length === 3);
t('屏6 指数分档 lv-mid', doc.querySelectorAll('#p6 .idxcard.lv-mid').length === 1);
t('屏6 五档分箱', doc.querySelectorAll('#p6 .bk').length === 5,
  '档 ' + doc.querySelectorAll('#p6 .bk').length);
t('屏6 时间轴竖线', doc.querySelectorAll('#p6 .tl .tline').length === 3);
t('屏6 节点标记', doc.querySelectorAll('#p6 .tnode').length === 5,
  '节点 ' + doc.querySelectorAll('#p6 .tnode').length);
t('屏6 时间轴卡片', doc.querySelectorAll('#p6 .tcard').length === 5,
  '卡片 ' + doc.querySelectorAll('#p6 .tcard').length);
t('屏6 今天到期档高亮', doc.querySelectorAll('#p6 .bhd.now').length === 1);
t('屏6 更远档存在', doc.querySelectorAll('#p6 .bhd.far').length === 1);

/* 8c. 屏⑦ 今日简报 */
t('屏7 简报头', doc.querySelectorAll('#p7 .bhead').length === 1);
t('屏7 一句话总结卡', doc.querySelectorAll('#p7 .sumcard').length === 1);
t('屏7 总结分句 3 行', doc.querySelectorAll('#p7 .sumcard .sumtx').length === 3,
  '句 ' + doc.querySelectorAll('#p7 .sumcard .sumtx').length);
t('屏7 指数行', doc.querySelectorAll('#p7 .sumidx .siv').length === 1);
t('屏7 三天内要办 3 件', doc.querySelectorAll('#p7 .icard').length === 3,
  '要办 ' + doc.querySelectorAll('#p7 .icard').length);
t('屏7 本周留意 3 件', doc.querySelectorAll('#p7 .wcard').length === 3,
  '留意 ' + doc.querySelectorAll('#p7 .wcard').length);
t('屏7 可信度条', doc.querySelectorAll('#p7 .trust').length === 1);
t('屏7 可信度高', doc.querySelectorAll('#p7 .trust.trust-high').length === 1);
t('屏7 可信度进度条', doc.querySelectorAll('#p7 .trbar .trfill').length === 1);
t('屏7 快捷入口 3 个', doc.querySelectorAll('#p7 .quick .qb').length === 3);

/* 9. 底部 tabBar 每屏都有 + 四 tab */
t('每屏都有 tabBar', doc.querySelectorAll('.tabbar').length === 13);
t('tabBar 高亮（搜索/自查/推送/问答/日历是二级页，不占高亮）', doc.querySelectorAll('.tabbar .tb.on').length === 8,
  'on ' + doc.querySelectorAll('.tabbar .tb.on').length + ' / 13 屏');
t('每屏 4 个 tab', doc.querySelectorAll('.tabbar').length * 4 === doc.querySelectorAll('.tabbar .tb').length,
  'tb ' + doc.querySelectorAll('.tabbar .tb').length);
t('四 tab 文案齐全', doc.querySelectorAll('.tabbar .tb').length === 52,
  'tb ' + doc.querySelectorAll('.tabbar .tb').length);

/* 9b. 首页新增组件 */
t('屏1 知时指数条', doc.querySelectorAll('#p1 .idxstrip').length === 1);
t('屏1 快捷入口 3 个', doc.querySelectorAll('#p1 .quick .qb').length === 3);
t('屏5 快捷入口 2 个', doc.querySelectorAll('#p5 .quick .qb').length === 2);

/* 9c. 屏⑧ 详情：和我有关吗 + 办理清单 + 真实出处 */
t('屏8 有判定卡', doc.querySelectorAll('#p8 .relcard').length === 1);
t('屏8 判定卡为要看细则', doc.querySelectorAll('#p8 .relcard.rel-warn').length === 1);
t('屏8 条件逐条列出 3 条', doc.querySelectorAll('#p8 .relcard .relrow').length === 3,
  '条 ' + doc.querySelectorAll('#p8 .relcard .relrow').length);
t('屏8 符合态 ✓ 两条', doc.querySelectorAll('#p8 .relst-ok').length === 2);
t('屏8 存疑态 ? 一条', doc.querySelectorAll('#p8 .relst-warn').length === 1);
t('屏8 有「我 ↔ 要求」对照',
  doc.querySelectorAll('#p8 .relmine').length === 3 && doc.querySelectorAll('#p8 .relneed').length === 3);
t('屏8 有办理清单', doc.querySelectorAll('#p8 .stepcard').length === 1);
t('屏8 清单 7 步', doc.querySelectorAll('#p8 .stepitem').length === 7,
  '步 ' + doc.querySelectorAll('#p8 .stepitem').length);
t('屏8 已勾 1 步', doc.querySelectorAll('#p8 .stepitem.done').length === 1);
t('屏8 清单有进度条', doc.querySelectorAll('#p8 .stepbar .stepfill').length === 1);
t('屏8 有复制清单入口', doc.querySelectorAll('#p8 .stepcopy').length === 1);
/* 出处真实性（可靠性红线） */
t('屏8 展示可核对原文链接', doc.querySelectorAll('#p8 .srcline').length === 1);
t('屏8 链接指向 jwc.ahau.edu.cn',
  /jwc\.ahau\.edu\.cn\/info\/1881\/36671\.htm/.test(
    (doc.querySelector('#p8 .srcline') || {}).textContent || ''));
t('屏8 角标写明"真实公开源 · 可核对"',
  /真实公开源 · 可核对/.test((doc.querySelector('#p8 .dhead .real') || {}).textContent || ''));

/* 9d. 屏⑨ 收藏：按截止日排 + 办事进度 */
t('屏9 收藏行 4 条', doc.querySelectorAll('#p9 .frow').length === 4,
  '行 ' + doc.querySelectorAll('#p9 .frow').length);
t('屏9 有紧急度标记', doc.querySelectorAll('#p9 .frow .fdd').length === 4);
t('屏9 紧急度含"要抓紧"提示', doc.querySelectorAll('#p9 .secwarn').length === 1);
t('屏9 覆盖 hot/soon/exp 三档',
  doc.querySelectorAll('#p9 .frow.lv-hot').length === 2 &&
  doc.querySelectorAll('#p9 .frow.lv-soon').length === 1 &&
  doc.querySelectorAll('#p9 .frow.lv-exp').length === 1);
t('屏9 有办事进度', doc.querySelectorAll('#p9 .frow .fprog').length === 3,
  '进度 ' + doc.querySelectorAll('#p9 .frow .fprog').length);
t('屏9 有"全部办完"态', doc.querySelectorAll('#p9 .fpi.ok').length === 1);

/* 10. 无外部依赖 */
t('无外链 CSS/JS', doc.querySelectorAll('link[rel=stylesheet],script[src]').length === 0);

/* 11. 出处诚实性（可靠性红线） */
const bodyText = doc.body.textContent || '';
t('可信度段说明链接情况', /带可核对原文链接/.test(bodyText));
t('注明没链接的条目标为演示/未留存链接',
  /演示样例 \/ 未留存链接/.test(bodyText) || /没链接的标为/.test(bodyText));
t('页面不再出现含糊的"真实公开源"独占角标',
  (bodyText.match(/真实公开源/g) || []).length <= 3,
  '出现 ' + (bodyText.match(/真实公开源/g) || []).length + ' 次（应仅在"可核对"语境下）');

/* 9e. 屏⑩ 数据自查（自查自纠系统） */
t('屏10 有自查结论卡', doc.querySelectorAll('#p10 .verdict').length === 1);
t('屏10 结论卡为通过态', doc.querySelectorAll('#p10 .verdict.ok').length === 1);
t('屏10 四项审计指标', doc.querySelectorAll('#p10 .stat .it').length === 4);
t('屏10 三条铁律齐全', doc.querySelectorAll('#p10 .rulecard').length === 3,
  '条 ' + doc.querySelectorAll('#p10 .rulecard').length);
t('屏10 铁律标签为 R1/R2/R3',
  Array.from(doc.querySelectorAll('#p10 .rulecard .rtag')).map(function(e){return e.textContent.trim();}).join(',') === 'R1,R2,R3');
t('屏10 有自动纠正说明', doc.querySelectorAll('#p10 .arnote').length >= 1);
t('屏10 有疑点如实标注区', doc.querySelectorAll('#p10 .arl.warn').length >= 1);
t('屏10 明示未留存链接是如实标注不是失败',
  /不是失败/.test(doc.querySelector('#p10').textContent));
t('屏10 有被剔除条目区', /被剔除的条目/.test(doc.querySelector('#p10').textContent));
t('屏10 明示本次零剔除', /未剔除任何条目/.test(doc.querySelector('#p10').textContent));
t('屏10 可举证清单 3 条', doc.querySelectorAll('#p10 .vcard').length === 3,
  '条 ' + doc.querySelectorAll('#p10 .vcard').length);
t('屏10 可举证清单均带 ahau.edu.cn 链接',
  Array.from(doc.querySelectorAll('#p10 .vcard .vu')).every(function(e){return /ahau\.edu\.cn/.test(e.textContent);}));
t('屏10 有审计留痕', doc.querySelectorAll('#p10 .hrow').length >= 3,
  '行 ' + doc.querySelectorAll('#p10 .hrow').length);
t('屏10 留痕含放行/剔除/可举证三指标',
  /放行 \d+\/\d+ · 剔除 \d+ · 可举证 \d+/.test(doc.querySelector('#p10').textContent));

/* 9f. 屏⑪ 推送设置（主动推送引擎） */
t('屏11 有引擎状态卡', doc.querySelectorAll('#p11 .sumcard').length === 1);
t('屏11 状态卡显示覆盖率', doc.querySelectorAll('#p11 .sumcard .siv').length === 1);
t('屏11 有应用内推送开关 3 个', doc.querySelectorAll('#p11 .trow').length === 3,
  '开关 ' + doc.querySelectorAll('#p11 .trow').length);
t('屏11 开关有开启态', doc.querySelectorAll('#p11 .sw.on').length === 3);
t('屏11 有打扰策略区', /打扰策略/.test(doc.querySelector('#p11').textContent));
t('屏11 明示「只打扰三天内」', /只打扰三天内/.test(doc.querySelector('#p11').textContent));
t('屏11 解释为什么不滥打扰', /最贵的资源/.test(doc.querySelector('#p11').textContent));
t('屏11 有后台推送说明', /后台推送/.test(doc.querySelector('#p11').textContent));
t('屏11 明示注册方式（注册后台推送.bat）',
  /注册后台推送\.bat/.test(doc.querySelector('#p11').textContent));
t('屏11 有推送留痕区', /推送留痕/.test(doc.querySelector('#p11').textContent));
t('屏11 留痕说明「新收录」如何判定', /不会再标新/.test(doc.querySelector('#p11').textContent));
t('屏11 有推送卡片 3 张', doc.querySelectorAll('#p11 .pc').length === 3,
  '卡 ' + doc.querySelectorAll('#p11 .pc').length);
t('屏11 卡片不再堆「为什么推给你」（只留级别/标题/来源）',
  doc.querySelectorAll('#p11 .pwhy').length === 0 &&
  !/为什么推给你/.test(doc.querySelector('#p11').textContent));
t('屏11 卡有推送级别徽标',
  doc.querySelectorAll('#p11 .plv.now').length === 1 &&
  doc.querySelectorAll('#p11 .plv.hot').length === 1 &&
  doc.querySelectorAll('#p11 .plv.soon').length === 1);
t('屏11 卡有新收录标记', doc.querySelectorAll('#p11 .pnew').length === 2);
t('屏11 卡有推送分数', doc.querySelectorAll('#p11 .tg.s').length === 3);
t('屏11 卡有排名', doc.querySelectorAll('#p11 .prank').length === 3);
t('屏11 说明三条不变式', /三条不变式/.test(doc.querySelector('#p11').textContent));

/* 9g. 屏⑫ 问知时（学生自问自答引擎） */
const p12 = doc.querySelector('#p12');
t('屏12 卡片存在', !!p12);
t('屏12 今日一问大卡', doc.querySelectorAll('#p12 .hcard').length === 1);
t('屏12 大卡为告急态（今天有要办）', doc.querySelectorAll('#p12 .hcard.tone-alert').length === 1);
t('屏12 大卡以「问知时」开头', /问知时/.test(p12.textContent));
t('屏12 大卡给出真实结论（今天有 1 件要办）', /今天有 1 件要办/.test(p12.textContent));
t('屏12 大卡有追问入口', doc.querySelectorAll('#p12 .hcard .hm').length === 1);
t('屏12 问答自评条', doc.querySelectorAll('#p12 .askstat').length === 1);
t('屏12 自评三项指标', doc.querySelectorAll('#p12 .askstat .sti').length === 3);
t('屏12 自评含问题数 13', /13/.test((doc.querySelector('#p12 .askstat .sti .stn') || {}).textContent || ''));
t('屏12 自评含数据完备度', /数据完备度/.test(p12.textContent));
t('屏12 答案卡 2 张（问答示例）', doc.querySelectorAll('#p12 .acard').length === 2,
  '卡 ' + doc.querySelectorAll('#p12 .acard').length);
t('屏12 每张答案卡都有「依据」一行', doc.querySelectorAll('#p12 .acard .abasis').length === 2);
t('屏12 依据写明统计口径/筛选口径',
  Array.from(doc.querySelectorAll('#p12 .acard .abt')).every(function(e){return /口径/.test(e.textContent);}));
t('屏12 材料清单卡存在', doc.querySelectorAll('#p12 .mlist').length === 1);
t('屏12 材料清单说明共 9 项', /共 9 项/.test(p12.textContent));
t('屏12 每条材料写明来自哪条通知',
  doc.querySelectorAll('#p12 .mlist .mrow').length === 4 &&
  doc.querySelectorAll('#p12 .mlist .mfrom').length === 4);
t('屏12 材料有「还有 N 项」折叠提示', doc.querySelectorAll('#p12 .mlist .more').length === 1);
t('屏12 答案卡带相关条目', doc.querySelectorAll('#p12 .acard .ilist').length === 1);
t('屏12 相关条目有倒计时徽标', doc.querySelectorAll('#p12 .acard .idd').length >= 1);
t('屏12 问题目录 6 组', doc.querySelectorAll('#p12 .qgroup').length === 6,
  '组 ' + doc.querySelectorAll('#p12 .qgroup').length);
t('屏12 问题目录共 13 条', doc.querySelectorAll('#p12 .qrow').length === 13,
  '行 ' + doc.querySelectorAll('#p12 .qrow').length);
t('屏12 六组标签齐全',
  ['今天 / 这周', '先办哪个', '我漏了什么', '是不是给我的', '要准备什么', '数据可靠吗']
    .every(function(s){ return p12.textContent.indexOf(s) >= 0; }));
t('屏12 已答问题高亮', doc.querySelectorAll('#p12 .qrow.on').length === 1);
t('屏12 未答问题显示「问 ›」',
  doc.querySelectorAll('#p12 .qrow .qa').length === 13 &&
  (p12.textContent.match(/已答/g) || []).length === 1);
t('屏12 六组高频疑问覆盖学生视角',
  /今天有什么非要办的/.test(p12.textContent) &&
  /先办哪个|该办哪个/.test(p12.textContent) &&
  /我是不是漏了什么/.test(p12.textContent) &&
  /哪些是全校都能报的/.test(p12.textContent) &&
  /我要准备哪些材料/.test(p12.textContent) &&
  /数据可靠吗/.test(p12.textContent));
t('屏12 明示「算不出来也不编结论」答问原则',
  /算不出来/.test(p12.textContent) && /不编结论/.test(p12.textContent));
t('屏12 有行动按钮 2 个', doc.querySelectorAll('#p12 .acts .ab').length === 2);
t('屏12 有跳日历入口', /看办事日历/.test(p12.textContent));

/* 9h. 屏⑬ 办事日历 */
const p13 = doc.querySelector('#p13');
t('屏13 卡片存在', !!p13);
t('屏13 月份切换条', doc.querySelectorAll('#p13 .mbar').length === 1);
t('屏13 月份标签为 2026 年 11 月', /2026 年 11 月/.test(p13.textContent));
t('屏13 有「回到今天」', /回到今天/.test(p13.textContent));
t('屏13 上下月导航各一', doc.querySelectorAll('#p13 .mbar .mnav').length === 2);
t('屏13 月历网格', doc.querySelectorAll('#p13 .calbox').length === 1);
t('屏13 周标题 7 列（周一起）', doc.querySelectorAll('#p13 .wkrow .wk').length === 7);
t('屏13 周标题以「一」开头「日」结尾',
  Array.from(doc.querySelectorAll('#p13 .wkrow .wk')).map(function(e){return e.textContent.trim();}).join('') === '一二三四五六日');
t('屏13 周末列高亮', doc.querySelectorAll('#p13 .wk.wkend').length === 2);
t('屏13 六周行', doc.querySelectorAll('#p13 .crow').length === 6,
  '行 ' + doc.querySelectorAll('#p13 .crow').length);
t('屏13 每行 7 格', doc.querySelectorAll('#p13 .cell').length === 42,
  '格 ' + doc.querySelectorAll('#p13 .cell').length);
t('屏13 首行前导空白 6 格（11 月 1 日是周日）',
  doc.querySelectorAll('#p13 .calbox .crow')[0].querySelectorAll('.cell.blank').length === 6);
t('屏13 有今天标记', doc.querySelectorAll('#p13 .cell.today').length === 1);
t('屏13 今天为 6 号', (doc.querySelector('#p13 .cell.today .cd') || {}).textContent.trim() === '6');
t('屏13 默认选中今天', doc.querySelectorAll('#p13 .cell.today.sel').length === 1);
t('屏13 忙碌日带圆点', doc.querySelectorAll('#p13 .cell.has .cdot').length === 5,
  '点 ' + doc.querySelectorAll('#p13 .cell.has .cdot').length);
t('屏13 多事日显示计数', doc.querySelectorAll('#p13 .ccnt').length === 1);
t('屏13 今天格显示 2 件', (doc.querySelector('#p13 .ccnt') || {}).textContent.trim() === '2');
t('屏13 忙日含 now/soon/plan 三档',
  doc.querySelectorAll('#p13 .cell.lv-now').length === 1 &&
  doc.querySelectorAll('#p13 .cell.lv-soon').length === 2 &&
  doc.querySelectorAll('#p13 .cell.lv-plan').length === 2);
t('屏13 有图例 4 档', doc.querySelectorAll('#p13 .legend .lg').length === 4);
t('屏13 图例含今天/三天内/一周内/本月内',
  ['今天/明天', '三天内', '一周内', '本月内']
    .every(function(s){ return p13.textContent.indexOf(s) >= 0; }));
t('屏13 本月总结行', doc.querySelectorAll('#p13 .sumline').length === 1);
t('屏13 总结给出真实数字（6 件 / 5 天）',
  /这个月有 6 件要办，分布在 5 天/.test(p13.textContent));
t('屏13 选中日明细标题写明今天', /11 月 6 日（今天）/.test(p13.textContent));
t('屏13 选中日 2 条明细',
  doc.querySelectorAll('#p13 .ibox')[0].querySelectorAll('.irow').length === 2);
t('屏13 本月全部待办可展开', /本月全部待办/.test(p13.textContent) && /收起/.test(p13.textContent));
t('屏13 本月条目 5 条', doc.querySelectorAll('#p13 .ibox').length === 2,
  '盒 ' + doc.querySelectorAll('#p13 .ibox').length);
t('屏13 条目有倒计时徽标', doc.querySelectorAll('#p13 .ibox .idd').length >= 5);
t('屏13 明示日历口径（只落关注的标签 + 身份匹配）',
  /只落你关注标签/.test(p13.textContent));
t('屏13 明示与时间轴同源不是两套事实',
  /同一批数据/.test(p13.textContent) && /不是两套事实/.test(p13.textContent));
t('屏13 明示已过期不再占用待办位置', /不再占用待办位置/.test(p13.textContent));

/* 9i. 两屏共用「问知时」口径一致性 */
t('屏12/13 均未出现编造的假结论',
  !/预计|大概|可能是|估计/.test(doc.querySelector('#p12').textContent + doc.querySelector('#p13').textContent));

/* 9j. 一句话卡片墙 —— 默认只给结论，点开才贴全文
   （为什么：十三屏平铺成一面墙太挤；默认收敛成一句话，细看再点开独占一行） */
const cards = doc.getElementById('cards');
const grid = doc.getElementById('grid');
const stage = doc.getElementById('stage');
const stageBody = doc.getElementById('stageBody');
const stageNo = doc.getElementById('stageNo');
const stageNm = doc.getElementById('stageNm');
const stageClose = doc.getElementById('stageClose');
const btnCards = doc.getElementById('btnCards');
const btnAll = doc.getElementById('btnAll');

t('卡片墙/网格/舞台/模式按钮都在',
  !!cards && !!grid && !!stage && !!stageBody && !!stageClose && !!btnCards && !!btnAll);

/* —— 卡片本身 —— */
const pcardEls = cards ? cards.querySelectorAll('.pcard') : [];
t('卡片墙共 13 张', pcardEls.length === 13, '实际 ' + pcardEls.length);

t('每张卡片四要素齐全（序号/名称/路由/一句话）',
  Array.prototype.every.call(pcardEls, function(c){
    return !!(c.querySelector('.pc-no') && c.querySelector('.pc-nm') &&
              c.querySelector('.pc-rt') && c.querySelector('.pc-one'));
  }));

t('每张卡片都带 data-no（1..13 齐）',
  Array.prototype.every.call(pcardEls, function(c, i){
    return c.getAttribute('data-no') === String(i + 1);
  }));

/* 一句话必须是「一句话」：有内容、句尾带句号、不超过 40 字 */
t('每张卡片的一句话都是单句结论（≤ 40 字，句尾带符号）',
  Array.prototype.every.call(pcardEls, function(c){
    var s = c.querySelector('.pc-one').textContent.trim();
    return s.length > 0 && s.length <= 40 && /[。！？]$/.test(s);
  }),
  '最长 ' + Math.max.apply(null, Array.prototype.map.call(pcardEls, function(c){
    return c.querySelector('.pc-one').textContent.trim().length;
  })) + ' 字');

t('卡片序号两格式化（01..13）',
  Array.prototype.every.call(pcardEls, function(c, i){
    return c.querySelector('.pc-no').textContent.trim() === ('0' + (i + 1)).slice(-2);
  }));

/* —— 网格里 13 个 .col 与卡片一一对应 —— */
const colEls = grid ? grid.querySelectorAll('.col') : [];
t('网格里 13 个手机列', colEls.length === 13, '实际 ' + colEls.length);
t('每个手机列都有 data-no（与卡片对应）',
  Array.prototype.every.call(colEls, function(c, i){
    return c.getAttribute('data-no') === String(i + 1);
  }));
t('网格里 13 屏 id 齐全 p1..p13',
  Array.prototype.every.call(colEls, function(c, i){
    return !!doc.getElementById('p' + (i + 1));
  }));

/* —— 默认视图：卡片总览可见、网格与舞台收起 —— */
t('默认「一句话总览」按钮选中', btnCards.classList.contains('on') && !btnAll.classList.contains('on'));
t('默认网格收起（#grid 无 on）', grid && !grid.classList.contains('on'));
t('默认舞台收起（#stage 无 on）', stage && !stage.classList.contains('on'));
t('默认 13 个手机列都待在网格里',
  grid && grid.querySelectorAll('.col').length === 13);
t('默认舞台里没有被搬走的屏',
  stageBody && stageBody.querySelectorAll('.col').length === 0);

/* —— 点开一张卡片 —— */
const card3 = cards.querySelector('.pcard[data-no="3"]');
card3.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
t('点开卡片 → 舞台展开（#stage.on）', stage.classList.contains('on'));
t('点开卡片 → 对应屏 p3 进舞台',
  stageBody.querySelectorAll('.col').length === 1 &&
  !!stageBody.querySelector('#p3'));
t('点开卡片 → 舞台标题同步为该屏名',
  stageNm.textContent.trim() === '详情 · 浓缩溯源', stageNm.textContent.trim());
t('点开卡片 → 舞台序号同步为 03', stageNo.textContent.trim() === '03', stageNo.textContent.trim());
t('点开卡片 → 该卡片高亮（.open）',
  card3.classList.contains('open') &&
  cards.querySelectorAll('.pcard.open').length === 1);
t('点开卡片 → 一次只展开一屏（网格里少 1 个）',
  grid.querySelectorAll('.col').length === 12);

/* —— 再点另一张，切换 —— */
const card7 = cards.querySelector('.pcard[data-no="7"]');
card7.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
t('点另一张 → 舞台上换成 p7（仍然只 1 屏）',
  stageBody.querySelectorAll('.col').length === 1 && !!stageBody.querySelector('#p7'));
t('点另一张 → p3 已放回网格',
  !!grid.querySelector('.col[data-no="3"]') && !stageBody.querySelector('#p3'));
t('点另一张 → 高亮转移到新卡片',
  card7.classList.contains('open') && !card3.classList.contains('open'));
t('点另一张 → 舞台标题/序号同步',
  stageNm.textContent.trim() === '今日简报' && stageNo.textContent.trim() === '07',
  stageNm.textContent.trim() + ' / ' + stageNo.textContent.trim());

/* —— 收起 —— */
stageClose.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
t('点收起 → 舞台收起（#stage 无 on）', !stage.classList.contains('on'));
t('点收起 → 屏精确放回网格（13 屏齐）', grid.querySelectorAll('.col').length === 13);
t('点收起 → 13 屏顺序不乱（data-no 1..13）',
  Array.prototype.every.call(grid.querySelectorAll('.col'), function(c, i){
    return c.getAttribute('data-no') === String(i + 1);
  }));
t('点收起 → 无卡片残留高亮', cards.querySelectorAll('.pcard.open').length === 0);

/* —— 视图模式切换 —— */
dom.window.setMode('all');
t('切「全部展开」→ 网格显示（#grid.on）', grid.classList.contains('on'));
t('切「全部展开」→ 卡片墙隐藏', cards.style.display === 'none');
t('切「全部展开」→ 按钮态翻转',
  btnAll.classList.contains('on') && !btnCards.classList.contains('on'));
t('切「全部展开」→ 十三屏都在网格里', grid.querySelectorAll('.col').length === 13);
t('切「全部展开」→ 舞台收起', !stage.classList.contains('on'));

dom.window.setMode('cards');
t('切回「一句话总览」→ 网格收起', !grid.classList.contains('on'));
t('切回「一句话总览」→ 卡片墙显示', cards.style.display !== 'none');
t('切回「一句话总览」→ 按钮态翻转回来',
  btnCards.classList.contains('on') && !btnAll.classList.contains('on'));

console.log('');
console.log('======== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ========');
process.exit(fail ? 1 : 0);
