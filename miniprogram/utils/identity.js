/**
 * 知时 · 用户身份体系（单一事实来源）
 * ================================
 *
 * 为什么要有这个文件：
 *   「信息分类推送」的第一层是标签（转专业/竞赛/奖助学金…），
 *   第二层是**身份**——同一条通知，大一新生和大四学生、本科生和研究生看到的不一样。
 *   比如「转专业通知」只对大一有效，「招聘会」只对毕业生有效。
 *
 *   所以这里定一份身份维度词表（IDENTITY），并给一个
 *   「通知适用人群 → 身份标签」的匹配函数（matchAudience）。
 *
 * 【合规红线】
 *   身份信息**仅指**：身份类型（本科/研究生/教职工）+ 年级 + 学院 + 专业 + 校区。
 *   这些是**分类用的标签**，由用户在小程序里主动选择；
 *   绝不采集身份证号、学号、手机号、成绩、课表、一卡通等敏感或私域数据。
 *   —— 这条写进代码，也写进隐私清单。
 */

/* ============ 身份类型 ============ */
const IDENTITY_TYPES = [
  { key: '本科生',   icon: '🎒', desc: '全日制本科在读' },
  { key: '研究生',   icon: '🔬', desc: '硕士 / 博士在读' },
  { key: '教职工',   icon: '🧑‍🏫', desc: '在职教职工' }
];

/* ============ 年级 ============ */
/* 注意：年级以**入学年份**标识（2025级 = 2025 年入学），
 * 不随学年滚动改叫"大二/大三" —— 改名会让历史通知的 audience 匹配失准。
 * 每年新生入学后在这里补一条当年年级。 */
const GRADES = [
  '2026级 · 大一', '2025级 · 大一', '2024级 · 大二', '2023级 · 大三', '2022级 · 大四',
  '研究生 · 研一', '研究生 · 研二', '研究生 · 研三', '在职教职工'
];

/* ============ 学院（安农主要学院，可续补）============ */
const COLLEGES = [
  '信息与人工智能学院', '经济管理学院', '农学院', '林学与园林学院',
  '动物科技学院', '茶与食品科技学院', '生命科学学院', '资源与环境学院',
  '工学院', '理学院', '外国语学院', '人文社会科学学院'
];

/* ============ 校区 ============ */
const CAMPUSES = ['长江西路校区', '经开区校区', '南校区'];

/* ============ 「来源单位 → 归属学院」词表（本轮新增）============
 * 【为什么要这个 · 用户点出的真问题】
 *   一条通知发布在哪个单位自己的官网上，本身就说明了"它是给谁看的"。
 *   例：「机械与车辆工程学院…第十周考试安排」发布在**工学院官网**，
 *   考的是车辆工程各班（原文写着 `23车辆工程-3班`），**不该推给信院学生**。
 *   但它的 audience 是"未点名具体对象"，旧逻辑只好当它全员可见 → 跨院误推。
 *
 *   用户的原话很准：**每个学院都有他们自己的官网，各花入各眼。**
 *   所以规则是：**通知发布的来源单位若属于某个学院 → 只推给该学院学生**；
 *   来源是校级单位（图书馆/工会/教务处/保卫处/数据管理处…）→ 面向全校，不设限。
 *
 *   只在"能确定归属学院、且用户档案填了学院、且两者不一致"时才排除；
 *   用户没填学院 → 放行（不误杀）；来源认不出是学院 → 当校级，放行。
 * ============ */

/* 来源单位里的学院名 → COLLEGES 标准名。含常见简称/旧名。
 * 键做"包含匹配"（来源串里出现键，即视为该学院）。 */
