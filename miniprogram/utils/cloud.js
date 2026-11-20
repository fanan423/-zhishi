/**
 * 知时 · 云服务接入层
 * ====================
 *
 * 【当前状态】适配器已就绪；云端能力「已开通」但**本地演示默认关闭**。
 *
 * 设计原则：**可降级适配**
 *   - CLOUD_ENABLED = false 时（当前默认）：自动走本地存储，小程序照常可跑可演示
 *   - CLOUD_ENABLED = true  时：填好 publicConfig 即自动切换到云端
 *   - 两套实现对外接口完全一致，上层页面代码一行都不用改
 *
 * 【为什么当前默认关闭云端（重要）】
 *   本地演示/提交演示时，小程序项目里**没有 node_modules / miniprogram_npm**
 *   （云 SDK 未安装）。若 CLOUD_ENABLED = true，微信开发者工具的编译器在
 *   静态解析 `require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')` 时
 *   会直接报「模块不存在」——try/catch 拦不住**编译期**的模块解析。
 *   因此默认关闭，保证「导入 → 编译」一次通过、零配置可跑。
 *   本地模式数据来自 data/notices.js（打包进代码），推送/溯源/问答/日历全可用。
 *
 * 【依赖声明已归档】
 *   为避免开发者工具弹出「构建 npm」提示，miniprogram/package.json 已改为
 *   无外部依赖的最小版本；原始带云 SDK 的版本归档在
 *   tools/cloud/package.json.bak 与 tools/cloud/package-lock.json.bak。
 *
 * 【要启用云端时】
 *   ① 在 miniprogram/ 下 `npm install`（依赖见 tools/cloud/package.json.bak）；
 *   ② 用开发者工具「工具 → 构建 npm」；
 *   ③ 把本文件 CLOUD_ENABLED 改成 true 即可恢复云端。
 *
 * 【合规声明】
 *   本文件只做三件事：① 存学生自己填的订阅偏好与身份标签 ② 存公开通知数据 ③ 调大模型做理解。
 *   身份标签 = 身份类型（本科/研究生/教职工）+ 年级 + 学院 + 专业 + 校区，
 *   全部由用户在「我的」页主动选择，用于把通知按身份分类推送。
 *   不读取、不上传任何校内私域数据（课表/成绩/学籍/一卡通/身份证号）。
 */

/* 提示词同源：与 Node 端 tools/agent/prompt.js 逐字一致，
 * 由 tools/checks/check_llm_pipeline.js 守两端版本。 */
const { SYSTEM_PROMPT, buildUserPrompt } = require('./llm_prompt.js');

/* ============================================================
 * 云端公开配置（配置外置 · 2026-11-15）
 * ------------------------------------------------------------
 * 真实值已移到 config/cloud.local.json（被 .gitignore 与打包器排除），
 * 不再硬编码在会随小程序源码分发的本文件里。
 * 本文件只保留**空占位**：CLOUD_ENABLED=false 时端上根本不会连接云端，
 * 因此留空不影响断网演示；需要启用云端时，由构建/部署流程注入真值。
 * 模板见 config/cloud.example.json；Node 端读取逻辑见 tools/agent/core.js
 * 的 loadPublicConfig()（环境变量 > local.json > 回退本文件）。
 * ============================================================ */
const PUBLIC_CONFIG = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: '',
  workBuddyOAuthClientId: ''
};

/* 本地演示默认关闭（见文件头【为什么当前默认关闭云端】）。
 * 装好云 SDK 并「构建 npm」后，把这里改成 true 即可恢复云端。 */
const CLOUD_ENABLED = false;

/* ============================================================
 * 本地降级实现（云服务未开通时使用）
 * ============================================================ */
const LOCAL_KEYS = {
  profile: 'zhishi_profile',
  noticesCache: 'zhishi_notices_cache'
};

const localAdapter = {
  name: 'local',

  async getProfile() {
    try {
      const p = wx.getStorageSync(LOCAL_KEYS.profile);
      return p && p.interests ? p : null;
    } catch (e) {
      return null;
    }
  },

  async saveProfile(profile) {
    wx.setStorageSync(LOCAL_KEYS.profile, profile);
    return { ok: true, where: 'local' };
  },

  async listNotices() {
    // 本地模式下通知数据来自 data/notices.js（打包进代码）
    const { NOTICES } = require('../data/notices.js');
    return NOTICES;
  },

  async understandNotice(notice) {
    /* 构建期注入的离线大模型理解产物（tools/agent/export_llm_fields.js）。
     * 这是「同一 understandNotice 契约」的离线实现：端上不装 SDK、不联网、
     * 断网也能展示模型结果；产物带 model / at / promptVersion，页面如实标注来源。 */
    if (notice && notice.llm && notice.llm.fields) return notice.llm.fields;
    // 没有离线产物时如实返回 null，绝不冒充已理解
    return null;
  }
};

