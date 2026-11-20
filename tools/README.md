# 工具说明 · tools/

本目录是「知时」的数据采集、理解与生成工具集。核心是一句话：

> **跑一次采集脚本 + 理解层，网页版和小程序的数据就自动更新，且每条通知都可搜、可溯源、可按标签推送。**

> 📌 **要接入新的安农信息源、或想测推送机制？** 看专文：
> [`docs/信息源接入与推送测试.md`](../docs/信息源接入与推送测试.md)
> （怎么加一个源、怎么跑全链路、推送怎么打分、怎么调权重、合规红线）。

> 🎬 **要录参赛演示视频 / 要交作品了？** 看这两份：
> [`docs/演示视频脚本.md`](../docs/演示视频脚本.md)（**5 分钟逐镜脚本**，秒数+屏幕动作+口播词，照念即可）
> 与 [`docs/大赛提交要求.md`](../docs/大赛提交要求.md)（**官方提交办法原文核对**：云盘链接、上传密码、命名格式）。
> 一条命令链路：`export_docx.py` 出 Word → `pack_submission.py` 出 zip → 上传云盘 → 群内回「已提交」。

---

## 零、怎么真的把它跑起来（最想看这个的话）

### A·0 统一门户「知时门户.html」（不知道从哪看起 · 首选这里）

```
双击项目根目录的  知时门户.html
```

演示页已经攒到十几个，散落各处、来回找文件很尴尬。这个门户把**所有入口收进
一个左侧导航 + 右侧内嵌工作区**：点左边一项，右边直接打开对应页；顶栏给一句话说明，
右上角「↗ 新窗口打开」可脱离门户单看。侧栏顶部四个 KPI（真实通知 / 来源单位 /
带官网链接 / 年份覆盖）**不是写死的**，而是构建时从 `web/zhishi-data.js` 现场统计，
数据一改、门户重跑，数字跟着变。

**导航不再一屏铺满**：首屏只放 **4 个主推大按钮**（可用应用 / 交互 Demo / 浓缩溯源 /
项目总览），其余 9 项收进 **3 个可折叠分组**（核心演示 / 落地面 / 形态预览，第一组默认展开），
点分组标题展开收起，避免十几项堆得繁琐。

支持 `#key` 直达：演示时直接贴 `知时门户.html#digest` 就能一进就落在「浓缩 + 溯源」页；
若目标落在折叠分组里，会**自动展开该组**再高亮。

由 `node tools\build_portal.js` 生成（读 `web/zhishi-data.js` 现算 KPI + 写死导航清单）。
根目录的 `打开总览.html` 与 `一键运行.bat` 现在都指向它（双击任一个都能进门户）。

### A. 单文件应用「知时.html」（零依赖，双击即用 · 首选）

```
双击项目根目录的  知时.html
```

就这一个文件，双击即开，**不需要服务、不需要联网、不需要装任何东西**。
它是把同源数据 + 同源算法 + 应用外壳内联而成的可运行应用，含：

- 四个 tab：通知（主动通知列表）/ 日程 / 汇总 / 我的
- **首屏主次分明**：通知页只留一张头条卡（今日一问 + 推送总览），通知列表**只展开前 3 条**，
  其余收进「展开更多」；分数 / 排名 / 标签等细节移到**详情页**，不堆首屏
- **① 自主完善档案**：身份类型 / 年级 / 学院 / 专业 / 校区 + 关注标签，全由你自己选
- **② 按档案自动推送**：只推和你身份、关注相符的通知，详情页可逐条核对「是否与我有关」
- **③ 自动整合信息**：一屏汇总，把临近截止的事压成一段话
- **④ 贴明出处**：标「可核对原文 / 真实采集 / 演示样例」，带链接的可点开复制比对
- **⑤ 主动推送引擎**：**理由即分数**的可解释评分（归一化 0-100，分数 = 理由权重之和）——
  今天截止 +40 / 三天内 +28 / 点名学院 +22 / 自定关键词 +20 / 订阅标签 +16 / 机会类 +14…；
  另有 **反馈闭环**（点开过的同类 +4）与 **重复抑制**（看多次没点开 -12），
  **新近发布补偿**（+6）让无截止日期的条目不至于永远沉底；
  只有三天内截止的才允许「打扰」，其余静默进流；推送设置页可开关、可调打扰级别、可看留痕
  （权重表与网页版同源，由 `check_parity.py` 守卫）
- **⑥ 数据自查自纠**：三条铁律（出处可举证 / 链接不伪造 / 引文可定位），
  不可靠的剔除、可疑的如实标注，全部留痕
- **⑦ 问答（自问自答）**：13 个安农学生真的会问的疑问（今天要办啥 / 先办哪个 /
  我漏了什么 / 是不是给我的 / 要备什么材料 / 数据可靠吗），一问一答；
  **每个答案都由真实字段算出，附「依据」一行说明算法，算不出就如实说算不出，不编结论**
- **⑧ 日历**：把有截止的通知落到月历格子上，回答「具体哪天忙、哪天能空」；
  与日程同一批数据，不是两套事实

数据一改（改 `miniprogram/data/notices.js` → 跑 `export_mp_data_to_web.py`），
重跑 `node tools/build_app.js` 即可重新生成。

### A·2 关掉页面也能收到提醒（真·后台推送）

应用内推送只在你打开 `知时.html` 时工作。要「关掉页面也提醒」：

```
双击 tools\注册后台推送.bat      # 注册到 Windows 任务计划，每天 08:00 / 20:00 自动检查
双击 tools\开始推送.bat          # 想立刻看效果，手动跑一次
node tools\push_daemon.js --status    # 查看后台推送状态
node tools\push_daemon.js --uninstall # 解除注册
```

它会读你的档案 → 读通知池 → 判定该不该打扰 → 弹**系统原生通知**（零依赖，
用 Windows 自带的 PowerShell + NotifyIcon；弹不出就降级为写推送记录，绝不静默失败），
并落一份 `push_out/今日推送.txt`，写明「推了什么、为什么推、来源是哪」。

