/**
 * 知时 · 微信订阅消息层（真·触达）
 * ================================
 *
 * 【这一层解决什么】
 *   应用内推送（push.js）只在"你打开小程序"时才工作 —— 它本质还是"你来找它"。
 *   痛点「信息到达不了该看到的人手上」，要真正解掉，必须让消息**在你不开小程序时也能到**。
 *   微信生态里唯一合规则的原生通道就是：**订阅消息（SubscribeMessage）**。
 *
 *   所以本层三件事，一件都不能少：
 *     ① 授权 —— 用 wx.requestSubscribeMessage 拿到用户的一次性/长期订阅授权（这是合规前提，必须用户主动点）
 *     ② 登记 —— 把"这个用户订了哪几类、愿意在多早之前被提醒"写到云端（服务端据此下发）
 *     ③ 回执 —— 记录每次授权/下发的状态，页面能如实显示"到底能不能推到你"
 *
 * 【合规声明】
 *   - 绝不静默订阅：必须由用户点按钮触发 requestSubscribeMessage；
 *   - 授权失败 / 用户拒绝 / 模板未配置，一律如实降级为"仅应用内推送"，不假装能推；
 *   - 本层不读取任何私域数据，只登记身份标签 + 订阅类别 + 提前量。
 *
 * 【真机 vs 演示】
 *   订阅消息需要「小程序后台配置模板 ID」+「服务端下发」两个前提。
 *   本层把两个前提都写成可注入的适配器：
 *     - 有云端（cloud 可用）→ 走真登记，模板 ID 从 TEMPLATES 取；
 *     - 未配置模板 ID → 走"演示模式"：依然完整走一遍授权交互与登记入库，
 *       但在页面上**明确标注"演示模式 · 待配置模板后自动转真"**，绝不冒充已通。
 */

const store = require('./store.js');

/* ============================================================
 * 订阅类别 → 微信订阅消息模板
 * ------------------------------------------------------------
 * tmplId 留空 = 尚未在小程序后台申请该模板。
 * 上线前到「微信公众平台 → 订阅消息」申请"截止提醒/新通知提醒"模板，
 * 把模板 ID 填进来即可，**本文件之外一行代码都不用改**。
 * ============================================================ */
const TEMPLATES = {
  deadline:  { tmplId: '', name: '截止提醒', scene: '你订阅的事项临近截止时提醒', fields: ['事项名称', '截止时间', '剩余天数'] },
  newnotice: { tmplId: '', name: '新通知提醒', scene: '命中你关注类别的新通知出现时提醒', fields: ['通知标题', '发布时间', '来源'] },
  weekly:    { tmplId: '', name: '每周简报', scene: '每周汇总本周与你相关的通知', fields: ['本周事项数', '最紧急一项', '截止日'] }
};

/* 用户可选的"提前几天提醒"（与 push.js 的 advance 口径一致） */
const ADVANCE_OPTIONS = [
  { key: '7,3,1', label: '截止前 7 / 3 / 1 天', desc: '最稳，三次提醒几乎不会错过' },
  { key: '3,1',   label: '截止前 3 / 1 天',      desc: '推荐，不吵也不漏' },
  { key: '1',     label: '仅截止前 1 天',        desc: '最少打扰，适合已经常看的人' }
];

const STATE_KEY = 'zhishi_wxnotify_state';

/* ============================================================
 * 授权与登记状态（本地留痕，供页面如实显示）
 * ============================================================ */
function readState() {
  try {
    const s = wx.getStorageSync(STATE_KEY);
    if (s && typeof s === 'object') return s;
  } catch (e) {}
  return {
    granted: false,        // 是否拿到过授权（至少一次）
    subscribeCount: 0,     // 累计授权次数
    lastAt: 0,             // 最近一次授权时间
    advance: '3,1',        // 提前量
    types: [],             // 已授权的类别 key，如 ['deadline','newnotice']
    sends: 0,              // 服务端下发次数（云服务回执累加）
    lastSendAt: 0,
    demo: true             // 是否处于演示模式（模板 ID 未配置）
  };
}

