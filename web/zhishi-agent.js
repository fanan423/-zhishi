/* ============================================================================
 * 知时 · 智能体客户端（网页侧）
 * ============================================================================
 *
 * 【与小程序侧 miniprogram/utils/agent.js 的关系】
 *   两端的**接口契约完全一致**（digest / notices / status / setBase），
 *   但运行环境不同：
 *     小程序 → 用 wx.request 打服务；未配置时用 miniprogram/utils/* 现算
 *     网页   → 用 fetch 打服务；未配置时用 window.ZS_CORE 现算
 *   这里不强行共享一份代码，是因为两端的"本地现算"调用的库本就不同
 *   （小程序是 require('utils/store.js')，网页是 window.ZS_CORE），
 *   强行同源反而要造一层适配，不如让契约同源、实现各自贴合环境 ——
 *   这也是 check_parity.py 只守"算法常量"而不守"客户端实现"的原因。
 *
 * 【降级策略（同小程序）】
 *   服务可达 → 用它（结论权威、含真实 LLM 理解）
 *   服务不可达 / 没配 → 用 ZS_CORE 本地现算（页面一行都不用改）
 *
 * 【合规】
 *   只把公开通知 + 用户自填画像发给服务；不发送任何私域数据。
 *
 * 【配置】
 *   默认空 = 本地模式（开箱即用）。
 *   可在「我的 → 智能体服务」里运行时填地址（写 localStorage，免发版）。
 *   也可在页面脚本加载前设 window.ZS_AGENT_BASE = 'https://...' 强制指定。
 * ========================================================================== */
