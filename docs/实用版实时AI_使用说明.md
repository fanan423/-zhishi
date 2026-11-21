# 知时 · 实用版实时 AI 使用说明

> 面向「打开就能真调大模型」的实用版。演示版不受影响，仍保持纯离线保险形态。

## 一句话

双击 `一键启动_AI版.bat` → 打开实用版网页 → 「汇总」页的 ✨ AI 推荐就是**服务端实时调用大模型**的结果（不是预计算快照）。

---

## 一、两种大模型凭证（都支持，自动择优）

服务端按下面的顺序自动选通道，**不需要改任何代码**：

| 优先级 | 通道 | 需要什么 | 标注 |
|---|---|---|---|
| ① 第一优先 | 自备 API Key（OpenAI 兼容） | `config/llm.local.json` 填 `apiKey` | `channel: openai-compatible` |
| ② 兜底 | WorkBuddy 云 SDK | 本机登录 WorkBuddy 桌面端 | `channel: workbuddy` |
| ③ 最后 | 规则加权 | 无需任何配置 | `mode: rule` |

**推荐用 ①**：不依赖 WorkBuddy 登录态，换机器、长时间不用也不会过期。这是我们把通道 ① 设为第一优先的原因——之前实测过 WorkBuddy 登录态过期后返回「该能力需要登录后使用」，对「打开即用」是硬伤。

### 配置自备模型（一次即可）

1. 复制 `config/llm.example.json` → `config/llm.local.json`
2. 把 `apiKey` 填成你的密钥，选一家（示例里已给默认）：

```json
{
  "provider": "deepseek",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "apiKey": "sk-你的密钥"
}
```

支持的内置预设（`provider` 可填简称，会自动补 `baseUrl` 与 `model`）：

| provider | 厂商 | 默认 model |
|---|---|---|
| `deepseek` | DeepSeek | `deepseek-chat` |
| `dashscope` / `qwen` | 通义千问 | `qwen-plus` |
| `moonshot` / `kimi` | Kimi | `moonshot-v1-8k` |
| `zhipu` | 智谱 | `glm-4-flash` |
| `openai` | OpenAI 官方 | `gpt-4o-mini` |

也可完全自定义 `baseUrl` + `model`（任何 OpenAI 兼容的 `/chat/completions` 端点都行）。

**也可以用环境变量**（适合不想落盘密钥的场景）：

```powershell
$env:ZHISHI_LLM_BASE_URL="https://api.deepseek.com/v1"
$env:ZHISHI_LLM_MODEL="deepseek-chat"
$env:ZHISHI_LLM_API_KEY="sk-..."
# 再启动服务
node tools/agent/server.js
```

> 密钥只在本地服务端进程内使用，通过 `/api/recommend`、`/api/understand` 代理调用，
> **绝不下发到浏览器**。`config/llm.local.json` 已被 `.gitignore` 与打包器排除，不进提交包。

---

## 二、一键启动

双击项目根目录的 **`一键启动_AI版.bat`**，它会：

1. 探测 Node 运行时（优先系统 `node`，回退 WorkBuddy 内置）
2. 检查是否已配置凭证；没配会给出引导
3. 若 8787 端口未监听，后台启动 `tools/agent/server.js`（绑定 `127.0.0.1`，安全）
4. 等服务就绪后，打开 `知时_可用版.html?agent=http://127.0.0.1:8787`
5. 页面读到 `?agent=` 参数，自动连接本机服务（普通打开不带该参数，仍是本地模式）

**关服务**：运行 `停止知时服务.bat`（或关掉那个最小化的「知时AI服务」窗口）。

### 手动启动（可选）

```powershell
node tools/agent/server.js --port 8787 --host 127.0.0.1
# 浏览器打开：
#   知时_可用版.html?agent=http://127.0.0.1:8787
```

---

## 三、怎么确认「真的在用大模型」

1. 浏览器打开 `http://127.0.0.1:8787/api/llm/status`，看：
   - `active` = `openai-compatible`（自备 Key）或 `workbuddy`（云 SDK）
   - `recommendReady` = `true`
   - 若 `active` = `rule`，说明没配密钥也没登录 WorkBuddy，会走规则推荐
2. 网页「汇总」页的 ✨ AI 推荐区块：
   - 标注「**实时大模型 · 自备模型 deepseek**」→ 真调成功
   - 标注「构建期预计算（非实时调用）」→ 离线快照（断网也能看，诚实标注）
   - 标注「规则推荐」→ 未连上服务或未配密钥
3. 网页「我的 → 数据自查」页的「AI 运行留痕」会增加一行「当前通道：实时大模型…」
4. 每次实时调用都写 `push_out/ai_recommend_run.json`，含通道、模型、提示词版本、逐条理由与逐字引文。

---

## 四、诚实性边界（答辩务必说清）

- 三条通道**如实标注来源**，规则结果绝不冒充 AI；模型失败就显示降级，不伪造理由。
- 断网 / 不启动服务时，实用版仍用**构建期真调的 AI 快照**（标注「非实时调用」），完整可演示。
- 演示版**没有**任何实时通道，也没有 AI 快照，是纯离线保险形态，本次改造对演示版零影响。
- 密钥 never 下发浏览器；智能体服务默认只绑 `127.0.0.1`，对外暴露且不开鉴权时启动即警告（见 `tools/agent/server.js`）。