function writeState(s) {
  try { wx.setStorageSync(STATE_KEY, s); } catch (e) {}
}

/* ============================================================
 * 平台能力探测
 * ============================================================ */
function apiReady() {
  return typeof wx !== 'undefined'
    && typeof wx.requestSubscribeMessage === 'function';
}

/** 有模板 ID 的类别（真·可下发）；空说明还没在后台申请 */
function readyTemplates() {
  const out = [];
  Object.keys(TEMPLATES).forEach(k => {
    if (TEMPLATES[k].tmplId) out.push({ key: k, tmplId: TEMPLATES[k].tmplId, name: TEMPLATES[k].name });
  });
  return out;
}

/** 当前是否只能走演示模式（无平台 API 或无模板 ID） */
function isDemo() {
  return !apiReady() || readyTemplates().length === 0;
}

/* ============================================================
 * ① 授权：请求微信订阅消息授权
 * ------------------------------------------------------------
 * 必须由用户点击触发（wx.requestSubscribeMessage 的硬性要求）。
 * @param {string[]} typeKeys 想订阅的类别，如 ['deadline','newnotice']
 * @returns {Promise<{ok, granted:string[], rejected:string[], demo, reason}>}
 * ============================================================ */
function requestSubscribe(typeKeys) {
  const wanted = (Array.isArray(typeKeys) && typeKeys.length)
    ? typeKeys
    : Object.keys(TEMPLATES);

  return new Promise((resolve) => {
    const st = readState();

    /* 分支 A：演示模式 —— 依然完整走交互，但如实告知 */
    if (isDemo()) {
      const demoGranted = wanted.slice();
      st.granted = true;
      st.types = mergeTypes(st.types, demoGranted);
      st.subscribeCount = (st.subscribeCount || 0) + 1;
      st.lastAt = Date.now();
      st.demo = true;
      writeState(st);
      resolve({
        ok: true,
        granted: demoGranted,
        rejected: [],
        demo: true,
        reason: '演示模式：未配置订阅消息模板 ID，已按完整流程登记授权'
      });
      return;
    }

    /* 分支 B：真机 —— 走 wx.requestSubscribeMessage */
    const tpls = readyTemplates().filter(t => wanted.indexOf(t.key) >= 0);
    if (!tpls.length) {
      resolve({ ok: false, granted: [], rejected: wanted, demo: false, reason: '所选类别暂无可用模板' });
      return;
    }

    const tmplIds = tpls.map(t => t.tmplId);

    // requestSubscribeMessage 单次上限 3 个（微信硬限制），超了要分批
    const batches = [];
    for (let i = 0; i < tmplIds.length; i += 3) batches.push(tmplIds.slice(i, i + 3));

    const grantedAll = [];
    const rejectedAll = [];

    const runBatch = (bi) => {
      if (bi >= batches.length) {
        st.granted = grantedAll.length > 0;
        st.types = mergeTypes(st.types, grantedAll.map(id => idToKey(id)));
        st.subscribeCount = (st.subscribeCount || 0) + 1;
        st.lastAt = Date.now();
        st.demo = false;
        writeState(st);
        resolve({
          ok: grantedAll.length > 0,
          granted: grantedAll.map(id => idToKey(id)),
          rejected: rejectedAll.map(id => idToKey(id)),
          demo: false,
          reason: grantedAll.length ? '订阅成功，服务端将在你订阅的事项临近截止时提醒你'
                                    : '你未开启任何订阅，仍可在小程序内看到全部推送'
        });
        return;
      }
      wx.requestSubscribeMessage({
        tmplIds: batches[bi],
        success: (res) => {
          batches[bi].forEach(id => {
            const v = res[id];
            if (v === 'accept') grantedAll.push(id);
            else rejectedAll.push(id);
          });
          runBatch(bi + 1);
        },
        fail: (err) => {
          batches[bi].forEach(id => rejectedAll.push(id));
          // 一次失败不阻断，继续尝试剩余批次，最后如实汇总
          runBatch(bi + 1);
        }
      });
    };

    runBatch(0);
  });
}

