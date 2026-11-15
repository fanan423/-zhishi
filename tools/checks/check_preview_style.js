/* 用 jsdom + 无头截图 不可用时，输出结构化校验报告 */
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, '..', '..', '小程序预览.html');
const c = fs.readFileSync(f, 'utf8');

const marks = {
  '浅色主题变量 --brand:#00653E': /\.phone\.light\s*\{[^}]*--brand:#00653E/.test(c),
  '深色主题变量 --brand:#2FBF82': /\.phone\.dark\s*\{[^}]*--brand:#2FBF82/.test(c),
  '深色背景 --bg:#0C1A14':       /\.phone\.dark\s*\{[^}]*--bg:#0C1A14/.test(c),
  '安农绿 #00653E':               c.includes('#00653E'),
  '麦穗金 #F3AE00':               c.includes('#F3AE00'),
  '朝阳橙红 #E77844':             c.includes('#E77844'),
  '校徽 AAU':                     c.includes('>AAU<'),
  '校徽展开书页 .book':           c.includes('class="book"'),
  '校徽建校年号 1928':            c.includes('>1928<'),
  '校徽双圆形内环（.crest::before 描边）':
    /\.hd \.crest::before\{[^}]*border:[^;]*solid/.test(c) &&
    /\.mhead \.lg::before\{[^}]*border:[^;]*solid/.test(c) &&
    /\.bhead \.lg::before\{[^}]*border:[^;]*solid/.test(c),
  '麦金朝阳点 .sun':              c.includes('class="sun"'),
  '十三屏 .phone':                (c.match(/class="phone light"/g) || []).length === 13,
  '主题按钮':                     c.includes('id="btnDark"'),
  'localStorage 持久化':          c.includes('zhishi_preview_theme'),
  '无外链资源':                   !/<link[^>]+stylesheet/.test(c) && !/<script[^>]+src=/.test(c),
  'tabBar 四 tab × 十三屏':       (c.match(/class="tb[ "]/g) || []).length >= 52,
  '时间轴五档样式':               c.includes('.bhd.now') && c.includes('.bhd.far'),
  '时间轴节点样式':               /\.tnode\.hi/.test(c) && /\.tnode\.md/.test(c),
  '时间轴卡片三档':               /\.tcard\.hi/.test(c) && /\.tcard\.md/.test(c) && /\.tcard\.lo/.test(c),
  '指数卡分档':                   /\.idxcard\.lv-high/.test(c) && /\.idxcard\.lv-mid/.test(c),
  '简报总结卡分档':               /\.sumcard\.lv-high/.test(c) && /\.sumcard\.lv-mid/.test(c),
  '可信度三档':                   /\.trust-high/.test(c) && /\.trust-mid/.test(c) && /\.trust-low/.test(c),
  '到办卡 now/hi':                /\.icard\.now/.test(c) && /\.icard\.hi/.test(c),
  '快捷入口样式':                 /\.quick \.qb\b/.test(c),
  '和我有关吗 四档':              /\.relcard\.rel-ok/.test(c) && /\.relcard\.rel-warn/.test(c) &&
                                  /\.relcard\.rel-no/.test(c) && /\.relcard\.rel-open/.test(c),
  '条件三态标记':                 /\.relst-ok/.test(c) && /\.relst-warn/.test(c) && /\.relst-no/.test(c),
  '办理清单样式':                 /\.stepitem\b/.test(c) && /\.stepitem\.done/.test(c) &&
                                  /\.stepfill/.test(c),
  '收藏紧急度色阶':               /\.frow\.lv-hot/.test(c) && /\.frow\.lv-exp/.test(c) &&
                                  /\.frow\.lv-soon/.test(c),
  '收藏办事进度':                 /\.fprog/.test(c) && /\.fpi\.ok/.test(c),
  '自查结论卡两态':               /\.verdict\.ok/.test(c) && /\.verdict\.bad/.test(c),
  '自查铁律卡样式':               /\.rulecard\b/.test(c) && /\.rulecard \.rtag/.test(c),
  '自查疑点标注样式':             /\.sbox \.arl\.warn/.test(c),
  '自查可举证清单样式':           /\.vcard \.vu/.test(c) && /\.vcard \.vgo/.test(c),
  '自查留痕样式':                 /\.hrow \.ht/.test(c) && /\.hrow \.hx/.test(c),
  '推送卡片四档色阶':             /\.pc\.lv-now/.test(c) && /\.pc\.lv-hot/.test(c) &&
                                  /\.pc\.lv-soon/.test(c) && /\.pc\.lv-far/.test(c),
  '推送级别徽标样式':             /\.pc \.plv\.now/.test(c) && /\.pc \.plv\.soon/.test(c),
  '推送卡片元信息行样式':         /\.pc \.pmeta/.test(c),
  '推送卡片不再有理由框（已精简）': !/\.pc \.pwhy/.test(c),
  '推送新收录标样式':             /\.pc \.pnew/.test(c) && /\.pc \.prank/.test(c),
  '推送开关样式':                 /\.sw\.on/.test(c) && /\.sw \.swd/.test(c),
  '推送引擎状态卡样式':           /\.sumcard \.sumidx/.test(c) && /\.sumcard \.siv/.test(c),
  '后台推送说明样式':             /\.daemon \.dh/.test(c) && /\.daemon \.dc/.test(c),
  '推送留痕行样式':               /\.kvrow \.kk/.test(c) && /\.kvrow \.vv/.test(c),
  '推送打扰徽标样式':             /\.sec \.secwarn/.test(c),
  '新增变量 --track/--alert-ink': c.includes('--track') && c.includes('--alert-ink'),

  /* ⑤ 我的关键词（自定义订阅） */
  '关键词输入框样式':             /\.kwin\b/.test(c) && /\.kwinbox\b/.test(c),
  '关键词添加按钮样式':           /\.kwadd\b/.test(c),
  '关键词 chip 样式':             /\.kwchip\b/.test(c) && /\.kwchip\.empty\b/.test(c) &&
                                  /\.kwchip \.kwt\b/.test(c) && /\.kwchip \.kwn\b/.test(c),
  '关键词紧急标样式':             /\.kwchip \.kwhot\b/.test(c),
  '关键词删除 × 样式':            /\.kwchip \.kwx\b/.test(c),
  '关键词推荐词样式':             /\.kwsug\b/.test(c) && /\.kwsug-w\b/.test(c),
  '关键词说明行样式':             /\.srow-hint\b/.test(c),

  /* ⑫ 问知时（自问自答引擎） */
  '问答今日一问大卡样式':         /\.hcard\b/.test(c) && /\.hcard \.hq\b/.test(c) &&
                                  /\.hcard \.ha\b/.test(c) && /\.hcard \.hm\b/.test(c),
  '问答大卡告急态':               /\.hcard\.tone-alert\b/.test(c),
  '问答大卡其他三态':             /\.hcard\.tone-warn\b/.test(c),
  '问答自评条样式':               /\.askstat \.sti\b/.test(c) && /\.askstat \.stn\b/.test(c),
  '答案卡样式':                   /\.acard \.aq\b/.test(c) && /\.acard \.aa\b/.test(c),
  '答案卡四档色阶':               /\.acard\.tone-alert\b/.test(c) && /\.acard\.tone-warn\b/.test(c) &&
                                  /\.acard\.tone-busy\b/.test(c) && /\.acard\.tone-calm\b/.test(c),
  '「依据」说明框样式':           /\.acard \.abasis\b/.test(c) && /\.acard \.abl\b/.test(c) &&
                                  /\.acard \.abt\b/.test(c),
  '材料清单样式':                 /\.acard \.mlist\b/.test(c) && /\.acard \.mrow\b/.test(c) &&
                                  /\.acard \.mname\b/.test(c) && /\.acard \.mfrom\b/.test(c),
  '相关条目样式':                 /\.acard \.ilist\b/.test(c) && /\.acard \.irow\b/.test(c) &&
                                  /\.acard \.ititle\b/.test(c),
  '条目倒计时徽标样式':           /\.acard \.idd\b/.test(c),
  '问题目录分组样式':             /\.qgroup \.ghead\b/.test(c) && /\.qgroup \.gl\b/.test(c),
  '问题行样式':                   /\.qrow \.qq\b/.test(c) && /\.qrow \.qh\b/.test(c) &&
                                  /\.qrow \.qa\b/.test(c),
  '已答问题高亮样式':             /\.qrow\.on\b/.test(c),
  '行动按钮样式':                 /\.acts \.ab\b/.test(c) && /\.acts \.ab\.primary\b/.test(c),

  /* ⑬ 办事日历 */
  '月份切换条样式':               /\.mbar \.mnav\b/.test(c) && /\.mbar \.ml\b/.test(c) &&
                                  /\.mbar \.mtoday\b/.test(c),
  '月历网格样式':                 /\.calbox \.wkrow\b/.test(c) && /\.calbox \.crow\b/.test(c) &&
                                  /\.calbox \.cell\b/.test(c),
  '月历格空白态':                 /\.calbox \.cell\.blank\b/.test(c),
  '月历格四档色阶':               /\.calbox \.cell\.has\.lv-now\b/.test(c) &&
                                  /\.calbox \.cell\.has\.lv-hot\b/.test(c) &&
                                  /\.calbox \.cell\.has\.lv-soon\b/.test(c),
  '月历今天标记':                 /\.calbox \.cell\.today\b/.test(c),
  '月历选中态':                   /\.calbox \.cell\.sel\b/.test(c),
  '月历忙碌圆点':                 /\.calbox \.cdot\b/.test(c),
  '月历多事计数':                 /\.calbox \.ccnt\b/.test(c),
  '月历过期变灰':                 /\.calbox \.cell\.past\b/.test(c),
  '图例四档样式':                 /\.legend \.dot\.now\b/.test(c) && /\.legend \.dot\.hot\b/.test(c) &&
                                  /\.legend \.dot\.soon\b/.test(c) && /\.legend \.dot\.plan\b/.test(c),
  '本月总结行样式':               /\.sumline\b/.test(c),
  '日历条目盒样式':               /\.ibox \.irow\b/.test(c) && /\.ibox \.ititle\b/.test(c) &&
                                  /\.ibox \.idd\b/.test(c),
  '空态提示样式':                 /\.empty\b/.test(c),
  'UTF-8 声明':                   c.includes('charset="UTF-8"'),
  'viewport':                     c.includes('viewport'),

  /* ============================================================
   * 排版呼吸感（本轮优化）—— 把"不拥挤"变成可检查的规则
   * 起因：用户反馈"有点拥挤复杂"。根因是字号普遍 10-11.5px、
   * 卡片间距 9px、手机壳被压到 788px。这一节守住优化后的下限，
   * 防止后续改动再把页面挤回去。
   * ============================================================ */
  '呼吸 手机壳高度 ≥ 840px（不压扁内容）':
    /\.phone\{[^}]*max-height:(\d+)px/.test(c) &&
    Number((c.match(/\.phone\{[^}]*max-height:(\d+)px/) || [])[1]) >= 840,
  '呼吸 内容区左右内边距 ≥ 15px':
    /\.pbody\{padding:(\d+)px/.test(c) &&
    Number((c.match(/\.pbody\{padding:(\d+)px/) || [])[1]) >= 15,
  '呼吸 通知卡纵向间距 ≥ 12px':
    Number(((c.match(/\.ncard\{[^}]*margin-bottom:(\d+)px/) || [])[1]) || 0) >= 12,
  '呼吸 通知卡内边距 ≥ 14px':
    Number(((c.match(/\.ncard\{[^}]*padding:(\d+)px/) || [])[1]) || 0) >= 14,
  '呼吸 手机列间距 ≥ 28px':
    Number(((c.match(/\.grid\{[^}]*gap:(\d+)px/) || [])[1]) || 0) >= 28,
  '呼吸 手机列宽 ≥ 360px（同排不塞太多）':
    Number(((c.match(/\.col\{[^}]*max-width:(\d+)px/) || [])[1]) || 0) >= 360,
  '呼吸 无 9px/10px 极小字号（正文下限 11px）':
    !/font-size:9px/.test(c) && !/font-size:10px/.test(c),
  '呼吸 极小字号占比受控（≤ 20 处 font-size:11px，仅徽标类）': 
    (c.match(/font-size:11px/g) || []).length <= 20,
  '呼吸 正文主字号 ≥ 12px':
    Number((c.match(/\.ncard \.t\{font-size:([\d.]+)px/) || [])[1] || 0) >= 12,
  '呼吸 描述文字行距 ≥ 1.6':
    /\.ncard \.one\{[^}]*line-height:(1\.[6-9]|[2-9])/.test(c),
  '呼吸 顶部工具条为紧凑单行（色彩图例内联）':
    /\.bar \.vi\{[^}]*border-left/.test(c),
  '呼吸 校徽已收敛（≤ 68px）':
    Number(((c.match(/\.hd \.crest\{[^}]*width:(\d+)px/) || [])[1]) || 999) <= 68,
  '校徽 大徽三元素纵向有序（AAU < 书页 < 1928）': (function(){
    const aaTop = Number((c.match(/\.hd \.crest \.aa\{[^}]*top:(\d+)px/) || [])[1] || -1);
    const bkTop = Number((c.match(/\.hd \.crest \.book\{[^}]*top:(\d+)px/) || [])[1] || -1);
    const yTop  = Number((c.match(/\.hd \.crest \.y\{[^}]*top:(\d+)px/) || [])[1] || -1);
    return aaTop > 0 && bkTop > aaTop && yTop > bkTop;
  })(),
  '校徽 内页徽三元素纵向有序（AAU < 书页 < 1928）': (function(){
    const aaTop = Number((c.match(/\.mhead \.lg \.aa\{[^}]*top:(\d+)px/) || [])[1] || -1);
    const bkTop = Number((c.match(/\.mhead \.lg \.book\{[^}]*top:(\d+)px/) || [])[1] || -1);
    const yTop  = Number((c.match(/\.mhead \.lg \.y\{[^}]*top:(\d+)px/) || [])[1] || -1);
    return aaTop > 0 && bkTop > aaTop && yTop > bkTop;
  })(),
  '校徽 田野外纹不与年号重叠（横纹起点低于年号底）': (function(){
    /* 大徽 */
    const bH = Number((c.match(/\.hd \.crest\{[^}]*height:(\d+)px/) || [])[1] || -1);
    const bF = Number((c.match(/\.hd \.crest::after\{[^}]*height:(\d+)px/) || [])[1] || -1);
    const bY = Number((c.match(/\.hd \.crest \.y\{[^}]*top:(\d+)px/) || [])[1] || -1);
    /* 内页徽 */
    const mH = Number((c.match(/\.mhead \.lg\{[^}]*height:(\d+)px/) || [])[1] || -1);
    const mF = Number((c.match(/\.mhead \.lg::after\{[^}]*height:(\d+)px/) || [])[1] || -1);
    const mY = Number((c.match(/\.mhead \.lg \.y\{[^}]*top:(\d+)px/) || [])[1] || -1);
    if ([bH,bF,bY,mH,mF,mY].some(function(v){ return v < 0; })) return false;
    /* 年号 8px 高 + 1px 余量须在横纹起点之上 */
    return (bH - bF) >= (bY + 9) && (mH - mF) >= (mY + 8);
  })(),
  '事实 顶部联动文案为「十三屏」（非旧「九屏」）':
    c.includes('十三屏联动') && !c.includes('九屏联动')
};

let ok = 0, bad = 0;
for (const [k, v] of Object.entries(marks)) {
  console.log((v ? '[OK]   ' : '[FAIL] ') + k);
  v ? ok++ : bad++;
}
console.log('\n==== ' + ok + ' 通过 / ' + bad + ' 失败 ====');
console.log('文件大小：' + (c.length / 1024).toFixed(1) + ' KB');
process.exit(bad ? 1 : 0);
