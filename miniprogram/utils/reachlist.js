/**
 * 知时 · 提醒时间（可演示的"主动找你"闭环）
 * ==========================================
 *
 * 【为什么需要这一层】
 *   push.js 算出"该推谁"，wxnotify.js 负责"真·下发"。
 *   但评审和用户都看不到"时间"——他们只会问一句：
 *     "你说会主动提醒我，凭什么信？"
 *   本层就是回答这个问题的：**把一条通知从'发布'到'截止'的全过程摊在日程上**，
 *   标出"哪一天知时会主动找你、找你几次、每次说什么"。
 *
 *   它不产生新数据，完全由真实条目（发布日 + 截止日 + 受众 + 订阅提前量）算出，
 *   所以：**能推演、能复核、可离线跑** —— 断网答辩也能演示。
 *
 * 【三条硬规则（与 push.js/notify 口径完全一致，避免"说一套做一套"）】
 *   1. 只有命中用户身份或订阅类别的条目，才会进入"会找你"的行；
 *   2. 提醒日 = 截止日往前推 advance 里的每一档，且不早于发布日（发布前不可能提醒）；
 *   3. 已过期的不再规划任何提醒（避免"教人去赶一个已经关了的门"）。
 */

const store = require('./store.js');
const push = require('./push.js');
const wxnotify = require('./wxnotify.js');

/* 提前量字符串 → 天数数组，如 '3,1' → [3,1] */
function advanceDays(key) {
  const s = String(key || '3,1');
  const arr = s.split(',')
    .map(x => parseInt(String(x).replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n) && n > 0);
  const uniq = [];
  arr.forEach(n => { if (uniq.indexOf(n) < 0) uniq.push(n); });
  return uniq.sort((a, b) => b - a); // 由远及近
}

/* 'YYYY-MM-DD' / Date / 时间戳 → Date（取当天 00:00） */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtMD(d) {
  if (!d) return '';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 为一条通知规划"触达计划"。
 * @returns {{id, title, source, deadline, publish, daysLeft, plan:[{date, daysBefore, kind, text}], expired}}
 */
function planFor(n, userAdvance) {
  const deadline = toDate(n.deadline);
  const publish = toDate(n.publishDate || n.publish || n.date);
  const t = today();
  const daysLeft = deadline ? Math.round((deadline - t) / 86400000) : null;
  const expired = daysLeft !== null && daysLeft < 0;

  const plan = [];
  if (deadline && !expired) {
    const adv = advanceDays(userAdvance);
    adv.forEach(db => {
      let when = addDays(deadline, -db);
      // 规则 2：发布之前不可能提醒 → 不早于发布日
      if (publish && when < publish) when = publish;
      const kind = db <= 1 ? 'urgent' : (db <= 3 ? 'hot' : 'soon');
      plan.push({
        date: when,
        dateText: fmtMD(when),
        daysBefore: db,
        kind,
        text: db <= 1
          ? '「' + n.title + '」明天截止，最后一天了'
          : '「' + n.title + '」还有 ' + db + ' 天截止'
      });
    });
    // 同日去重（发布晚于提醒日时会挤到同一天）
    const seen = {};
    const dedup = [];
    plan.forEach(p => {
      const k = p.date.getTime();
      if (seen[k]) return;
      seen[k] = 1;
      dedup.push(p);
    });
    // 只保留"今天及以后"的提醒（过去的已经发生过了）
    dedup.sort((a, b) => a.date - b.date);
    dedup.forEach(p => { if (p.date >= t) plan.push(p); });
  }

  return {
    id: n.id,
    title: n.title,
    source: n.source,
    site: n.site || '',
    deadline,
    deadlineText: deadline ? fmtMD(deadline) : '无明确截止',
    publish,
    publishText: publish ? fmtMD(publish) : '',
    daysLeft,
    expired,
    plan
  };
}

/**
 * 全池提醒时间：只统计"会找我"的条目（命中身份/订阅），按首次提醒日排序。
 * @returns {{rows, upcoming, stats}}
 */
function build(profile, opt) {
  const o = opt || {};
  const limit = o.limit || 40;
  const p = profile || store.getProfile();
  const st = wxnotify.readState();
  const advKey = o.advance || st.advance || (p && p.advance) || '3,1';

  const all = store.allNotices() || [];
  const t = today();

  /* 只取"与我有关"的：命中身份 / 订阅标签 / 自定关键词任一 */
  const mine = all.filter(n => {
    if (!n || n.real === false && o.realOnly) return false;
    try {
      if (push.shouldNotifyNow) {
        // 用 push 的"是否与我有关"逻辑：有推送理由即算相关
        const rs = push.reasonsFor(n, p);
        if (rs && rs.length) return true;
      }
    } catch (e) {}
    try {
      return store.isRelevant ? store.isRelevant(n, p) : true;
    } catch (e) {
      return true;
    }
  });

  const rows = [];
  mine.forEach(n => {
    const row = planFor(n, advKey);
    if (row.expired) return;              // 规则 3：过期的不再规划
    if (!row.plan.length) return;         // 无截止 → 无提醒计划（但仍会进流，见 push）
    row.first = row.plan[0];
    row.count = row.plan.length;
    rows.push(row);
  });

  /* 排序：先按首次提醒日升序，同日按剩余天数升序（更急的在前） */
  rows.sort((a, b) => {
    const d = a.first.date - b.first.date;
    if (d !== 0) return d;
    return (a.daysLeft || 9999) - (b.daysLeft || 9999);
  });

  /* 未来 14 天内会被打扰的 */
  const horizon = addDays(t, 14);
  const upcoming = rows.filter(r => r.first.date <= horizon);

  /* 按天归组（给页面画时间线） */
  const byDay = [];
  const dayMap = {};
  upcoming.forEach(r => {
    const k = r.first.date.getTime();
    if (!dayMap[k]) {
      dayMap[k] = { date: r.first.date, dateText: fmtMD(r.first.date), items: [] };
      byDay.push(dayMap[k]);
    }
    dayMap[k].items.push(r);
  });
  byDay.sort((a, b) => a.date - b.date);

  const totalReminders = upcoming.reduce((s, r) => s + r.count, 0);

  return {
    rows: rows.slice(0, limit),
    upcoming,
    byDay,
    stats: {
      mine: mine.length,
      scheduled: rows.length,
      upcoming: upcoming.length,
      totalReminders,
      advanceText: wxnotify.advanceText(advKey),
      advanceKey: advKey,
      demo: wxnotify.isDemo()
    },
    advanceKey: advKey
  };
}

module.exports = {
  advanceDays,
  planFor,
  build,
  fmtMD,
  toDate,
  addDays
};