(function (global) {
  'use strict';

  var LS_KEY = 'zs_agent_base';
  var TIMEOUT_MS = 20000;
  var PROBE_TTL = 30000;

  /* ---------- 配置解析（三级：window 常量 > localStorage > 空） ---------- */
  function resolveBase() {
    try {
      if (global.ZS_AGENT_BASE) return String(global.ZS_AGENT_BASE).trim();
    } catch (e) { /* ignore */ }
    try {
      var s = global.localStorage && global.localStorage.getItem(LS_KEY);
      if (s) return String(s).trim();
    } catch (e) { /* ignore */ }
    return '';
  }

  function setBase(base) {
    var v = base ? String(base).trim().replace(/\/+$/, '') : '';
    try { global.localStorage && global.localStorage.setItem(LS_KEY, v); } catch (e) { /* ignore */ }
    try { global.ZS_AGENT_BASE = v; } catch (e) { /* ignore */ }
    _probe = null;
    return v;
  }

  function isConfigured() { return !!resolveBase(); }

  /* ---------- 通用请求（fetch + 超时 + 错误归一） ---------- */
  function request(method, path, data) {
    var base = resolveBase();
    if (!base) return Promise.reject(mkErr('AGENT_BASE_EMPTY', '未配置智能体服务地址'));

    /* 环境无 fetch（老浏览器 / 某些 file:// webview）→ 直接如实拒绝，
     * 让上层降级到本地算法，而不是抛 ReferenceError 把整块炸掉。
     * 这是真实踩到的：jsdom 与部分内嵌 WebView 都没有 fetch。 */
    if (typeof global.fetch !== 'function') {
      return Promise.reject(mkErr('FETCH_UNAVAILABLE', '当前环境不支持 fetch，无法连接智能体服务'));
    }

    var url = base.replace(/\/+$/, '') + path;

    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data !== undefined && data !== null && method !== 'GET') {
      opts.body = JSON.stringify(data);
    }

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, TIMEOUT_MS);

    return global.fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
        if (res.ok) return body;
        var e = mkErr(
          (body && body.error && body.error.code) || ('HTTP_' + res.status),
          (body && body.error && body.error.message) || ('HTTP ' + res.status)
        );
        e.status = res.status;
        e.hint = body && body.error && body.error.hint;
        throw e;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.code) throw err;   // 已经是归一过的错误
      throw mkErr('NETWORK_ERROR', (err && err.message) || '网络请求失败');
    });
  }

  function mkErr(code, msg) {
    var e = new Error(msg);
    e.code = code;
    return e;
  }

  /* ============================================================
   * 本地实现：用 window.ZS_CORE 现算（与小程序 push.js 同源算法）
   * 输出结构与远端同构，页面不用改。
   * ============================================================ */
  /* web/zhishi-core.js 导出在 window.ZS（见该文件末尾 global.ZS = {...}）。
   * 同时兼容 ZS_CORE / ZS_ALGO 别名，避免因改名而挂。 */
  function core() {
    var C = global.ZS || global.ZS_CORE || global.ZS_ALGO;
    if (!C) throw mkErr('CORE_MISSING', '同源算法库（window.ZS）未加载');
    return C;
  }

  function localProfile() {
    var C = core();
    var BR = global.ZS_AGENT_BRIDGE;
    if (BR && typeof BR.profile === 'function') {
      var bp = BR.profile();
      if (bp) return bp;
    }
    var p = (typeof global.PROFILE !== 'undefined' && global.PROFILE) ? global.PROFILE
          : (global.STATE && global.STATE.profile) ? global.STATE.profile
          : { interests: C.TAGS.slice(0, 4).map(function (t) { return t.key; }) };
    return p;
  }

  function localNotices() {
    var BR = global.ZS_AGENT_BRIDGE;
    if (BR && typeof BR.notices === 'function') {
      var bn = BR.notices();
      if (bn && bn.length) return bn;
    }
    if (global.NOTICES && global.NOTICES.length) return global.NOTICES;
    if (global.ZS_DATA && global.ZS_DATA.NOTICES) return global.ZS_DATA.NOTICES;
    return [];
  }

  var localImpl = {
    name: 'local',

    digest: function () {
      var C = core();
      var p = localProfile();
      var all = localNotices();

      /* 用与小程序 push.js 完全一样的引擎（buildPush 就是两端同源那支） */
      var BR = global.ZS_AGENT_BRIDGE;
      var st = (BR && typeof BR.pushState === 'function') ? (BR.pushState() || {}) : {};
      var built = C.buildPush(all, {
        profile: p,
        seenIds: st.pushedIds || [],
        limit: 60
      });
      var toCard = function (c) {
        return {
          id: c.id,
          title: c.title,
          score: c.pushScore,
          level: c.pushLevel,
          levelLabel: c.pushLevelLabel,
          countdown: (typeof c.countdown === 'number') ? c.countdown : (typeof c._cd === 'number' ? c._cd : null),
          deadline: c.deadline || null,
          source: c.source || c.unit || '',
          site: c.site || '',
          url: c.url || '',
          reasonLine: c.pushReasonLine || '',
          reasons: (c.pushReasons || []).map(function (r) { return r.label || r.code; }),
          isNew: !!c.isNew,
          event: c.event || '',
          digestOne: c.digestOne || '',
          llm: null
        };
      };

      return Promise.resolve({
        ok: true,
        source: 'local',
        via: 'local',
        meta: {
          ranAt: new Date().toISOString(),
          mode: 'rule',
          model: null,
          elapsedMs: 0,
          summaryLine: built.summary && built.summary.line,
          summaryTone: built.summary && built.summary.tone,
          counts: {
            matched: built.cards.length,
            cards: built.cards.length,
            notify: built.notify.length,
            silent: built.silent.length
          },
          profile: p
        },
        notify: built.notify.map(toCard),
        silent: built.silent.map(toCard)
      });
    },

    /* AI 推荐：本地模式优先读「构建期 AI 快照」（断网也能展示模型结果，但如实标
     * offline / 非实时调用）；无快照则如实降级为规则推荐，绝不假装调了模型。 */
    recommend: function (query) {
      var C = core();
      var p = localProfile();
      var all = localNotices();
      var BR = global.ZS_AGENT_BRIDGE;
      var st = (BR && typeof BR.pushState === 'function') ? (BR.pushState() || {}) : {};
      var built = C.buildPush(all, { profile: p, seenIds: st.pushedIds || [], limit: 60 });
      var cards = (built.notify || []).concat(built.silent || []);
      var limit = (query && query.limit) || 12;
      var picked = cards.slice(0, limit);

      function itemOf(c, ai) {
        return {
          id: c.id, title: c.title,
          score: c.pushScore,
          relevance: ai ? ai.relevance : c.pushScore,
          reason: ai ? (ai.reason || '') : (c.pushReasonLine || ''),
          evidence: ai ? (ai.evidence || null) : null,
          source: ai ? 'llm' : 'rule',
          level: c.pushLevel, levelLabel: c.pushLevelLabel,
          countdown: (typeof c.countdown === 'number') ? c.countdown
                    : (typeof c._cd === 'number' ? c._cd : null),
          deadline: c.deadline || null, event: c.event || '',
          digestOne: c.digestOne || '', url: c.url || '',
          sourceUnit: c.source || c.unit || ''
        };
      }

      var snap = global.ZS_AI;
      if (snap && snap.mode === 'llm' && snap.items && snap.items.length) {
        var byId = {};
        snap.items.forEach(function (x) {
          if (x && x.id && x.ok !== false) byId[String(x.id)] = x;
        });
        /* 对全部卡片匹配快照后按模型分重排 —— 让 AI 真正改变顺序，
         * 而不是只给规则前 N 条换个说法。 */
        var aiItems = cards.map(function (c) { return itemOf(c, byId[String(c.id)] || null); });
        aiItems.sort(function (a, b) { return b.relevance - a.relevance; });
        aiItems = aiItems.slice(0, limit);
        var aiN = aiItems.filter(function (x) { return x.source === 'llm'; }).length;
        return Promise.resolve({
          ok: true, source: 'offline-snapshot', via: 'offline-snapshot',
          mode: 'llm', aiPowered: true, offline: true,
          model: snap.model || null, modelName: snap.modelName || null,
          promptVersion: snap.promptVersion || null, generatedAt: snap.generatedAt || null,
          reason: '构建期大模型预计算结果（非实时调用）',
          items: aiItems,
          meta: {
            ranAt: snap.generatedAt || new Date().toISOString(),
            mode: 'llm', model: snap.model || null, elapsedMs: 0,
            counts: { pool: cards.length, ai: aiN, rule: aiItems.length - aiN },
            profile: p, summaryLine: built.summary && built.summary.line
          }
        });
      }

      return Promise.resolve({
        ok: true, source: 'local', via: 'local',
        mode: 'rule', aiPowered: false, offline: false,
        model: null, promptVersion: null,
        reason: '本地模式不调用大模型（未部署智能体服务）',
        items: picked.map(function (c) { return itemOf(c, null); }),
        meta: {
          ranAt: new Date().toISOString(), mode: 'rule', model: null, elapsedMs: 0,
          counts: { pool: cards.length, ai: 0, rule: picked.length },
          profile: p, summaryLine: built.summary && built.summary.line
        }
      });
    },

    notices: function (query) {
      var list = localNotices().slice();
      var q = (query && query.q) || '';
      if (q) {
        var low = String(q).toLowerCase();
        list = list.filter(function (n) {
          return (n.title || '').toLowerCase().indexOf(low) >= 0;
        });
      }
      var limit = (query && query.limit) || 50;
      return Promise.resolve({ ok: true, source: 'local', total: list.length, items: list.slice(0, limit) });
    },

    health: function () {
      return Promise.resolve({ ok: true, status: 'local-only', cloud: false });
    }
  };

  /* ============================================================
   * 远端实现：调 tools/agent/server.js
   * ============================================================ */
  var remoteImpl = {
    name: 'remote',

    digest: function (query) {
      var useLLM = (query && query.useLLM) ? 'true' : 'false';
      return request('GET', '/api/digest?useLLM=' + useLLM).then(function (r) {
        return Object.assign({}, r, { via: 'remote' });
      });
    },

    notices: function (query) {
      var qs = [];
      if (query && query.q) qs.push('q=' + encodeURIComponent(query.q));
      if (query && query.limit) qs.push('limit=' + query.limit);
      if (query && query.event) qs.push('event=' + encodeURIComponent(query.event));
      return request('GET', '/api/notices' + (qs.length ? '?' + qs.join('&') : '')).then(function (r) {
        return Object.assign({}, r, { via: 'remote' });
      });
    },

    recommend: function (query) {
      var q = query || {};
      return request('POST', '/api/recommend', {
        useLLM: q.useLLM !== false,
        limit: q.limit || 12,
        profile: q.profile || undefined
      }).then(function (r) { return Object.assign({}, r, { via: 'remote' }); });
    },

    understand: function (idOrNotice, useLLM) {
      var body = (typeof idOrNotice === 'string') ? { id: idOrNotice } : { notice: idOrNotice };
      body.useLLM = useLLM !== false;
      return request('POST', '/api/understand', body);
    },

    health: function () { return request('GET', '/readyz'); },
    version: function () { return request('GET', '/api/version'); },
    run: function (patch) { return request('POST', '/api/run', { profile: patch, useLLM: false }); },
    saveProfile: function (profile) { return request('PUT', '/api/profile', { profile: profile }); }
  };

  /* ============================================================
   * 择路（探测 + 30s 缓存）
   * ============================================================ */
  var _probe = null;

  function resolveImpl(force) {
    if (!isConfigured()) {
      return Promise.resolve({ reachable: false, impl: localImpl, mode: 'local' });
    }
    if (!force && _probe && (Date.now() - _probe.at) < PROBE_TTL) {
      return Promise.resolve({
        reachable: _probe.reachable,
        impl: _probe.reachable ? remoteImpl : localImpl,
        mode: _probe.reachable ? 'remote' : 'local',
        error: _probe.error
      });
    }
    return request('GET', '/healthz').then(function () {
      _probe = { at: Date.now(), reachable: true, error: null };
      return { reachable: true, impl: remoteImpl, mode: 'remote' };
    }).catch(function (e) {
      _probe = { at: Date.now(), reachable: false, error: e.message };
      return { reachable: false, impl: localImpl, mode: 'local', error: e.message };
    });
  }

  /* ============================================================
   * 对外统一接口（与小程序 agent.js 同名同义）
   * ============================================================ */

  /** 今日主动送达清单（页面主入口） */
  function digest(query) {
    return resolveImpl().then(function (r) {
      return r.impl.digest(query).then(function (out) {
        var o = Object.assign({ ok: true }, out, { mode: r.mode });
        if (r.mode === 'local' && isConfigured()) {
          o.degraded = true;
          o.degradeReason = r.error || '智能体服务不可达';
        }
        return o;
      }).catch(function (e) {
        /* 远端偶发失败 → 降级本地，并如实标注 */
        return localImpl.digest(query).then(function (lr) {
          return Object.assign(lr, { mode: 'local', degraded: true, degradeReason: e.message });
        });
      });
    });
  }

  function notices(query) {
    return resolveImpl().then(function (r) {
      return r.impl.notices(query).catch(function () { return localImpl.notices(query); });
    });
  }

  /** AI 推荐（与 digest 同样的降级语义：远端失败 → 本地规则/离线快照） */
  function recommend(query) {
    return resolveImpl().then(function (r) {
      return r.impl.recommend(query).then(function (out) {
        var o = Object.assign({ ok: true }, out);
        if (r.mode === 'local' && isConfigured()) {
          o.degraded = true;
          o.degradeReason = r.error || '智能体服务不可达';
        }
        return o;
      }).catch(function (e) {
        return localImpl.recommend(query).then(function (lr) {
          return Object.assign(lr, {
            degraded: true,
            degradeReason: '远端推荐失败：' + ((e && e.message) || e)
          });
        });
      });
    });
  }

  function understand(idOrNotice, useLLM) {
    return resolveImpl().then(function (r) {
      if (r.mode !== 'remote') {
        return { ok: true, mode: 'rule', fields: null,
                 reason: '本地模式不调用大模型（未部署智能体服务）' };
      }
      return r.impl.understand(idOrNotice, useLLM).catch(function (e) {
        return { ok: false, mode: 'rule', fields: null,
                 error: { code: e.code || 'REMOTE_ERROR', message: e.message, hint: e.hint } };
      });
    });
  }

  function status() {
    var base = resolveBase();
    var configured = !!base;
    return resolveImpl(configured).then(function (r) {
      var out = {
        configured: configured,
        reachable: r.reachable,
        mode: r.reachable ? 'remote' : 'local',
        base: base || null,
        error: r.error || null,
        ready: null,
        version: null,
        label: !configured ? '本地模式（未部署智能体服务）'
             : r.reachable ? '已连接智能体服务'
             : '服务未连接（已降级本地算法）'
      };
      if (!r.reachable) return out;
      return Promise.all([
        remoteImpl.health().catch(function (e) { return { ok: false, error: e.message }; }),
        remoteImpl.version().catch(function () { return null; })
      ]).then(function (arr) {
        out.ready = arr[0];
        out.version = arr[1];
        return out;
      });
    });
  }

  global.ZS_AGENT = {
    resolveBase: resolveBase,
    setBase: setBase,
    isConfigured: isConfigured,
    resolveImpl: resolveImpl,
    digest: digest,
    recommend: recommend,
    notices: notices,
    understand: understand,
    status: status,
    localImpl: localImpl,
    remoteImpl: remoteImpl
  };
})(window);