> **本机没装 Node.js 也能弹**：双击 `tools\推送通知.vbs` —— 它零依赖，
> 只用 Windows 自带的脚本宿主 + PowerShell，读取 `push_out\今日推送.txt`
> 把「今天要办什么」浓缩成一句，弹一条原生气泡。没有记录时如实提示"先装 Node 跑一次"，
> 绝不编造。`开始推送.bat` 检测不到 Node 时就会引导你双击它。

### B. 交互 Demo「交互Demo.html」（想点着玩 · 带数据源总览）

```
双击项目根目录的  交互Demo.html
```

一部能真正点开、搜索、追问的手机模拟器（单文件，零依赖）。五个 tab：

- **通知** —— 主动通知列表，只推和你身份、关注相符的通知，主次分层（优先办 / 稍后看 / 已截止可回看），
  **优先办只展开前 3 条**、其余折叠；稍后看与已截止**合并一段、整体折叠**；可已读、可长按删除
  （卡片只留"要办什么"，不再堆「为什么推给你」；分数/排名/相关度收进详情页）
- **搜索** —— 关键词检索 + 命中来源说明（热词会传池筛选，保证点了一定搜得到）
- **问答** —— 自然语言问答 + 日历
- **数据源** —— 📊 200 条真实公开通知的**采集概览 KPI** + 来源单位 / 内容标签 / 年份分布柱状图 + 站点接入状态（被 WAF 拦截的站点**如实标注**）
- **订阅** —— 切身份 / 年级 / 学院 / 关注标签，回通知看通知列表实时重排（千人千面）

点任意卡片进详情，能看到**来源卡**（谁发布、何时发布、官网可核徽章、一键跳原文）
与**发布 → 今天 → 截止时间线**。

由 `tools\build_demo.py` 把同源数据 + 同源算法**原样内联**生成，改源码后重跑即可。

### C. 网页版总览（了解全貌用）

```
双击项目根目录的  一键运行.bat
```

它会自动起一个本地服务并打开浏览器，进场就是**统一门户** `知时门户.html`
（也可直接双击 `打开总览.html`，它会跳到门户）。

手动也行：

```powershell
node tools\serve.js 8420 . 知时门户.html
# 然后浏览器打开 http://127.0.0.1:8420/知时门户.html
# 只想看项目总览：http://127.0.0.1:8420/web/overview.html
```

### D. 小程序（用微信开发者工具）

```
微信开发者工具 → 导入项目 → 选择 miniprogram 目录
```

`project.config.json` 里 `appid` 已配 **`wx07d1c8d64c32808b`**（本项目注册的小程序 AppID）。
早期文档写的 `touristappid`（游客模式）已过时，2026-11-15 核对后更正。
用微信开发者工具导入 `miniprogram/` 目录后点「编译」即可；若本机不方便登录，
也可以在开发者工具里切「测试号 / 游客模式」编译预览，十个页面同样能真跑。

导入后点「编译」，十个页面都能真跑：

| 页面 | 能干什么 |
|---|---|
| `pages/index` 通知 | 主动通知列表：按可解释分数排序，只推相符通知（卡片只留要办什么），可切「按标签」视图 |
| `pages/push` 推送设置 | 推送开关 / 打扰级别 / 留痕 / 后台推送说明 / 通知列表预览 |
| `pages/search` 搜索 | 输入 / 点热词 / 点标签 → 出结果，命中词高亮，说清"为什么搜到" |
| `pages/detail` 详情 | 浓缩要点 → 点要点看原文出处 → 跳原文高亮核对（双向互跳） |
| `pages/timeline` 日程 | 按截止日分五档，看清"这周还有几件事" |
| `pages/digest` 汇总 | 一句话总结 + 知时指数 + 三天内要办 + 本周留意 |
| `pages/me` 订阅 | 改身份、开关 9 个标签 → 实时算"能收到几条" → 保存 |
| `pages/selfcheck` 数据自查 | 三条铁律 + 疑点标注明细 + 可举证清单 + 审计留痕 |
| `pages/ask` 问答 | 13 问自问自答：答案 + 「依据」+ 材料清单 + 相关条目，分六组目录 |
| `pages/calendar` 日历 | 月历网格：忙碌日圆点 + 紧急度图例 + 选中日明细 + 本月全部待办 |

---

## 一、一次性跑完整个流程（最常用）

在项目根目录依次执行这些命令即可（Python 路径按你的机器调整）：

