const store = require('../../utils/store.js');
const cloud = require('../../utils/cloud.js');
const tags = require('../../utils/tags.js');
const identity = require('../../utils/identity.js');
const fav = require('../../utils/favorites.js');
const theme = require('../../utils/theme.js');
const readstate = require('../../utils/readstate.js');
const subscribe = require('../../utils/subscribe.js');
const wxnotify = require('../../utils/wxnotify.js');
const agent = require('../../utils/agent.js');

/* 关注事项 = tags.js 里的 9 个统一标签（和推送、搜索同源） */
const ALL_TAGS = tags.TAGS;

/* 身份维度（来自 identity.js，单一事实来源） */
const IDENTITY_OPTS = identity.IDENTITY_TYPES.map(t => t.key);
const GRADE_OPTS = identity.GRADES;
const COLLEGE_OPTS = identity.COLLEGES;
const CAMPUS_OPTS = identity.CAMPUSES;
const ADVANCE_OPTS = ['截止前 7 天 / 3 天 / 1 天', '截止前 3 天 / 1 天', '仅截止前 1 天'];
const CHANNEL_OPTS = ['小程序服务通知 + 群内播报', '仅小程序服务通知', '仅群内播报'];

/* 关键词订阅的**推荐词**候选：都是安农通知里真实出现、且固定标签盖不住的具体名词。
 * 只把"池里真的命中"的推给用户（命中 0 条的剔除）—— 点了才发现是空词最伤信任。 */
const KW_SUGGEST_CANDIDATES = [
  '正大杯', '挑战杯', '数学建模', '蓝桥杯', '节能减排', '大学生创新创业',
  '四六级', '普通话', '计算机等级', '教资', '志愿服务', '社会实践',
  '招聘会', '考研', '保研', '交换生'
];

