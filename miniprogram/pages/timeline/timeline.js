const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');

/**
 * 时间轴页
 * ========
 * 回答的问题跟首页不一样：
 *   首页 = 「今天该干什么」（按紧急度平铺）
 *   时间轴 = 「这周/这个月还有几件事、分别在哪天」（按截止日归集）
 *
 * 所有分箱都由 store.timelineBuckets() 产出，本页只负责渲染与交互。
 */
Page({
  data: {
    theme: 'light',
    buckets: [],
    /* 折叠状态：默认只展开「今天 / 三天内」，其余折叠收起，减少滚动焦虑 */
    openKeys: ['today', 'd3'],
    /* 指数 */
    index: { score: 0, level: 'calm', label: '', now: 0, d3: 0, week: 0, total: 0 },
    /* 汇总 */
    total: 0,
    hasAny: false
  },

  onLoad() {
    const t = theme.current();
    this.setData({ theme: t });
    this.applyNavTheme(t);
    wx.setNavigationBarTitle({ title: '截止时间轴' });
    this.build();
  },

  onShow() {
    const t = theme.current();
    this.setData({ theme: t });
    this.applyNavTheme(t);
    this.build();
  },

  applyNavTheme(t) {
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t === 'dark' ? '#0E211A' : '#00653E'
    });
  },

  build() {
    const buckets = store.timelineBuckets();
    const index = store.urgencyIndex();
    const total = buckets.reduce((s, b) => s + b.count, 0);

    /* 自动展开：有内容且靠前的分箱自动展开，避免用户进来看到一屏折叠 */
    const keys = [];
    buckets.forEach(b => {
      if (b.count > 0 && keys.length < 2) keys.push(b.key);
    });

    this.setData({
      buckets,
      index,
      total,
      hasAny: total > 0,
      openKeys: keys.length ? keys : this.data.openKeys
    });
  },

  isOpen(key) {
    return this.data.openKeys.indexOf(key) >= 0;
  },

  toggleBucket(e) {
    const key = e.currentTarget.dataset.k;
    const list = this.data.openKeys.slice();
    const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else list.push(key);
    this.setData({ openKeys: list });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /* 空态：直接去订阅 */
  goMe() { wx.switchTab({ url: '/pages/me/me' }); },

  /* 下拉刷新 */
  onPullDownRefresh() {
    this.build();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return { title: '知时 · 我的截止时间轴', path: '/pages/timeline/timeline' };
  }
});
