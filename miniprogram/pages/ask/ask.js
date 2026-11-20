/**
 * 知时 · 「问答」问答页
 * ========================
 *
 * 这一页把学生脑子里的疑问直接端出来，一问一答。
 * 不是搜索框 —— 搜索解决"我知道我要找什么"，
 * 这一页解决"我根本不知道该问什么，但就是心慌"。
 *
 * 13 个问题分成 6 组，每组对应一个焦虑点：
 *   今天/这周、先办哪个、我漏了什么、是不是给我的、要准备什么、数据可靠吗
 *
 * 每个答案都带「依据」行，写明这个结论是怎么算出来的 ——
 * 用户能顺着依据去核对，而不是只能信我们一句话。
 */
const store = require('../../utils/store.js');
const ask = require('../../utils/ask.js');
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'light',
    /* 问答目录 */
    groups: [],
    /* 今日一问（顶部大卡） */
    headline: null,
    /* 当前打开的答案 */
    opened: null,
    /* 自评指标 */
    stats: null,
    /* 展开的条目 */
    expandId: ''
  },

  onLoad() {
    this.setData({ theme: theme.current() });
    this.refresh();
  },

  onShow() {
    this.setData({ theme: theme.current() });
    this.refresh();
  },

  refresh() {
    const groups = ask.questionGroups();
    const headline = ask.headline();
    const stats = ask.askStats();
    this.setData({ groups, headline, stats });
    /* 首次进入默认展开"今天"这组的问题，让页面不是一片待点状态 */
    if (!this.data.opened) {
      const t = ask.ask('today');
      if (t) this.setData({ opened: t });
    }
  },

  /* 点一个问题 → 取答案并展示 */
  onAsk(e) {
    const id = e.currentTarget.dataset.id;
    const r = ask.ask(id);
    if (!r) {
      wx.showToast({ title: '这个问题暂时没有答案', icon: 'none' });
      return;
    }
    this.setData({ opened: r, expandId: id });
  },

  /* 点顶部大卡 → 跳到对应问题 */
  onHeadline() {
    const h = this.data.headline;
    if (!h) return;
    const r = ask.ask(h.id);
    if (r) this.setData({ opened: r, expandId: h.id });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },
  goIndex() { wx.switchTab({ url: '/pages/index/index' }); },
  goCalendar() { wx.navigateTo({ url: '/pages/calendar/calendar' }); },

  onShareAppMessage() {
    return { title: '知时 · 有问题直接问，答案带依据', path: '/pages/index/index' };
  }
});
