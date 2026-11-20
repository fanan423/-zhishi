const store = require('../../utils/store.js');
const fav = require('../../utils/favorites.js');
const theme = require('../../utils/theme.js');
const agent = require('../../utils/agent.js');

/**
 * 今日汇总页
 * ========
 * 给「没时间一屏屏翻」的人一段能直接读完的东西。
 * 汇总内容全部由 store.brief() 从当前数据派生 —— 没有一句是写死的结论，
 * 所以订阅改了、身份改了、云端数据更新了，汇总会跟着变。
 *
 * ★ 智能体区块（本页新增）
 *   上面那部分是「你打开小程序时，本地现算」的汇总；
 *   下面「智能体主动送达」是**服务端智能体**按点自己跑出来的清单。
 *   两者的区别是真实存在的，所以界面里如实分开标注，不混为一谈：
 *     - 本地汇总  → 你打开才更新（"我来了它才想"）
 *     - 智能体清单 → 后台常驻，按点自己跑（"你不来它也想"）—— 这才是治"错过"的那一环
 *   agent.digest() 会自动择路：服务可达走服务、不可达降级本地，页面代码不分叉。
 */
Page({
  data: {
    theme: 'light',
    brief: null,
    /* 汇总里的「一句话总结」按句拆开，便于逐句排版 */
    sentences: [],
    /* 数据可信度 */
    trustLevel: '',
    trustLabel: '',
    /* 生成时间 */
    stamp: '',
    /* 收藏数 */
    favCount: 0,
    /* 空态 */
    hasAny: false,

    /* ★ 智能体 */
    agentLoading: false,
    agentReady: false,
    agentMode: 'local',        // remote / local
    agentVia: 'local',         // 实际执行者
    agentLabel: '',            // 人话状态
    agentDegraded: false,
    agentDegradeReason: '',
    agentMeta: null,
    agentNotify: [],           // 主动送达（该打断你的）
    agentSilent: [],           // 静默进流（不必打扰的）
    agentErr: ''
  },

  onLoad() {
    const t = theme.current();
    this.setData({ theme: t });
    this.applyNavTheme(t);
    wx.setNavigationBarTitle({ title: '今日汇总' });
    this.build();
    this.loadAgent();
  },

  onShow() {
    const t = theme.current();
    this.setData({ theme: t });
    this.applyNavTheme(t);
    this.build();
    this.loadAgent();
  },

  applyNavTheme(t) {
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t === 'dark' ? '#0E211A' : '#00653E'
    });
  },

  build() {
    const b = store.brief();
    const stats = b.stats || {};
    const info = store.sourceInfo();

    /* 可信度：真实公开源占比 */
    const realRatio = stats.collected ? stats.realCnt / stats.collected : 0;
    let trustLevel = 'low', trustLabel = '以演示数据为主';
    if (realRatio >= 0.8) { trustLevel = 'high'; trustLabel = '绝大多数来自安农官网公开页'; }
    else if (realRatio >= 0.5) { trustLevel = 'mid'; trustLabel = '一半以上来自安农官网公开页'; }

    /* 生成时间戳（本地时区） */
    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    this.setData({
      brief: b,
      sentences: String(b.summary || '').split('；').filter(Boolean),
      trustLevel,
      trustLabel,
      stamp,
      favCount: fav.count(),
      hasAny: (b.must.length + b.watch.length) > 0
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /* 日程是 tabBar 页，必须用 switchTab（navigateTo 会失败） */
  goTimeline() { wx.switchTab({ url: '/pages/timeline/timeline' }); },
  goMe() { wx.switchTab({ url: '/pages/me/me' }); },
  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },

  /* 把汇总复制出去，方便贴给自己/群 */
  copyBrief() {
    const b = this.data.brief;
    if (!b) return;
    const lines = ['【知时 · 今日汇总】' + this.data.stamp, ''];
    lines.push('知时指数 ' + b.index.score + '（' + b.index.label + '）');
    lines.push('');
    if (b.must.length) {
      lines.push('■ 三天内要办');
      b.must.forEach((n, i) => {
        lines.push(`${i + 1}. ${n.title}`);
        lines.push(`   截止 ${n.deadline}${n.entry ? ' · ' + n.entry : ''}`);
      });
      lines.push('');
    }
    if (b.watch.length) {
      lines.push('■ 本周留意');
      b.watch.forEach((n, i) => lines.push(`${i + 1}. ${n.title}（截止 ${n.deadline}）`));
      lines.push('');
    }
    lines.push(b.summary);
    lines.push('');
    lines.push('—— 数据来自安农公网公开通知页，仅聚合公开信息');

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '汇总已复制', icon: 'success' })
    });
  },

  /**
   * ★ 拉智能体的「今日主动送达清单」
   * agent.digest() 内部已处理择路与降级，这里只负责渲染 + 如实标注状态。
   * 失败不抛到页面（页面不能因为智能体挂了就白屏）—— 失败只收起这一块。
   */
  async loadAgent() {
    if (this.data.agentLoading) return;
    this.setData({ agentLoading: true, agentErr: '' });

    let st = null;
    try { st = await agent.status(); } catch (e) { st = null; }

    try {
      const r = await agent.digest({ useLLM: true });

      const notify = (r.notify || []).map(n => Object.assign({}, n, {
        /* 倒计时人话 */
        dueText: this.dueText(n),
      }));
      const silent = (r.silent || []).slice(0, 3).map(n => Object.assign({}, n, {
        dueText: this.dueText(n),
      }));

      this.setData({
        agentLoading: false,
        agentReady: !!r.ok,
        agentMode: r.mode || 'local',
        agentVia: r.via || r.mode || 'local',
        agentDegraded: !!r.degraded,
        agentDegradeReason: r.degradeReason || '',
        agentLabel: (st && st.label) || (r.mode === 'remote' ? '已连接智能体服务' : '本地模式'),
        agentMeta: r.meta || null,
        agentNotify: notify,
        agentSilent: silent,
        agentErr: ''
      });
    } catch (e) {
      this.setData({
        agentLoading: false,
        agentReady: false,
        agentLabel: (st && st.label) || '',
        agentErr: (e && e.message) || '智能体清单获取失败'
      });
    }
  },

  /** 倒计时 → 人话（与汇总页口径一致） */
  dueText(n) {
    const c = (n && typeof n.countdown === 'number') ? n.countdown : null;
    if (c === null) return '';
    if (c < 0) return '已过期';
    if (c === 0) return '今天截止';
    if (c === 1) return '明天截止';
    if (c <= 3) return 'D-' + c;
    return '还有 ' + c + ' 天';
  },

  /* 智能体清单里的条目 → 详情页 */
  goAgentDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /* 重跑一次（用户可以主动"催"智能体，看到最新结论） */
  async rerunAgent() {
    if (this.data.agentLoading) return;
    wx.showLoading({ title: '智能体计算中', mask: true });
    await this.loadAgent();
    wx.hideLoading();
    wx.showToast({ title: this.data.agentReady ? '已刷新' : '未取到清单', icon: 'none' });
  },

  /* 复制智能体清单（可贴群/贴给自己） */
  copyAgent() {
    const list = this.data.agentNotify || [];
    if (!list.length) {
      wx.showToast({ title: '当前没有要主动送达的条目', icon: 'none' });
      return;
    }
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const lines = ['【知时 · 智能体主动送达】' + stamp, ''];
    list.forEach((n, i) => {
      lines.push(`${i + 1}. ${n.title}`);
      if (n.dueText || n.deadline) lines.push(`   ${n.dueText || ''}${n.deadline ? ' · 截止 ' + n.deadline : ''}`);
      if (n.reasonLine) lines.push(`   为什么推给你：${n.reasonLine}`);
      if (n.url) lines.push(`   原文：${n.url}`);
      lines.push('');
    });
    lines.push('—— 由知时智能体按你的订阅自动筛出，仅聚合公开通知');
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '清单已复制', icon: 'success' })
    });
  },

  onPullDownRefresh() {
    this.build();
    this.loadAgent().then(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return { title: '知时 · 今日汇总', path: '/pages/digest/digest' };
  },

  onShareTimeline() {
    return { title: '知时 · 今日汇总' };
  }
});
