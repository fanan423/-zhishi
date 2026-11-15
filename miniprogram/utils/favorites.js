/**
 * 知时 · 收藏夹
 * ============
 *
 * 「稍后再说」不该等于「忘掉」。
 * 校园通知的痛点是：看到了、想办、但当时没空，然后就过期了。
 * 收藏夹把「我关心的那几条」钉住，首页/详情页再打开就能看到倒计时。
 *
 * 存本地即可（这是个人偏好，不需要跨端；云端只存订阅画像）。
 */

const KEY = 'zhishi_favorites';

function list() {
  try {
    const a = wx.getStorageSync(KEY);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

function has(id) {
  return list().indexOf(id) >= 0;
}

function add(id) {
  const a = list();
  if (a.indexOf(id) >= 0) return a;
  a.unshift(id);
  wx.setStorageSync(KEY, a.slice(0, 200));
  return list();
}

function remove(id) {
  const a = list().filter(x => x !== id);
  wx.setStorageSync(KEY, a);
  return a;
}

function toggle(id) {
  if (has(id)) { remove(id); return false; }
  add(id);
  return true;
}

function count() {
  return list().length;
}

/**
 * 办事进度：勾掉的步骤存本地，key 是「通知id + 步骤key」。
 * 之所以要落盘，是因为「我办到哪一步了」跨天还得记得住——否则收藏夹等于白存。
 */
const DONE_KEY = 'zhishi_fav_steps';

function doneMap() {
  try {
    const m = wx.getStorageSync(DONE_KEY);
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  } catch (e) { return {}; }
}

function isStepDone(id, stepKey) {
  return !!doneMap()[id + '::' + stepKey];
}

function toggleStep(id, stepKey) {
  const m = doneMap();
  const k = id + '::' + stepKey;
  if (m[k]) delete m[k]; else m[k] = 1;
  try { wx.setStorageSync(DONE_KEY, m); } catch (e) {}
  return !!m[k];
}

/* 撤销收藏时把该条的办事进度一并清掉，避免残留串到别的通知上 */
function clearSteps(id) {
  const m = doneMap();
  let changed = false;
  Object.keys(m).forEach(k => {
    if (k.indexOf(id + '::') === 0) { delete m[k]; changed = true; }
  });
  if (changed) { try { wx.setStorageSync(DONE_KEY, m); } catch (e) {} }
}

module.exports = { list, has, add, remove, toggle, count, isStepDone, toggleStep, clearSteps, doneMap };
