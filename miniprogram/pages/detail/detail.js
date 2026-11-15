const store = require('../../utils/store.js');
const searcher = require('../../utils/search.js');
const cloud = require('../../utils/cloud.js');
const fav = require('../../utils/favorites.js');
const theme = require('../../utils/theme.js');
const push = require('../../utils/push.js');
const readstate = require('../../utils/readstate.js');

Page({
  data: {
    notice: null,
    theme: 'light',
    tab: 'digest',       // digest | raw
    activeIdx: -1,       // 当前高亮的要点
    rawFocused: false,
    quotedRaw: [],       // 原文切片：[{text, hl, idx}]
    matched: false,
    /* 搜索词高亮 */
    query: '',
    qWords: [],
    titleSegs: [],
    /* 溯源完整度自评 */
    traceable: 0,
    traceTotal: 0,
    /* 要素完整度 */
    factList: [],
    /* 关键信息卡 */
    keyCard: [],
    /* 是否收藏 */
    favorited: false,
    /* AI 理解（离线大模型产物优先，在线重新理解为可选增强） */
    aiReady: false,
    aiRunning: false,
    aiResult: null,
    aiError: '',
    aiSource: '',       // offline | cloud
    /* 「和我有关吗」：把 audience 翻成人话，逐条对上本人画像 */
    rel: null,
    /* 出处可信度：verifiable（有原文链接）/ real-nolink（真采集但缺链接）/ demo（演示样例） */
    srcState: '',
    srcLabel: '',
    /* 「要办什么」：可勾选的办理清单 */
    steps: [],
    stepDone: 0,
    stepTotal: 0,
    allDone: false,
    /* 已读 / 已删除（本地状态） */
    isRead: false,
    isHidden: false
  },

  onLoad(options) {
    const id = options.id;
    const q = decodeURIComponent(options.q || '');

    // 主题跟随全局设置
    const t = theme.current();
    this.setData({ theme: t });
    wx.setNavigationBarColor && wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: t === 'dark' ? '#0E211A' : '#00653E'
    });

    const n = store.getNotice(id);
    if (!n) {
      wx.showToast({ title: '未找到该通知', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }

    const profile = store.getProfile();
    const notice = { ...n, level: store.levelOf(n) };

    const qWords = searcher.splitQuery(q);

    // 溯源率自评：多少条要点能在原文里找到
    const pts = n.digestPoints || [];
    const okCnt = pts.filter(p => store.locateQuote(n.raw, p.quote) >= 0).length;

    // 关键信息卡：把最要紧的几条挑出来置顶（谁该看 / 截止 / 去哪办）
    const keyCard = [];
    if (n.deadline) {
      keyCard.push({
        k: '截止时间',
        v: n.deadline + (typeof n.countdown === 'number' && n.countdown >= 0 ? `（还剩 ${n.countdown} 天）` : '')
      });
    }
    keyCard.push({ k: '谁该看', v: n.audience || '原文未明确说明' });
    if (n.entry) keyCard.push({ k: '去哪办', v: n.entry });
    if (n.materials) keyCard.push({ k: '要交什么', v: n.materials });

    this.setData({
      notice,
      matched: (profile.interests || []).indexOf(n.event) >= 0,
      query: q,
      qWords,
      titleSegs: qWords.length ? searcher.highlight(n.title, qWords) : [{ text: n.title, hl: false }],
      traceTotal: pts.length,
      traceable: okCnt,
      keyCard,
      favorited: fav.has(n.id),
      factList: [
        { k: '谁该看', v: n.audience || '原文未明确说明' },
        { k: '要交什么', v: n.materials || '原文未明确说明' },
        { k: '去哪办', v: n.entry || '原文未明确说明' },
        { k: '剩几天', v: (typeof n.countdown === 'number') && n.countdown >= 0 ? `剩 ${n.countdown} 天（截止 ${n.deadline}）` : (n.deadline ? `截止 ${n.deadline}` : '原文未明确说明') }
      ]
    });

    wx.setNavigationBarTitle({ title: n.event + ' · 详情' });
    this.buildRaw(n);
    this.buildRel(n, profile);
    this.buildSteps(n);

    /* 反馈闭环（正反馈）：用户真的打开了这条详情 → 记为"点开过"。
     * 用途有二：① 让推送引擎知道你在意这一类（同类后续加权）；
     *         ② 这条不再被判为"看了却没点开"，不会被降权。
     * 全部只在本地留痕，不上传任何隐私。 */
    push.markOpened(n);

    /* 已读：打开详情即视为已读（用户可见的持久状态）。
     * 与 push.markOpened 的区别：那是"反馈闭环痕迹"（会随反馈重置清空），
     * 这是"我看过这条了"的持久标记（用于列表里去掉未读点）。两者语义不同，各存各的。 */
    readstate.markRead(n.id);
    this.setData({ isRead: true, isHidden: readstate.isHidden(n.id) });

    /* 出处状态：决定页头角标怎么说 —— 有链接才敢说"可核对" */
    let srcState, srcLabel;
    if (n.real && n.url) { srcState = 'verifiable'; srcLabel = '真实公开源 · 可核对原文'; }
    else if (n.real) { srcState = 'real-nolink'; srcLabel = '真实采集 · 未留存链接'; }
    else { srcState = 'demo'; srcLabel = '演示样例 · 非真实通知'; }
    this.setData({ srcState, srcLabel });

    /* AI 理解区块：优先展示构建期注入的离线大模型产物。
     * 断网 / 未启用云服务时，评审也能直接看到模型抽取的五要素与依据原文，
     * 而不是只看到一张「云服务未就绪」的空卡片。在线通道保留为「重新理解」。 */
    const off = (n && n.llm && n.llm.fields) ? n.llm : null;
    const aiResult = off ? {
      who: off.fields.who || '原文未明确说明',
      what: off.fields.what || '原文未明确说明',
      where: off.fields.where || '原文未明确说明',
      deadline: off.fields.deadline || '原文未明确说明',
      materials: off.fields.materials || '原文未明确说明',
      quote: off.fields.source_quote || '',
      summary: off.fields.summary || '',
      model: off.model || 'auto',
      at: off.at || '',
      promptVersion: off.promptVersion || '',
      quoteMatch: off.quoteMatch || 'none'
    } : null;
    this.setData({
      aiReady: !!aiResult || cloud.isCloudReady(),
      aiResult,
      aiSource: aiResult ? 'offline' : 'cloud'
    });
  },

  /* ============ 「和我有关吗」 ============ */
  buildRel(n, profile) {
    const rel = store.relevance(n, profile);
    /* 把结论翻译成一句能直接给学生看的话（三种结果分别对应三种真实场景） */
    rel.reasonLine = rel.level === 'ok'
      ? '原文要求的条件，和你填的身份是对得上的。'
      : rel.level === 'no'
        ? '原文写明的条件和你的身份有对不上的地方，报名前先问一下主办方。'
        : rel.level === 'open'
          ? '原文没有限定人群，一般在校生都可以参加。'
          : '原文有几项限定，需要你自己核对一下——已在下面对照列出。';
    this.setData({ rel });
  },

  /* ============ 「要办什么」办理清单 ============ */
  buildSteps(n) {
    const raw = store.actionSteps(n);
    const steps = raw.map(s => Object.assign({}, s, { done: fav.isStepDone(n.id, s.key) }));
    this.setData({
      steps,
      stepTotal: steps.length,
      stepDone: steps.filter(s => s.done).length,
      allDone: steps.length > 0 && steps.every(s => s.done)
    });
  },

  /* 勾一步：本地落盘，退出再进来还记得 */
  toggleStep(e) {
    const n = this.data.notice;
    if (!n) return;
    const key = e.currentTarget.dataset.k;
    const now = fav.toggleStep(n.id, key);
    const steps = this.data.steps.map(s => (s.key === key ? Object.assign({}, s, { done: now }) : s));
    const done = steps.filter(s => s.done).length;
    this.setData({
      steps,
      stepDone: done,
      allDone: steps.length > 0 && steps.every(s => s.done)
    });
    if (steps.length > 0 && steps.every(s => s.done)) {
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      wx.showToast({ title: '都办完了 👍', icon: 'none' });
    }
  },

  /* 一键全清（勾错了/重新来过） */
  resetSteps() {
    const n = this.data.notice;
    if (!n) return;
    fav.clearSteps(n.id);
    this.buildSteps(n);
    wx.showToast({ title: '已重置办理进度', icon: 'none' });
  },

  /* 把当前清单复制出去，方便发给一起报名的同学 */
  copySteps() {
    const n = this.data.notice;
    if (!n || !this.data.steps.length) {
      wx.showToast({ title: '这条没有可复制的清单', icon: 'none' });
      return;
    }
    const lines = [`【${n.title}】办理清单`];
    this.data.steps.forEach((s, i) => {
      lines.push(`${s.done ? '☑' : '☐'} ${i + 1}. ${s.text}`);
    });
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '清单已复制', icon: 'success' })
    });
  },

  /* 切换收藏 */
  toggleFav() {
    const n = this.data.notice;
    if (!n) return;
    const now = fav.toggle(n.id);
    this.setData({ favorited: now });
    /* 取消收藏时一并清掉这条的办事进度，避免残留 */
    if (!now) { fav.clearSteps(n.id); this.buildSteps(n); }
    wx.showToast({ title: now ? '已收藏 · 可在"我的"查看' : '已取消收藏', icon: 'none' });
  },

  /* 切换已读 / 未读 */
  toggleRead() {
    const n = this.data.notice;
    if (!n) return;
    const now = readstate.toggleRead(n.id);
    this.setData({ isRead: now });
    wx.showToast({ title: now ? '已标记已读' : '已标记未读', icon: 'none' });
  },

  /* 删除（本地隐藏）→ 返回上一页；可在「我的 · 已删除」找回 */
  removeNotice() {
    const n = this.data.notice;
    if (!n) return;
    const self = this;
    wx.showModal({
      title: '删除这条通知',
      content: '删除后从推送流/列表里隐藏（云端公开数据不受影响），可在「我的 · 已删除」找回。',
      confirmText: '删除',
      confirmColor: '#C0392B',
      success(res) {
        if (!res.confirm) return;
        readstate.hide(n.id);
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      }
    });
  },

  /* 找回（若当前是已删除状态） */
  restoreNotice() {
    const n = this.data.notice;
    if (!n) return;
    readstate.unhide(n.id);
    this.setData({ isHidden: false });
    wx.showToast({ title: '已找回', icon: 'none' });
  },

  /**
   * 把原文按要点引文切成片段，便于高亮渲染
   * 切片：{ text, hl:bool, idx:要点序号 }
   *
   * 说明：这是"可溯源"的物理实现——quote 一定是原文原样切片，
   * 在这里把它在 raw 里定位出来，前端就能点一句→跳对应原文。
   */
  buildRaw(n) {
    const raw = n.raw || '';
    const marks = [];

    (n.digestPoints || []).forEach((p, i) => {
      const start = store.locateQuote(raw, p.quote);
      if (start < 0) return;

      // 计算实际匹配长度（quote 可能被截断加了省略号）
      let len = p.quote.length;
      const trimmed = p.quote.replace(/…+$/, '');
      if (raw.substr(start, len) !== p.quote) {
        // 用去空白版本估算长度
        len = trimmed.replace(/\s+/g, '').length;
        // 从 start 起，数够 len 个非空白字符
        let cnt = 0, end = start;
        while (end < raw.length && cnt < len) {
          if (!/\s/.test(raw[end])) cnt++;
          end++;
        }
        len = end - start;
      }
      marks.push({ start, end: start + len, idx: i });
    });

    // 按起点排序、去重叠
    marks.sort((a, b) => a.start - b.start);
    const clean = [];
    let last = 0;
    marks.forEach(m => {
      if (m.start >= last) { clean.push(m); last = m.end; }
    });

    const segs = [];
    let cursor = 0;
    clean.forEach(m => {
      if (m.start > cursor) {
        segs.push({ text: raw.slice(cursor, m.start), hl: false, idx: -1 });
      }
      segs.push({ text: raw.slice(m.start, m.end), hl: true, idx: m.idx });
      cursor = m.end;
    });
    if (cursor < raw.length) {
      segs.push({ text: raw.slice(cursor), hl: false, idx: -1 });
    }

    this.setData({ quotedRaw: segs });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab, activeIdx: -1, rawFocused: false });
  },

  tapPoint(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ activeIdx: idx, rawFocused: false });
  },

  /* 从要点直接跳到原文核对 */
  jumpToRaw(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ tab: 'raw', activeIdx: idx, rawFocused: false });
  },

  tapQuote(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx < 0) return;
    this.setData({ tab: 'digest', activeIdx: idx, rawFocused: false });
  },

  toggleAll() {
    const next = !this.data.rawFocused;
    this.setData({ tab: 'raw', rawFocused: next, activeIdx: -1 });
  },

  copyEntry() {
    const n = this.data.notice;
    if (!n) return;
    const lines = [
      n.title,
      `谁该看：${n.audience}`,
      `要交什么：${n.materials}`,
      `去哪办：${n.entry}`,
      n.deadline ? `截止：${n.deadline}` : ''
    ].filter(Boolean);
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制办理信息', icon: 'success' })
    });
  },

  /* 点原文出处那一行：直接进来源弹窗（可复制链接） */
  copySource() {
    this.openSource();
  },

  /* 查看来源：真实数据必须能给出可核对的原始 URL
   *
   * 这里严守一条：**有 url 才叫"可核对"**。
   *   real + url     → 给出官网链接，可复制去浏览器逐字比对
   *   real 但没 url  → 如实说明"这条没留下原文链接，请以官网为准"（不假装）
   *   非 real        → 明确标"演示样例"，别让学生当真通知看
   */
  openSource() {
    const n = this.data.notice;
    if (!n) return;

    const url = n.url || '';

    if (n.real && url) {
      wx.showModal({
        title: '原文出处（可逐字核对）',
        content: `来源：${n.source}${n.site ? '（' + n.site + '）' : ''}\n`
          + `页面发布：${n.publish}\n`
          + `链接：${url}\n\n`
          + '小程序内不跳外链，可复制到浏览器打开，与本页原文逐字比对。',
        showCancel: true,
        cancelText: '关闭',
        confirmText: '复制链接',
        success: (r) => {
          if (r.confirm) {
            wx.setClipboardData({
              data: url,
              success: () => wx.showToast({ title: '原文链接已复制', icon: 'success' })
            });
          }
        }
      });
      return;
    }

    if (n.real && !url) {
      /* 真实采集但缺链接 —— 诚实说明，不编造 */
      wx.showModal({
        title: '本条未留存原文链接',
        content: `来源：${n.source}\n页面发布：${n.publish}\n\n`
          + '这条是从公网公开页面采集的真实通知，但本次未记录原文链接。\n'
          + '如需核对，请直接到学校对应部门官网检索标题。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    /* 演示样例 —— 明说 */
    wx.showModal({
      title: '本条为演示样例',
      content: `来源单位标注：${n.source}\n\n`
        + '这条并非从安农官网采集的真实通知，是为演示功能而构造的样例，'
        + '没有原文链接，请勿当作真实通知使用。\n\n'
        + '带「原文出处」且能复制链接的，才是真实公开数据。',
      showCancel: false,
      confirmText: '明白了'
    });
  },

  /* 搜索同标签 */
  searchTag() {
    const n = this.data.notice;
    if (!n) return;
    wx.navigateTo({ url: `/pages/search/search?tag=${encodeURIComponent(n.event)}` });
  },

  /* 「和我有关吗」里点「去改身份」 */
  gotoMe() { wx.switchTab({ url: '/pages/me/me' }); },

  setRemind() {
    const n = this.data.notice;
    const advance = (store.getProfile().advance || '').split('/')[0].trim();
    if (!n) return;
    // 收藏 + 提醒一起做：这是用户真正想要的「帮我记住」
    if (!fav.has(n.id)) {
      fav.add(n.id);
      this.setData({ favorited: true });
    }
    wx.showModal({
      title: '已加入提醒',
      content: `已收藏本条，并按你的设置「${advance || '截止前 1 天'}」提醒。\n\n可在「我的订阅」调整提前量。`,
      showCancel: false,
      confirmText: '好'
    });
  },

  /**
   * AI 重新理解（可选增强）：调云端大模型把原文重抽一遍。
   * 详情页默认展示的是**构建期离线预计算**的大模型产物（断网可演），
   * 这里只负责「联网时重算」，失败或未就绪都不清空已有结果。
   */
  async aiUnderstand() {
    const n = this.data.notice;
    if (!n || this.data.aiRunning) return;

    if (!cloud.isCloudReady()) {
      wx.showToast({
        title: this.data.aiSource === 'offline' ? '已展示构建期大模型结果，无需联网' : '云服务未就绪，暂用预置浓缩',
        icon: 'none'
      });
      return;
    }

    this.setData({ aiRunning: true, aiError: '', aiResult: null });
    let r = null;
    try {
      r = await cloud.understandNotice(n);
    } catch (e) {
      r = null;
    }

    if (!r) {
      this.setData({
        aiRunning: false,
        aiError: '模型暂时没有返回结果，请稍后重试（下方预置浓缩仍可用）'
      });
      return;
    }

    this.setData({
      aiRunning: false,
      aiResult: {
        who: r.who || '原文未明确说明',
        what: r.what || '原文未明确说明',
        where: r.where || '原文未明确说明',
        deadline: r.deadline || '原文未明确说明',
        materials: r.materials || '原文未明确说明',
        quote: r.source_quote || '',
        summary: r.summary || '',
        model: (n.llm && n.llm.model) || 'auto',
        source: 'cloud'
      },
      aiSource: 'cloud'
    });
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  /* 分享：把这条通知的关键信息带出去 */
  onShareAppMessage() {
    const n = this.data.notice;
    if (!n) return { title: '知时 · 安农校园信息雷达', path: '/pages/index/index' };
    return {
      title: n.title,
      path: `/pages/detail/detail?id=${n.id}`
    };
  },

  onShareTimeline() {
    const n = this.data.notice;
    return { title: n ? n.title : '知时 · 安农校园信息雷达', query: n ? `id=${n.id}` : '' };
  }
});
