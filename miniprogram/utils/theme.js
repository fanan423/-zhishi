/**
 * 知时 · 主题（单一事实来源）
 * ==========================
 *
 * 提供两套主题，均源自安徽农业大学 VI：
 *   light（默认）—— 白卡片 + 浅绿灰底，贴近官网 / 数字安农服务气质
 *   dark          —— 深墨绿底 + 金绿描边，夜间与演示更沉稳
 *
 * 实现方式：在页面根 <view class="wrap"> 外挂一个 theme-<name> 的类，
 * 由 app.wxss 里的 CSS 变量切换整站配色。页面代码只调 applyTheme()。
 */

const KEY = 'zhishi_theme';

const THEMES = [
  { key: 'light', name: '浅色（数字安农）', icon: '☀️' },
  { key: 'dark',  name: '深色（夜间）',     icon: '🌙' }
];

/* 读当前主题（没存过就跟随系统；再不行默认浅色） */
function current() {
  try {
    const saved = wx.getStorageSync(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (e) {}
  try {
    const sys = wx.getSystemInfoSync();
    if (sys && sys.theme === 'dark') return 'dark';
  } catch (e) {}
  return 'light';
}

function set(name) {
  const v = name === 'dark' ? 'dark' : 'light';
  try { wx.setStorageSync(KEY, v); } catch (e) {}
  return v;
}

function toggle() {
  return set(current() === 'dark' ? 'light' : 'dark');
}

function index() {
  const c = current();
  return Math.max(0, THEMES.findIndex(t => t.key === c));
}

module.exports = { THEMES, current, set, toggle, index };