```powershell
# 0. 设置控制台编码，避免中文乱码（可选，但建议）
$env:PYTHONIOENCODING="utf-8"

# 1. 采集：抓取学校各公开通知页 → data/notices_real.json
#    v2 架构：注册表驱动（data/sources.json 声明源）· 可插拔适配器 · 时效闸门 + 价值过滤
#    默认抓够 220 条（TARGET_COUNT），单源上限由 sources.json 的 per_site 决定
#    写入：notices_real.json（底本）/ notices_app.json（下游）/ notices_merged.json（兼容副本）
& C:\hclaw\python\python.exe "tools\collect_notices.py"

# 1.5 重清洗标题（列表页常把正文并进标题；联网采集后可选，无需重抓）
& C:\hclaw\python\python.exe "tools\reclean_titles.py"

# 2. 合并：真实数据并入 Demo 数据 → data/notices.json
& C:\hclaw\python\python.exe "tools\merge_real_into_demo.py"

# 3. 注入：把真实数据写进网页版和小程序
& C:\hclaw\python\python.exe "tools\inject_real_into_web.py"
& C:\hclaw\python\python.exe "tools\inject_real_into_mp.py"

# 4. 理解层：把裸原文浓缩成要点 + 原文出处（可溯源）
& C:\hclaw\python\python.exe "tools\inject_digest_into_mp.py"

# 5. 清洗：修标题污染、统一标签到词表
& C:\hclaw\python\python.exe "tools\fix_mp_titles_tags.py"

# 6. 重建「原始数据」展示页
& C:\hclaw\python\python.exe "tools\build_rawdata_page.py"

# 7. 同源导出：小程序数据 → 网页版（网页版三能力依赖这一步）
& C:\hclaw\python\python.exe "tools\export_mp_data_to_web.py"

# 8. 打包单文件应用 + 实跑验证
& C:\hclaw\python\python.exe "tools\build_app.js"   # 无 python 时用 node tools\build_app.js
node tools\checks\verify_web.js          # 网页版（vm 里跑逻辑层）
node tools\checks\verify_search.js       # 小程序（vm 里跑逻辑层）
node tools\checks\check_render.js        # 网页版真渲染（jsdom，点按钮走全链路）
node tools\checks\check_app.js           # 单文件应用真运行（jsdom，八项能力 + 边界加固 + 校徽 + 自定义关键词订阅，119 项）
node tools\checks\run_miniprogram.js     # 小程序真运行（Node 模拟 wx 宿主，十个页面全跑）
node tools\checks\check_preview.js       # 预览页十三屏结构 + 一句话卡片墙交互 + 校徽 + 关键词订阅（jsdom，217 项）
node tools\checks\check_preview_style.js # 预览页十三屏样式 / 配色 / 色阶 + 排版呼吸感 + 校徽 + 关键词订阅样式（97 项）
node tools\checks\check_demo_interactive.js # 交互 Demo 真点击（jsdom，39 项：通知列表/五点 Tab/搜索/详情时间线/档案/关键词订阅/问答/日历/长按删除/数据源总览）
node tools\checks\check_portal.js          # 统一门户真点击（jsdom，35 项：KPI/导航同集合/首屏自动开/点击切换/高亮/内层命中/#key 直达/文件真实存在/主推 4 按钮/分组折叠）
node tools\checks\check_submission.py      # 参赛交付就绪自检（通告/八章文档/打包器/程序齐备/合规/官方提交办法/导出器/逐镜脚本/智能体，96 项）
node tools\checks\check_entry.js         # 入口层自洽（启动页跳转/bat 引用/无 Node 退路，19 项）
node tools\checks\check_daydrift.js      # 倒计时日子前行不变式（全链口径一致）

# 8.5 生成「交互 Demo」单文件（依据真源内联，永远不漂移）
& C:\hclaw\python\python.exe "tools\build_demo.py"   # 产出项目根目录 交互Demo.html
# 8.6 生成「统一门户」单文件（把十几个入口收进左导航 + 右 iframe，KPI 现算）
node tools\build_portal.js               # 产出项目根目录 知时门户.html

# 8.7 导出「项目说明文档」Word（以官方模板 docx 为基底套版）
& C:\hclaw\python\python.exe "tools\export_docx.py"          # 产出 docs/项目说明文档_知时.docx（8 章套版）
& C:\hclaw\python\python.exe "tools\export_docx.py" --pdf    # 同时导出 PDF（需本机 Word）

# 8.8 参赛交付一键打包（填自己的队长学号与队名）
& C:\hclaw\python\python.exe "tools\pack_submission.py" --dry                     # 先预览，不落盘
& C:\hclaw\python\python.exe "tools\pack_submission.py" --sid 20231234 --team "队名"  # 真打包 → dist/
& C:\hclaw\python\python.exe "tools\pack_submission.py" --sid 20231234 --team "张三" --video 演示视频.mp4  # 带视频打包

# 9. 同源守卫：两边标签 / 数据 / 算法必须一致
& C:\hclaw\python\python.exe "tools\checks\check_parity.py"

# 10. 代码自检
& C:\hclaw\python\python.exe "tools\checks\check_miniprogram.py"
& C:\hclaw\python\python.exe "tools\checks\check_all_pages.py"
& C:\hclaw\python\python.exe "tools\checks\check_links.py"
& C:\hclaw\python\python.exe "tools\checks\check_wxml.py"
& C:\hclaw\python\python.exe "tools\checks\check_digest.py"
& C:\hclaw\python\python.exe "tools\checks\check_demo.py"
```

跑完刷新 `web/rawdata.html`、`web/index.html` 和微信开发者工具，数据就是最新的。

> **懒人版**：上面第 8-10 步那一串校验，直接一条命令跑完 ——
> ```powershell
> node tools\checks\run_all.js
> ```
> 它把 20 个校验脚本按清单跑一遍，末尾给一张总账（哪个过得快、哪个挂了、exit 码多少），
> 退出码 0 就代表**全部通过**。新增校验脚本时，往 `run_all.js` 顶部 `SUITE` 数组加一行即可。

---

## 一·二、想让智能体自己跑（不是"看页面"，是"它主动送上门"）

前面那些都是**你去看**的东西（页面、Demo、小程序）。这一节是**它来找你**的东西 ——
真正意义上的智能体：不问任何人，自己跑完一轮，把该给你的送达清单放到 `push_out\`。

```powershell
# ① 跑一轮（纯规则，零额度）：载入通知池 → 过两道闸门 → 装载画像 → 匹配打分 → 决策输出
node tools\agent.js

# ② 跑一轮（真调大模型理解通知：抽五要素 + 受众 + 截止 + 摘要）
node tools\agent.js --llm
node tools\agent.js --llm --limit 12          # 一次最多理解 12 条"还没理解过的"

# ③ 用你自己的画像（改 tools\agent_profile.json 里的年级/学院/订阅/关键词）
node tools\agent.js --llm --profile tools\agent_profile.json

# ④ 常驻模式：每 60 分钟自己跑一轮，不刷屏
node tools\agent.js --llm --every 60 --quiet

