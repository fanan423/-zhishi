/**
 * 知时 · 日历
 * ================
 *
 * 日程回答"这周我还有几件事"；日历回答更直接的问题：
 *   「具体哪天忙、哪天能空出来？」
 *
 * 学生看截止日期的方式不是"还剩几天"这种抽象数字 ——
 * 而是"11 月 16 号那天我有两件事"。月历符合这种直觉。
 *
 * 日历上的每一格如果有点，就说明那天有截止。颜色代表紧急度：
 *   红 = 今天/明天、橙 = 三天内、黄 = 一周内、绿 = 本月内
 * 今天那一格永远高亮，方便定位。
 */
const store = require('../../utils/store.js');
const ask = require('../../utils/ask.js');
const theme = require('../../utils/theme.js');

Page({
  data: {
    theme: 'light',
    /* 当前展示的年月 */
    year: 0,
    month: 0,
    monthLabel: '',
    /* 月历网格 */
    weeks: [],
    weekdays: [],
    /* 统计 */
    summary: '',
    busyCount: 0,
    monthCount: 0,
    /* 选中某一天 */
    selectedDay: 0,
    selectedItems: [],
    selectedLabel: '',
    /* 今天 */
    today: null,
    /* 当月总览列表 */
    monthItems: [],
    showList: false
  },

  onLoad() {
    const now = new Date();
    this.setData({ theme: theme.current(), year: now.getFullYear(), month: now.getMonth() + 1 });
    this.rebuild();
  },

  onShow() {
    this.setData({ theme: theme.current() });
    this.rebuild();
  },

  rebuild() {
    const cal = ask.buildCalendar(this.data.year, this.data.month);
    this.setData({
      weeks: cal.weeks,
      weekdays: cal.weekdays,
      monthLabel: cal.year + ' 年 ' + cal.month + ' 月',
      summary: cal.summary,
      busyCount: cal.busyCount,
      monthCount: cal.monthCount,
      monthItems: cal.monthItems,
      today: cal.today
    });
    /* 默认选中今天（若在今天所在月） */
    if (!this.data.selectedDay) {
      const t = cal.today;
      if (t.y === cal.year && t.m === cal.month) {
        this.selectDay(t.d, cal.weeks);
      }
    }
  },

  /* 点某一格 */
  onPickDay(e) {
    const d = +e.currentTarget.dataset.d;
    if (!d) return;
    this.selectDay(d, this.data.weeks);
  },

  selectDay(d, weeks) {
    let items = [];
    (weeks || []).forEach(w => w.forEach(c => { if (!c.blank && c.day === d) items = c.items || []; }));
    this.setData({
      selectedDay: d,
      selectedItems: items,
      selectedLabel: this.data.month + ' 月 ' + d + ' 日 · ' + (items.length ? items.length + ' 件要办' : '没有截止事项')
    });
  },

  prevMonth() {
    const s = ask.shiftMonth(this.data.year, this.data.month, -1);
    this.setData({ year: s.year, month: s.month, selectedDay: 0 });
    this.rebuild();
  },

  nextMonth() {
    const s = ask.shiftMonth(this.data.year, this.data.month, 1);
    this.setData({ year: s.year, month: s.month, selectedDay: 0 });
    this.rebuild();
  },

  goToday() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1, selectedDay: 0 });
    this.rebuild();
  },

  toggleList() {
    this.setData({ showList: !this.data.showList });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goAsk() { wx.navigateTo({ url: '/pages/ask/ask' }); },
  goIndex() { wx.switchTab({ url: '/pages/index/index' }); },

  onShareAppMessage() {
    return { title: '知时 · 日历，哪天忙一目了然', path: '/pages/index/index' };
  }
});
