const store = require('../../utils/store.js');
const identity = require('../../utils/identity.js');
const theme = require('../../utils/theme.js');
const push = require('../../utils/push.js');
const ask = require('../../utils/ask.js');
const readstate = require('../../utils/readstate.js');

Page({
  data: {
    loading: true,
    /* 主题 */
    theme: 'light',
    /* 数据源状态：cloud / cache / local */
    source: 'local',
    sourceLabel: '本地示例',
    lastSyncText: '',
    /* 统计 */
    stats: { collected: 0, realCnt: 0, matched: 0, urgent: 0, tagCnt: 0, siteCnt: 0 },
    /* 知时指数：把"今天有多少事"压成一个数 */
    index: { score: 0, level: 'calm', label: '', now: 0, d3: 0, week: 0, total: 0 },
    /* 汇总摘要一句话 */
    briefLine: '',
    /* 三档分区 */
    urgent: [], soon: [], later: [],
    /* 展示模式：feed（通知列表） | tag（按标签分组） */
    viewMode: 'feed',
    groups: [],
    openTag: '',
    /* 推送引擎 */
    pushCards: [],
    pushBuckets: [],
    pushSummary: { line: '', badge: '', tone: 'calm' },
    pushNewCount: 0,
    /* 首屏头条（合并原先三张重复卡：紧急提示 / 推送小结 / 问答一句话） */
    hero: null,
    /* 梯度通知列表：major（三天内，中卡）/ minor（更远，小卡） */
    majorCards: [],
    minorCards: [],
    minorOpen: false,
    /* 未读 / 已删除统计 */
    readStats: { read: 0, unread: 0, hidden: 0, total: 0 },
    /* 问答：今日一问（保留给快捷入口） */
    headline: null,
    /* 身份 */
    profile: {},
    identitySummary: '',
    identityIncomplete: false,
    /* 是否已订阅 */
    hasInterests: true
  },

  onLoad() {
    this.setData({ theme: theme.current() });
    this.applyNavTheme(theme.current());
    this.refreshProfile();
    this.refresh();
  },

  onShow() {
    const t = theme.current();
    this.setData({ theme: t });
    this.applyNavTheme(t);
    this.refreshProfile();
    // 订阅或身份可能已变，回来重算匹配
    this.recompute();
  },

  refreshProfile() {
    const p = store.getProfile();
    this.setData({
      profile: p,
      identitySummary: identity.summarize(p),
      identityIncomplete: !store.identityComplete(p),
      hasInterests: (p.interests || []).length > 0
    });
  },

  /* 主题切换后同步导航栏 */
  applyNavTheme(t) {
    const dark = t === 'dark';
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#ffffff',
      backgroundColor: dark ? '#0E211A' : '#00653E'
    });
  },

  /* 首屏：先预热缓存/本地，立刻可渲染，再异步拉云端 */
  async refresh() {
    // 预热（同步）：缓存优先
    const w = store.warmUp();
    this.recompute();
    this.setData({ loading: false, source: w.source, sourceLabel: this.labelOf(w.source) });

    // 异步刷新云端
    try {
      const h = await store.hydrateNotices();
      if (h && h.ok) {
        this.recompute();
        this.setData({ source: 'cloud', sourceLabel: this.labelOf('cloud') });
      }
    } catch (e) {}
    this.updateSyncText();
  },

  /* 下拉刷新 */
  async onPullDownRefresh() {
    try {
      const h = await store.hydrateNotices();
      if (h && h.ok) this.setData({ source: 'cloud', sourceLabel: this.labelOf('cloud') });
    } catch (e) {}
    this.recompute();
    this.updateSyncText();
    wx.stopPullDownRefresh();
    wx.showToast({ title: '已更新', icon: 'none' });
  },

  labelOf(s) {
    return s === 'cloud' ? '云端数据' : s === 'cache' ? '本地缓存' : '本地示例';
  },

  updateSyncText() {
    const info = store.sourceInfo();
    if (!info.lastSync) { this.setData({ lastSyncText: '' }); return; }
    const d = new Date(info.lastSync);
    const pad = n => (n < 10 ? '0' + n : '' + n);
    this.setData({ lastSyncText: `${pad(d.getHours())}:${pad(d.getMinutes())} 同步` });
  },

  /* 重算匹配（身份/订阅变化后调用） */
  recompute() {
    const sec = store.feedSections();
    const b = store.brief();
    const profile = store.getProfile();

    /* 推送引擎：按可解释分数排序，产出带理由的推送卡片流 */
    const r = push.buildPush({ profile, limit: 40 });
    const buckets = push.pushBuckets(profile);

    /* 已读/删除是本地用户状态：先从通知列表剔除「已删除」，再给每卡注入 read 标记。
     * 头条与梯度流用同一份过滤后的卡，保证三处口径一致（不产生第二套事实）。 */
    const visibleCards = readstate.visible(r.cards);
    const cardsRead = readstate.decorate(visibleCards);

    /* 主次梯度：头条（合并三卡）+ 中卡（三天内）/ 小卡（更远归档） */
    const hero = push.heroCard(profile);
    const tiered = push.tieredFeed(profile);

    /* 头条/梯度也要吃「已删除」过滤与 read 标记：
     * heroCard/tieredFeed 各自重算了一份，需按同一规则过滤后再注入。 */
    const heroFiltered = (hero && hero.lead && readstate.isHidden(hero.lead.id))
      ? Object.assign({}, hero, { lead: null, hasLead: false })
      : hero;
    if (heroFiltered && heroFiltered.lead) {
      heroFiltered.lead = Object.assign({}, heroFiltered.lead,
        { read: readstate.isRead(heroFiltered.lead.id) });
    }
    const majorCards = readstate.decorate(readstate.visible(tiered.major));
    const minorCards = readstate.decorate(readstate.visible(tiered.minor));

    /* 问答：算出今日一问，保留给快捷入口 */
    const headline = ask.headline();

    const readStats = readstate.stats(r.cards);

    this.setData({
      urgent: sec.urgent,
      soon: sec.soon,
      later: sec.later,
      groups: store.matchByTag(),
      stats: store.getStats(),
      index: store.urgencyIndex(),
      briefLine: b.summary,
      pushCards: cardsRead,
      pushBuckets: buckets,
      pushSummary: r.summary,
      pushNewCount: r.newCount,
      hero: heroFiltered,
      majorCards,
      minorCards,
      readStats,
      headline
    });

    /* 用户真的看到通知列表了 → 记为已推送（决定下次哪些算"新收录"）
     * 注意顺序：先 setData 用旧的 isNew 状态渲染，再标记。
     * 反过来做的话，第一次打开时"新"标记就被自己抹掉了。
     * 同时记一次"展示"用于重复抑制：反复看到却没点开的，下次自动降权。 */
    if (r.cards.length) {
      const ids = r.cards.map((c) => c.id);
      const shown = r.cards.map((c) => ({ id: c.id }));
      setTimeout(() => { push.markPushed(ids); push.markShown(shown); }, 800);
    }
  },

  /* 手动刷新按钮 */
  async onRefreshTap() {
    wx.showLoading({ title: '刷新中…' });
    try {
      await store.hydrateNotices();
    } catch (e) {}
    this.recompute();
    this.updateSyncText();
    this.setData({ source: store.sourceInfo().source });
    wx.hideLoading();
    wx.showToast({ title: `已刷新 · 命中 ${store.getStats().matched} 条`, icon: 'none' });
  },

  /* 视图切换：关注流 / 按标签 */
  switchView(e) {
    const m = e.currentTarget.dataset.m;
    this.setData({ viewMode: m });
  },

  toggleGroup(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ openTag: this.data.openTag === t ? '' : t });
  },

  /* 小卡归档区展开/收起 */
  toggleMinor() {
    this.setData({ minorOpen: !this.data.minorOpen });
  },

  /* 头条卡点击：有 lead 进详情，否则按 action.kind 跳转 */
  heroTap() {
    const h = this.data.hero;
    if (!h || !h.action) return;
    if (h.action.kind === 'detail') { wx.navigateTo({ url: `/pages/detail/detail?id=${h.action.id}` }); }
    else if (h.action.kind === 'me') { wx.switchTab({ url: '/pages/me/me' }); }
    /* kind === 'feed' 时不动（已经在通知列表里） */
  },

  /* 头条卡右侧按钮：直达（详情 / 设置订阅） */
  heroAction(e) {
    e.stopPropagation && e.stopPropagation();
    const h = this.data.hero;
    if (!h || !h.action) return;
    if (h.action.kind === 'detail') { wx.navigateTo({ url: `/pages/detail/detail?id=${h.action.id}` }); }
    else if (h.action.kind === 'me') { wx.switchTab({ url: '/pages/me/me' }); }
    else { wx.navigateTo({ url: '/pages/ask/ask' }); }
  },

  /* 头条回退：没有紧急 lead 时，切到"按标签"视图看清全貌 */
  goFeed() {
    this.setData({ viewMode: 'feed' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    /* 进详情即记「已读」（用户可见的持久状态；详情页 onLoad 也会再记一次，幂等） */
    readstate.markRead(id);
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /* 长按卡片 → 弹「标记已读/未读」「删除」 */
  onCardLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const isRead = readstate.isRead(id);
    const self = this;
    wx.showActionSheet({
      itemList: [isRead ? '标记为未读' : '标记为已读', '删除（本地隐藏）'],
      success(res) {
        if (res.tapIndex === 0) {
          if (isRead) readstate.markUnread(id); else readstate.markRead(id);
          self.recompute();
          wx.showToast({ title: isRead ? '已标记未读' : '已标记已读', icon: 'none' });
        } else if (res.tapIndex === 1) {
          self.deleteCard(id);
        }
      },
      fail() {}
    });
  },

  /* 小圆点：点一下切换已读/未读，不进入详情 */
  toggleRead(e) {
    e.stopPropagation && e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    const now = readstate.toggleRead(id);
    this.recompute();
    wx.showToast({ title: now ? '已标记已读' : '已标记未读', icon: 'none' });
  },

  /* 删除（本地隐藏）+ 可撤销 */
  deleteCard(id) {
    readstate.hide(id);
    this.recompute();
    wx.showToast({ title: '已删除（本地隐藏）', icon: 'none', duration: 2000 });
  },

  goTag(e) {
    const t = e.currentTarget.dataset.t;
    wx.navigateTo({ url: `/pages/search/search?tag=${encodeURIComponent(t)}` });
  },

  goMe() { wx.switchTab({ url: '/pages/me/me' }); },
  /* 「已删除」入口：跳到「我的」页的已删除区找回 */
  goHidden() {
    wx.switchTab({
      url: '/pages/me/me',
      success() { wx.showToast({ title: '在「我的」页底部可找回', icon: 'none' }); }
    });
  },
  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },
  goTimeline() { wx.switchTab({ url: '/pages/timeline/timeline' }); },
  goDigest() { wx.switchTab({ url: '/pages/digest/digest' }); },
  goPush() { wx.navigateTo({ url: '/pages/push/push' }); },
  goAsk() { wx.navigateTo({ url: '/pages/ask/ask' }); },
  goCalendar() { wx.navigateTo({ url: '/pages/calendar/calendar' }); },

  onShareAppMessage() {
    return { title: '知时 · 别让机会悄悄溜走', path: '/pages/index/index' };
  }
});