Page({
  data: {
    profile: {},
    /* 主题 */
    theme: 'light',
    themeIcon: '☀️',
    allTags: ALL_TAGS,
    tagCounts: {},
    identityTypeOpts: IDENTITY_OPTS,
    gradeOpts: GRADE_OPTS,
    collegeOpts: COLLEGE_OPTS,
    campusOpts: CAMPUS_OPTS,
    advanceOpts: ADVANCE_OPTS,
    channelOpts: CHANNEL_OPTS,
    identityTypeIdx: 0,
    gradeIdx: 0,
    collegeIdx: 0,
    campusIdx: 0,
    advanceIdx: 0,
    channelIdx: 0,
    identitySummary: '',
    identityIncomplete: false,
    dirty: false,
    /* 运行模式 */
    runMode: 'local',
    cloudReady: false,
    /* 订阅后能收到多少条 */
    reachable: 0,
    reachableUrgent: 0,
    /* 概览 */
    totalNotices: 0,
    realNotices: 0,
    /* 收藏 */
    favList: [],
    favAlerts: 0,
    /* 已删除（本地隐藏） */
    hiddenList: [],
    /* 阅读统计 */
    readStats: { read: 0, unread: 0, hidden: 0, total: 0 },
    /* 同步状态文案 */
    syncText: '',
    /* 自定义关键词订阅 */
    kwInput: '',
    kwStats: [],
    kwMax: 12,
    kwReach: 0,
    kwReachUrgent: 0,
    kwSuggest: [],
    /* ★ 微信服务通知（真·触达） */
    wxNotify: null,
    wxBusy: false,

    /* ★ 智能体服务状态（"到底谁来替我盯着"） */
    ag: null,             // { configured, reachable, label, base, version, error }
    agBusy: false,
    agBaseInput: '',
    agShowConfig: false
  },

  onLoad() {
    this.syncTheme();
    this.refreshMode();
    /* 先用本地画像立刻渲染（同步），云端回来再覆盖 —— 
       否则弱网下要等 SDK 重试退避（实测可达 7s），页面会一直空白 */
    this.loadLocal();
    this.load();
    this.loadAgent();
  },

  onShow() {
    this.syncTheme();
    this.loadLocal();
    this.load();
    this.loadAgent();
  },

  /* 本地画像的即时渲染：保证任何情况下页面一进就有内容 */
  loadLocal() {
    const p = store.getProfile();
    const all = store.allNotices();
    const interests = Array.isArray(p.interests) ? p.interests : [];
    this.setData({
      profile: p,
      tagCounts: store.tagCounts(),
      identityTypeIdx: Math.max(0, IDENTITY_OPTS.indexOf(p.identityType)),
      gradeIdx: Math.max(0, GRADE_OPTS.indexOf(p.grade)),
      collegeIdx: Math.max(0, COLLEGE_OPTS.indexOf(p.college)),
      campusIdx: Math.max(0, CAMPUS_OPTS.indexOf(p.campus)),
      advanceIdx: Math.max(0, ADVANCE_OPTS.indexOf(p.advance)),
      channelIdx: Math.max(0, CHANNEL_OPTS.indexOf(p.channel)),
      identitySummary: identity.summarize(p),
      identityIncomplete: !store.identityComplete(p),
      totalNotices: all.length,
      realNotices: all.filter(n => n.real).length,
      wxNotify: wxnotify.summary(),
      dirty: false
    });
    this.calcReach(interests);
    this.loadKeywords(p);
    this.loadFavorites();
    this.loadHidden();
  },

  /* ---- 主题 ---- */
  syncTheme() {
    const t = theme.current();
    this.setData({ theme: t, themeIcon: t === 'dark' ? '🌙' : '☀️' });
    this.applyNavTheme(t);
  },

  toggleTheme() {
    const t = theme.toggle();
    this.setData({ theme: t, themeIcon: t === 'dark' ? '🌙' : '☀️' });
    this.applyNavTheme(t);
    wx.showToast({ title: t === 'dark' ? '已切换到深色' : '已切换到浅色', icon: 'none' });
  },

  applyNavTheme(t) {
    const dark = t === 'dark';
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: dark ? '#0E211A' : '#00653E'
    });
  },

  refreshMode() {
    this.setData({ runMode: cloud.mode(), cloudReady: cloud.isCloudReady() });
  },

  /* ============================================================
   * ★ 智能体服务状态
   * ------------------------------------------------------------
   * 这一块存在的理由：用户有权知道"到底是谁在替我盯着"。
   *   - 连上了 → 绿点 + 服务地址 + 版本；说明"你不打开它也在跑"
   *   - 没部署 → 灰点；如实说"只能你打开时才算"
   *   - 配了没连上 → 橙点 + 原因；不假装成功
   * 地址可在页面上直接改（写 storage），免发版 —— 部署后现场就能接上。
   * ============================================================ */
  async loadAgent() {
    try {
      const st = await agent.status();
      this.setData({
        ag: st,
        agBaseInput: st.base || ''
      });
    } catch (e) {
      this.setData({
        ag: { configured: agent.isConfigured(), reachable: false, mode: 'local',
              label: '智能体状态未知（探测失败）', base: agent.resolveBase() || null,
              error: (e && e.message) || '未知错误', ready: null, version: null }
      });
    }
  },

  toggleAgentConfig() {
    this.setData({ agShowConfig: !this.data.agShowConfig });
  },

  onAgentBaseInput(e) {
    this.setData({ agBaseInput: e.detail.value });
  },

  /* 保存服务地址 → 立刻重新探测（让用户当场看到成没成） */
  async saveAgentBase() {
    if (this.data.agBusy) return;
    this.setData({ agBusy: true });
    const v = (this.data.agBaseInput || '').trim();
    agent.setBase(v);
    await this.loadAgent();
    const ok = this.data.ag && this.data.ag.reachable;
    this.setData({ agBusy: false });
    wx.showToast({
      title: !v ? '已切回本地模式' : (ok ? '服务已连接' : '地址已存，但没连上'),
      icon: 'none', duration: 2400
    });
  },

  /* 清空地址 = 回到开箱即用的本地模式（演示/评审场景一键复位） */
  async clearAgentBase() {
    agent.setBase('');
    this.setData({ agBaseInput: '' });
    await this.loadAgent();
    wx.showToast({ title: '已切回本地模式', icon: 'none' });
  },

  /* 让它现在跑一轮（服务端会把结果落盘，页面再读回来） */
  async runAgentNow() {
    if (this.data.agBusy) return;
    this.setData({ agBusy: true });
    wx.showLoading({ title: '智能体运行中', mask: true });
    try {
      const st = this.data.ag;
      if (st && st.reachable) {
        const profile = store.getProfile();
        try { await agent.remoteImpl.saveProfile(profile); } catch (e) {}
        await agent.remoteImpl.run({});
      }
      await this.loadAgent();
      wx.hideLoading();
      wx.showToast({
        title: (st && st.reachable) ? '已触发一轮计算' : '本地模式：打开简报页即可看到最新清单',
        icon: 'none', duration: 2600
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '触发失败：' + ((e && e.message) || ''), icon: 'none', duration: 2600 });
    }
    this.setData({ agBusy: false });
  },

  goDigestAgent() { wx.switchTab({ url: '/pages/digest/digest' }); },

  async load() {
    let p = null;
    try {
      p = await cloud.getProfile();
    } catch (e) {
      p = null;
    }
    // 云端有就用云端，否则用本地（本地已保证字段齐全）
    if (p) {
      p = store.fillProfile(p);
    } else {
      p = store.getProfile();
    }

    const all = store.allNotices();
    /* interests 归一成数组（防止旧数据 / 云端缺字段导致 WXML 里 indexOf 报错） */
    const interests = Array.isArray(p.interests) ? p.interests : [];
    p = Object.assign({}, p, { interests });
    this.setData({
      profile: p,
      tagCounts: store.tagCounts(),
      identityTypeIdx: Math.max(0, IDENTITY_OPTS.indexOf(p.identityType)),
      gradeIdx: Math.max(0, GRADE_OPTS.indexOf(p.grade)),
      collegeIdx: Math.max(0, COLLEGE_OPTS.indexOf(p.college)),
      campusIdx: Math.max(0, CAMPUS_OPTS.indexOf(p.campus)),
      advanceIdx: Math.max(0, ADVANCE_OPTS.indexOf(p.advance)),
      channelIdx: Math.max(0, CHANNEL_OPTS.indexOf(p.channel)),
      identitySummary: identity.summarize(p),
      identityIncomplete: !store.identityComplete(p),
      totalNotices: all.length,
      realNotices: all.filter(n => n.real).length,
      wxNotify: wxnotify.summary(),
      dirty: false
    });
    this.calcReach(p.interests || []);
    this.loadKeywords(p);
    this.updateSyncText();
    this.loadFavorites();
    this.loadHidden();
  },

  /* 收藏列表：只取当前通知池里还存在的（下架/换源的自然消失）   *
   * 「我关心的事」最怕的不是忘收藏，是收藏了却忘了办。
   * 所以这里不只列出来，还按「离截止还有几天」排序，并把已过期/今天/三天内的挑出来顶上，
   * 顺带带上「这条我办到哪一步了」（勾了几步 / 共几步）。 */
  loadFavorites() {
    const ids = fav.list();
    const dm = fav.doneMap();
    const out = [];
    ids.forEach(id => {
      const n = store.getNotice(id);
      if (!n) return;
      const cd = (typeof n.countdown === 'number') ? n.countdown : null;

      /* 紧急度：过期 / 今天 / 三天内 / 一周内 / 更远 */
      let lv, lvLabel;
      if (cd === null) { lv = 'far'; lvLabel = '长期有效'; }
      else if (cd < 0) { lv = 'exp'; lvLabel = '已过期'; }
      else if (cd === 0) { lv = 'now'; lvLabel = '今天截止'; }
      else if (cd <= 3) { lv = 'hot'; lvLabel = '还剩 ' + cd + ' 天'; }
      else if (cd <= 7) { lv = 'soon'; lvLabel = '还剩 ' + cd + ' 天'; }
      else { lv = 'far'; lvLabel = '还剩 ' + cd + ' 天'; }

      /* 这条的办事进度 */
      const steps = store.actionSteps(n);
      let done = 0;
      steps.forEach(s => { if (dm[id + '::' + s.key]) done++; });

      out.push({
        id: n.id, title: n.title, source: n.source, publish: n.publish,
        deadline: n.deadline, countdown: cd,
        lv, lvLabel,
        stepDone: done, stepTotal: steps.length,
        allDone: steps.length > 0 && done === steps.length
      });
    });

    /* 排序：越紧急越靠前；同档按倒计时升序；无截止的排最后 */
    const rank = { exp: 0, now: 1, hot: 2, soon: 3, far: 4 };
    out.sort((a, b) => {
      if (rank[a.lv] !== rank[b.lv]) return rank[a.lv] - rank[b.lv];
      const ca = a.countdown === null ? 9999 : a.countdown;
      const cb = b.countdown === null ? 9999 : b.countdown;
      return ca - cb;
    });

    const alerts = out.filter(x => x.lv === 'exp' || x.lv === 'now' || x.lv === 'hot').length;

    this.setData({ favList: out, favAlerts: alerts });
  },

  /* 已删除列表 + 阅读统计：已删的从当前池里取标题展示（池里已无则跳过） */
  loadHidden() {
    const ids = readstate.hiddenList();
    const out = [];
    ids.forEach(id => {
      const n = store.getNotice(id);
      if (!n) return;
      out.push({ id: n.id, title: n.title, source: n.source, publish: n.publish });
    });
    this.setData({
      hiddenList: out,
      readStats: readstate.stats(store.allNotices())
    });
  },

  /* 找回一条（取消删除） */
  restoreHidden(e) {
    const id = e.currentTarget.dataset.id;
    readstate.unhide(id);
    this.loadHidden();
    wx.showToast({ title: '已找回', icon: 'none' });
  },

  /* 清空全部删除记录 */
  clearHidden() {
    const self = this;
    wx.showModal({
      title: '清空已删除',
      content: '清空后这些通知会重新出现在推送流里，确定吗？',
      success(res) {
        if (!res.confirm) return;
        readstate.hiddenList().forEach(id => readstate.unhide(id));
        self.loadHidden();
        wx.showToast({ title: '已全部找回', icon: 'none' });
      }
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goTimeline() { wx.switchTab({ url: '/pages/timeline/timeline' }); },
  goDigest() { wx.switchTab({ url: '/pages/digest/digest' }); },
  goSelfcheck() { wx.navigateTo({ url: '/pages/selfcheck/selfcheck' }); },
  goPush() { wx.navigateTo({ url: '/pages/push/push' }); },
  goAsk() { wx.navigateTo({ url: '/pages/ask/ask' }); },
  goCalendar() { wx.navigateTo({ url: '/pages/calendar/calendar' }); },

  updateSyncText() {
    const info = store.sourceInfo();
    if (!info.lastSync) { this.setData({ syncText: '' }); return; }
    const d = new Date(info.lastSync);
    const pad = n => (n < 10 ? '0' + n : '' + n);
    this.setData({ syncText: `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}` });
  },

  /* 实时算：当前勾选的标签 + 当前身份，能收到几条通知（含紧急数） */
  calcReach(interests) {
    const p = this.data.profile || {};
    const list = Array.isArray(interests) ? interests : [];
    let n = 0, urgent = 0;
    store.allNotices().forEach(item => {
      if (list.indexOf(item.event) < 0) return;
      if (!store.passesIdentity(item, p)) return;
      n++;
      const lv = store.levelOf(item);
      if (lv === 'hi') urgent++;
    });
    this.setData({ reachable: n, reachableUrgent: urgent });
  },

  /* 关注事项开关 */
  toggleEvent(e) {
    const ev = e.currentTarget.dataset.ev;
    /* interests 可能缺失（旧版本存的画像 / 云端返回不全），先归一成数组再操作 */
    const cur = this.data.profile && this.data.profile.interests;
    const list = Array.isArray(cur) ? cur.slice() : [];
    const i = list.indexOf(ev);
    if (i >= 0) {
      if (list.length === 1) {
        wx.showToast({ title: '至少保留一项关注', icon: 'none' });
        return;
      }
      list.splice(i, 1);
    } else {
      list.push(ev);
    }
    this.setData({ 'profile.interests': list, dirty: true });
    this.calcReach(list);
  },

  selectAll() {
    const all = ALL_TAGS.map(t => t.key);
    this.setData({ 'profile.interests': all, dirty: true });
    this.calcReach(all);
  },

  resetDefault() {
    const def = tags.TAGS.slice(0, 4).map(t => t.key);
    this.setData({ 'profile.interests': def, dirty: true });
    this.calcReach(def);
  },

  onIdentityType(e) {
    const v = IDENTITY_OPTS[+e.detail.value];
    this.setData({ identityTypeIdx: +e.detail.value, 'profile.identityType': v, dirty: true });
    this.refreshSummary();
    this.calcReach(this.data.profile.interests || []);
  },
  onGrade(e) {
    this.setData({ gradeIdx: +e.detail.value, 'profile.grade': GRADE_OPTS[+e.detail.value], dirty: true });
    this.refreshSummary();
    this.calcReach(this.data.profile.interests || []);
  },
  onCollege(e) {
    this.setData({ collegeIdx: +e.detail.value, 'profile.college': COLLEGE_OPTS[+e.detail.value], dirty: true });
    this.refreshSummary();
    this.calcReach(this.data.profile.interests || []);
  },
  onCampus(e) { this.setData({ campusIdx: +e.detail.value, 'profile.campus': CAMPUS_OPTS[+e.detail.value], dirty: true }); },
  onAdvance(e) { this.setData({ advanceIdx: +e.detail.value, 'profile.advance': ADVANCE_OPTS[+e.detail.value], dirty: true }); },
  onChannel(e) { this.setData({ channelIdx: +e.detail.value, 'profile.channel': CHANNEL_OPTS[+e.detail.value], dirty: true }); },

  /* ★ 开启/更新微信服务通知（真·触达） —— 必须由用户点，合规硬要求 */
  async enableWxNotify() {
    if (this.data.wxBusy) return;
    this.setData({ wxBusy: true });

    const profile = store.getProfile();
    let res;
    try {
      res = await wxnotify.requestSubscribe(['deadline', 'newnotice']);
    } catch (e) {
      res = { ok: false, reason: '订阅请求失败：' + (e && e.message) };
    }
    /* 提前量与订阅意图登记进云端，服务端据此下发 */
    try { await wxnotify.registerPlan(profile); } catch (e) {}

    this.setData({ wxBusy: false });
    this.setData({ wxNotify: wxnotify.summary() });

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

  /* ============ 自定义关键词订阅 ============ */
  /*
   * 用户在输入框里敲一个词（如"正大杯"），保存进画像的 keywords；
   * 之后池中命中该词的通知就进推送流并主动推送。
   * 这一层与"关注标签"并列：标签是选的分好的类，关键词是自己敲的具体名词。
   */

  /* 重新统计每个关键词在池内命中多少条（含紧急数），供 chips 显示数字 + 反过来证明"我输的词有用" */
  loadKeywords(profile) {
    const p = profile || this.data.profile || store.getProfile();
    const kws = Array.isArray(p.keywords) ? p.keywords : [];
    const stats = store.keywordStats(p);
    let reach = 0, urgent = 0;
    stats.forEach(s => { reach += s.count; urgent += s.urgent; });

    /* 推荐词：只留池里真命中、且用户还没订的（最多 8 个，避免一屏塞满） */
    const owned = {};
    kws.forEach(k => { owned[subscribe.normKeyword(k)] = 1; });
    const suggest = KW_SUGGEST_CANDIDATES
      .filter(w => !owned[subscribe.normKeyword(w)])
      .map(w => {
        const cnt = store.allNotices().filter(n =>
          subscribe.hitKeyword(n, { keywords: [w] }) && store.passesIdentity(n, p)).length;
        return { w: w, n: cnt };
      })
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map(x => x.w);

    this.setData({
      'profile.keywords': kws,
      kwStats: stats,
      kwMax: subscribe.MAX_KEYWORDS,
      kwReach: reach,
      kwReachUrgent: urgent,
      kwSuggest: suggest
    });
  },

  onKwInput(e) {
    this.setData({ kwInput: e.detail.value });
  },

  /* 确认输入（回车 / 点"添加"） */
  onKwConfirm() {
    this.addKeyword();
  },

  /* 添加一个关键词：洗一下 → 去重 → 限个数 → 写画像 */
  addKeyword() {
    const raw = String(this.data.kwInput || '').replace(/\s+/g, '');
    if (!raw) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }
    if (raw.length > 20) {
      wx.showToast({ title: '关键词最多 20 个字', icon: 'none' });
      return;
    }
    const cur = Array.isArray(this.data.profile.keywords) ? this.data.profile.keywords.slice() : [];
    if (cur.some(k => store.sameKeyword(k, raw))) {
      wx.showToast({ title: '这个词已经订过了', icon: 'none' });
      return;
    }
    if (cur.length >= subscribe.MAX_KEYWORDS) {
      wx.showToast({ title: '最多订阅 ' + subscribe.MAX_KEYWORDS + ' 个关键词', icon: 'none' });
      return;
    }
    cur.push(raw);
    const next = { 'profile.keywords': subscribe.sanitizeKeywords(cur), dirty: true };
    this.setData(next);
    this.setData({ kwInput: '' });
    this.loadKeywords(this.data.profile);
    wx.showToast({ title: '已订阅「' + raw + '」', icon: 'none' });
  },

  /* 点一个推荐词（正大杯/挑战杯…）直接订阅 */
  tapSuggest(e) {
    const w = e.currentTarget.dataset.kw;
    this.setData({ kwInput: w }, () => this.addKeyword());
  },

  /* 删掉一个关键词（点 chip 上的 × ） */
  removeKeyword(e) {
    const kw = e.currentTarget.dataset.kw;
    const cur = Array.isArray(this.data.profile.keywords) ? this.data.profile.keywords.slice() : [];
    const i = cur.findIndex(k => store.sameKeyword(k, kw));
    if (i < 0) return;
    cur.splice(i, 1);
    this.setData({ 'profile.keywords': subscribe.sanitizeKeywords(cur), dirty: true });
    this.loadKeywords(this.data.profile);
    wx.showToast({ title: '已取消订阅', icon: 'none' });
  },

  onMajor(e) {
    this.setData({ 'profile.major': e.detail.value, dirty: true });
  },

  refreshSummary() {
    const p = this.data.profile;
    this.setData({
      identitySummary: identity.summarize(p),
      identityIncomplete: !store.identityComplete(p)
    });
  },

  async save() {
    store.saveProfile(this.data.profile);
    this.setData({ dirty: false, identityIncomplete: !store.identityComplete(this.data.profile) });

    if (cloud.isCloudReady()) {
      wx.showLoading({ title: '同步中…' });
      const r = await cloud.saveProfile(this.data.profile);
      wx.hideLoading();
      if (r && r.ok) {
        wx.showToast({ title: '已保存并同步到云端', icon: 'success' });
      } else {
        wx.showToast({ title: '已存本地 · 云同步稍后重试', icon: 'none' });
      }
    } else {
      wx.showToast({ title: '已保存（本地）', icon: 'success' });
    }

    this.refreshMode();
  },

  about() {
    wx.showModal({
      title: '关于知时',
      content: '知时把安徽农业大学分散在学院、教务处、图书馆的公开通知聚合起来，浓缩成「谁该看 · 剩几天 · 怎么办」，按标签分组、再按你的身份（本科生/研究生/教职工 · 年级 · 学院）筛选后推送到你面前；每句话都挂着原文出处，点一下就能核对。\n\n搜索：也可以主动搜关键词，一搜就到，结果可溯源。\n\n合规边界：仅聚合 ahau.edu.cn 公网公开通知页面；身份信息只采集你自己选择的身份标签（类型/年级/学院/专业/校区），不采集身份证号、学号、成绩、课表等任何私域或敏感数据。\n\n本项目为「农芯智」AI 智能体创新大赛参赛作品。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onShareAppMessage() {
    return { title: '知时 · 别让机会悄悄溜走', path: '/pages/index/index' };
  }
});
