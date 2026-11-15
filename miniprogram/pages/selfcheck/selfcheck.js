const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const selfcheck = require('../../utils/selfcheck.js');

/**
 * 数据自查页
 * ========
 * 「我们凭什么让你信」——把自查自纠系统的结论摊开给用户看。
 *
 * 这一页的存在本身就是一种承诺：
 *   如果哪条通知不可靠，我们不是偷偷删掉，而是把"扔掉了什么、为什么"写在这里。
 *   用户能追问、能复核，这正是"可信"和"看起来可信"的区别。
 */
Page({
  data: {
    theme: 'light',
    /* 结论摘要 */
    stat: { total: 0, passed: 0, dropped: 0, warned: 0, verifiable: 0, realCnt: 0, demoCnt: 0 },
    /* 人类可读结论 */
    lines: [],
    issueLines: [],
    infoLines: [],
    /* 被剔除的条目 + 原因 */
    dropped: [],
    /* 三条铁律 */
    rules: [],
    /* 健康的条目（可举证原文） */
    verifiableList: [],
    /* 审计留痕 */
    history: [],
    healthy: false,
    stamp: ''
  },

  onLoad() {
    const t = theme.current();
    this.setData({ theme: t });
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t === 'dark' ? '#0E211A' : '#00653E'
    });
    wx.setNavigationBarTitle({ title: '数据自查' });
    this.build();
  },

  onShow() {
    const t = theme.current();
    this.setData({ theme: t });
    this.build();
  },

  build() {
    const rep = store.selfReport();
    const all = store.allNotices();

    /* 可举证原文的条目清单（这是全站可信度最高的那几条） */
    const verifiableList = all
      .filter(n => n.real === true && n.url && selfcheck.hostAllowed(n.url))
      .map(n => ({
        id: n.id,
        title: n.title,
        source: n.source,
        site: n.site || '',
        url: n.url,
        publish: n.publish
      }));

    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    this.setData({
      stat: rep.stats,
      lines: rep.lines,
      issueLines: rep.issueLines,
      infoLines: rep.infoLines,
      dropped: rep.dropped,
      verifiableList,
      healthy: rep.healthy,
      history: store.auditHistory().slice(0, 5).map(h => ({
        time: this.fmtTime(h.ts),
        txt: `放行 ${h.passed}/${h.total} · 剔除 ${h.dropped} · 可举证 ${h.verifiable}`
      })),
      stamp,
      rules: [
        {
          code: 'R1',
          t: '出处可举证',
          d: '标为真实公开数据的，必须带 ahau.edu.cn 官网链接；域名不在白名单的，直接剔除。'
        },
        {
          code: 'R2',
          t: '链接不伪造',
          d: '演示样例绝不允许带出处链接。宁可标成"演示样例"，也不假装有原文。'
        },
        {
          code: 'R3',
          t: '引文可定位',
          d: '每条浓缩要点都必须在原文里原样找到；全对不上的条目会被剔除。'
        }
      ]
    });
  },

  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => (n < 10 ? '0' + n : '' + n);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /* 点某条可举证的 → 复制链接（不跳外链，与详情页口径一致） */
  copyUrl(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'success' })
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /* 手动重跑一次自查 */
  rerun() {
    wx.showLoading({ title: '正在自查…' });
    setTimeout(() => {
      this.build();
      wx.hideLoading();
      const s = this.data.stat;
      wx.showToast({
        title: s.dropped ? `发现并剔除 ${s.dropped} 条` : '自查完成 · 无剔除',
        icon: 'none'
      });
    }, 220);
  },

  onPullDownRefresh() {
    this.build();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return { title: '知时 · 数据自查报告', path: '/pages/selfcheck/selfcheck' };
  }
});