/* ============================================================
 * 云端实现（云服务开通后使用）
 * ============================================================ */
let cloudClient = null;

function ensureCloudClient() {
  if (cloudClient) return cloudClient;
  if (!CLOUD_ENABLED) return null;

  try {
    /* 【关键】这里不写字符串字面量的 require，避免微信开发者工具在
     * CLOUD_ENABLED=false（无 node_modules）时**编译期**就报「模块不存在」。
     * 用变量拼接包名 —— 静态扫描扫不到，运行期真正走到这里时才解析。
     * 需要云端时保持同样写法即可，装好 npm 后照常工作。 */
    const SDK_PKG = '@tencent-ai/workbuddy-cloud-sdk/miniprogram';
    const { createMiniProgramWorkBuddyCloud } = require(SDK_PKG);
    const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

    cloudClient = createMiniProgramWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey,
      workBuddyOAuthClientId: PUBLIC_CONFIG.workBuddyOAuthClientId,
      wx: createDiagnosticWx(wx)
    });
    return cloudClient;
  } catch (e) {
    console.warn('[知时] 云服务初始化失败，回退本地模式：', e && e.message);
    return null;
  }
}

/* 云端适配器：把 SDK 的调用包成与 localAdapter 完全一致的接口 */
const cloudAdapter = {
  name: 'cloud',

  async getProfile() {
    const c = ensureCloudClient();
    if (!c) return null;
    try {
      const rows = await c.db.list('profile', { limit: 1 });
      return (rows && rows[0]) || null;
    } catch (e) {
      console.warn('[知时] 云端读画像失败：', e && e.message);
      return null;
    }
  },

  async saveProfile(profile) {
    const c = ensureCloudClient();
    if (!c) return { ok: false, where: 'cloud' };
    try {
      await c.db.upsert('profile', profile);
      return { ok: true, where: 'cloud' };
    } catch (e) {
      console.warn('[知时] 云端存画像失败：', e && e.message);
      return { ok: false, where: 'cloud' };
    }
  },

  async listNotices() {
    const c = ensureCloudClient();
    if (!c) return null;
    try {
      return await c.db.list('notices', { limit: 500 });
    } catch (e) {
      console.warn('[知时] 云端读通知失败：', e && e.message);
      return null;
    }
  },

  async understandNotice(notice) {
    /* ① 离线产物优先：与 Node 端智能体共用同一份理解结果，断网可演 */
    if (notice && notice.llm && notice.llm.fields) return notice.llm.fields;

    /* ② 在线重新理解（可选增强）：与 tools/agent/core.js 完全同一套调用契约，
     *    提示词同源、流式、JSON 输出、低温。默认 CLOUD_ENABLED=false 时不会走到这里。 */
    const c = ensureCloudClient();
    if (!c) return null;
    try {
      const stream = await c.llm.chat.completions.create({
        model: 'auto',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt({
            title: notice.title || '',
            raw: notice.raw || notice.digest || notice.text || ''
          }) }
        ],
        stream: true,
        response_format: { type: 'json_object' },
        temperature: 0.2
      });
      let answer = '';
      for await (const chunk of stream) {
        const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) answer += d.content;
      }
      return JSON.parse(answer);
    } catch (e) {
      console.warn('[知时] 云端理解失败，回退离线产物或规则版浓缩：', e && e.message);
      return null;
    }
  }
};

/* ============================================================
 * 对外统一接口
 * ============================================================ */

/* 当前运行模式：cloud / local */
function mode() {
  return (CLOUD_ENABLED && ensureCloudClient()) ? 'cloud' : 'local';
}

/* 云服务是否可用（页面据此决定 UI 提示） */
function isCloudReady() {
  return mode() === 'cloud';
}

/* 取当前生效的适配器 */
function getAdapter() {
  return isCloudReady() ? cloudAdapter : localAdapter;
}

module.exports = {
  mode,
  isCloudReady,
  getAdapter,
  getProfile: (...a) => getAdapter().getProfile(...a),
  saveProfile: (...a) => getAdapter().saveProfile(...a),
  listNotices: (...a) => getAdapter().listNotices(...a),
  understandNotice: (...a) => getAdapter().understandNotice(...a),
  PUBLIC_CONFIG
};