function idToKey(id) {
  const ks = Object.keys(TEMPLATES);
  for (let i = 0; i < ks.length; i++) if (TEMPLATES[ks[i]].tmplId === id) return ks[i];
  return '';
}

function mergeTypes(oldList, addList) {
  const out = Array.isArray(oldList) ? oldList.slice() : [];
  (addList || []).forEach(k => { if (k && out.indexOf(k) < 0) out.push(k); });
  return out;
}

/* ============================================================
 * ② 登记：把"订了哪几类 + 提前几天"写进云端
 * ------------------------------------------------------------
 * 服务端据此定时检查公开通知、临近截止就下发订阅消息。
 * 云端不可用时静默失败 —— 不阻断用户，只把状态标成"仅本地登记"。
 * ============================================================ */
async function registerPlan(profile) {
  const st = readState();
  st.advance = (profile && profile.advance) || st.advance;
  st.types = mergeTypes(st.types, (profile && profile.interests) || []);
  writeState(st);

  /* 云服务可用则真登记 */
  let cloudOk = false;
  try {
    const cloud = require('./cloud.js');
    if (cloud.isCloudReady && cloud.isCloudReady()) {
      // 走 profile 表已足够承载订阅信息（categories/advance），无额外表结构依赖
      const r = await cloud.saveProfile(Object.assign({}, profile, {
        channel: profile.channel || '小程序服务通知'
      }));
      cloudOk = !!(r && r.ok);
    }
  } catch (e) {
    cloudOk = false;
  }

  return { ok: true, cloudOk, demo: isDemo(), state: readState() };
}

/* ============================================================
 * ③ 回执：记录服务端下发（供页面显示"真的推给你了"）
 * ============================================================ */
function noteDelivery(n) {
  const st = readState();
  st.sends = (st.sends || 0) + (n || 1);
  st.lastSendAt = Date.now();
  writeState(st);
  return st;
}

/* ============================================================
 * 页面用的汇总视图
 * ============================================================ */
function summary() {
  const st = readState();
  const demo = isDemo();
  const grantedTypes = (st.types || []).map(k => (TEMPLATES[k] && TEMPLATES[k].name) || k);

  let status, statusTip;
  if (!st.granted) {
    status = '未开启';
    statusTip = '开启后，即使不打开小程序，订阅的事项临近截止也会通过微信服务通知提醒你。';
  } else if (demo) {
    status = '已登记 · 演示模式';
    statusTip = '已完成授权登记流程；待小程序后台配置订阅消息模板后自动转为真实下发，无需你重操作。';
  } else {
    status = '已开启 · 真实下发';
    statusTip = '服务端会在你订阅的事项临近截止时，通过微信服务通知送达。';
  }

  return {
    granted: !!st.granted,
    status,
    statusTip,
    demo,
    types: st.types || [],
    typeNames: grantedTypes,
    advance: st.advance || '3,1',
    subscribeCount: st.subscribeCount || 0,
    sends: st.sends || 0,
    lastAt: st.lastAt || 0,
    lastSendAt: st.lastSendAt || 0,
    apiReady: apiReady(),
    templates: TEMPLATES,
    readyCount: readyTemplates().length
  };
}

/* 提前量 → 人话 */
function advanceText(key) {
  const o = ADVANCE_OPTIONS.find(x => x.key === key);
  return o ? o.label : '截止前 3 / 1 天';
}

module.exports = {
  TEMPLATES,
  ADVANCE_OPTIONS,
  apiReady,
  isDemo,
  readyTemplates,
  requestSubscribe,
  registerPlan,
  noteDelivery,
  summary,
  advanceText,
  readState,
  writeState
};
