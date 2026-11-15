const store = require('../../utils/store.js');
const searcher = require('../../utils/search.js');
const tags = require('../../utils/tags.js');
const theme = require('../../utils/theme.js');

const HISTORY_KEY = 'zhishi_search_history';

Page({
  data: {
    q: '',
    theme: 'light',
    searched: false,
    results: [],
    /* 命中的标题高亮切分：{id: [{text,hl}]} */
    titleSegs: {},
    snippetSegs: {},
    /* 标签筛选 */
    allTags: tags.TAGS,
    tagFilter: '',
    tagCounts: {},
    /* 历史与热词 */
    history: [],
    hotWords: [],
    /* 统计 */
    stat: { total: 0, real: 0, tagHit: 0 },
    profile: {}
  },

  onLoad(options) {
    const initTag = decodeURIComponent((options && options.tag) || '');

    const t = theme.current();
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t === 'dark' ? '#0E211A' : '#00653E'
    });

    this.setData({
      theme: t,
      profile: store.getProfile(),
      history: wx.getStorageSync(HISTORY_KEY) || [],
      hotWords: searcher.hotWords(store.list ? store.list() : null),
      tagCounts: store.tagCounts(),
      tagFilter: initTag
    });

    // 从详情页带标签进来 → 直接展开该标签的全部通知
    if (initTag) {
      setTimeout(() => this.doSearch('', initTag), 120);
    }
  },

  onReady() {
    // 自动聚焦输入框
    setTimeout(() => {
      try { this.setData({ focus: true }); } catch (e) {}
    }, 300);
  },

  /* ---- 输入 ---- */
  onInput(e) {
    this.setData({ q: e.detail.value });
  },

  onConfirm(e) {
    this.doSearch(e.detail.value || this.data.q);
  },

  onClear() {
    this.setData({ q: '', searched: false, results: [], titleSegs: {}, snippetSegs: {}, tagFilter: '' });
  },

  /* 点热词 / 历史 */
  tapWord(e) {
    const w = e.currentTarget.dataset.w;
    this.setData({ q: w });
    this.doSearch(w);
  },

  clearHistory() {
    wx.removeStorageSync(HISTORY_KEY);
    this.setData({ history: [] });
  },

  /* 点标签筛选 chip */
  tapTag(e) {
    const t = e.currentTarget.dataset.t;
    const next = this.data.tagFilter === t ? '' : t;
    this.setData({ tagFilter: next });
    if (this.data.searched || next) this.doSearch(this.data.q, next);
  },

  /* ---- 执行搜索 ---- */
  doSearch(q, tagOverride) {
    const query = String(q || '').trim();
    const tagFilter = tagOverride !== undefined ? tagOverride : this.data.tagFilter;

    // 关键词和标签都为空 → 不搜
    if (!query && !tagFilter) {
      wx.showToast({ title: '输入关键词或点选标签', icon: 'none' });
      return;
    }

    const words = searcher.splitQuery(query);
    const results = searcher.search(store.allNotices(), query, { tag: tagFilter });

    // 生成高亮切分（片段只有在真的含命中词时才渲染，避免"空高亮"）
    const titleSegs = {};
    const snippetSegs = {};
    results.forEach(r => {
      titleSegs[r.id] = searcher.highlight(r.title, words);
      if (r.snippet && r.hitInSnippet) {
        snippetSegs[r.id] = searcher.highlight(r.snippet, words);
      }
    });

    // 统计
    const stat = {
      total: results.length,
      real: results.filter(r => r.real).length,
      tagHit: tagFilter ? results.filter(r => r.event === tagFilter).length : 0
    };

    this.setData({
      q: query,
      searched: true,
      results,
      titleSegs,
      snippetSegs,
      tagFilter,
      stat,
      focus: false
    });

    // 记历史（关键词非空才记）
    if (query) this.pushHistory(query);
  },

  pushHistory(q) {
    let h = wx.getStorageSync(HISTORY_KEY) || [];
    h = h.filter(x => x !== q);
    h.unshift(q);
    h = h.slice(0, 8);
    wx.setStorageSync(HISTORY_KEY, h);
    this.setData({ history: h });
  },

  /* ---- 进详情（带搜索词，让详情页也高亮） ---- */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const q = encodeURIComponent(this.data.q || '');
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}&q=${q}` });
  },

  /* 快捷：看这个标签下全部 */
  browseTag(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ q: '', tagFilter: t });
    this.doSearch('', t);
  },

  onShareAppMessage() {
    return {
      title: '知时 · 校园通知一搜就到',
      path: '/pages/search/search'
    };
  }
});
