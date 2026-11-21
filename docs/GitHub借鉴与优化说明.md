# 知时 · GitHub 开源借鉴与优化说明

> 调研日期：2026-11-21 · 依据：GitHub 公开仓库页面与 README（未逐行审计源码）
> 目的：把同类项目的成熟做法，转译成知时能落地、能自查、能答辩的改动。

---

## 一、调研了谁

| 项目 | Star（调研时） | 一句话 | 对知时最有价值的点 |
|---|---:|---|---|
| [aayushch/laya](https://github.com/aayushch/laya) | 834 | 本地优先的 AI 通知指挥中心，聚合 Gmail/Slack/GitHub/Jira/日历 | Action Card、每日简报、审计与失败事件恢复、按平台/人物分层路由、隐私分级 |
| [kevinho/clawfeed](https://github.com/kevinho/clawfeed) | 2413 | AI 新闻摘要，4 小时/日/周/月多频率，Web 仪表盘 | 多频率摘要切换、Source Packs、Mark & Deep Dive、Changelog/Roadmap 进产品 |
| [versun/RSSBox](https://github.com/versun/RSSBox) | 683 | 智能 RSS 管理：翻译、总结、过滤、合并源 | 逐源配置 AI、Token/字符用量可见、关键词过滤 + AI 智能过滤 |
| [Qetesh/miniflux-ai](https://github.com/Qetesh/miniflux-ai) | 255 | 给 Miniflux 加 AI 摘要/翻译/早晚报 | 配置化 agent、allow/deny 列表、Markdown/HTML 双输出 |
| [EPFLiGHT/LiGHT-Conferences-Calendar](https://github.com/EPFLiGHT/LiGHT-Conferences-Calendar) | 17 | 会议截止日历：倒计时、ICS 导出、提醒机器人 | **无数据库 + YAML 单一事实源 + CI 校验**；自动同步只开 PR、不直接写主分支；引文必须与网页原文逐字一致 |
| [BruceLanLan/augur](https://github.com/BruceLanLan/augur) | 709 | 本地优先研究记忆系统：证据时间语义、每次运行可复查 | **RunBundle 不可变留痕**、缺失数据显式标注、功能成熟度如实分级、默认只绑回环地址 |

> 说明：这些项目与知时的领域不同（办公通知、新闻、RSS、学术日历、投研），
> 我们只借鉴**机制**，不照搬业务，也不引入任何需要登录的私域数据源。

---

## 二、已经落地的优化

| # | 优化 | 借鉴自 | 落点 | 用户/评审能看到什么 |
|---|---|---|---|---|
| 1 | 日历导出 `.ics` | LiGHT Conferences Calendar | `tools/app_shell.html` → `APP.exportICS()` | 日历页多一个「导出日历(.ics)」按钮，可导入系统日历，断网可用 |
| 2 | 汇总多时间窗 | ClawFeed 多频率摘要 | `viewDigest()` / `APP.setDigestWindow()` | 汇总页可切 3 天 / 7 天 / 30 天，默认仍是原口径，不改变既有自检 |
| 3 | AI 运行留痕面板 | Laya 审计面板 + Augur RunBundle | `viewSelfcheck()` | 数据自查页直接显示构建期模型、提示词版本、成功条数与「非实时调用」标注 |
| 4 | 服务暴露安全警告 | Augur 默认回环地址 | `tools/agent/server.js` | 绑定非本机且未开鉴权时，启动即打警告；默认仍为 `127.0.0.1` |
| 5 | 功能成熟度表 | Augur 诚实分级 | `docs/功能成熟度.md` | 明确区分「稳定 / 可用有边界 / 未接入 / 明确不做」 |
| 6 | Changelog + 本说明 | ClawFeed / Augur 文档习惯 | `CHANGELOG.md`、本文件 | 每次改动有据可查，答辩时能讲清「为什么改」 |

---

## 三、借鉴但不照搬的三条边界

1. **不接多平台私域通知源**。Laya 接 Gmail/Slack/Jira，知时只聚合**无需登录的校园公开页**；
   这不是能力不足，而是参赛合规红线（见 `docs/参赛作品说明.md` 第四章）。
2. **不上向量库 / 多用户 OAuth**。混合检索和账号体系会破坏「双击即开、断网可演」的单文件形态；
   知时的搜索保留关键词命中 + 命中理由，已足够自证。
3. **不做自动直写主分支的数据更新**。参考 LiGHT 的「同步只开 PR、人工合并」，
   知时的数据更新继续走本地工具 + 27 个守卫 + GitHub Actions PR 校验，避免机器改坏事实源。

---

## 四、验证

- `npm run checks`：**27/27 全通过**（含单文件应用真渲染、真点击、AI 留痕一致性）。
- `知时.html` / `知时_可用版.html` 已重建；`dist/` 两版交付包已重打并交叉校验。
- 演示版刻意不接 AI 快照与本次交互新增，保持纯离线保险形态。

后续路线见 `docs/功能成熟度.md` 与 `CHANGELOG.md`。