# ⑤ 注册成 Windows 计划任务（每天 07:30 / 21:00 自动跑；跑完即退，不占窗口）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install_agent_task.ps1 -At 07:30,21:00
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install_agent_task.ps1 -Remove    # 卸载
```

**产物**：
| 文件 | 给谁看 |
|---|---|
| `push_out\今日推送.txt` | 给人看 —— 「今天该主动送达的通知」清单，含分数、来源、倒计时、凭什么推 |
| `push_out\agent_run.json` | 给机器看 —— 六步全要素（池/闸门/匹配/卡片/送达/耗时/模式/模型） |
| `push_out\agent_memory.json` | 给智能体自己看 —— 已理解的通知**不重复调模型**（原文变了才重理解） |

**它凭什么可信**：打分与匹配**复用小程序同一套真源算法**（`miniprogram/utils/store.js` + `push.js`），
所以命令行跑出来的结论与小程序里看到的**必然一致**，不是两套事。
`tools\checks\check_submission.py` 的 J 段会验证这一点（28 项）。

**降级诚实**：没加 `--llm` 或云端不可用时，它**如实标注"规则版理解"**，绝不假装调过模型。

---

## 一·五、两道防线：「代码对不对」和「真的能跑吗」

这两件事**不是一回事**，吃过一次亏：

> 有一次所有静态检查全绿，但用户打开页面发现**搜索点不动**。
> 真因是：首次搜索时结果容器 `#sRes` 还没创建，写 `innerHTML` 直接抛
> `Cannot set properties of null`，整条搜索链路静默死掉——静态检查看不见这种错。

所以现在分两层验：

| 层次 | 脚本 | 验什么 |
|---|---|---|
| **静态** | `check_miniprogram.py` / `check_all_pages.py` / `check_links.py` / `check_wxml.py` | 文件齐不齐、字段对不对、页面能不能回总览、wxml 绑定的变量在不在 |
| **动态·逻辑** | `verify_web.js` / `verify_search.js` | 把逻辑层丢进 `vm` 里跑，断言搜索排序、分组、溯源定位率 |
| **动态·真渲染** | `check_render.js` | jsdom 真建 DOM、真点「运行智能体」、真在输入框打字回车，抓 JS 报错 |
| **动态·真运行** | `run_miniprogram.js` | Node 里搭最小 wx 宿主（App/Page/setData 的 data-path 语义），按 `app.json` 加载**十个页面**，驱动 onLoad→onShow→点击→跳转→搜索→溯源→刷新通知列表→问答→日历→订阅关键词，并比对两端分组结果；含主动推送引擎、问答问答引擎、日历、身份过滤、**「各花入各眼」学院归属过滤**、**自定义关键词订阅**、**已读/删除本地状态**与**边界加固回归**（倒计时实时刷新 / 极端输入不崩 / 日历 36 月网格恒等式 / 身份受众不漏推不误杀 / **学院归属：工学院官网通知不推给信院** / 受众抽取定点 / 报送类降权 / tier 与分数自洽 / 过期降权 / 说明类降权 / 远期软信号减半 / 已读删除口径自洽）（502 项） |

**为什么 `run_miniprogram.js` 值得存在**：小程序代码跑不起来时，
微信开发者工具只会给你一行红字，看不出是哪一步断的。
这个脚本能在**命令行**里把十页全跑一遍——`node tools\checks\run_miniprogram.js`
输出 484 项断言，哪步断了直接指出来。

> 注：`check_render.js` 和 `run_miniprogram.js` 需要 `jsdom`。
> 装法（npm 被策略拦时绕行）：
> ```powershell
> node "C:\Users\<你>\.workbuddy\binaries\node\versions\<ver>\node_modules\npm\bin\npm-cli.js" install jsdom --no-save
> ```

---

## 二、各脚本干什么

