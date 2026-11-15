/**
 * 知时 · 网页版核心逻辑（与小程序同源）
 * =====================================
 *
 * 这个文件是「网页 Demo」和「微信小程序」的**唯一区别所在**：
 *   小程序用 require/module.exports，网页用 window 挂载；
 *   除此之外，标签体系 / 检索 / 溯源 / 分组匹配的**算法完全一致**。
 *
 * 为什么要同源：
 *   评委面前是一套东西，不能"网页版一个样、小程序一个样"。
 *   所以把 miniprogram/utils/ 里那四个文件（tags / search / digest / store）
 *   的核心逻辑抽成这一份，两边各自引用，改一处两边都变。
 *
 * 三个能力的落点（与小程序一一对应）：
 *   ① 主动搜索  → search()
 *   ② 浓缩+出处 → data 里的 digestOne / digestPoints[{text,quote}] + locateQuote()
 *   ③ 标签推送  → matchByTag()
 */
(function (global) {
  'use strict';

  /* ============================================================
   * 一、标签体系（单一事实来源）
   * 与 miniprogram/utils/tags.js 完全一致
   * ============================================================ */
  var TAGS = [
    { key: '转专业',   icon: '🔀', desc: '转专业 / 专业分流',         color: 'blue'  },
    { key: '学科竞赛', icon: '🏆', desc: '各类竞赛报名与提交',         color: 'green' },
    { key: '奖助学金', icon: '💰', desc: '奖学金 / 助学金 / 评优评先', color: 'amber' },
    { key: '考试安排', icon: '📝', desc: '考试时间地点 / 补考缓考',    color: 'red'   },
    { key: '选课',     icon: '📚', desc: '选课 / 退改选 / 学分',       color: 'blue'  },
    { key: '讲座培训', icon: '🎓', desc: '学术报告 / 讲座 / 技能培训', color: 'green' },
    { key: '图书资源', icon: '📖', desc: '图书馆开放 / 数据库 / 借阅', color: 'amber' },
    { key: '学工事务', icon: '🧾', desc: '学籍 / 毕业 / 宿舍 / 心理健康', color: 'gray' },
    { key: '校内通知', icon: '📢', desc: '其他公开通知与公告',         color: 'gray'  }
  ];
  var TAG_KEYS = TAGS.map(function (t) { return t.key; });

  function tagMeta(key) {
    for (var i = 0; i < TAGS.length; i++) {
      if (TAGS[i].key === key) return TAGS[i];
    }
    return { key: key || '校内通知', icon: '📢', desc: '', color: 'gray' };
  }

  /* ============================================================
   * 二、紧急度分级（与 store.levelOf 一致）
   * ============================================================ */
  function levelOf(n) {
    var cd = n.countdown;
    if (typeof cd === 'number') {
      if (cd < 0) return 'lo';
      if (cd <= 3) return 'hi';
      if (cd <= 7) return 'md';
    }
    return n.priority === 'high' ? 'hi' : n.priority === 'medium' ? 'md' : 'lo';
  }

  /**
   * 倒计时实时刷新（与小程序 store.refreshCountdowns 同源）。
   * 打包进数据的 countdown 是编制时刻的定值，日子在前行，必须按 deadline 现算，
   * 否则"今天截止"的条目会顶着过期的"还剩 N 天"，把该今天办的事排到明天。
   */
  function refreshCountdowns(notices) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return (notices || []).map(function (n) {
      var s = String(n.deadline || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return n;
      var d = new Date(s + 'T00:00:00');
      if (isNaN(d.getTime())) return n;
      var cd = Math.round((d - today) / 86400000);
      if (cd === n.countdown) return n;
      var copy = {};
      for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) copy[k] = n[k];
      copy.countdown = cd;
      return copy;
    });
  }

  /* ============================================================
   * 三、检索层（与 utils/search.js 一致）
   * ============================================================ */
  function splitQuery(q) {
    var s = String(q || '').trim();
    if (!s) return [];
    var parts = s.split(/[\s,，、+]+/).filter(Boolean);
    var seen = {}, out = [];
    parts.forEach(function (p) {
      var k = p.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(p); }
    });
    return out;
  }

  function countHit(hay, words) {
    if (!hay) return { n: 0, c: 0 };
    var h = String(hay).toLowerCase();
    var n = 0, c = 0;
    words.forEach(function (w) {
      var wl = w.toLowerCase(), idx = h.indexOf(wl), hit = 0;
      while (idx >= 0) { hit++; idx = h.indexOf(wl, idx + wl.length); }
      if (hit > 0) { n++; c += hit; }
    });
    return { n: n, c: c };
  }

  /* 从原文截出命中上下文 */
  function snippet(raw, words, radius) {
    radius = radius || 60;
    var r = String(raw || '');
    if (!r) return { text: '', hitWords: [] };
    var lower = r.toLowerCase(), best = -1, bestWord = '';
    words.forEach(function (w) {
      var i = lower.indexOf(w.toLowerCase());
      if (i >= 0 && (best < 0 || i < best)) { best = i; bestWord = w; }
    });
    if (best < 0) return { text: r.slice(0, radius * 2), hitWords: [] };
    var start = Math.max(0, best - radius);
    var end = Math.min(r.length, best + bestWord.length + radius);
    return {
      text: r.slice(start, end),
      prefix: start > 0 ? '…' : '',
      suffix: end < r.length ? '…' : '',
      hitWords: words
    };
  }

  /* 高亮切分：返回 [{text, hl}] */
  function highlight(text, words) {
    var s = String(text || '');
    if (!words || !words.length || !s) return [{ text: s, hl: false }];
    var lower = s.toLowerCase(), ranges = [];
    words.forEach(function (w) {
      var wl = w.toLowerCase();
      if (!wl) return;
      var i = lower.indexOf(wl);
      while (i >= 0) { ranges.push([i, i + wl.length]); i = lower.indexOf(wl, i + wl.length); }
    });
    if (!ranges.length) return [{ text: s, hl: false }];
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [], cur = ranges[0];
    for (var i = 1; i < ranges.length; i++) {
      var r = ranges[i];
      if (r[0] <= cur[1]) cur[1] = Math.max(cur[1], r[1]);
      else { merged.push(cur); cur = r; }
    }
    merged.push(cur);
    var segs = [], cursor = 0;
    merged.forEach(function (m) {
      if (m[0] > cursor) segs.push({ text: s.slice(cursor, m[0]), hl: false });
      segs.push({ text: s.slice(m[0], m[1]), hl: true });
      cursor = m[1];
    });
    if (cursor < s.length) segs.push({ text: s.slice(cursor), hl: false });
    return segs;
  }

  /* 主检索：加权排序，结果永远带出处切片 */
  function search(notices, q, opt) {
    opt = opt || {};
    var words = splitQuery(q);
    var tagFilter = opt.tag || '';
    var list = (notices || []).filter(function (n) {
      if (tagFilter && n.event !== tagFilter) return false;
      return true;
    });

    /* 无关键词：退化为按标签/时间浏览 */
    if (words.length === 0) {
      return list.slice()
        .sort(function (a, b) { return String(b.publish).localeCompare(String(a.publish)); })
        .map(function (n) { return decorate(n, [], 0); });
    }

    var scored = [];
    list.forEach(function (n) {
      var t = countHit(n.title, words);
      var one = countHit(n.digestOne, words);
      var pts = countHit((n.points || []).join(' '), words);
      var raw = countHit(n.raw, words);
      var src = countHit(n.source, words);
      var ev = countHit(n.event, words);
      var totalN = t.n + one.n + pts.n + raw.n + src.n + ev.n;
      if (totalN === 0) return;
      /* 加权：标题 10 / 标签 6 / 摘要 5 / 要点 3 / 来源 2 / 原文 1 */
      var score = t.n * 10 + t.c * 2 + ev.n * 6 + one.n * 5 + pts.n * 3 + src.n * 2 + raw.n * 1;
      scored.push({ n: n, score: score, words: words });
    });

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.n.publish).localeCompare(String(a.n.publish));
    });
    return scored.map(function (s) { return decorate(s.n, s.words, s.score); });
  }

  function decorate(n, words, score) {
    var snip = words.length ? snippet(n.raw, words) : null;
    var m = tagMeta(n.event);

    /* 命中来源：告诉用户"为什么这条被搜出来"
       可能的来源：标题 / 标签 / 浓缩 / 要点 / 来源单位 / 原文
       如果标题和原文片段都没有可见命中，必须如实说明是标签命中——
       否则用户会看到一条"没有高亮"的结果，莫名其妙。 */
    var hitInTitle = words.some(function (w) {
      return n.title && n.title.toLowerCase().indexOf(w.toLowerCase()) >= 0;
    });
    var hitInSnippet = snip && words.some(function (w) {
      return snip.text.toLowerCase().indexOf(w.toLowerCase()) >= 0;
    });
    var hitSources = [];
    if (hitInTitle) hitSources.push('标题');
    if (words.some(function (w) { return (n.event || '').indexOf(w) >= 0; })) hitSources.push('标签');
    if (words.some(function (w) { return (n.digestOne || '').indexOf(w) >= 0; })) hitSources.push('浓缩');
    if (words.some(function (w) { return (n.points || []).join(' ').indexOf(w) >= 0; })) hitSources.push('要点');
    if (words.some(function (w) { return (n.source || '').indexOf(w) >= 0; })) hitSources.push('来源单位');
    if (hitInSnippet) hitSources.push('原文');

    return {
      id: n.id,
      title: n.title,
      source: n.source,
      publish: n.publish,
      event: n.event,
      icon: m.icon,
      real: !!n.real,
      raw: !!n.raw,
      digestOne: n.digestOne || '',
      deadline: n.deadline || '',
      countdown: (typeof n.countdown === 'number') ? n.countdown : null,
      level: levelOf(n),
      hitWords: words,
      score: score,
      /* 命中来源（用于"为什么搜到"的说明） */
      hitSources: hitSources,
      hitInTitle: hitInTitle,
      hitInSnippet: !!hitInSnippet,
      /* 需要显式说明命中来源 = 标题和片段都没可见高亮 */
      needExplain: words.length > 0 && !hitInTitle && !hitInSnippet,
      snippet: snip ? snip.text : '',
      snippetPrefix: snip && snip.prefix ? snip.prefix : '',
      snippetSuffix: snip && snip.suffix ? snip.suffix : ''
    };
  }

  /* 搜索热词：优先给"真的搜得到"的词。
   * 传了 notices 时，逐个试搜，命中数 <1 的剔除（避免点了个空词）；
   * 若全不命中（数据不寻常）则退回静态候选，保证永远有点的。 */
  var HOT_WORDS = ['转专业', '奖学金', '竞赛', '考试安排', '讲座', '选课', '图书馆', '招聘'];
  function hotWords(notices) {
    if (!notices || !notices.length || typeof search !== 'function') return HOT_WORDS.slice();
    var live = HOT_WORDS.filter(function (w) {
      try { return search(notices, w, {}).length > 0; } catch (e) { return false; }
    });
    /* 命中太多词（>6）时按池内出现频次取前 6，保持热词条不被挤爆 */
    if (live.length > 6) {
      var scored = live.map(function (w) {
        var n = 0;
        try { n = search(notices, w, {}).length; } catch (e) { n = 0; }
        return { w: w, n: n };
      }).sort(function (a, b) { return b.n - a.n; });
      live = scored.slice(0, 6).map(function (x) { return x.w; });
    }
    return live.length ? live : HOT_WORDS.slice();
  }

  /* ============================================================
   * 四、溯源定位（与 store.locateQuote 一致）
   * 三级兜底：完整匹配 → 去尾省略号 → 去空白 → 前 18 字
   * ============================================================ */
  function locateQuote(raw, quote) {
    if (!raw || !quote) return -1;
    var i = raw.indexOf(quote);
    if (i >= 0) return i;
    var trimmed = quote.replace(/…+$/, '');
    i = raw.indexOf(trimmed);
    if (i >= 0) return i;
    var normRaw = raw.replace(/\s+/g, '');
    var normQ = trimmed.replace(/\s+/g, '');
    if (normQ.length >= 8) {
      var ni = normRaw.indexOf(normQ);
      if (ni >= 0) return mapNormIndex(raw, ni);
    }
    var head = trimmed.slice(0, Math.min(18, trimmed.length)).replace(/\s+/g, '');
    if (head.length >= 6) {
      var ni2 = normRaw.indexOf(head);
      if (ni2 >= 0) return mapNormIndex(raw, ni2);
    }
    return -1;
  }

  function mapNormIndex(raw, normIdx) {
    var n = 0;
    for (var i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) continue;
      if (n === normIdx) return i;
      n++;
    }
    return -1;
  }

  /* 把原文按要点引文切成 [{text, hl, idx}]，供高亮渲染 */
  function buildRawSegs(raw, points) {
    raw = raw || '';
    var marks = [];
    (points || []).forEach(function (p, i) {
      var start = locateQuote(raw, p.quote);
      if (start < 0) return;
      var len = p.quote.length;
      var trimmed = p.quote.replace(/…+$/, '');
      if (raw.substr(start, len) !== p.quote) {
        len = trimmed.replace(/\s+/g, '').length;
        var cnt = 0, end = start;
        while (end < raw.length && cnt < len) {
          if (!/\s/.test(raw[end])) cnt++;
          end++;
        }
        len = end - start;
      }
      marks.push({ start: start, end: start + len, idx: i });
    });
    marks.sort(function (a, b) { return a.start - b.start; });
    var clean = [], last = 0;
    marks.forEach(function (m) {
      if (m.start >= last) { clean.push(m); last = m.end; }
    });
    var segs = [], cursor = 0;
    clean.forEach(function (m) {
      if (m.start > cursor) segs.push({ text: raw.slice(cursor, m.start), hl: false, idx: -1 });
      segs.push({ text: raw.slice(m.start, m.end), hl: true, idx: m.idx });
      cursor = m.end;
    });
    if (cursor < raw.length) segs.push({ text: raw.slice(cursor), hl: false, idx: -1 });
    return segs;
  }

  /* 溯源率自评：几条要点能在原文原样定位 */
  function traceRate(n) {
    var pts = n.digestPoints || [];
    var ok = pts.filter(function (p) { return locateQuote(n.raw, p.quote) >= 0; }).length;
    return { traceable: ok, traceTotal: pts.length };
  }

  /* ============================================================
   * 四半、身份过滤（与 miniprogram/utils/identity.js 一致）
   *
   * 【踩过的坑】早期实现"逐关键词命中就判死"，把「全校本科生、研究生」
   *   错判成"只给研究生"，本科生被自己的推送系统漏掉。
   *   现在改为先识别范围形态：A、B 并列出现 = 两类都收，不排除任何一方。
   * ============================================================ */

  /* 「来源单位 → 归属学院」词表（与小程序 identity.js 同源 · 本轮新增）
   * 用户点出的真问题：工学院官网发的考试安排，不该推给信院学生 ——
   * 每个学院都有自己的官网，各花入各眼。规则见 identity.matchCollege。 */
  var SOURCE_COLLEGE_ALIAS = [
    { kw: '信息与',      college: '信息与人工智能学院' },
    { kw: '计算机学院',  college: '信息与人工智能学院' },
    { kw: '人工智能学院', college: '信息与人工智能学院' },
    { kw: '经济管理学院', college: '经济管理学院' },
    { kw: '经管学院',    college: '经济管理学院' },
    { kw: '机械与车辆',  college: '工学院' },
    { kw: '工学院',      college: '工学院' },
    { kw: '农学院',      college: '农学院' },
    { kw: '林学与园林',  college: '林学与园林学院' },
    { kw: '林学院',      college: '林学与园林学院' },
    { kw: '动物科技',    college: '动物科技学院' },
    { kw: '动物科学',    college: '动物科技学院' },
    { kw: '茶与食品',    college: '茶与食品科技学院' },
    { kw: '生命科学',    college: '生命科学学院' },
    { kw: '资源与环境',  college: '资源与环境学院' },
    { kw: '理学院',      college: '理学院' },
    { kw: '外国语',      college: '外国语学院' },
    { kw: '人文社会科学', college: '人文社会科学学院' },
    { kw: '人文学院',    college: '人文社会科学学院' }
  ];
  var UNIVERSAL_SOURCE_KW = [
    '图书馆', '校工会', '工会', '教务处', '本科生院', '研究生院', '学生工作处', '学工处',
    '保卫处', '数据管理处', '信息化办公室', '创新创业学院', '团委', '招生办', '就业',
    '财务处', '人事处', '后勤', '党政办', '校办', '宣传部', '通报', '通知公告（校级）',
    '学生报告', '学术报告', '学术讲座', '讲座', '论坛', '讲堂', '沙龙'
  ];

  /* 从来源推断通知归属学院；校级 / 认不出 → '' */
  function noticeCollege(n) {
    var source = String((n && (n.source || '')) || '');
    var title  = String((n && n.title) || '');
    /* ① 校级单位：**只看来源串**，不并入标题（否则标题里的"讲座"会把
     *    学院官网通知误判成校级，造成跨院误推） */
    for (var i = 0; i < UNIVERSAL_SOURCE_KW.length; i++) {
      if (source.indexOf(UNIVERSAL_SOURCE_KW[i]) >= 0) return '';
    }
    var src = (source + ' ' + title).trim();
    if (!src) return '';
    for (var j = 0; j < SOURCE_COLLEGE_ALIAS.length; j++) {
      if (src.indexOf(SOURCE_COLLEGE_ALIAS[j].kw) >= 0) return SOURCE_COLLEGE_ALIAS[j].college;
    }
    return '';
  }

  /* 学院维度可见性：学院官网通知只给本学院（用户没填学院 / 校级 / 明写全校 → 放行） */
  function matchCollege(n, profile) {
    var owner = noticeCollege(n);
    if (!owner) return true;
    var p = profile || {};
    var myCollege = String(p.college || '');
    if (!myCollege) return true;
    var hay = String((n && n.title) || '') + ' ' + String((n && n.audience) || '');
    if (/全校|全体师生|全校师生|全校学生|各单位、?各学院|各学院、?各单位/.test(hay)) return true;
    return myCollege === owner;
  }

  function matchAudience(audience, profile) {
    var a = String(audience || '');
    if (!a) return true;
    var p = profile || {};

    /* 一、学历层次 */
    /* 【与小程序 identity.matchAudience 同源 · 2026-11 修复】
     *   "本科"二字常出现在非受众语境：「本科教学检查」「本科教育教学审核评估」
     *   「本科毕业论文（设计）工作会」—— 这些是"本科教学环节的工作安排"，
     *   **不是"只有本科生能看"**。早期直接 /本科/ 判定，会把这类通知对研究生
     *   误排除（漏推）。故先剔除这些组合词，再判是否真的在限定受众。 */
    var aNoWork = a.replace(/本科(教学|教育|培养|毕业|论文|专业建设|课程|实践|实习|工作|管理|评估|审核|认证)/g, '');
    var isBen  = /本科/.test(aNoWork);
    var isGrad = /研究生|硕士|博士/.test(a);
    var isStaffOnly = /教职工|教师|在职/.test(a) && !isBen && !isGrad;
    var myType = String(p.identityType || '');
    var mineGrad = /研究生|硕士|博士/.test(myType);

    if (isStaffOnly) {
      if (myType !== '教职工') return false;
    } else if (isBen && isGrad) {
      /* 并列 = 全校学生都收，谁都不排除 */
      if (myType === '教职工') return false;
    } else if (isGrad && !isBen) {
      if (!mineGrad) return false;
    } else if (isBen && !isGrad) {
      if (mineGrad || myType === '教职工') return false;
    }

    /* 二、年级（词表顺序与小程序 identity.GRADES 对齐） */
    var GRADE_KW = [
      { kw: '2026级', grade: '2026级 · 大一' },
      { kw: '2025级', grade: '2025级 · 大一' },
      { kw: '2024级', grade: '2024级 · 大二' },
      { kw: '2023级', grade: '2023级 · 大三' },
      { kw: '2022级', grade: '2022级 · 大四' }
    ];
    var hits = GRADE_KW.filter(function (g) { return a.indexOf(g.kw) >= 0; });
    var myGrade = String(p.grade || '');
    if (hits.length) {
      var ok = hits.some(function (g) { return myGrade.indexOf(g.kw) >= 0 || myGrade === g.grade; });
      if (!ok) return false;
    } else if (/大一/.test(a) && /新生/.test(a)) {
      if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大一') < 0) return false;
    } else if (/毕业生|大四/.test(a) && !/就业|招聘/.test(a)) {
      if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大四') < 0 && myGrade.indexOf('研') < 0) return false;
    }

    return true;
  }

  /* 通知适用人群判不出时用标题兜底（与 store.passesIdentity 一致）
   * 身份可见性 = 学院归属（matchCollege）**且** 学历层次/年级（matchAudience） */
  function passesIdentity(n, profile) {
    if (!matchCollege(n, profile)) return false;
    var aud = (n.audience && n.audience !== '原文未明确说明')
      ? n.audience
      : (n.title || '');
    return matchAudience(aud, profile);
  }

  /* ============================================================
   * 五、分组匹配（与 store.matchByTag 一致）
   * ============================================================ */
  function matchByTag(notices, interests, profile) {
    interests = interests || [];
    profile = profile || {};
    var groups = [];
    TAGS.forEach(function (t) {
      if (interests.indexOf(t.key) < 0) return;
      var items = notices
        .filter(function (n) { return n.event === t.key; })
        .filter(function (n) { return passesIdentity(n, profile); })
        .map(function (n) {
          var o = {};
          for (var k in n) { if (Object.prototype.hasOwnProperty.call(n, k)) o[k] = n[k]; }
          o.level = levelOf(n); o.icon = t.icon;
          return o;
        })
        .sort(function (a, b) {
          var ca = (typeof a.countdown === 'number') ? a.countdown : 9999;
          var cb = (typeof b.countdown === 'number') ? b.countdown : 9999;
          if (ca !== cb) return ca - cb;
          return String(b.publish).localeCompare(String(a.publish));
        });
      if (items.length === 0) return;
      var hasUrgent = items.some(function (x) { return x.level === 'hi'; });
      groups.push({
        tag: t.key, icon: t.icon, desc: t.desc, color: t.color,
        count: items.length, urgent: hasUrgent, items: items
      });
    });
    return groups;
  }

  function tagCounts(notices) {
    var out = {};
    TAG_KEYS.forEach(function (k) { out[k] = 0; });
    (notices || []).forEach(function (n) { if (out[n.event] !== undefined) out[n.event]++; });
    return out;
  }

  function getStats(notices, interests) {
    var realCnt = notices.filter(function (n) { return n.real; }).length;
    var understood = notices.filter(function (n) { return (n.digestPoints || []).length > 0; }).length;
    var tc = tagCounts(notices);
    var tagCnt = Object.keys(tc).filter(function (k) { return tc[k] > 0; }).length;
    var matched = notices.filter(function (n) { return (interests || []).indexOf(n.event) >= 0; }).length;
    return { collected: notices.length, realCnt: realCnt, understood: understood, tagCnt: tagCnt, matched: matched };
  }

  /* ============================================================
   * 六、主动推送引擎（与 miniprogram/utils/push.js 同源）
   * ============================================================
   * 核心不变式：
   *   ① 每条推送必须给出可核对的理由（不许"AI 觉得你可能会喜欢"）
   *   ② 只有三天内截止的才允许"打扰"，其余静默进流
   *   ③ 排序完全由可解释的分数决定，无随机、无黑箱
   * ============================================================ */
  var LEVEL = { NOW: 'now', HOT: 'hot', SOON: 'soon', PLAN: 'plan', FAR: 'far' };

  var LEVEL_META = {
    now:  { key: 'now',  label: '今天就要办', icon: '🔴', notify: true  },
    hot:  { key: 'hot',  label: '三天内要办', icon: '🟠', notify: true  },
    soon: { key: 'soon', label: '一周内',     icon: '🟡', notify: false },
    plan: { key: 'plan', label: '本月内',     icon: '🟢', notify: false },
    far:  { key: 'far',  label: '长期有效',   icon: '⚪️', notify: false }
  };

  function levelMeta(lv) { return LEVEL_META[lv] || LEVEL_META.far; }

  function levelOfCd(cd) {
    if (typeof cd !== 'number') return LEVEL.FAR;
    if (cd < 0) return LEVEL.FAR;
    if (cd <= 1) return LEVEL.NOW;
    if (cd <= 3) return LEVEL.HOT;
    if (cd <= 7) return LEVEL.SOON;
    if (cd <= 30) return LEVEL.PLAN;
    return LEVEL.FAR;
  }

  /* 推送理由权重表 —— 与小程序 push.js 的 WEIGHT 同源（同一套权重、同一套规则）。
   * 分数 = 理由权重之和，再归一到 0-100。理由即分数：能展示的理由一定参与打分。 */
  var PUSH_WEIGHT = {
    DUE_TODAY: 40, DUE_3: 28, DUE_7: 12,
    MATCH_COLLEGE: 22, KW_MATCH: 20, MATCH_GRADE: 18, SUBSCRIBED: 16, OPPORTUNITY: 14,
    MATCH_LEVEL: 10, PRIORITY: 10, NEW: 8, VERIFIABLE: 6, FRESH: 6,
    READ: 4, EXPIRED: -40, EXPLAIN_ONLY: -18, STALE: -12, NOT_STUDENT: -30, INDIRECT: -14
  };
  /* "不由学生直接办"的信号词（与小程序 push.js 同源） */
  var PUSH_INDIRECT_KW = ['面向学院报送', '非学生直接申报', '由学院统一', '学院汇总报送',
                          '各单位报送', '部门报送', '报送材料', '二级单位报送'];

  /* ============================================================
   * 自定义关键词订阅（与 miniprogram/utils/subscribe.js 同源）
   * ============================================================
   * 用户亲手输入的具体名词（如"正大杯"）命中通知即视为"与我有关"。
   * 固定标签覆盖不到具体赛事/项目，必须给输入框。
   * 命中范围与检索层同源：标题 / 浓缩 / 要点 / 标签 / 来源 / 原文。
   * ============================================================ */

  /* 归一化关键词：去掉所有空白 + 转小写 */
  function normKeyword(k) {
    if (k === null || k === undefined) return '';
    return String(k).replace(/\s+/g, '').toLowerCase();
  }

  /* 一条通知的"可命中文本"（小写） */
  function noticeHaystack(n) {
    if (!n) return '';
    return [
      String(n.title || ''),
      String(n.digestOne || ''),
      (n.points || []).join(' '),
      String(n.event || ''),
      String(n.source || ''),
      String(n.raw || '')
    ].join(' ').toLowerCase();
  }

  /* 用户关键词的归一化去重列表 */
  function keywordList(profile) {
    var kws = (profile && Array.isArray(profile.keywords)) ? profile.keywords : [];
    var out = [];
    kws.forEach(function (k) {
      var n = normKeyword(k);
      if (n && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  /* 命中哪个关键词（返回最长的那个；没命中返回 ''） */
  function matchKeyword(n, profile) {
    var kws = (profile && Array.isArray(profile.keywords)) ? profile.keywords : [];
    if (!kws.length || !n) return '';
    var hay = noticeHaystack(n);
    var best = '', bestLen = 0;
    for (var i = 0; i < kws.length; i++) {
      var raw = String(kws[i] === null || kws[i] === undefined ? '' : kws[i]).trim();
      var k = normKeyword(raw);
      if (!k) continue;
      if (hay.indexOf(k) >= 0 && k.length > bestLen) { best = raw; bestLen = k.length; }
    }
    return best;
  }

  /* 布尔版：是否命中任一关键词 */
  function hitKeyword(n, profile) {
    var list = keywordList(profile);
    if (!list.length || !n) return false;
    var hay = noticeHaystack(n);
    for (var i = 0; i < list.length; i++) {
      if (hay.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  /* 清洗用户输入的关键词（保存到画像前调用）：去空白 / 截断 20 字 / 去重 / 最多 12 个 */
  var MAX_KEYWORDS = 12;
  function sanitizeKeywords(arr) {
    var list = Array.isArray(arr) ? arr : [];
    var seen = {}, out = [];
    list.forEach(function (k) {
      var s = String(k === null || k === undefined ? '' : k).replace(/\s+/g, '');
      if (!s) return;
      if (s.length > 20) s = s.slice(0, 20);
      var key = s.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(s);
    });
    return out.slice(0, MAX_KEYWORDS);
  }
  /* 归一化上限（与小程序 push.js MAX_RAW 同源；见该处注释说明为何是 150） */
  var PUSH_MAX_RAW = 150;
  /* 中卡分数阈值（与小程序 push.js MAJOR_SCORE 同源；网页版不渲染 tier，
   * 但常量必须两端一致，供同源守卫比对）。 */
  var MAJOR_SCORE = 35;
  /* 机会类标签白名单（与小程序一致） */
  var PUSH_OPPORTUNITY = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];

  /* publish 距今天数（自然日）；无 publish 或解析失败返回 null */
  function publishAge(publish) {
    if (!publish) return null;
    var s = String(publish).slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var pub = new Date(+m[1], +m[2] - 1, +m[3]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - pub) / 86400000);
  }

  /* 推送理由：每条都可追溯到档案的某一项或数据的某个字段；每条带权重 w */
  function pushReasons(n, profile, isNew, fb) {
    var p = profile || {};
    var out = [];
    var cd = n.countdown;
    var push = function (code, label, detail) { out.push({ code: code, label: label, detail: detail, w: PUSH_WEIGHT[code] || 0 }); };

    /* 理由 0：非学生事项（行政/新闻）—— 强负权，让它沉底 */
    if (String(n.audience || '').indexOf('非学生事项') >= 0) {
      push('NOT_STUDENT', '非学生事项', '行政/新闻类，不是给学生办的待办');
    }
    /* 「说明/澄清/解读/事后公示」类不是待办（无截止 + 告知性标题）—— 不给机会正权 */
    var ttlC = String(n.title || '');
    var noDeadlineC = (typeof cd !== 'number');
    var isExplain = noDeadlineC && /说明|澄清|解读|答疑|问答|公告栏|温馨提示|情况反映|意见征集|公示|名单公布|结果公布|评审结果|复核结论/.test(ttlC);
    if (isExplain) {
      push('EXPLAIN_ONLY', '只是说明，非待办', '告知类通知，没有需要你去办的动作');
    }
    /* 「面向学院报送 / 非学生直接申报」：学院/老师的活儿，学生不用自己办 */
    var isIndirect = PUSH_INDIRECT_KW.some(function (k) {
      return String(n.audience || '').indexOf(k) >= 0;
    });

    /* 过期 = 系统性降权（与小程序 push.js 同源）：
     * 已截止的条目只给 EXPIRED 负权，且不再给"它还值得你行动"的正向理由。
     * 负权随过期天数递增：刚过期的（可能还能补交）比过了很久的排前面。 */
    var expired = (typeof cd === 'number' && cd < 0);
    if (expired) {
      var daysAgo = Math.abs(cd);
      var extra = Math.min(30, daysAgo);
      out.push({
        code: 'EXPIRED',
        label: '已截止 ' + daysAgo + ' 天',
        detail: '这件事已经过了办理时间，仅供回看',
        w: PUSH_WEIGHT.EXPIRED - extra
      });
    } else if (typeof cd === 'number' && cd >= 0) {
      if (cd === 0) push('DUE_TODAY', '今天截止', '错过今天就得等下一轮');
      else if (cd <= 3) push('DUE_3', '还剩 ' + cd + ' 天', '截止 ' + (n.deadline || ''));
      else if (cd <= 7) push('DUE_7', '还剩 ' + cd + ' 天', '截止 ' + (n.deadline || ''));
    }

    var interests = p.interests || [];
    if (interests.indexOf(n.event) >= 0) {
      push('SUBSCRIBED', '你关注了「' + n.event + '」', '在你的关注清单里');
    }

    /* 理由 2b：命中你亲手输入的订阅关键词（如"正大杯"）—— 与小程序 push.js 同源 */
    var kwHit = matchKeyword(n, p);
    if (kwHit) {
      push('KW_MATCH', '你订的关键词「' + kwHit + '」', '这条内容命中了你自己输入的订阅词');
    }

    /* 远期折扣：cd>14 的条目，软信号（机会/新鲜度）减半 —— 防止"遥远的事"
     * 靠身份/机会堆分反超"近截止的事"（时间在分数里始终起主导）。 */
    var farOut = (typeof cd === 'number' && cd > 14);
    var soft = function (w) { return farOut ? Math.round(w / 2) : w; };

    if (PUSH_OPPORTUNITY.indexOf(n.event) >= 0 && !isIndirect && !expired && !isExplain) {
      out.push({
        code: 'OPPORTUNITY',
        label: n.event + ' · 可参与',
        detail: '是需要你报名/参加的机会类通知',
        w: soft(PUSH_WEIGHT.OPPORTUNITY)
      });
    }
    if (isIndirect) {
      push('INDIRECT', '非学生直接办', '面向学院报送，学生不用自己申报');
    }

    var audRaw = String(n.audience || '');
    var audUsable = (audRaw && audRaw !== '原文未明确说明'
                     && audRaw.indexOf('非学生事项') < 0
                     && audRaw.indexOf('未点名具体对象') < 0) ? audRaw : '';
    var hay = audUsable + ' ' + String(n.title || '');
    var gradeNum = (String(p.grade || '').match(/(\d{4})/) || [])[1];
    if (gradeNum && hay.indexOf(gradeNum + '级') >= 0) {
      push('MATCH_GRADE', '点名了 ' + gradeNum + '级', '和你的年级一致');
    }
    if (p.college && hay.indexOf(p.college) >= 0) {
      push('MATCH_COLLEGE', '点名了 ' + p.college, '和你的学院一致');
    } else if (noticeCollege(n) && noticeCollege(n) === String(p.college)) {
      push('MATCH_COLLEGE', '来自 ' + noticeCollege(n) + ' 官网', '是你所在学院发布的通知');
    }
    var idType = String(p.identityType || '');
    /* 与 matchAudience 同源的排除：本科教学/教育教学/毕业论文等组合词
     * 不是受众限定，据此给"面向本科生"理由会误导学生。 */
    var hayNoWork = hay.replace(/本科(教学|教育|培养|毕业|论文|专业建设|课程|实践|实习|工作|管理|评估|审核|认证)/g, '');
    if (/本科生/.test(idType) && /本科生?/.test(hayNoWork) && !/只|仅限.*研究生/.test(hay) && !isIndirect && !expired) {
      push('MATCH_LEVEL', '面向本科生', '和你的身份一致');
    }
    if (/研究生/.test(idType) && /研究生|硕士|博士/.test(hay) && !isIndirect && !expired) {
      push('MATCH_LEVEL', '面向研究生', '和你的身份一致');
    }

    if (isNew) push('NEW', '新收录', '你上次看之后才聚合进来的');
    if (n.priority === 'high') push('PRIORITY', '标记为较重要', '系统按事项性质标注');
    if (n.real === true && n.url && !expired) push('VERIFIABLE', '可核对原文', '带安农官网链接');

    /* 新近发布：给无截止日期条目一条生路（14 天内给 FRESH）；已截止的不给；
     * 远期条目（cd>14）FRESH 减半。 */
    var freshDays = publishAge(n.publish);
    if (!expired && freshDays !== null && freshDays <= 14) {
      out.push({
        code: 'FRESH',
        label: freshDays <= 3 ? '刚刚发布' : '近期发布',
        detail: '发布于 ' + (n.publish || ''),
        w: soft(PUSH_WEIGHT.FRESH)
      });
    }

    /* 反馈闭环 */
    if (fb) {
      if (fb.readTag) push('READ', '你常看「' + n.event + '」', '过去你点开过这一类通知');
      if (fb.stale) push('STALE', '看过了没点开', '已多次展示但你还没打开，自动降权');
    }

    return out;
  }

  /* 由理由列表算归一化分（0-100） */
  function scoreFromReasons(reasons) {
    var raw = (reasons || []).reduce(function (s, r) { return s + (r.w || 0); }, 0);
    var clamped = Math.max(0, raw);
    return Math.round(100 * Math.min(1, clamped / PUSH_MAX_RAW));
  }

  /* 打分：分数 = 理由权重之和（与小程序 push.js 完全同源，无随机） */
  function pushScore(n, profile, isNew, fb) {
    return scoreFromReasons(pushReasons(n, profile, isNew, fb));
  }

  /**
   * 构建推送流。notices 是候选池（调用方已按档案筛过，或传全池由本函数筛）。
   * opts: { limit, profile, seenIds, filter:true }
   */
  function buildPush(notices, opts) {
    opts = opts || {};
    var profile = opts.profile || {};
    var limit = opts.limit || 30;
    var seen = {};
    (opts.seenIds || []).forEach(function (id) { seen[id] = 1; });
    var fbm = opts.feedback || null;   /* { readTags:{标签:true}, staleIds:{id:true} } 可选 */

    var pool = (notices || []).filter(function (n) {
      if (opts.filter === false) return true;
      /* 非学生事项（纪委会议/巡察/值班表/经费公示/学校新闻…）不进推送流 */
      if (String(n.audience || '').indexOf('非学生事项') >= 0) return false;
      /* 与我有关 = 命中订阅标签 OR 命中自定义关键词；两条口径与小程序 store.isRelevant 同源 */
      var byTag = (profile.interests || []).indexOf(n.event) >= 0;
      var byKw = hitKeyword(n, profile);
      if (!byTag && !byKw) return false;
      return passesIdentity(n, profile);
    });

    var cards = pool.map(function (n) {
      var lv = levelOfCd(n.countdown);
      var isNew = !seen[n.id];
      var fb = fbm ? {
        readTag: !!(fbm.readTags && fbm.readTags[n.event]),
        stale: !!(fbm.staleIds && fbm.staleIds[n.id])
      } : null;
      var reasons = pushReasons(n, profile, isNew, fb);
      var meta = levelMeta(lv);
      var rawScore = reasons.reduce(function (s, r) { return s + (r.w || 0); }, 0);
      var o = {};
      for (var k in n) { if (Object.prototype.hasOwnProperty.call(n, k)) o[k] = n[k]; }
      o.pushLevel = lv;
      o.pushLevelLabel = meta.label;
      o.pushLevelIcon = meta.icon;
      o.pushScore = scoreFromReasons(reasons);
      o.pushRaw = rawScore;   /* 未夹零原始分：同分细分用（过期条目都夹 0 后靠它排序） */
      o.pushReasons = reasons;
      o.isNew = isNew;
      o.isStale = !!(fb && fb.stale);
      o.shouldNotify = meta.notify;
      /* "为什么推给你"取权重最大的理由，而非列表第一条。
       * 但"已截止"是定性事实，不能被正权子标签盖过（与小程序同源）。 */
      var expiredR = reasons.filter(function (r) { return r.code === 'EXPIRED'; })[0];
      var top = null;
      reasons.forEach(function (r) { if (!top || r.w > top.w) top = r; });
      o.isExpired = !!expiredR;
      o.pushReasonLine = expiredR ? expiredR.label : (top ? top.label : '已按你的档案匹配');
      return o;
    });

    cards.sort(function (a, b) {
      if (b.pushScore !== a.pushScore) return b.pushScore - a.pushScore;
      var ra = typeof a.pushRaw === 'number' ? a.pushRaw : 0;
      var rb = typeof b.pushRaw === 'number' ? b.pushRaw : 0;
      if (rb !== ra) return rb - ra;
      var ca = typeof a.countdown === 'number' ? a.countdown : 9999;
      var cb = typeof b.countdown === 'number' ? b.countdown : 9999;
      if (ca !== cb) return ca - cb;
      return String(b.publish).localeCompare(String(a.publish));
    });
    cards.forEach(function (c, i) { c.rank = i + 1; });

    var top = cards.slice(0, limit);
    var notify = top.filter(function (c) { return c.shouldNotify; });
    var silent = top.filter(function (c) { return !c.shouldNotify; });
    var newCount = top.filter(function (c) { return c.isNew; }).length;
    var hotCount = notify.length;

    var line;
    if (!top.length) line = '当前档案下没有匹配的通知 —— 去「我的」调整关注标签试试';
    else if (hotCount) line = '有 ' + hotCount + ' 条三天内要办，共 ' + top.length + ' 条与你有关' + (newCount ? '（含 ' + newCount + ' 条新收录）' : '');
    else line = '暂无紧急事项，共 ' + top.length + ' 条与你有关' + (newCount ? '（含 ' + newCount + ' 条新收录）' : '');

    var badge = hotCount ? (hotCount + ' 条待办') : (newCount ? (newCount + ' 条新') : '');
    var tone = hotCount ? 'alert' : (newCount ? 'new' : 'calm');

    return {
      cards: top, notify: notify, silent: silent,
      newCount: newCount, hotCount: hotCount, total: top.length,
      summary: { line: line, badge: badge, tone: tone }
    };
  }

  /* 按推送级别分箱 */
  function pushBuckets(notices, opts) {
    var r = buildPush(notices, opts);
    return [LEVEL.NOW, LEVEL.HOT, LEVEL.SOON, LEVEL.PLAN, LEVEL.FAR]
      .map(function (lv) {
        var items = r.cards.filter(function (c) { return c.pushLevel === lv; });
        var m = levelMeta(lv);
        return { key: lv, label: m.label, icon: m.icon, notify: m.notify, count: items.length, items: items };
      })
      .filter(function (b) { return b.count > 0; });
  }

  /* ============================================================
   * 七、「问知时」问答引擎（与 miniprogram/utils/ask.js 同源）
   * ============================================================
   * 小程序版依赖 store（有 wx API），网页版走纯函数：接收 notices + profile。
   * 两边的**问题文案、筛选口径、答案措辞、依据说明**必须逐字一致 ——
   * 否则评委在网页看到的答案和小程序里的不一样。
   *
   * 三条铁律：① 结论由真实字段派生 ② 附"依据"说明算法 ③ 算不出就说算不出
   * ============================================================ */

  /* 与我有关（订阅标签 OR 自定义关键词 + 身份），与小程序 store.myFeed 同口径 */
  function relatedNotices(notices, profile) {
    var p = profile || {};
    var interests = p.interests || [];
    return (notices || []).filter(function (n) {
      var byTag = interests.indexOf(n.event) >= 0;
      var byKw = hitKeyword(n, p);
      if (!byTag && !byKw) return false;
      return passesIdentity(n, p);
    });
  }

  /* 剩余时间说法（与 ask.js dueText 一致） */
  function dueTextOf(n) {
    var cd = n.countdown;
    if (typeof cd !== 'number') return n.deadline ? ('截止 ' + n.deadline) : '没写截止时间';
    if (cd < 0) return '已过期 ' + Math.abs(cd) + ' 天';
    if (cd === 0) return '今天截止';
    if (cd === 1) return '明天截止';
    return '还剩 ' + cd + ' 天（截止 ' + (n.deadline || '') + '）';
  }

  /* 机会类标签白名单（与 ask.js 一致） */
  var OPPORTUNITY = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];

  /* 材料拆分（与 ask.js splitMaterials 一致） */
  function splitMaterials(s) {
    /* 与小程序同源：非字符串一律当空处理，数字转字符串，其余返回空数组，绝不崩 */
    if (s === null || s === undefined || typeof s !== 'string') {
      if (typeof s === 'number') s = String(s);
      else return [];
    }
    var out = [], buf = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var isSep = (ch === '/' || ch === '、' || ch === '；' || ch === ';');
      if (!isSep) { buf += ch; continue; }
      if (ch === '/') {
        var prev = buf.length ? buf[buf.length - 1] : '';
        var next = s[i + 1] || '';
        if (/\d/.test(prev) && /\d/.test(next)) { buf += ch; continue; }
      }
      var t = buf.trim();
      if (t) out.push(t);
      buf = '';
    }
    var tt = buf.trim();
    if (tt) out.push(tt);
    return out;
  }

  /* ============================================================
   * 触达时间线（与小程序 utils/reachlist.js / wxnotify.js 同源）
   * ------------------------------------------------------------
   * 回答"你说会主动提醒我，凭什么信"：
   *   把一条通知从发布到截止的全过程摊开，标出哪一天会主动找你、找你几次。
   * 三条硬规则（与 push 同口径）：
   *   ① 只有"与我有关"的条目才进入规划（有推送理由即算相关）；
   *   ② 提醒日 = 截止日往前推 advance 的每一档，且不早于发布日；
   *   ③ 已过期的不再规划任何提醒。
   * ============================================================ */

  function advanceDays(key) {
    var s = String(key || '3,1');
    var arr = s.split(',').map(function (x) {
      var n = parseInt(String(x).replace(/[^0-9]/g, ''), 10);
      return isNaN(n) ? 0 : n;
    }).filter(function (n) { return n > 0; });
    var uniq = [];
    arr.forEach(function (n) { if (uniq.indexOf(n) < 0) uniq.push(n); });
    return uniq.sort(function (a, b) { return b - a; });
  }

  function _rd0(v) {
    if (!v) return null;
    var d = (v instanceof Date) ? new Date(v.getTime()) : new Date(v);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function _radd(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function _rfmtMD(d) {
    if (!d) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function _rtoday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function planReach(n, advanceKey) {
    var deadline = _rd0(n.deadline);
    var publish = _rd0(n.publishDate || n.publish || n.date);
    var t = _rtoday();
    var daysLeft = deadline ? Math.round((deadline - t) / 86400000) : null;
    var expired = (daysLeft !== null && daysLeft < 0);
    var plan = [];
    if (deadline && !expired) {
      var seen = {}, dedup = [];
      advanceDays(advanceKey).forEach(function (db) {
        var when = _radd(deadline, -db);
        if (publish && when < publish) when = publish;
        var k = when.getTime();
        if (seen[k]) return;
        seen[k] = 1;
        var kind = db <= 1 ? 'urgent' : (db <= 3 ? 'hot' : 'soon');
        dedup.push({
          date: when, dateText: _rfmtMD(when), daysBefore: db, kind: kind,
          text: db <= 1 ? '「' + n.title + '」明天截止，最后一天了'
                        : '「' + n.title + '」还有 ' + db + ' 天截止'
        });
      });
      dedup.sort(function (a, b) { return a.date - b.date; });
      dedup.forEach(function (p) { if (p.date >= t) plan.push(p); });
    }
    return {
      id: n.id, title: n.title, source: n.source, site: n.site || '',
      deadline: deadline, deadlineText: deadline ? _rfmtMD(deadline) : '无明确截止',
      publish: publish, publishText: publish ? _rfmtMD(publish) : '',
      daysLeft: daysLeft, expired: expired, plan: plan
    };
  }

  function buildReach(notices, profile, advanceKey, opt) {
    var o = opt || {};
    var limit = o.limit || 40;
    var p = profile || {};
    var advKey = advanceKey || p.advance || '3,1';
    var t = _rtoday();
    var pool = Array.isArray(notices) ? notices : [];

    var mine = pool.filter(function (n) {
      if (!n) return false;
      try {
        var rs = pushReasons(n, p);
        if (rs && rs.length) return true;
      } catch (e) {}
      try {
        var m = matchByTag(n, p);
        if (m !== null && m !== undefined) return true;
      } catch (e2) {}
      return false;
    });

    var rows = [];
    mine.forEach(function (n) {
      var row = planReach(n, advKey);
      if (row.expired) return;
      if (!row.plan.length) return;
      row.first = row.plan[0];
      row.count = row.plan.length;
      rows.push(row);
    });

    rows.sort(function (a, b) {
      var d = a.first.date - b.first.date;
      if (d !== 0) return d;
      return (a.daysLeft == null ? 9999 : a.daysLeft) - (b.daysLeft == null ? 9999 : b.daysLeft);
    });

    var horizon = _radd(t, 14);
    var upcoming = rows.filter(function (r) { return r.first.date <= horizon; });

    var byDay = [], dayMap = {};
    upcoming.forEach(function (r) {
      var k = r.first.date.getTime();
      if (!dayMap[k]) {
        dayMap[k] = { date: r.first.date, dateText: _rfmtMD(r.first.date), items: [] };
        byDay.push(dayMap[k]);
      }
      dayMap[k].items.push(r);
    });
    byDay.sort(function (a, b) { return a.date - b.date; });

    var totalReminders = 0;
    upcoming.forEach(function (r) { totalReminders += r.count; });

    return {
      rows: rows.slice(0, limit),
      upcoming: upcoming,
      byDay: byDay,
      stats: {
        mine: mine.length,
        scheduled: rows.length,
        upcoming: upcoming.length,
        totalReminders: totalReminders,
        advanceKey: advKey,
        advanceText: (advKey === '1' ? '截止前 1 天'
          : (advKey === '7,3,1' ? '截止前 7 / 3 / 1 天' : '截止前 3 / 1 天'))
      }
    };
  }

  /* 问题定义表：与 ask.js QUESTIONS 一一对应 */
  var QUESTIONS = [
    { id: 'today', q: '今天有什么非要办的？', hint: '只看今天截止的', group: 'today' },
    { id: 'week', q: '这周还剩几件事？', hint: '一周内的待办总量', group: 'today' },
    { id: 'calendar_empty', q: '哪天我可以空出来？', hint: '未来一周哪天没有截止', group: 'today' },
    { id: 'first', q: '要是只办一件，该办哪个？', hint: '按紧急度 + 可核对度给出唯一推荐', group: 'pick' },
    { id: 'top3', q: '给我一张今日待办清单', hint: '按分数排出前几件', group: 'pick' },
    { id: 'miss', q: '我是不是漏了什么？', hint: '上次看之后新收录的', group: 'miss' },
    { id: 'expired', q: '有没有已经过期的？', hint: '过期条目单独列出，不再混在待办里', group: 'miss' },
    { id: 'all_can_apply', q: '哪些是全校都能报的？', hint: '不限身份、门槛最低的机会', group: 'fit' },
    { id: 'my_college', q: '哪些点名了我们学院？', hint: '本学院专属的机会别漏', group: 'fit' },
    { id: 'threshold', q: '哪些有硬门槛（绩点/处分）？', hint: '先把够不着的挑出来，省得白忙', group: 'fit' },
    { id: 'need_material', q: '我要准备哪些材料？', hint: '把所有待办的材料汇总成一张清单', group: 'prep' },
    { id: 'need_link', q: '哪几条必须去官网原文看？', hint: '带安农官网链接的，可逐字核对', group: 'trust' },
    { id: 'trust', q: '数据可靠吗？会不会骗我？', hint: '自查自纠系统每次展示前都查一遍', group: 'trust' }
  ];

  var ASK_GROUPS = [
    { key: 'today',  label: '今天 / 这周',  icon: '📅' },
    { key: 'pick',   label: '先办哪个',      icon: '🎯' },
    { key: 'miss',   label: '我漏了什么',    icon: '🔍' },
    { key: 'fit',    label: '是不是给我的',  icon: '🎫' },
    { key: 'prep',   label: '要准备什么',    icon: '📦' },
    { key: 'trust',  label: '数据可靠吗',    icon: '🛡' }
  ];

  /**
   * 回答一个问题。纯函数版：与小程序 ask.ask 输出结构一致。
   * opts: { notices, profile, pushResult, seenIds }
   */
  function askAnswer(id, opts) {
    opts = opts || {};
    var notices = opts.notices || [];
    var profile = opts.profile || {};
    var p = profile;
    var related, r;

    /* 与小程序 ask.ask() 同源的兜底铁律：任何异常都如实降级，不许假装有答案 */
    try {
      related = relatedNotices(notices, profile);
    } catch (e) {
      r = { answer: '这条问题暂时算不出来（数据读取异常）。', basis: '发生了内部错误：' + (e && e.message ? e.message : e), tone: 'warn', items: [] };
      return {
        id: id,
        q: '', hint: '', group: '',
        answer: r.answer, basis: r.basis, tone: r.tone,
        items: [], itemCount: 0, materials: null
      };
    }

    switch (id) {
      /* ---- today ---- */
      case 'today': {
        var l1 = related.filter(function (n) { return n.countdown === 0; });
        if (!l1.length) r = { answer: '今天没有截止的通知，可以安心。', basis: '统计口径：与你有关（订阅标签 + 身份匹配）且倒计时为 0 的条目。', tone: 'calm', items: [] };
        else r = {
          answer: '今天有 ' + l1.length + ' 件要办：' + l1.map(function (n) { return n.title; }).slice(0, 3).join('；') + (l1.length > 3 ? ' 等' : '') + '。',
          basis: '统计口径：倒计时 = 0 的条目，共 ' + l1.length + ' 条。',
          tone: 'alert', items: l1
        };
        break;
      }
      case 'week': {
        var l2 = related.filter(function (n) { return typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7; });
        var t2 = l2.filter(function (n) { return n.countdown === 0; }).length;
        if (!l2.length) r = { answer: '这周没有临近截止的事，最近比较清闲。', basis: '统计口径：倒计时在 0-7 天之间。', tone: 'calm', items: [] };
        else r = {
          answer: '这周有 ' + l2.length + ' 件要办（其中 ' + t2 + ' 件是今天）。',
          basis: '统计口径：倒计时 0-7 天，共 ' + l2.length + ' 条。',
          tone: l2.length >= 5 ? 'alert' : 'busy', items: l2
        };
        break;
      }
      case 'calendar_empty': {
        var l3 = related.filter(function (n) { return typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7; });
        var busy = {};
        l3.forEach(function (n) { busy[n.countdown] = (busy[n.countdown] || 0) + 1; });
        var free = [];
        for (var d = 0; d <= 7; d++) if (!busy[d]) free.push(d);
        if (!free.length) r = { answer: '未来一周每天都有截止，建议尽早动手，别攒到最后。', basis: '统计口径：逐日检查 0-7 天内是否有条目截止。', tone: 'alert', items: l3 };
        else {
          var ft = free.map(function (dd) { return dd === 0 ? '今天' : (dd === 1 ? '明天' : dd + '天后'); }).join('、');
          r = {
            answer: '未来一周里，' + ft + ' 没有截止事项，可以安排其他事。',
            basis: '统计口径：逐日检查 0-7 天内是否有条目截止；无截止的天数为 ' + free.length + '。',
            tone: 'calm', items: []
          };
        }
        break;
      }
      /* ---- pick ---- */
      case 'first': {
        var pr = opts.pushResult || buildPush(notices, { profile: profile, limit: 40 });
        var cand = pr.cards.filter(function (c) { return c.pushLevel === LEVEL.NOW || c.pushLevel === LEVEL.HOT; });
        if (!cand.length) {
          var topn = pr.cards[0];
          if (!topn) r = { answer: '现在没有和你有关的待办。', basis: '推送池为空。', tone: 'calm', items: [] };
          else r = {
            answer: '最近没有三天内要办的；最靠前的是「' + topn.title + '」（' + dueTextOf(topn) + '）。',
            basis: '依据：推送分的最高分条目（分 = ' + topn.pushScore + '）。',
            tone: 'busy', items: [topn]
          };
        } else {
          var top1 = cand[0];
          var rs = (top1.pushReasons || []).map(function (x) { return x.label; }).slice(0, 3).join(' · ');
          r = {
            answer: '先办「' + top1.title + '」——' + dueTextOf(top1) + '。',
            basis: '依据：推送分最高（' + top1.pushScore + ' 分），理由：' + (rs || '紧急') + '。',
            tone: 'alert', items: cand.slice(0, 5)
          };
        }
        break;
      }
      case 'top3': {
        var pr2 = opts.pushResult || buildPush(notices, { profile: profile, limit: 40 });
        var top5 = pr2.cards.slice(0, 5);
        if (!top5.length) r = { answer: '暂时没有和你有关的待办。', basis: '推送池为空。', tone: 'calm', items: [] };
        else r = {
          answer: '按紧急度给你排了 ' + top5.length + ' 件，从上往下办就行。',
          basis: '依据：按推送分（含紧急度 / 身份契合 / 新收录）降序排列。',
          tone: (top5[0].pushLevel === LEVEL.NOW || top5[0].pushLevel === LEVEL.HOT) ? 'alert' : 'busy',
          items: top5
        };
        break;
      }
      /* ---- miss ---- */
      case 'miss': {
        var pr3 = opts.pushResult || buildPush(notices, { profile: profile, limit: 40 });
        var news = pr3.cards.filter(function (c) { return c.isNew; });
        if (!news.length) r = { answer: '没有新漏的——上次推送之后没有新增条目。', basis: '依据：与本地留痕（zhishi_push_state）比对，isNew 为 0 条。', tone: 'calm', items: [] };
        else {
          var urg = news.filter(function (c) { return c.pushLevel === LEVEL.NOW || c.pushLevel === LEVEL.HOT; });
          r = {
            answer: '你上次看之后新增了 ' + news.length + ' 条' + (urg.length ? '，其中 ' + urg.length + ' 条是三天内要办的，建议先看。' : '，都不急，有空再看。'),
            basis: '依据：与本地留痕比对得出的新条目，共 ' + news.length + ' 条。',
            tone: urg.length ? 'alert' : 'new', items: news
          };
        }
        break;
      }
      case 'expired': {
        var l4 = related.filter(function (n) { return typeof n.countdown === 'number' && n.countdown < 0; });
        if (!l4.length) r = { answer: '没有已过期的条目——你关注的范围内都还在有效期内。', basis: '统计口径：倒计时 < 0 的条目，共 0 条。', tone: 'calm', items: [] };
        else r = {
          answer: '有 ' + l4.length + ' 条已经过期了，我把它们单独归到「已过期」，不再混进待办里。',
          basis: '统计口径：倒计时 < 0，共 ' + l4.length + ' 条。过期条目只在归档里可见，避免顶在待办上干扰你。',
          tone: 'warn', items: l4
        };
        break;
      }
      /* ---- fit ---- */
      case 'all_can_apply': {
        var l5 = related.filter(function (n) {
          if (OPPORTUNITY.indexOf(n.event) < 0) return false;
          var a = String(n.audience || '');
          if (!a || a === '原文未明确说明') return true;
          return /全校|全体|师生|在校学生|均可|不限/.test(a) && !/仅限|只面向|定向/.test(a);
        });
        if (!l5.length) r = { answer: '这一批通知里没有明确写「全校都能报」的机会类通知。', basis: '筛选口径：标签属于机会类（竞赛/奖助/讲座/图书/转专业/选课），且受众文本含「全校/全体/师生/在校学生/均可/不限」、不含「仅限/只面向」。', tone: 'calm', items: [] };
        else r = {
          answer: '有 ' + l5.length + ' 条是面向全校/全体师生的机会，报名面最大：' + l5.map(function (n) { return n.title; }).slice(0, 3).join('；') + (l5.length > 3 ? ' 等' : '') + '。',
          basis: '筛选口径：机会类标签 + 受众含「全校/全体/师生/在校学生/均可/不限」，共 ' + l5.length + ' 条。',
          tone: 'ok', items: l5
        };
        break;
      }
      case 'my_college': {
        var col = String(p.college || '');
        if (!col) r = { answer: '你还没填学院，填了才能帮你找本院专属通知。', basis: '画像缺 college 字段。', tone: 'warn', items: [] };
        else {
          var l6 = related.filter(function (n) {
            var hay = String(n.audience || '') + ' ' + String(n.title || '');
            return hay.indexOf(col) >= 0;
          });
          if (!l6.length) r = { answer: '最近的通知里没有点名「' + col + '」的。', basis: '筛选口径：受众或标题包含「' + col + '」。', tone: 'calm', items: [] };
          else r = {
            answer: '有 ' + l6.length + ' 条点名了「' + col + '」，这类通常是本院专属，别漏：',
            basis: '筛选口径：受众或标题包含你的学院名，共 ' + l6.length + ' 条。',
            tone: 'ok', items: l6
          };
        }
        break;
      }
      case 'threshold': {
        var l7 = related.filter(function (n) {
          if (OPPORTUNITY.indexOf(n.event) < 0) return false;
          var hay = String(n.audience || '') + ' ' + String(n.raw || '');
          return /绩点|无.{0,4}(处分|违纪)|无挂科|排名前/.test(hay);
        });
        if (!l7.length) r = { answer: '这批通知里没有看到明确的硬门槛（绩点 / 处分 / 排名）。', basis: '筛选口径：受众或原文含「绩点/无处分/无挂科/排名前」。', tone: 'calm', items: [] };
        else r = {
          answer: '有 ' + l7.length + ' 条设了硬门槛，报名前先自查，别白忙：',
          basis: '筛选口径：原文出现绩点/无处分/无挂科/排名前等限制词，共 ' + l7.length + ' 条。门槛具体数值请看每条详情页的「和我有关吗」。',
          tone: 'warn', items: l7
        };
        break;
      }
      /* ---- prep ---- */
      case 'need_material': {
        var l8 = related.filter(function (n) { return typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7; })
          .filter(function (n) { return n.materials && String(n.materials).trim(); });
        if (!l8.length) r = { answer: '一周内要办的事里，没有写明"需要准备材料"的。', basis: '筛选口径：倒计时 0-7 天且 materials 字段非空。', tone: 'calm', items: [] };
        else {
          var flat = [];
          l8.forEach(function (n) {
            splitMaterials(String(n.materials)).forEach(function (m) {
              flat.push({ material: m, from: n.title, id: n.id });
            });
          });
          r = {
            answer: '一周内你一共要准备 ' + flat.length + ' 项材料，来自 ' + l8.length + ' 条通知。',
            basis: '统计口径：把倒计时 0-7 天内各条通知的 materials 拆开后汇总，共 ' + flat.length + ' 项。',
            tone: flat.length >= 6 ? 'busy' : 'ok',
            items: l8,
            materials: flat
          };
        }
        break;
      }
      /* ---- trust ---- */
      case 'need_link': {
        var l9 = related.filter(function (n) { return n.real === true && n.url; });
        if (!l9.length) r = { answer: '当前和你有关的通知里，没有带原始链接的条目。', basis: '筛选口径：real 为 true 且 url 非空。', tone: 'calm', items: [] };
        else r = {
          answer: '有 ' + l9.length + ' 条带安农官网原文链接，可以逐字核对，不放心就去点开看：',
          basis: '筛选口径：真实采集（real=true）且有 url，共 ' + l9.length + ' 条。',
          tone: 'ok', items: l9
        };
        break;
      }
      case 'trust': {
        var poolAll = notices || [];
        var real = poolAll.filter(function (n) { return n.real; }).length;
        var linked = poolAll.filter(function (n) { return n.real && n.url; }).length;
        r = {
          answer: '每次展示前都会自查一遍：' + poolAll.length + ' 条里 ' + real + ' 条是真实采集（其中 ' + linked + ' 条带官网链接可核对）。',
          basis: '依据：自查自纠系统的 auditPool 结果。三条铁律——出处可举证 / 链接不伪造 / 引文可定位。',
          tone: 'ok', items: []
        };
        break;
      }
      default:
        return null;
    }

    var meta = null;
    for (var qi = 0; qi < QUESTIONS.length; qi++) if (QUESTIONS[qi].id === id) meta = QUESTIONS[qi];
    var items = (r.items || []).slice(0, 8);
    return {
      id: id,
      q: meta ? meta.q : '',
      hint: meta ? meta.hint : '',
      group: meta ? meta.group : '',
      answer: r.answer || '',
      basis: r.basis || '',
      tone: r.tone || 'calm',
      items: items,
      itemCount: (r.items || []).length,
      materials: r.materials || null
    };
  }

  /* 问答分组（供网页渲染目录） */
  function askQuestionGroups() {
    return ASK_GROUPS.map(function (g) {
      return {
        key: g.key, label: g.label, icon: g.icon,
        questions: QUESTIONS.filter(function (q) { return q.group === g.key; })
          .map(function (q) { return { id: q.id, q: q.q, hint: q.hint }; })
      };
    }).filter(function (g) { return g.questions.length > 0; });
  }

  /* 今日一问（网页版：与小程序 ask.headline 同策略） */
  function askHeadline(opts) {
    var a = askAnswer('today', opts);
    if (a && a.items && a.items.length) return { q: a.q, answer: a.answer, tone: a.tone, id: a.id, more: '去看今天要办的 ›' };
    var m = askAnswer('miss', opts);
    if (m && m.itemCount) return { q: m.q, answer: m.answer, tone: m.tone, id: m.id, more: '看漏了什么 ›' };
    var w = askAnswer('week', opts);
    if (w) return { q: w.q, answer: w.answer, tone: w.tone, id: w.id, more: '看这周安排 ›' };
    return { q: '现在有什么要办的吗？', answer: '暂时没有和你有关的待办。', tone: 'calm', id: 'week', more: '' };
  }

  /**
   * 办事日历（与小程序 ask.buildCalendar 同源）。
   * 返回 { year, month, weeks, weekdays, today, busyDays, busyCount, monthItems, monthCount, summary }
   */
  function buildCalendar(notices, year, month, profile) {
    var today = new Date();
    var tY = today.getFullYear(), tM = today.getMonth() + 1, tD = today.getDate();

    /* 入参归一：与小程序 ask.buildCalendar 同源，月份越界（0/13/-1）要夹回 1-12 */
    year = (typeof year === 'number' && isFinite(year)) ? Math.round(year) : tY;
    month = (typeof month === 'number' && isFinite(month)) ? Math.round(month) : tM;
    var norm = shiftMonth(year, month, 0);
    year = norm.year; month = norm.month;

    var feed = relatedNotices(notices, profile);

    var byDay = {};
    feed.forEach(function (n) {
      if (!n.deadline) return;
      var s = String(n.deadline).slice(0, 10);
      var mm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!mm) return;
      if (+mm[1] !== year || +mm[2] !== month) return;
      var d = +mm[3];
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(n);
    });

    var first = new Date(year, month - 1, 1);
    var lead = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(year, month, 0).getDate();

    var cells = [];
    for (var i = 0; i < lead; i++) cells.push({ day: 0, key: 'blank' + i, blank: true });
    for (var d2 = 1; d2 <= daysInMonth; d2++) {
      var items = byDay[d2] || [];
      var cmp = (year - tY) * 10000 + (month - tM) * 100 + (d2 - tD);
      var isToday = (year === tY && month === tM && d2 === tD);
      var isPast = cmp < 0;
      var level = '';
      if (items.length) {
        var hasNow = items.some(function (n) { return n.countdown === 0; });
        var hasHot = items.some(function (n) { return typeof n.countdown === 'number' && n.countdown > 0 && n.countdown <= 3; });
        var hasSoon = items.some(function (n) { return typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7; });
        level = hasNow ? 'now' : hasHot ? 'hot' : hasSoon ? 'soon' : 'plan';
      }
      cells.push({
        day: d2, key: year + '-' + month + '-' + d2, blank: false,
        count: items.length, items: items, level: level,
        isToday: isToday, isPast: isPast, hasItem: items.length > 0
      });
    }
    while (cells.length % 7 !== 0) cells.push({ day: 0, key: 'tail' + cells.length, blank: true });

    var weeks = [];
    for (var k = 0; k < cells.length; k += 7) weeks.push(cells.slice(k, k + 7));

    var busyNums = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
    var monthItems = [];
    busyNums.forEach(function (dd) { byDay[dd].forEach(function (n) { monthItems.push(n); }); });
    monthItems.sort(function (a, b) {
      var ca = typeof a.countdown === 'number' ? a.countdown : 9999;
      var cb = typeof b.countdown === 'number' ? b.countdown : 9999;
      return ca - cb;
    });

    var summary;
    if (!monthItems.length) summary = '这个月没有要办的事。';
    else summary = '这个月有 ' + monthItems.length + ' 件要办，分布在 ' + busyNums.length + ' 天。';

    return {
      year: year, month: month, weeks: weeks,
      weekdays: ['一', '二', '三', '四', '五', '六', '日'],
      today: { y: tY, m: tM, d: tD },
      busyDays: busyNums, busyCount: busyNums.length,
      monthItems: monthItems, monthCount: monthItems.length,
      summary: summary
    };
  }

  function shiftMonth(year, month, delta) {
    /* 与小程序 ask.shiftMonth 同源：入参归一 + 取模一次到位（避免大 delta 死循环） */
    if (typeof year !== 'number' || !isFinite(year)) year = new Date().getFullYear();
    if (typeof month !== 'number' || !isFinite(month)) month = new Date().getMonth() + 1;
    if (typeof delta !== 'number' || !isFinite(delta)) delta = 0;
    var y = Math.round(year);
    var total = (y * 12) + (Math.round(month) - 1 + Math.round(delta));
    y = Math.floor(total / 12);
    var m = (total % 12 + 12) % 12 + 1;
    return { year: y, month: m };
  }

  /* 导出 */
  global.ZS = {
    TAGS: TAGS,
    TAG_KEYS: TAG_KEYS,
    tagMeta: tagMeta,
    levelOf: levelOf,
    refreshCountdowns: refreshCountdowns,
    splitQuery: splitQuery,
    snippet: snippet,
    highlight: highlight,
    search: search,
    hotWords: hotWords,
    locateQuote: locateQuote,
    buildRawSegs: buildRawSegs,
    traceRate: traceRate,
    matchByTag: matchByTag,
    tagCounts: tagCounts,
    getStats: getStats,
    noticeCollege: noticeCollege,
    matchCollege: matchCollege,
    matchAudience: matchAudience,
    passesIdentity: passesIdentity,
    /* 主动推送引擎 */
    PUSH_LEVEL: LEVEL,
    PUSH_WEIGHT: PUSH_WEIGHT,
    PUSH_OPPORTUNITY: PUSH_OPPORTUNITY,
    PUSH_INDIRECT_KW: PUSH_INDIRECT_KW,
    PUSH_MAX_RAW: PUSH_MAX_RAW,
    PUSH_MAJOR_SCORE: MAJOR_SCORE,
    pushLevelMeta: levelMeta,
    pushLevelOfCd: levelOfCd,
    pushReasons: pushReasons,
    pushScore: pushScore,
    pushScoreFromReasons: scoreFromReasons,
    pushPublishAge: publishAge,
    buildPush: buildPush,
    pushBuckets: pushBuckets,
    /* 自定义关键词订阅（与 miniprogram/utils/subscribe.js 同源） */
    normKeyword: normKeyword,
    noticeHaystack: noticeHaystack,
    keywordList: keywordList,
    matchKeyword: matchKeyword,
    hitKeyword: hitKeyword,
    sanitizeKeywords: sanitizeKeywords,
    MAX_KEYWORDS: MAX_KEYWORDS,
    /* 问知时 · 问答引擎 */
    askQuestions: QUESTIONS,
    askQuestionGroups: askQuestionGroups,
    askAnswer: askAnswer,
    askHeadline: askHeadline,
    relatedNotices: relatedNotices,
    /* 办事日历 */
    buildCalendar: buildCalendar,
    shiftMonth: shiftMonth,
    splitMaterials: splitMaterials,
    /* 触达时间线（与小程序 reachlist.js 同源） */
    advanceDays: advanceDays,
    planReach: planReach,
    buildReach: buildReach
  };
})(window);