const SOURCE_COLLEGE_ALIAS = [
  { kw: '信息与',      college: '信息与人工智能学院' },   // 信息与人工智能学院 / 信息与计算机学院（旧名）
  { kw: '计算机学院',  college: '信息与人工智能学院' },
  { kw: '人工智能学院', college: '信息与人工智能学院' },
  { kw: '经济管理学院', college: '经济管理学院' },
  { kw: '经管学院',    college: '经济管理学院' },
  { kw: '机械与车辆',  college: '工学院' },               // 机械与车辆工程学院（工学院）
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

/* 校级单位（面向全校，永不按学院设限）。来源串里出现这些即视为校级。 */
const UNIVERSAL_SOURCE_KW = [
  '图书馆', '校工会', '工会', '教务处', '本科生院', '研究生院', '学生工作处', '学工处',
  '保卫处', '数据管理处', '信息化办公室', '创新创业学院', '团委', '招生办', '就业',
  '财务处', '人事处', '后勤', '党政办', '校办', '宣传部', '通报', '通知公告（校级）',
  /* ★ 学术活动频道：学生报告/讲座/论坛 —— 是全校性的学术活动，不归属任何学院。
   *   标题里出现的学院名是"主办单位"，不是"只给该学院"。
   *   若不排除，工学院主办的讲座会被误判成"只给工学院"，把别的学院学生挡在外面。 */
  '学生报告', '学术报告', '学术讲座', '讲座', '论坛', '讲堂', '沙龙'
];

/**
 * 从通知的来源单位推断"这条通知归属哪个学院"。
 * @param {object} n 通知对象（用 n.source，必要时用 n.title 兜底）
 * @returns {string} COLLEGES 里的标准学院名；认不出则返回 ''（当校级）
 */
function noticeCollege(n) {
  const source = String((n && (n.source || '')) || '');
  const title  = String((n && n.title) || '');
  /* ① 校级单位优先：**只看来源串**。
   *   ⚠ 不能把标题并进来判校级 —— 否则「经济管理学院学术讲座」标题里的
   *   "讲座" 会把一个明确发布在经管官网的通知误判成校级，跨院误推。
   *   来源是校级单位（图书馆/本科生院/学生报告…）→ 全校可见，不归属任何学院。 */
  for (let i = 0; i < UNIVERSAL_SOURCE_KW.length; i++) {
    if (source.indexOf(UNIVERSAL_SOURCE_KW[i]) >= 0) return '';
  }
  /* ② 再看是不是某个学院的官网（来源优先，标题兜底） */
  const src = (source + ' ' + title).trim();
  if (!src) return '';
  for (let i = 0; i < SOURCE_COLLEGE_ALIAS.length; i++) {
    if (src.indexOf(SOURCE_COLLEGE_ALIAS[i].kw) >= 0) return SOURCE_COLLEGE_ALIAS[i].college;
  }
  return '';
}

/**
 * 学院维度的可见性判断（本轮新增）。
 * @param {object} n 通知
 * @param {object} profile 用户画像 { college }
 * @returns {boolean} true = 该用户能看到这条
 *
 * 规则：
 *   - 通知归属某学院 + 用户填了别的学院 → 排除（各花入各眼）
 *   - 通知归属某学院 + 用户填了同一学院 → 放行
 *   - 通知归属某学院 + 用户**没填**学院 → 放行（不误杀，只在能判断时才排除）
 *   - 通知是校级（noticeCollege 返回 ''）→ 放行
 *   - 通知标题/受众**明确写了"全校"** → 放行（即便发布在学院站点，也是面向全校的）
 */
function matchCollege(n, profile) {
  const owner = noticeCollege(n);
  if (!owner) return true;                       // 校级 → 全员可见
  const p = profile || {};
  const myCollege = String(p.college || '');
  if (!myCollege) return true;                   // 用户没填学院 → 不误杀
  /* 学院站点也可能发"面向全校"的东西：标题/受众写了全校/全体师生 → 放行 */
  const hay = String((n && n.title) || '') + ' ' + String((n && n.audience) || '');
  if (/全校|全体师生|全校师生|全校学生|各单位、?各学院|各学院、?各单位/.test(hay)) return true;
  /* 部门/学院名号里带"学院/处/部"等前缀的"面向学院"通知，不视为归属该学院 */
  return myCollege === owner;
}

/* ============ 身份 → 适用年级维度（用于 audience 匹配）============ */
/* 【说明 · 2026-11 清理】
 *  这里曾有一份 AUDIENCE_RULES（关键词 → 身份约束）和一份 UNIVERSAL_KW。
 *  实际匹配早已改由 matchAudience 内的"先识别范围形态、再判"逻辑承担
 *  （见下方 matchAudience 的注释：并列范围不能误杀是踩过的坑），
 *  这两份常量从未被使用 —— 留着只会让后人误以为改它们就能改匹配行为。
 *  故删除；要改匹配请直接改 matchAudience。 */

/**
 * 判断一条通知是否适合某个身份
 * @param {string} audience 通知的适用人群文本（zhishi_notices.audience 或 title/raw 兜底）
 * @param {object} profile  用户画像 { identityType, grade, college, major }
 * @returns {boolean} true = 该身份能看到这条
 *
 * 规则很保守：只在明确能判断时才排除，判不了就放行（保证不漏推）。
 *
 * 【踩过的坑 · 必须记住】
 *   早期实现是"逐关键词命中就判死"，结果把「全校本科生、研究生」这条
 *   错判成"只给研究生"——本科生被自己的推送系统漏掉了。
 *   根因：并列接收范围（A、B 都收）被当成了"更窄的那个"。
 *
 *   所以现在改成**先识别范围形态，再判**：
 *     1. 学历层次：本科生 / 研究生 同时出现 = 两类都收，谁都别排除；
 *        只出现其一 = 只给那一类。
 *     2. 教职工与学生互斥。
 *     3. 年级：原文点名 20xx级 才判，未点名不判。
 *     4. 专升本 / 中外合作 / 定向专项属于"附加限定"，档案里没有这一维
 *        → 判不出 → 放行，由展示层提示"请自行确认"（错杀真实机会的代价更高）。
 */
function matchAudience(audience, profile) {
  const a = String(audience || '');
  if (!a) return true;              // 通知没写适用人群 → 默认全员可见
  const p = profile || {};

  /* ---------- 一、学历层次约束 ---------- */
  /* 【踩过的坑 · 2026-11 修复】
   *   "本科"二字在安农通知里大量出现在**非受众语境**：
   *     「本科教学检查通知」「本科教育教学审核评估」「本科毕业论文（设计）工作会」
   *   ——这些是"本科教学环节的工作安排"，**不是"只有本科生能看"**。
   *   早期用 /本科/ 直接判定，导致研究生把「本科教学检查」这类通知**误排除**（漏推）。
   *   所以先剔除这些"本科XX工作"的组合词，再判是否真的在限定受众。 */
  const aNoWork = a.replace(/本科(教学|教育|培养|毕业|论文|专业建设|课程|实践|实习|工作|管理|评估|审核|认证)/g, '');
  const isBen  = /本科/.test(aNoWork);
  const isGrad = /研究生|硕士|博士/.test(a);
  /* 教职工只在"没同时写学生范围"时才视为教职工专属 */
  const isStaffOnly = /教职工|教师|在职/.test(a) && !isBen && !isGrad;

  const myType = String(p.identityType || '');
  const mineGrad = /研究生|硕士|博士/.test(myType);

  if (isStaffOnly) {
    /* 「教职工」和「学生」互斥 */
    if (myType !== '教职工') return false;
  } else if (isBen && isGrad) {
    /* 「本科生、研究生」并列 = 全校学生都收 —— 关键修复点：谁都不排除 */
    if (myType === '教职工') return false;
  } else if (isGrad && !isBen) {
    /* 只面向研究生 */
    if (!mineGrad) return false;
  } else if (isBen && !isGrad) {
    /* 只面向本科生 */
    if (mineGrad || myType === '教职工') return false;
  }
  /* 专升本 / 中外合作 / 定向专项：档案无此维度，不排除（放行） */

  /* ---------- 二、年级约束 ---------- */
  /* 词表从 GRADES 派生，不再手写第二份 —— 避免"GRADES 加了 2026级、
   * 这里的 gradeKw 忘了加"导致新生通知漏推（已踩过一次）。 */
  const gradeKw = GRADES
    .map(g => (g.match(/(\d{4})级/) || [])[0])
    .filter(Boolean)
    .map(kw => ({ kw: kw, grade: (GRADES.find(g => g.indexOf(kw) >= 0) || kw) }));
  const gradeHit = gradeKw.filter(g => a.indexOf(g.kw) >= 0);
  const myGrade = String(p.grade || '');
  if (gradeHit.length) {
    /* 原文点名了具体年级：档案年级必须在点名范围内 */
    const ok = gradeHit.some(g => myGrade.indexOf(g.kw) >= 0 || myGrade === g.grade);
    if (!ok) return false;
  } else if (/大一/.test(a) && /新生/.test(a)) {
    /* 只说"大一新生"没说具体级：档案若明确是别的年级 → 排除 */
    if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大一') < 0) return false;
  } else if (/毕业生|大四/.test(a) && !/就业|招聘/.test(a)) {
    /* 只说"毕业生/大四"（非招聘语境）：档案若明确是低年级 → 排除 */
    if (/\d{4}级/.test(myGrade) && myGrade.indexOf('大四') < 0 && myGrade.indexOf('研') < 0) return false;
  }

  /* ---------- 三、拿不准就放行 ---------- */
  return true;
}

/* 通知适用人群判不出时用标题兜底（与 store.passesIdentity 同源）
 * 说明：身份可见性 = 学历层次/年级（matchAudience）**且** 学院归属（matchCollege）。
 *   后者是本轮新增的"各花入各眼"规则：学院官网发的通知只推给本学院学生。 */
function passesIdentity(n, profile) {
  if (!matchCollege(n, profile)) return false;
  const aud = (n && n.audience && n.audience !== '原文未明确说明')
    ? n.audience
    : ((n && n.title) || '');
  return matchAudience(aud, profile);
}

/* 身份类型元信息 */
function meta(key) {
  const found = IDENTITY_TYPES.find(t => t.key === key);
  if (found) return found;
  // 未识别的 key 归一为「本科生」（保证 UI 永远有图标与描述）
  return IDENTITY_TYPES[0];
}

/* 简短的画像摘要，用于页面展示（如「本科生 · 大一 · 信智院」） */
function summarize(profile) {
  const p = profile || {};
  const parts = [];
  if (p.identityType) parts.push(p.identityType);
  if (p.grade) parts.push(p.grade.replace(/\s*·\s*/, ' '));
  if (p.college) parts.push(p.college);
  return parts.join(' · ') || '未设置身份';
}

module.exports = {
  IDENTITY_TYPES,
  GRADES,
  COLLEGES,
  CAMPUSES,
  SOURCE_COLLEGE_ALIAS,
  UNIVERSAL_SOURCE_KW,
  noticeCollege,
  matchCollege,
  matchAudience,
  passesIdentity,
  meta,
  summarize
};
