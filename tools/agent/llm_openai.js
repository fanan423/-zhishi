#!/usr/bin/env node
/**
 * 知时 · 通用 OpenAI 兼容大模型直连客户端（自备 API Key 通道）
 * ============================================================================
 *
 * 【为什么要有这一层】
 *   原来的理解 / 推荐只走 WorkBuddy 云 SDK，而 SDK 依赖 WorkBuddy 账号登录态。
 *   登录态会在换机器、长时间不用后过期（坐席上真踩到：返回「需要登录后使用」），
 *   这对"打开即用"的实用版是硬伤。
 *   本层提供第二条**不依赖 WorkBuddy 登录**的通道：任何 OpenAI 兼容接口
 *   （DeepSeek / 通义 / Kimi / 智谱 / OpenAI 官方 …）只要填 baseUrl + key + model
 *   即可真调。服务端代理调用，密钥只在服务端进程内，绝不下发到浏览器。
 *
 * 【通道优先级（由 recommend.js 决定）】
 *   ① 本层（自备 Key，OPENAI 兼容）  → ② WorkBuddy 云 SDK（需登录态）  → ③ 规则降级
 *
 * 【配置来源（优先级高→低）】
 *   1) 环境变量  ZHISHI_LLM_BASE_URL / ZHISHI_LLM_API_KEY / ZHISHI_LLM_MODEL
 *   2) config/llm.local.json       （gitignore + 打包器排除，绝不进提交包）
 *   也可以只给 provider，用内置预设补齐 baseUrl / model：
 *     deepseek | dashscope(通义) | moonshot(Kimi) | zhipu(智谱) | openai
 *
 * 【诚实性】
 *   没配 key / 请求失败 / 输出非 JSON → 如实返回，绝不伪造模型结果。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CFG_FILE = path.join(ROOT, 'config', 'llm.local.json');

/** 常见 OpenAI 兼容端点预设：用户只填 provider + key 也能跑 */
const PRESETS = Object.freeze({
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Kimi' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Kimi' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', label: '智谱' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
});

/** 读配置；返回 { available, provider, baseUrl, model, apiKey, source } */
function loadConfig() {
  let file = {};
  try {
    if (fs.existsSync(CFG_FILE)) file = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) || {};
  } catch (e) { file = {}; }

  const provider = String(
    process.env.ZHISHI_LLM_PROVIDER || file.provider || ''
  ).trim().toLowerCase();
  const preset = PRESETS[provider] || null;

  const baseUrl = String(
    process.env.ZHISHI_LLM_BASE_URL || file.baseUrl || (preset && preset.baseUrl) || ''
  ).trim().replace(/\/+$/, '');
  const model = String(
    process.env.ZHISHI_LLM_MODEL || file.model || (preset && preset.model) || ''
  ).trim();
  const apiKey = String(process.env.ZHISHI_LLM_API_KEY || file.apiKey || '').trim();

  const fromEnv = !!(process.env.ZHISHI_LLM_API_KEY || process.env.ZHISHI_LLM_BASE_URL);
  return {
    available: !!(apiKey && baseUrl && model),
    provider: provider || (preset ? provider : 'custom'),
    label: preset ? preset.label : (provider || '自定义'),
    baseUrl, model, apiKey,
    source: fromEnv ? 'env' : (file.apiKey ? 'file' : 'none'),
  };
}

/** 供前端展示的脱敏状态（绝不含 key / baseUrl 细节） */
function publicStatus() {
  const c = loadConfig();
  return {
    channel: 'openai-compatible',
    available: c.available,
    provider: c.provider,
    label: c.label,
    model: c.available ? c.model : null,
    configSource: c.source,
  };
}

/**
 * 把 SSE 流里的 content 拼成完整文本。
 * OpenAI 兼容流：每行 `data: {...}`，结束 `data: [DONE]`。
 * 同时兼容某些实现把整段 JSON 一次性返回（非流）。
 */
async function readStream(resp) {
  const ct = String(resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '');
  if (ct.indexOf('application/json') >= 0 && ct.indexOf('text/event-stream') < 0) {
    const j = await resp.json();
    const d = j.choices && j.choices[0];
    return (d && (d.message && d.message.content || d.text)) || '';
  }
  const reader = resp.body && resp.body.getReader
    ? resp.body.getReader()
    : null;
  if (!reader) {
    const txt = await resp.text();
    return extractFromSseText(txt);
  }
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return extractFromSseText(buf);
}

function extractFromSseText(text) {
  let answer = '';
  String(text || '').split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.indexOf('data:') !== 0) return;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const j = JSON.parse(payload);
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && d.content) answer += d.content;
      // 兼容 delta 里没有、message 里有的实现
      if (!answer) {
        const m = j.choices && j.choices[0] && j.choices[0].message;
        if (m && m.content) answer += m.content;
      }
    } catch (e) { /* 忽略半行 / 心跳 */ }
  });
  return answer;
}

/**
 * 真调一次（流式）。
 * @param {Array}  messages  [{role:'system'|'user', content:'…'}]
 * @param {object} opts      { temperature, timeoutMs, responseFormat }
 * @returns {Promise<{ok:boolean, text:string, model:string, provider:string, error?:string, httpStatus?:number}>}
 */
async function chat(messages, opts) {
  const o = opts || {};
  const c = loadConfig();
  if (!c.available) {
    return { ok: false, text: '', model: null, provider: c.provider,
             error: '未配置自备 API Key（config/llm.local.json 或环境变量）' };
  }
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, o.timeoutMs || 60000);
  const body = {
    model: c.model,
    messages,
    stream: true,
    temperature: o.temperature == null ? 0.2 : o.temperature,
  };
  // json_object 不是所有兼容端点都支持；默认带，失败时由上层用 responseFormat:false 重试
  if (o.responseFormat !== false) {
    body.response_format = { type: 'json_object' };
  }
  try {
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + c.apiKey,
      },
      body: JSON.stringify(body),
    };
    if (ctrl) init.signal = ctrl.signal;
    const resp = await fetch(c.baseUrl.replace(/\/+$/, '') + '/chat/completions', init);
    clearTimeout(timer);
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch (e) { /* ignore */ }
      return { ok: false, text: '', model: c.model, provider: c.provider,
               httpStatus: resp.status,
               error: 'HTTP ' + resp.status + (detail ? '：' + detail : '') };
    }
    const text = await readStream(resp);
    return { ok: true, text, model: c.model, provider: c.provider, label: c.label };
  } catch (e) {
    clearTimeout(timer);
    const msg = (e && e.name === 'AbortError')
      ? '请求超时'
      : ((e && e.message) || String(e));
    return { ok: false, text: '', model: c.model, provider: c.provider, error: msg };
  }
}

module.exports = {
  PRESETS, CFG_FILE,
  loadConfig, publicStatus, chat,
  available: () => loadConfig().available,
};