| 脚本 | 作用 | 输入 | 输出 |
|---|---|---|---|
| `collect_notices.py` | **采集器 v2（注册表驱动 · 可插拔源）**：源清单抽到 `data/sources.json`（10 个启用源 + 1 个预留源），按 `adapter` 名选解析器（`ahau_vsb` / `generic` / `szsn_api`）。主流程只管翻页/去重/落盘，不知道源长什么样。**时效闸门**丢弃早于 `FRESH_AFTER`（2025-01-01）的陈年——日期三源合并（列表日期 > 标题编码日期 `_title_date` > 详情页日期兜底）；**价值过滤**挡掉房产出租/招标采购 + 党政会议新闻（`NONSTUDENT_NEWS`，用精简标题 `_headline` 判定）+ 值班安排表；**同名去重**（`dedup_by_title`，跨源跨栏同稿收口）；`clean_title` 剥离并进标题的正文/日期前缀/「了解更多」按钮文字 | `data/sources.json` + 官网公开页 | `data/notices_real.json`、`notices_app.json`、`notices_merged.json` |
| `data/sources.json` | **源注册表（配置，非脚本）**：声明每个信息源怎么接——`adapter`（解析器）、`list_url`、`pages`、`per_site`、`audience`、`campus_units`、`enabled`。新增安农二级站只加一条；接数智安农改 `future_sources`。`blocked_sites` 如实记录 WAF 拦截源，`adapters` 定义各模板的解析规则 | — | 被 `collect_notices.py` 读取 |
| `reclean_titles.py` | **重清洗**：对已采的 `notices_merged.json` 重跑标题清洗 + 标签归一到 9 词表（无需重抓），并自检标签是否越界 | `data/notices_merged.json` | 重写 `notices_merged.json` |
| `merge_real_into_demo.py` | 把真实数据合并进 Demo 数据池 | `notices_real.json` | `data/notices.json`、`notices_merged.json` |
| `inject_real_into_web.py` | 注入真实数据到网页版 | `notices_merged.json` | `web/index.html` |
| `inject_real_into_mp.py` | 注入真实数据到小程序（带 `url` 供"去官网看原文"，清控制字符防污染 JSON） | `notices_merged.json` | `miniprogram/data/notices.js` |
| `inject_digest_into_mp.py` | **理解层（规则版）**：裸原文 → 一句话浓缩 + 要点 + 原文出处 + **受众抽取**（`pick_audience` 从原文读出"针对谁"：学院/年级/班级/考研党员/身份层次；识别"非学生事项（行政/新闻）"、"在职教职工"、"图书馆活动"、"竞赛选拔"）| `notices.js` | 重写 `notices.js`；`RESAMPLE_AUDIENCE=1` 可只重抽受众、保留浓缩 |
| `fix_mp_titles_tags.py` | **清洗层**：修标题污染、标签统一到 9 词表、重算浓缩 | `notices.js` | 重写 `notices.js` |
| `build_rawdata_page.py` | 生成「原始数据」展示页 | `notices_real.json` | `web/rawdata.html` |
| `export_mp_data_to_web.py` | **同源导出**：小程序数据 → 网页版数据；并现算 **META 数据总览**（真实/演示拆分、带链接数、含截止数、单位/标签/年份分布）供 Demo 数据源页渲染 | `miniprogram/data/notices.js` | `web/zhishi-data.js` |
| `build_app.js` | **打包可用应用**：把同源数据 + 同源算法 + 应用外壳内联成单文件 `知时.html` | `web/zhishi-data.js`、`web/zhishi-core.js`、`tools/app_shell.html` | 根目录 `知时.html` |
| `build_demo.py` | **生成交互 Demo**：把同源数据 + 同源算法**原样内联**进一个手机外框 HTML；五 tab（通知/搜索/问答/**数据源**/订阅）；数据源页含 KPI + 单位/标签/年份分布 + 站点接入状态（含被 WAF 拦截站点如实标注）；详情页含**来源卡 + 发布→今天→截止时间线**；因为读的是真源文件，Demo 不可能和源码漂移 | `web/zhishi-data.js`、`web/zhishi-core.js` | 根目录 `交互Demo.html` |
| `build_portal.js` | **生成统一门户**：把散落的十几个入口收进「左导航 + 右 iframe 工作区」的单文件页；**首屏只放 4 个主推大按钮**（可用应用/交互 Demo/浓缩溯源/项目总览），其余 9 项收进 3 个可折叠分组，避免一屏堆砌；侧栏 4 个 KPI（真实通知/来源单位/带链接/年份覆盖）从 `web/zhishi-data.js` **现场统计**而非写死；支持 `#key` 直达（落到折叠组自动展开）、点击切换高亮、「新窗口打开」；导航清单与本脚本同源（校验会核对集合一致） | `web/zhishi-data.js` | 根目录 `知时门户.html` |
| `export_docx.py` | **项目说明文档 Word 导出器**：以**官方《项目说明文档（模板）》docx 为基底**（保留其页边距与样式），把 `docs/项目说明文档_知时.md` 按**官方八章结构**就地填充——封面 7 行表 + 章标题编号 + 章六 7 列工具表全部对齐模板；**个人信息未填则写「（待填）」绝不伪造**；`--pdf` 时用本机 Word 转 PDF（没装 Word 会如实提示手动另存，不假装成功） | `docs/项目说明文档_知时.md`、官方模板 docx | `docs/项目说明文档_知时.docx`（+`.pdf`）、按官方命名的一份 |
| `pack_submission.py` | **参赛交付一键打包器**：按大赛命名格式（`队长学号+队名+作品名+访问入口/项目说明文档/演示视频`）把**完整可运行程序 + 参赛通告 + 说明文档（md+docx+pdf）+ 逐镜脚本**打成 zip，并生成**含云盘链接与上传密码**的提交清单；`--dry` 先预览不落盘；缺视频/文档**如实标注不伪造**；自动排除 `node_modules`、`_原始材料`、`_extract` 等 | 项目根目录交付物 | `dist/<命名>.zip`、`dist/<命名>+项目说明文档.docx/.pdf`、`dist/提交清单.md` |
| `show_miniprogram.js` | **小程序真跑预览页生成器**：Node 模拟 wx 宿主把小程序**六页**（首页/搜索/详情/我的/信息源/**推送设置**）数据真跑一遍，渲染成手机外框静态页——第⑥屏含**微信服务通知**（订阅授权真交互 + 演示模式降级）与**提醒时间**（与你相关/已规划提醒/未来 14 天打扰次数 + 按天分组）；`wx.request/login` 做 **fail-fast**，离线时快速失败绝不挂死；生成物计数与真值同源 | `miniprogram/**` | `web/mp-preview.html` |
| `push_daemon.js` | **后台主动推送**：读档案 → 读通知池 → 判该不该打扰 → 弹系统通知 + 落推送记录（`--install/--uninstall/--status/--dry`） | `miniprogram/data/notices.js`、`tools/push_profile.json`（可选） | `push_out/今日推送.txt`、系统通知 |
| `serve.js` | **零依赖本地服务器**（没装 python 时的退路）：默认服务 `web/`、首页 `overview.html`；也可传参覆盖根目录与首页（`node tools\serve.js 8420 . 知时门户.html` 服务项目根、首页门户） | — | 127.0.0.1 上的静态服务 |

**校验脚本**（在 `tools/checks/`）：

| 脚本 | 作用 |
|---|---|
| `run_all.js` | **一键全量校验**：把下面 20 个脚本按清单跑一遍，末尾给总账（通过/失败/耗时/退出码），exit 0 = 全绿 |
| `check_miniprogram.py` | 11 节代码自检（含标签一致性、能力完整性、云接入层、问答问答引擎、日历、推送页与 push.js 文件清单） |
| `verify_search.js` | 实跑小程序逻辑层，验证搜索排序/分组/溯源定位率 |
| `verify_web.js` | 实跑网页版逻辑层，并逐条比对与小程序的数据一致性 |
| `verify_multisource_push.js` | **多信息源 × 推送端到端**：装 wx 桩，从真实数据出发验六件事——**数据真实性**（真实条目带链接/正文/时间）、**多源性**（来源单位 ≥5）、**定向正确**（工学院官网通知：信院不可见/工学院可见/未填不误杀；图书馆校级全员可见）、**可溯源**（真实推送卡片 100% 带原文链接）、**分档完整**（每张卡片有 0-100 分 + 推送理由）、**自定义关键词订阅**（订「正大杯」→入流 + 带 KW_MATCH 理由 + 仍可溯源 + 不越学院过滤）（25 项） |
| `check_render.js` | **网页版真渲染**（jsdom）：真点按钮、真打字回车，抓 JS 报错 |
| `run_miniprogram.js` | **小程序真运行**（Node 模拟 wx 宿主）：十页全跑 + 两端结果比对 + 自查自纠 + 主动推送引擎（**归一化分数 / 理由权重同源 / 机会类加权 / 反馈闭环 / 重复抑制 / 非学生事项剔除 / 报送类 INDIRECT 降权 / 过期 EXPIRED 降权 / 说明类 EXPLAIN_ONLY 降权 / 远期软信号减半**）+ **自定义关键词订阅**（清洗 / 上限 / 命中统计 / 入流 / KW_MATCH / 增删 / 长词优先 / 不越学院过滤）+ **首屏主次梯度**（今日头条卡 heroCard / 梯度流 tieredFeed：**tier 由分数决定**，紧急或高分进中卡）+ **已读/删除本地状态**（readstate：已读标记、隐藏过滤、统计口径自洽、页面级联动）+ 问答问答引擎 + 日历 + **边界加固回归**（倒计时实时刷新 / 极端输入不崩 / 日历 36 月网格恒等式 / 身份受众不漏推不误杀 / 受众抽取定点 / 过期排序 / tier 与分数自洽）（502 项） |
| `check_app.js` | **单文件应用真运行**（jsdom）：加载 `知时.html`，验八项能力（自主完善档案 / 自动推送 / 自动整合 / 贴明出处 / 主动推送引擎 / 自查自纠 / 问答 / 日历）与交互，含**自定义关键词订阅**（输入框 / chips / 增删 / KW_MATCH 理由 / 入流）、**边界加固回归**（倒计时与今天自洽 / 月份越界夹回 / 问答答案与数据自洽 / 受众匹配 / R2 铁律）、**首屏精简回归**（卡片不再堆「为什么推给你」/有来源与倒计时/首屏不堆分数排名/其余折叠）、**校徽元素**（双圆形 + AAU 展开书页 + 建校 1928）与**排版呼吸感**（字号下限 / 内边距 / 卡片间距）（119 项） |
| `check_preview.js` | 预览页（`小程序预览.html`）**十三屏**结构 + **一句话卡片墙交互**校验：13 屏元素齐全 + 真实 entries + 高度密度 + 配色变量 + **校徽元素**（双圆形 + AAU 书页 + 田野 + 1928）+ 推送卡片四档色阶 + 问答卡与月历网格 + **卡片墙**（默认只给一句话结论 / 点开把对应屏搬进舞台独占一行 / 收起精确放回原位 / 一次只展开一屏 / 「全部展开」与「一句话总览」双边切换）（212 项） |
| `check_preview_style.js` | 预览页样式与配色校验：主题变量 + 色阶 + **校徽元素**（双圆形内环 / 书页 / 1928 / 三元素纵向有序不重叠）+ **排版呼吸感**（字号下限 11px / 卡片间距 / 壳高 ≥840px / 列宽 ≥360px / 校徽收敛）+ **推送卡已精简**（不再有理由框）+ **关键词订阅样式**（输入框 / chips / 推荐词）（97 项） |
| `check_demo_interactive.js` | **交互 Demo 真点击**（jsdom）：加载项目根目录 `交互Demo.html`，真点真长按——通知列表渲染（级别/来源倒计时/分数/主次分区/官网可核徽章，**不再堆「为什么推给你」**）+ **五 Tab 切换** + 搜索（热词→结果→命中来源）+ 详情（来源卡/时间线/浓缩要点/原文核对/已读删除按钮）+ 档案切换重排 + 问答（回答+依据）+ 日历翻月 + 长按 ActionSheet 删除生效 + **数据源总览页**（KPI/单位与标签分布柱状/年份分布/被 WAF 拦截站点如实标注）（34 项） |
| `check_portal.js` | **统一门户真点击**（jsdom）：加载 `知时门户.html`——侧栏 KPI 卡 4 张且数字非占位、导航项数与分组、`data-key` 唯一、**每个入口指向的文件真实存在**、**入口集合与 `build_portal.js` 的 NAV 清单同集合**、**主推大按钮恰 4 个且落在首屏最上、折叠分组 3 组默认仅第一组展开、点分组头可展开收起、`#key` 落到折叠组自动展开**、首屏自动打开「可用应用」且 hint 隐藏、点击切换 iframe.src/高亮/顶栏标题/新窗口链接、点内层元素也能命中、`#key` 直达、未知 `#hash` 优雅回落（35 项） |
| `check_submission.py` | **参赛交付就绪自检**（**67 项**）：A 参赛通告要素齐全 / B 八章说明文档含官方八章标题 / C 打包器 `--dry` 可跑通且**打包清单里每个文件真实存在** / D 可运行程序齐备 / E **合规红线表述只出现在"不做"的否定语境里** / F 文档与工具一致（通告引用打包器+导出器+逐镜脚本）/ G **官方提交办法要点已录入**（云盘链接、密码、命名三段式、不得混用、截止 23:00、路径 2 风险对冲）/ H **Word 导出器可跑通、产物含全部官方八章标题与 7 列工具表、封面标题已替换、无 XXX 残留**（会**自动探测可用 Python 解释器**，避免 PATH 里那个没装 python-docx 的版本误判）/ I **逐镜脚本覆盖评分四维度 + 总时长不超 5 分钟 + 含录制清单/砍片指引/答辩预演** |
| `check_parity.py` | **同源守卫**：标签 / 数据 / 算法常量 / **搜索热词候选表**（hotWords 两端一致且都支持传池筛选）/ 能力 / 问答问答（13 问逐字 + 机会类白名单）/ **身份受众匹配**（组合词排除 + 年级词表同源）/ **「各花入各眼」学院归属**（noticeCollege+matchCollege 两端都在 + 学院别名表 19 条一致 + 校级关键词表 23 条一致 + 工学院→工学院抽查），两边必须一致 |
| `check_daydrift.js` | **倒计时日子前行不变式**（端到端）：A 段合成数据验 `refreshCountdowns` 纯函数/幂等/异常输入不产 NaN；B 段真实数据验 `refreshCountdowns → myFeed → ask` 全链口径一致（问答数出来的件数 == 关注流同口径件数） |
| `check_entry.js` | **入口层自洽**（用户双击那一层）：根目录启动页合法 + 跳转目标存在（`打开总览.html` 现跳 `知时门户.html`）；`一键运行.bat` 引用的 serve.js / 知时门户.html / 注册后台推送.bat / 知时.html 都在 + python/node 双退路；`tools` 推送脚本互相引用齐全（**含"无 Node 退路" `推送通知.vbs` 必须真的存在**，且不内嵌中文到临时 PS、有记录不存在的如实提示）；`知时.html` 自包含（25 项） |
| `check_wxml.py` | wxml 里绑定的变量，在页面 data 里是否真的存在 |
| `check_all_pages.py` | 全部展示页能不能打开、关键结构在不在；**含 10 页结构 + 入口页链接落地 + 反向覆盖（防孤岛页）+ 合规红线扫描 + `mp-preview.html` 真跑数据完整性**（计数栏在、无 `undefined`/`NaN`/`[object` 渲染残留） |
| `check_links.py` | 页面互链完整性（含"每个内页都能回到总览"） |

**⚠ 顺序很重要**：`inject_digest_into_mp.py` 必须在 `inject_real_into_mp.py` **之后**跑（它处理的是裸原文）；
`fix_mp_titles_tags.py` 又必须在理解层之后（标题干净了，浓缩才准）；
而 **`export_mp_data_to_web.py` 必须在所有改数据脚本之后跑**——它是网页版的唯一数据来源。

**⚠ 重跑采集后的额外两步（2026-11-15 补）**：
1. 采集会重编 id，`notices.js` 被重写 → 必须先跑 `node tools/agent/reset_llm_baseline.js`
   重建 LLM 回流基线，否则 `export_llm_fields.js` 的「手工改动保护」会误拦。
2. 新采集的讲座类通知容易残留 `audience: "原文未明确说明"` 占位符，
   跑一次 `$env:RESAMPLE_AUDIENCE="1"; python tools/inject_digest_into_mp.py` 重抽受众，
   否则 `run_miniprogram.js` 的「定点推送根基」守卫会变红。

**⚠ `inject_real_into_web.py` 已废弃**：`web/index.html` 早已改成
`var NOTICES = ZS_DATA.NOTICES`（读 `web/zhishi-data.js`），不再有可注入的数据块。
该脚本会报「找不到 NOTICES 块的结束位置」，**对交付物无任何影响**，
不要为它修锚点（那等于把已删掉的旧结构再装回去）。完整数据血缘见
`docs/数据血缘与单一事实来源.md`。

---

## 二·五、七能力的两种形态（单文件应用 = 小程序）

用户提的要求是「把这个版本在开发者工具里跑一遍，让**网页版也同步成搜索 + 分组，体验完全一致**」，
也就是**同源**：一个东西、两种出口。所以拆成两层：

| 层 | 小程序 | 网页版 | 说明 |
|---|---|---|---|
| **逻辑层** | `miniprogram/utils/tags.js`<br>`miniprogram/utils/search.js`<br>`miniprogram/utils/digest.js`<br>`miniprogram/utils/identity.js`<br>`miniprogram/utils/push.js`<br>`miniprogram/utils/selfcheck.js`<br>`miniprogram/utils/ask.js`<br>`miniprogram/utils/store.js` | **`web/zhishi-core.js`** | 标签体系 / 检索排序 / 溯源定位 / 分组匹配 / 身份过滤 / 推送评分 / 问答与日历，算法完全同一套 |
| **数据层** | `miniprogram/data/notices.js` | **`web/zhishi-data.js`** | 由 `export_mp_data_to_web.py` 自动导出，不手改 |
| **本地状态** | `miniprogram/utils/readstate.js`<br>`miniprogram/utils/favorites.js` | —（仅小程序） | 已读/删除、收藏是**端上用户状态**，只存本地 storage，无同源约束 |
| **页面层** | `pages/index`（主动通知列表）<br>`pages/push`（推送设置）<br>`pages/search`（搜索）<br>`pages/detail`（溯源）<br>`pages/selfcheck`（数据自查）<br>`pages/ask`（问答）<br>`pages/calendar`（日历） | `知时.html` 的通知 / 日程 / 汇总 / 我的 + 推送设置 / 数据自查 / 问答 / 日历 | 一份数据，各按各自平台渲染 |

**为什么要这么拆**：如果网页版和小程序各写一套，"完全一致"迟早会漂移——
改了小程序忘了改网页，答辩时两边数据对不上，最尴尬。

所以现在有 `check_parity.py` 守着：
改完任一边跑一下，不一致就直接报错并指出差异位置。
**承诺被机器验证，而不是靠记性。**

**改数据 / 改标签的标准动作**：

```powershell
# 1. 改小程序那一份（数据改 notices.js，标签改 utils/tags.js）
# 2. 重新导出到网页版
& C:\hclaw\python\python.exe "tools\export_mp_data_to_web.py"
# 3. 验证两边一致
& C:\hclaw\python\python.exe "tools\checks\check_parity.py"
node tools\checks\verify_web.js
```

**标签是单一事实来源**：`miniprogram/utils/tags.js` 里的 9 个标签，
订阅页、搜索页、推送页、数据层、网页版全部引用它。
`web/zhishi-core.js` 里有一份与之逐字对应的副本（`check_parity.py` 会校验）。
改标签要同时改这两处——脚本会告诉你漏了哪处。

---

## 三、想加一个采集源，怎么做

打开 `collect_notices.py`，找到 `TARGETS` 列表，加一条：

```python
{
    "site": "某学院 · 通知公告",          # 显示名
    "unit": "xxx",                        # 单位代号（用于生成 id 和标签）
    "list_url": "https://xxx.ahau.edu.cn/index/tzgg.htm",  # 列表页
    "base": "https://xxx.ahau.edu.cn/",   # 站点根，用于拼接详情页链接
    "pages": 6,                           # 向后翻页数上限（列表页形如 /index/tzgg/2.htm）
},
```

**怎么找列表页地址**：打开该单位官网 → 找到"通知公告"栏目 → 复制地址栏 URL。
翻页地址规律实测一致：`/index/tzgg.htm` → `/index/tzgg/2.htm`（第 2 页），`/3.htm`（第 3 页）…

**注意两点**：
1. 列表页里的详情链接必须是 `/info/数字/数字.htm` 这种形式，采集器才认得（这是学校站群的通用格式）。
2. 如果目标站点返回 **503**，说明被校方安全设备拦截了——**不要绕**，把它加进 `BLOCKED_SITES` 列表（Demo 数据源页会如实标成"安全拦截"）。

**要抓够多少条**：改模块顶部的 `TARGET_COUNT`（默认 200）与 `PER_SITE_LIMIT`（默认 45，防单一来源刷满）。
采集器会一直翻页 + 换站点，直到攒够目标条数或站点翻完为止。

**采完发现标题脏**（列表页把正文/日期并进了标题）：跑 `tools\reclean_titles.py`
重清洗一遍即可，不用重新联网。清洗规则写在 `clean_title()` 里。

---

## 四、合规红线（重要）

采集器**只做三件事**：发 GET 请求读公开页 → 解析文本 → 入库。

**明确不做**：
- ❌ 不登录、不模拟登录、不碰任何需要鉴权的页面
- ❌ 不采集教务系统后台、课表、成绩、学籍等私域数据
- ❌ 不破解、不绕过任何访问控制

**采集礼仪**（脚本里已内置）：
- 每条详情页抓取后 `sleep(0.4)`，不冲击对方服务器
- 单站点限 45 条、翻页有上限，不全站爬取

这两条不只是礼貌——**答辩时如果被问到"你们抓取会不会给学校服务器造成负担"，这就是答案。**

---

## 五、数据结构说明

`data/notices_merged.json` 里每条数据的字段：

| 字段 | 含义 |
|---|---|
| `id` | 唯一标识（`real-001` 形式） |
| `title` / `raw_title` | 通知标题 |
| `unit` | 来源单位 |
| `date` | 发布日期 |
| `tag` | 自动分类标签（转专业/奖助学金/竞赛/讲座活动…） |
| `url` | **来源 URL**（可回溯核对） |
| `body_len` | 正文字数 |
| `raw_body` | 原文片段（截取前 1500 字） |
| `fetched_at` | 抓取时间 |
| `is_real` | 是否为真实抓取 |

**注意**：真实抓取的条目，其结构化字段（`audience` / `deadline` / `materials` / `entry`）
现在由**理解层（规则版）**自动抽取——这是 `inject_digest_into_mp.py` 的活儿。

> 抽取原则：**只从原文抽，抽不到就写「原文未明确说明」，绝不编造。**
> 每条要点都带一段 `quote`（原文原样切片），详情页里点一下就能跳回原文高亮核对。
> 自检显示溯源定位率 **88/88 = 100%**。
>
> 云服务 11/20 开通后，这层换成大模型读全文抽取（`utils/cloud.js` 的 `understandNotice`），
> `utils/digest.js` 作为兜底保留——**接口不变，页面零改动**。

---

## 六、常见问题

**Q：跑出来控制台中文乱码怎么办？**
A：先执行 `$env:PYTHONIOENCODING="utf-8"`。文件本身是 UTF-8，只是控制台显示问题，不影响数据。

**Q：跑完网页没变化？**
A：浏览器缓存。按 `Ctrl+F5` 强制刷新，或关掉重开。

**Q：注入脚本报"找不到 NOTICES 块"？**
A：说明 `web/index.html` 或 `notices.js` 的结构被改动过。检查文件里是否有 `/* ===== 以下` 这个标记注释。

**Q：小程序里数据对不上？**
A：跑完 `inject_real_into_mp.py` 后，在微信开发者工具里点「编译」重新加载即可。

**Q：理解层重复跑会不会把数据搞坏？**
A：不会，脚本是幂等的。已经结构化的条目会跳过；但保险起见 `inject_digest_into_mp.py`
第一次运行时会自动备份成 `notices.bak.js`。要重来就把它复制回去再跑一遍。

**Q：标题里怎么混进了正文？**
A：这是早期抓取的历史遗留（列表页 `<a>` 标签里带了正文）。`fix_mp_titles_tags.py`
会自动清洗——凡是标题里出现「全体师生 / 各学院 / 各位同学 / 根据《…」这类正文开头标志，就在那里截断。

**Q：想加一个标签怎么办？**
A：两处同步改：① `miniprogram/utils/tags.js` 的 `TAGS` 数组；② `tools/fix_mp_titles_tags.py`
的 `RULES` 数组（关键词列表）。然后重跑清洗脚本 + 自检脚本。自检会检查两边是否一致。
