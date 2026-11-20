# AI 推荐层 · 接入与验证说明

> 修订日期：2026-11-16 ｜ 本文是 `docs/项目说明文档_知时.md` 的**补充举证材料**
> 适用形态：**实用版**（`知时.html` / `知时_可用版.html` / 小程序智能体通道）
> 「演示版」（`知时_演示版.html`）**保持原样、未接入 AI 推荐**，以维持离线静态演示的确定性 —— 这是刻意的产品分层。

---

## 一、先说清楚：三段链路各自的 AI 成色

| 环节 | 是否真调大模型 | 实现 |
|---|---|---|
| 抓取 | ❌ 不用（也不该用） | `tools/collect_notices.py` 真实 HTTP 采集；交付包内为快照，运行时不联网重抓 |
| 通读 / 理解 | ✅ 真调过 | `tools/agent/core.js` 构建期真调，46 条结构化产物注入通知池；`push_out/agent_run.json` 记 `mode=llm`、`36/36` 成功、`promptVersion 1.1.0` |
| **推荐（本次新增）** | ✅ **真调过** | `tools/agent/recommend.js`：按「通知 × 学生画像」输出相关性分 + 一句话理由 + 逐字引文 |

**准确说法**：理解由模型做、推荐由模型做，决策结果可解释（规则分保留供对照）；
模型产物在**构建期预计算并注入**，端上不实时调模型，**断网可完整演示**。
不要把整套链路说成「纯规则」，也不要说成「端上实时 AI」——两种都和留痕对不上。

---

## 二、双模设计（为什么不破坏断网可演）

```
构建期（有网、Node 端）
  tools/agent/build_ai_snapshot.js
    → 真调大模型（通知 × 画像）
    → web/zhishi-ai.js（window.ZS_AI，22 条 AI 推荐）
    → 由 tools/build_app.js 注入 知时.html / 知时_可用版.html
          │
          ├─ 断网打开实用版 → 读 ZS_AI 快照
          │    标注「AI 推荐 · 构建期预计算（非实时调用）」
          │
          └─ 配置智能体服务且联网 → POST /api/recommend
               实时按当前画像重排，标注「AI 推荐 · 实时大模型」

服务不可达 / 模型失败 → 自动降级规则推荐，标注「规则推荐（未启用 AI）」
```

- **规则算法完整保留**为降级基线：`WEIGHT` 权重表、`reasonsFor`、`scoreOf` 一行未改，96 处精确数值断言不动。
- **演示版天然隔离**：`tools/build_presentation.js` 只读 `web/zhishi-data.js`，不引用 `zhishi-ai.js`，重建前后 SHA256 完全一致。

---

## 三、真调证据（本次实跑，非计划、非设计稿）

| 项 | 实测 |
|---|---|
| 命令 | `node tools/agent/build_ai_snapshot.js`（`AI_SNAPSHOT_LIMIT=24`） |
| 模型 | `auto` |
| 提示词 | `RECOMMEND_VERSION = 1.0.0`（`tools/agent/prompt.js`，字段契约固定） |
| 候选 | 通知池 **130** 条 → 规则候选 **22** 条 |
| 结果 | **22 / 22 成功，0 失败**，耗时 **56,034 ms** |
| 产物 | `web/zhishi-ai.js`（6.4 KB，22 条 AI 推荐） |
| 留痕 | `push_out/ai_recommend_snapshot.json`、`push_out/ai_recommend_run.json`；**包内副本 `docs/AI推荐_运行留痕.json`** |
| 接口自测 | `check_agent_service.js` **91/91**（含 `/api/recommend` 11 条断言） |
| 全量自检 | `run_all.js` **27/27**；`check_llm_pipeline.js` **24/24** |

> 小批量预跑同样成功：`6/6`、15,091 ms，确认凭证 / SDK / 提示词链路通畅后才跑全量。

---

## 四、诚实性设计（答辩最容易被追问的部分）

1. **不冒充**：模型不可用、云未配置、返回非法 JSON、全失败 → 如实返回 `mode=rule` + `degraded` + `degradeReason`，绝不拿规则分冒称模型分。
2. **不伪装实时**：构建期快照在页面明写「非实时调用」，并带生成时间、模型名、提示词版本。
3. **可对照**：每条推荐同时保留 `relevance`（模型分）与 `score`（规则分），并标 `source: llm | rule`。
4. **不编造**：`evidence` 要求逐字复制通知原文连续片段，无合适片段填 `null`；`reason` 必须能在画像或原文里找到依据。
5. **自检绿灯 ≠ 模型已接通**：`check_llm_pipeline.js` 守的是「产物是否回流、是否说谎」，不守「模型能否调用」。接通证据是留痕文件里的 `22/22`。

---

## 五、接口契约

`POST /api/recommend`（`tools/agent/server.js`）

```json
// 请求
{ "useLLM": true, "limit": 12, "profile": { "grade": "2025级", "college": "信息与人工智能学院" } }

// 响应（成功）
{
  "ok": true, "mode": "llm", "aiPowered": true,
  "model": "auto", "promptVersion": "1.0.0",
  "items": [
    { "id": "...", "title": "...", "relevance": 88, "score": 54,
      "reason": "...", "evidence": "...", "source": "llm" }
  ],
  "meta": { "counts": { "pool": 22, "ai": 12, "rule": 0 }, "elapsedMs": 0 }
}
```

- `useLLM=false` / 云不可用 / 模型全失败 → `mode=rule`、`aiPowered=false`、`source=rule`、`evidence=null`。
- 两端客户端契约同源：`web/zhishi-agent.js` 与 `miniprogram/utils/agent.js` 均导出 `recommend()`，远端失败自动降级本地。

---

## 六、答辩可用口径（照念）

> 「推荐这一层我们做了双模：构建期用大模型对『通知 × 学生画像』做相关性判断，产物注入交付包，
> 所以断网演示时看到的就是真实模型结果，页面标了非实时调用；部署智能体服务后可切到实时 AI 推荐。
> 规则加权算法完整保留作为降级基线和可解释对照，每条推荐都能同时看到模型分和规则分。
> 有 22/22 的运行留痕、提示词版本和逐字引文可以逐条举证；演示版刻意不接入，保持静态演示的确定性。」

---

## 七、涉及文件清单

| 文件 | 作用 |
|---|---|
| `tools/agent/prompt.js` | 新增推荐层提示词 `RECOMMEND_VERSION / SYSTEM_PROMPT / buildRecommendPrompt`（与理解层常量分开，不破坏双端同源守卫） |
| `tools/agent/recommend.js` | 推荐引擎：真调模型、逐条容错、运行留痕 |
| `tools/agent/server.js` | 新增 `POST /api/recommend`、能力清单、路由 |
| `tools/agent/build_ai_snapshot.js` | 构建期快照生成器（vm 加载网页同源库，保证 id 逐条对齐） |
| `web/zhishi-agent.js` | 网页端 `recommend()` 契约 + 离线快照/规则降级 |
| `miniprogram/utils/agent.js` | 小程序端同契约（不加 UI，避免牵动页面断言） |
| `tools/app_shell.html` | 实用版「AI 推荐」区块 + 三态如实标注 |
| `tools/build_app.js` | 可选注入 `/*__AI__*/`（`web/zhishi-ai.js`） |
| `tools/checks/check_agent_service.js` | 新增 11 条 `/api/recommend` 断言（只测规则降级，不在自检里产生模型费用） |
| `web/zhishi-ai.js` | 构建期 AI 推荐快照（自动生成，勿手改） |
| `docs/AI推荐_运行留痕.json` | 包内留痕副本，供评委核对 |
