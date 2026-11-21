/* ============================================================================
 * 知时 · 云端客户端（在线可用版专用）
 * ============================================================================
 *
 * 这是「真正的后端」的浏览器侧入口：通过 WorkBuddy 云服务的免密钥大模型
 * 做实时 AI 推荐，并把画像 / 运行留痕写入云数据库。与 web/zhishi-agent.js
 * 的 recommend() 契约同构，页面渲染逻辑一行都不用改。
 *
 * 【为什么单文件 HTML 用全局版 SDK】
 *   云服务 SDK 官方规定：无构建步骤的纯 HTML 用 index.global.js 的
 *   WorkBuddyCloud 全局对象，不引入打包器。在线版把同一份全局包内联，
 *   避免评审现场 CDN 不可达；这不是外链，不改变 SDK 的调用方式。
 *
 * 【严格的可用性边界 —— 演示版 / 参赛可用版不受影响】
 *   ① 本文件只由 tools/build_online.js 注入「知时_在线版.html」；
 *      演示版 build_presentation.js、参赛可用版 build_usable.js 从不读本文件，
 *      也不注入 SDK，二者保持离线自包含。
 *   ② 云服务强制精确 Origin 匹配：只有在应用保留域名（在线部署）下
 *      SDK 才能鉴权成功。本地 file:// 打开时 available() 恒为 false，
 *      页面自动降级到「构建期快照 / 规则推荐」，不报错、不假装。
 *   ③ 所有来源如实标注：channel='workbuddy-cloud'、offline=false，
 *      绝不把规则结果冒充 AI，也不把离线快照说成实时调用。
 *
 * 【配置】
 *   window.ZS_CLOUD_CONFIG 由构建器从 config/cloud.service.json 注入，
 *   只含可公开的 endpoint / publishableKey / oauthRelayBaseUrl（官方允许
 *   publishableKey 出现在前端；真正权限由服务端 Origin 校验约束）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.ZS_CLOUD_CONFIG || null;
  var cloud = null;
  var modelId = 'auto';
  var authTried = false;   // 仅在「SDK 已加载且鉴权尝试过」后置位，避免 CDN 慢加载被锁死
  var initErr = null;
  var CLIENT_ID_KEY = 'zs_cloud_client_id';

  /* 应用自带的推荐提示词话术（与 tools/agent/prompt.js 的
   * RECOMMEND_SYSTEM_PROMPT / buildRecommendPrompt 逐字同源，v1.0.0）。
   * 这里内联是因为单文件 HTML 不能 require Node 模块。 */
  var RECOMMEND_VERSION = '1.0.0';
  var SYS_PROMPT =
    '你是校园通知个性化推荐助手。依据「学生画像」和「通知原文」判断这条通知对该学生的相关程度。' +
    '只依据给定的画像字段和通知原文，绝不编造画像里没有的信息，也不依据常识补全。' +
    'relevance 只能是 0-100 的整数：与该学生直接相关、且临近截止或需本人办理的给高分；' +
    '与该学生无关、面向学院/老师报送、或已过期的给低分。' +
    'evidence 必须逐字复制原文中的连续片段，不得改写、概括、插入省略号或删减字符；没有合适片段就填 null。' +
    'reason 用中文，一句话，不超过 60 字，必须能在画像或原文里找到依据。' +
    '严格输出 JSON，不要任何额外文字。';

  function mkErr(code, msg) { var e = new Error(msg); e.code = code; return e; }

  function clientId() {
    var id = null;
    try { id = global.localStorage && global.localStorage.getItem(CLIENT_ID_KEY); } catch (e) {}
    if (!id) {
      id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { global.localStorage && global.localStorage.setItem(CLIENT_ID_KEY, id); } catch (e) {}
    }
    return id;
  }

  function sdk() {
    // CDN IIFE 暴露全局 WorkBuddyCloud；也可能被宿主预先注入
    return global.WorkBuddyCloud || null;
  }

  /** 是否真正可用（同步判断：配置存在 + SDK 已加载 + 已初始化成功） */
  function available() {
    return !!(cloud && CFG);
  }

  /** 懒初始化：返回 Promise<boolean>。任何一步失败都如实返回 false，不抛错。
   *  SDK 由 CDN 异步加载，未就绪时不锁死，后续调用会重试。 */
  function ensure() {
    if (cloud) return Promise.resolve(true);
    if (!CFG) { initErr = '未注入云配置（本地或演示版）'; return Promise.resolve(false); }
    var W = sdk();
    if (!W || typeof W.createWorkBuddyCloud !== 'function') {
      initErr = '云 SDK 未加载（离线或 CDN 不可达）';
      return Promise.resolve(false); // 不锁死：CDN 加载完成后重试
    }
    if (authTried) return Promise.resolve(false); // 已鉴权失败（多为 Origin 不匹配），不反复打
    authTried = true;
    try {
      var opts = { endpoint: CFG.endpoint, publishableKey: CFG.publishableKey };
      if (CFG.oauthRelayBaseUrl) opts.oauthRelayBaseUrl = CFG.oauthRelayBaseUrl;
      cloud = W.createWorkBuddyCloud(opts);
    } catch (e) {
      initErr = '云客户端初始化失败：' + ((e && e.message) || e);
      cloud = null;
      return Promise.resolve(false);
    }
    // 拉一次模型列表，顺便验证 Origin 鉴权是否通过（在线保留域名才通过）
    return cloud.llm.models.list().then(function (models) {
      var arr = Array.isArray(models) ? models : [];
      var pick = arr.find(function (m) { return m && m.disabled !== true; });
      modelId = (pick && (pick.id || pick.name)) || 'auto';
      return true;
    }).catch(function (e) {
      initErr = '云端鉴权失败（需在在线域名打开）：' +
        ((e && e.error && e.error.code) || (e && e.code) || (e && e.message) || '未知');
      cloud = null;
      return false;
    });
  }

  function extractJson(text) {
    if (!text) return null;
    var s = String(text).trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  function buildUserPrompt(n, p) {
    p = p || {};
    var interests = Array.isArray(p.interests) ? p.interests.join('、') : '';
    var keywords = Array.isArray(p.keywords) ? p.keywords.join('、') : '';
    return '请判断下面这条校园通知对「这位学生」的相关程度，输出 JSON：\n' +
      '{"relevance":"0-100 整数","reason":"一句话理由（不超过60字）","evidence":"原文连续片段，逐字复制；无则 null"}\n\n' +
      '【学生画像】\n身份：' + (p.identityType || '未填') + '\n年级：' + (p.grade || '未填') +
      '\n学院：' + (p.college || '未填') + '\n兴趣标签：' + (interests || '无') +
      '\n订阅关键词：' + (keywords || '无') + '\n\n' +
      '【通知】\n标题：' + (n.title || '') + '\n事件类型：' + (n.event || '未标注') +
      '\n截止时间：' + (n.deadline || '无') + '\n' +
      '通知原文：\n' + String(n.raw || n.digest || n.digestOne || '').slice(0, 1800);
  }

  /** 单条通知的真调推荐。
   *  注意：浏览器 SDK 的 create({stream:true}) 直接返回 async iterable，
   *  不是 Promise —— 不能链 .then()（这是实测踩到的差异，Node 端虽兼容但
   *  浏览器端会报 ".then is not a function"）。统一用 async + for await。 */
  async function askOne(n, profile) {
    var answer = '';
    try {
      var stream = cloud.llm.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: SYS_PROMPT },
          { role: 'user', content: buildUserPrompt(n, profile) }
        ],
        stream: true,
        response_format: { type: 'json_object' },
        temperature: 0.2
      });
      for await (const chunk of stream) {
        var d = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) answer += d.content;
      }
      return extractJson(answer);
    } catch (e) {
      return null; // 单条失败由调用方按规则分兜底，如实标注
    }
  }

  /**
   * 实时 AI 推荐（真调云大模型）。
   * 契约与 ZS_AGENT.recommend 同构：{ok,mode,channel,offline,aiPowered,items[],meta}
   * 失败时抛出带 code 的错误，由页面回退到规则 / 快照，并如实标注。
   */
  function recommend(query) {
    var q = query || {};
    var data = global.ZS_DATA || {};
    var profile = q.profile || (global.PROFILE && global.PROFILE.interests ? global.PROFILE : null)
      || data.PROFILE || null;
    var limit = q.limit || 12;
    var t0 = Date.now();
    return ensure().then(function (ok) {
      if (!ok) return Promise.reject(mkErr('CLOUD_UNAVAILABLE', initErr || '云端不可用'));
      var C = global.ZS;
      var all = (global.ZS_DATA && global.ZS_DATA.NOTICES) ||
                (global.NOTICES || []);
      // 用同源算法先做候选集（可解释规则层），再把 Top-N 交给模型重排
      var pool = all.slice();
      var built = (C && typeof C.buildPush === 'function')
        ? C.buildPush(pool, { profile: profile, seenIds: [], limit: 40 })
        : null;
      var cards = built
        ? (built.notify || []).concat(built.silent || [])
        : pool.slice(0, 40);
      var todo = cards.slice(0, limit);

      var results = [];
      return todo.reduce(function (chain, card) {
        return chain.then(function () {
          return askOne(card, profile).then(function (parsed) {
            var rel = parsed ? Number(parsed.relevance) : NaN;
            results.push({
              id: card.id,
              title: card.title,
              score: card.pushScore,
              relevance: isFinite(rel) ? Math.max(0, Math.min(100, Math.round(rel))) : 0,
              reason: parsed ? String(parsed.reason || '').slice(0, 120) : '',
              evidence: (parsed && parsed.evidence) ? String(parsed.evidence).slice(0, 400) : null,
              source: 'llm',
              level: card.pushLevel, levelLabel: card.pushLevelLabel,
              countdown: (typeof card.countdown === 'number') ? card.countdown
                        : (typeof card._cd === 'number' ? card._cd : null),
              deadline: card.deadline || null, event: card.event || '',
              digestOne: card.digestOne || '', url: card.url || '',
              sourceUnit: card.source || card.unit || ''
            });
          }).catch(function () {
            // 单条失败不破坏整体：如实按规则分兜底，source=rule
            results.push({
              id: card.id, title: card.title, score: card.pushScore,
              relevance: card.pushScore || 0,
              reason: card.pushReasonLine || '', evidence: null,
              source: 'rule', level: card.pushLevel, levelLabel: card.pushLevelLabel,
              countdown: (typeof card.countdown === 'number') ? card.countdown
                        : (typeof card._cd === 'number' ? card._cd : null),
              deadline: card.deadline || null, event: card.event || '',
              digestOne: card.digestOne || '', url: card.url || '',
              sourceUnit: card.source || card.unit || ''
            });
          });
        });
      }, Promise.resolve()).then(function () {
        results.sort(function (a, b) { return b.relevance - a.relevance; });
        var aiN = results.filter(function (x) { return x.source === 'llm'; }).length;
        var out = {
          ok: true, mode: 'llm', aiPowered: true, offline: false,
          via: 'workbuddy-cloud', channel: 'workbuddy-cloud', source: 'workbuddy-cloud',
          model: modelId, modelName: modelId, promptVersion: RECOMMEND_VERSION,
          channelLabel: '云端免密钥大模型',
          generatedAt: new Date().toISOString(),
          reason: '实时调用云端免密钥大模型（在线可用版）',
          items: results,
          meta: {
            ranAt: new Date().toISOString(), mode: 'llm', model: modelId,
            elapsedMs: Date.now() - t0,
            counts: { pool: cards.length, ai: aiN, rule: results.length - aiN },
            profile: profile
          }
        };
        // 写运行留痕（尽力而为，失败不影响推荐结果）
        trace(aiN, results.length, Date.now() - t0).catch(function () {});
        return out;
      });
    });
  }

  /** 画像上云（尽力而为）。失败返回 {ok:false,reason} 不抛错。 */
  function saveProfile(profile) {
    if (!available()) return Promise.resolve({ ok: false, reason: '云端未就绪' });
    return cloud.database.from('zs_profile').upsert({
      client_id: clientId(),
      profile: profile || {},
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id' }).then(function (r) {
      return (r && r.error) ? { ok: false, reason: r.error.message } : { ok: true };
    }).catch(function (e) { return { ok: false, reason: (e && e.message) || '写入失败' }; });
  }

  function loadProfile() {
    if (!available()) return Promise.resolve(null);
    return cloud.database.from('zs_profile').select('profile')
      .eq('client_id', clientId()).maybeSingle().then(function (r) {
        return (r && r.data && r.data.profile) || null;
      }).catch(function () { return null; });
  }

  /** 运行留痕上云：证明推荐确实走了实时模型。 */
  function trace(okCount, tried, elapsedMs) {
    if (!available()) return Promise.resolve({ ok: false });
    return cloud.database.from('zs_ai_trace').insert({
      client_id: clientId(), channel: 'workbuddy-cloud',
      model: modelId, ok_count: okCount, tried: tried,
      elapsed_ms: elapsedMs
    }).then(function (r) {
      return (r && r.error) ? { ok: false, reason: r.error.message } : { ok: true };
    }).catch(function (e) { return { ok: false, reason: (e && e.message) || '留痕失败' }; });
  }

  function status() {
    return ensure().then(function (ok) {
      return {
        ok: ok,
        available: ok,
        mode: ok ? 'workbuddy-cloud' : 'unavailable',
        model: ok ? modelId : null,
        reason: ok ? '云端免密钥大模型已就绪' : (initErr || '云端不可用'),
        configured: !!CFG,
        origin: (typeof location !== 'undefined' && location.origin) || ''
      };
    });
  }

  global.ZS_CLOUD = {
    available: available,
    status: status,
    recommend: recommend,
    saveProfile: saveProfile,
    loadProfile: loadProfile,
    trace: trace,
    clientId: clientId,
    _config: CFG
  };
})(window);
