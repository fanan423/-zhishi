/**
 * 知时 · 已读未读 & 删除（本地）
 * ==============================
 *
 * 通知雷达的两个高频诉求：
 *   ① 「这条我看过了吗？」—— 42 条里翻过一遍，回头不记得哪条点开过。
 *   ② 「这条跟我无关，别再出现」—— 行政通知、外院事项，想清掉。
 *
 * 这两件事都是**个人本地状态**，各有明确语义：
 *   · 已读：读过 ≠ 不关心。读过仍要能翻到（标题变淡、去掉未读点），
 *          但不再计入"未读"。
 *   · 删除：明确不想再看到。从推送流里**隐藏**（不进流、不计命中），
 *          但仍可在「已删除」里找回（防止误删无法恢复），云端数据不动。
 *
 * 为什么单独一个模块（不复用 push.js 的 openedIds）：
 *   push.js 的 openedIds 是**反馈闭环**的输入（给"同类加分/重复抑制"用），
 *   语义是"点开过的痕迹"，会随反馈重置而清空。
 *   已读/删除是**用户可见的持久状态**，语义不同、生命周期不同，混在一起会互相污染。
 *
 * 【合规】全部存本地（wx.storage），不上云、不上报，删除只是本地隐藏，
 *        不触碰云端聚合的公开数据。
 */

const KEY = 'zhishi_read_state';

/* 状态形状：{ readIds: [...], hiddenIds: [...] } */
function _load() {
  try {
    const s = wx.getStorageSync(KEY);
    if (s && typeof s === 'object') {
      return {
        readIds: Array.isArray(s.readIds) ? s.readIds : [],
        hiddenIds: Array.isArray(s.hiddenIds) ? s.hiddenIds : []
      };
    }
  } catch (e) {}
  return { readIds: [], hiddenIds: [] };
}

function _save(s) {
  try { wx.setStorageSync(KEY, s); } catch (e) {}
}

/* ---------- 已读 ---------- */

function isRead(id) {
  return _load().readIds.indexOf(id) >= 0;
}

function markRead(id) {
  if (!id) return false;
  const s = _load();
  if (s.readIds.indexOf(id) < 0) {
    s.readIds.unshift(id);
    s.readIds = s.readIds.slice(0, 500);   /* 只留最近 500 条 */
    _save(s);
  }
  return true;
}

function markUnread(id) {
  if (!id) return false;
  const s = _load();
  s.readIds = s.readIds.filter(x => x !== id);
  _save(s);
  return false;
}

/* 读/未读来回切（详情页按钮用） */
function toggleRead(id) {
  if (isRead(id)) { markUnread(id); return false; }
  markRead(id); return true;
}

/* ---------- 删除（本地隐藏） ---------- */

function isHidden(id) {
  return _load().hiddenIds.indexOf(id) >= 0;
}

function hide(id) {
  if (!id) return false;
  const s = _load();
  if (s.hiddenIds.indexOf(id) < 0) {
    s.hiddenIds.unshift(id);
    s.hiddenIds = s.hiddenIds.slice(0, 500);
    _save(s);
  }
  return true;
}

/* 找回（从「已删除」恢复） */
function unhide(id) {
  if (!id) return false;
  const s = _load();
  s.hiddenIds = s.hiddenIds.filter(x => x !== id);
  _save(s);
  return false;
}

function toggleHidden(id) {
  if (isHidden(id)) { unhide(id); return false; }
  hide(id); return true;
}

function hiddenList() {
  return _load().hiddenIds.slice();
}

function readList() {
  return _load().readIds.slice();
}

/* ---------- 批量：给一组通知注入 read / hidden 标记 ---------- */
function decorate(items) {
  const s = _load();
  const rset = {}, hset = {};
  s.readIds.forEach(x => { rset[x] = 1; });
  s.hiddenIds.forEach(x => { hset[x] = 1; });
  return (items || []).map(n => Object.assign({}, n, {
    read: !!rset[n.id],
    hidden: !!hset[n.id]
  }));
}

/* 过滤掉已删除（不出现在推送流/列表） */
function visible(items) {
  const s = _load();
  const hset = {};
  s.hiddenIds.forEach(x => { hset[x] = 1; });
  return (items || []).filter(n => !hset[n.id]);
}

/* ---------- 统计（供首页/我的页展示） ---------- */
function stats(items) {
  const s = _load();
  const list = items || [];
  const hidden = list.filter(n => s.hiddenIds.indexOf(n.id) >= 0).length;
  const shown = list.filter(n => s.hiddenIds.indexOf(n.id) < 0);
  const read = shown.filter(n => s.readIds.indexOf(n.id) >= 0).length;
  return {
    read: read,
    unread: shown.length - read,
    hidden: hidden,
    total: list.length
  };
}

/* 未读数（不传 items 时只返回已读/删除记录条数） */
function unreadCount(items) {
  return stats(items).unread;
}

/* 清空全部已读/删除记录（"重置阅读状态"用） */
function reset() {
  _save({ readIds: [], hiddenIds: [] });
}

module.exports = {
  KEY,
  isRead, markRead, markUnread, toggleRead, readList,
  isHidden, hide, unhide, toggleHidden, hiddenList,
  decorate, visible, stats, unreadCount, reset
};
