/**
 * 知时 · 推送设置页
 * ==================
 *
 * 这一页要回答用户三个真实疑问：
 *   ① 你到底推了什么给我？（→ 当前通知列表预览）
 *   ② 凭什么推？（→ 每条写明理由，附打分）
 *   ③ 我不想被打扰怎么办？（→ 打扰级别开关 + 后台推送说明）
 *
 * 设计立场：把推送的"决策过程"摊开给用户。推送系统最容易失去信任，
 * 用户一旦觉得"你在乱推"，就会关通知权限 —— 那才是真的失败。
 */
const store = require('../../utils/store.js');
const push = require('../../utils/push.js');
const theme = require('../../utils/theme.js');
const wxnotify = require('../../utils/wxnotify.js');
const reachlist = require('../../utils/reachlist.js');

Page({
  data: {
    theme: 'light',
    /* 引擎状态 */
    stats: null,
    summary: null,
    /* 通知列表（前若干条） */
    cards: [],
    buckets: [],
    /* 开关 */
    flags: { pushOn: true, pushNew: true, pushScore: true },
    /* 打扰级别 */
    notifyLevel: 'hot',
    notifyLevelText: '只打扰三天内（推荐）',
    /* 留痕 */
    state: null,
    stateText: '',
    /* ★ 微信触达（订阅消息） */
    wx: null,
    advanceOptions: [],
    advanceIdx: 1,
    /* ★ 提醒时间 */
    reach: null,
    reachDays: [],
    busy: false
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
    const profile = store.getProfile();

    /* 开关默认全开；用户显式关过的以画像里的值为准 */
    const pf = profile.push || {};
    const flags = {
      pushOn: pf.pushOn !== false,
      pushNew: pf.pushNew !== false,
      pushScore: pf.pushScore !== false
    };
    const notifyLevel = pf.notifyLevel || 'hot';

    const stats = push.pushStats(profile);
    const r = push.buildPush({ profile, limit: 12 });
    const buckets = push.pushBuckets(profile);
    const st = push.pushState();

    /* 微信触达状态 */
    const wxSummary = wxnotify.summary();
    const advanceOptions = wxnotify.ADVANCE_OPTIONS;
    const advIdx = Math.max(0, advanceOptions.findIndex(o => o.key === (wxSummary.advance || '3,1')));

    /* 提醒时间（用已登记的提前量算） */
    const reach = reachlist.build(profile, { advance: wxSummary.advance, limit: 40 });

    this.setData({
      flags,
      notifyLevel,
      notifyLevelText: this.levelText(notifyLevel),
      stats,
      summary: r.summary,
      cards: r.cards,
      buckets,
      state: st,
      stateText: st.lastPushAt ? this.fmt(st.lastPushAt) : '尚未推送',
      wx: wxSummary,
      advanceOptions,
      advanceIdx: advIdx < 0 ? 1 : advIdx,
      reach: reach.stats,
      reachDays: reach.byDay
    });
  },

  levelText(v) {
    return v === 'all' ? '有新就打扰'
      : (v === 'none' ? '从不打扰，只静默进流' : '只打扰三天内（推荐）');
  },

  /* 时间戳 → 可读相对时间。曾漏定义（只有真跑过推送、lastPushAt 有值时才暴露） */
  fmt(ts) {
    if (!ts) return '尚未推送';
    const d = (ts instanceof Date) ? ts : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hh = Math.floor(min / 60);
    if (hh < 24) return hh + ' 小时前';
    const dd = Math.floor(hh / 24);
    if (dd < 7) return dd + ' 天前';
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  },

  /* 开关切换：值写进画像的 push 字段，和档案一起保存 —— 单一事实来源 */
  toggleFlag(e) {
    const key = e.currentTarget.dataset.k;
    const cur = this.data.flags[key];
    const profile = store.getProfile();
    profile.push = Object.assign({}, profile.push || {});
    profile.push[key] = !cur;
    store.saveProfile(profile);
    this.refresh();
    wx.showToast({ title: !cur ? '已开启' : '已关闭', icon: 'none' });
  },

  onNotifyLevel(e) {
    const opts = ['hot', 'all', 'none'];
    const v = opts[+e.detail.value];
    const profile = store.getProfile();
    profile.push = Object.assign({}, profile.push || {});
    profile.push.notifyLevel = v;
    store.saveProfile(profile);
    this.refresh();
    wx.showToast({ title: this.levelText(v), icon: 'none' });
  },

  /* ★ 一键开启微信订阅消息（真·触达入口） */
  async enableWxNotify() {
    if (this.data.busy) return;
    this.setData({ busy: true });

    const profile = store.getProfile();
    const types = ['deadline', 'newnotice'];

    let res;
    try {
      res = await wxnotify.requestSubscribe(types);
    } catch (e) {
      res = { ok: false, reason: '订阅请求失败：' + (e && e.message) };
    }

    /* 无论授权结果如何，都把提前量登记进云端（服务端据此下发） */
    try { await wxnotify.registerPlan(profile); } catch (e) {}

    this.setData({ busy: false });
    this.refresh();

    if (res.ok) {
      wx.showModal({
        title: res.demo ? '已登记（演示模式）' : '订阅成功',
        content: res.reason,
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      wx.showToast({ title: res.reason || '未获得授权', icon: 'none', duration: 2600 });
    }
  },

  /* ★ 调整提前量（改完立刻重算时间线） */
  onAdvanceChange(e) {
    const v = this.data.advanceOptions[+e.detail.value];
    if (!v) return;
    const profile = store.getProfile();
    profile.advance = v.key;
    store.saveProfile(profile);
    const st = wxnotify.readState();
    st.advance = v.key;
    wxnotify.writeState(st);
    this.refresh();
    wx.showToast({ title: '改为' + v.label, icon: 'none' });
  },

  /* ★ 演示一次"主动送达"（写留痕，让评审看到闭环） */
  simulateDeliver() {
    wx.showModal({
      title: '模拟一次主动送达',
      content: '知时会在你订阅的事项临近截止时，通过微信服务通知提醒你。此操作会记录一次送达留痕（仅演示，不真发）。',
      confirmText: '模拟一次',
      success: (r) => {
        if (!r.confirm) return;
        wxnotify.noteDelivery(1);
        this.refresh();
        wx.showToast({ title: '已记录 1 次送达留痕', icon: 'none' });
      }
    });
  },

  resetState() {
    wx.showModal({
      title: '重置推送记录',
      content: '重置后，所有通知都会重新标记为「新收录」。这不影响通知本身，只是让你再看一遍全部内容。',
      confirmText: '重置',
      success: (res) => {
        if (!res.confirm) return;
        push.resetState();
        this.refresh();
        wx.showToast({ title: '已重置 · 全部标记为新', icon: 'none' });
      }
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goIndex() { wx.switchTab({ url: '/pages/index/index' }); },

  copyUrl(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'none' })
    });
  },

  onShareAppMessage() {
    return { title: '知时 · 别让机会悄悄溜走', path: '/pages/index/index' };
  }
});
