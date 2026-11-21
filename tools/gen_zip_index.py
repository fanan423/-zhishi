# -*- coding: utf-8 -*-
"""为 zip 内每个文件编制「序号 + 简明功能名」索引，并写入 zip 根目录。
原文件名保持不变（物理改名会破坏 HTML/小程序引用路径，导致程序打不开）。
"""
import zipfile, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
INDEX_NAME = '00_文件编名索引.md'

# ── 精确功能名映射（简明，2-8 字）──
FUNC = {
    # 应用入口
    '知时_演示版.html': '演示版·评委答辩纯离线',
    '知时_可用版.html': '可用版·学生实用',
    '知时_在线版.html': '在线版·云端真后端',
    '知时门户.html': '统一门户·13入口',
    '知时.html': '主应用·单文件',
    '交互Demo.html': '交互演示Demo',
    '小程序预览.html': '小程序网页预览',
    '打开总览.html': '总览快捷打开',
    '打开小程序预览.html': '小程序预览打开',
    '一键运行.bat': '一键运行',
    '一键启动_AI版.bat': 'AI版一键启动',
    '一键生成_提交包.bat': '提交包一键生成',
    '提交核对清单.md': '提交核对清单',
    'CHANGELOG.md': '变更日志',
    'README.md': '项目总说明',
    '.gitignore': 'Git忽略规则',
    # web 网页版
    'web/digest.html': '汇总溯源页',
    'web/index.html': '网页首页',
    'web/inspect.html': '数据体检页',
    'web/mobile.html': '移动版页面',
    'web/mp-preview.html': '小程序预览页',
    'web/overview.html': '项目总览页',
    'web/pipeline.html': '主链路演示页',
    'web/rawdata.html': '原始数据页',
    'web/sources.html': '数据源状态页',
    'web/understand.html': '理解层拆解页',
    'web/zhishi-agent.js': '智能体客户端',
    'web/zhishi-ai.js': 'AI快照数据',
    'web/zhishi-cloud.js': '云端客户端',
    'web/zhishi-core.js': '核心算法层',
    'web/zhishi-data.js': '数据层',
    # 小程序 utils
    'miniprogram/utils/agent.js': '智能体客户端',
    'miniprogram/utils/ask.js': '问答引擎',
    'miniprogram/utils/cloud.js': '云服务适配',
    'miniprogram/utils/digest.js': '浓缩引擎',
    'miniprogram/utils/favorites.js': '收藏管理',
    'miniprogram/utils/identity.js': '身份画像',
    'miniprogram/utils/llm_prompt.js': '大模型提示词',
    'miniprogram/utils/push.js': '推送触达',
    'miniprogram/utils/reachlist.js': '提醒时间推演',
    'miniprogram/utils/readstate.js': '已读状态',
    'miniprogram/utils/search.js': '搜索',
    'miniprogram/utils/selfcheck.js': '数据自查',
    'miniprogram/utils/store.js': '数据存储',
    'miniprogram/utils/subscribe.js': '订阅授权',
    'miniprogram/utils/tags.js': '标签管理',
    'miniprogram/utils/theme.js': '主题',
    'miniprogram/utils/workbuddy-cloud-diagnostics.js': '云端诊断',
    'miniprogram/utils/wxnotify.js': '微信通知',
    # 小程序数据
    'miniprogram/data/notices.js': '通知数据',
    'miniprogram/data/notices.bak.js': '通知数据备份',
    'miniprogram/data/notices.pre_llm.bak.js': '理解前数据备份',
    'miniprogram/data/notices.pre_llm.prev.bak.js': '理解前上版备份',
    # 小程序配置
    'miniprogram/app.js': '小程序入口逻辑',
    'miniprogram/app.json': '小程序全局配置',
    'miniprogram/app.wxss': '小程序全局样式',
    'miniprogram/project.config.json': '项目配置',
    'miniprogram/project.private.config.json': '私有配置',
    'miniprogram/sitemap.json': '站点地图',
    'miniprogram/package.json': '依赖清单',
    'miniprogram/package-lock.json': '依赖锁定',
    # docs
    'docs/参赛通告.md': '参赛通告',
    'docs/项目说明文档_知时.md': '项目说明文档·源',
    'docs/项目说明文档_知时.docx': '项目说明文档·Word',
    'docs/参赛作品说明.md': '参赛作品说明',
    'docs/大赛提交要求.md': '大赛提交要求',
    'docs/农芯智_提交总表.md': '提交总表',
    'docs/演示视频脚本.md': '演示视频脚本',
    'docs/小程序运行说明.md': '小程序运行说明',
    'docs/信息源接入与推送测试.md': '信息源推送测试',
    'docs/多信息源抓取与推送验证报告.md': '多源推送验证报告',
    'docs/智能体接入与部署.md': '智能体接入部署',
    'docs/大模型理解层_接入与验证.md': '理解层接入验证',
    'docs/数据血缘与单一事实来源.md': '数据血缘说明',
    'docs/两版交付说明.md': '两版交付说明',
    'docs/实用版实时AI_使用说明.md': '实时AI说明',
    'docs/在线真后端_使用说明.md': '在线真后端说明',
    'docs/GitHub借鉴与优化说明.md': 'GitHub借鉴说明',
    'docs/功能成熟度.md': '功能成熟度',
    'docs/答辩速讲稿.md': '答辩速讲稿',
    # 工具链
    'tools/README.md': '工具链说明',
    'tools/export_docx.py': '文档导出器',
    'tools/pack_submission.py': '提交打包器',
    'tools/make_submission.py': '一键提交生成器',
    'tools/agent.js': '智能体CLI',
    'tools/agent_profile.json': '智能体画像配置',
    'tools/install_agent_task.ps1': '后台任务安装',
    'tools/sync_promo_kpi.js': 'KPI同步',
    'tools/build_presentation.js': '演示版构建器',
    'tools/build_usable.js': '可用版构建器',
    'tools/build_online.js': '在线版构建器',
    'tools/build_two_versions.js': '两版打包器',
    'tools/lib/zip_writer.js': 'ZIP写入器',
    # 智能体后端
    'tools/agent/build_ai_snapshot.js': 'AI快照构建',
    'tools/agent/core.js': '核心引擎',
    'tools/agent/daemon.js': '后台守护',
    'tools/agent/export_llm_fields.js': '大模型字段导出',
    'tools/agent/llm_openai.js': '大模型直连',
    'tools/agent/prompt.js': '提示词',
    'tools/agent/recommend.js': '推荐引擎',
    'tools/agent/reset_llm_baseline.js': '基线重置',
    'tools/agent/server.js': 'HTTP服务',
    # 配置 / 数据
    'config/cloud.example.json': '云配置模板',
    'config/cloud.service.json': '云端公开配置',
    'config/llm.example.json': '大模型配置模板',
    'data/notices.json': '通知主数据',
    'data/notices_app.json': '应用版通知',
    'data/notices_merged.json': '合并通知数据',
    'data/notices_real.json': '真实通知数据',
    'data/sources.json': '数据源注册表',
    'data/source_health.json': '数据源健康度',
}

PAGE_CN = {
    'ask': '问答', 'calendar': '日历', 'detail': '详情', 'digest': '汇总',
    'index': '首页', 'me': '我的', 'push': '推送设置', 'search': '搜索',
    'selfcheck': '数据自查', 'timeline': '日程',
}
FILE_TYPE = {'js': '逻辑', 'json': '配置', 'wxml': '结构', 'wxss': '样式'}
CHECK_CN = {
    'agent_clients': '智能体客户端', 'agent_preview': '智能体预览', 'agent_service': '智能体服务',
    'all': '总控', 'all_pages': '全部页面', 'app': '单文件应用', 'condchain': '条件链',
    'data_lineage': '数据血缘', 'daydrift': '日期漂移', 'demo': 'Demo数据',
    'demo_interactive': '交互Demo', 'digest': '浓缩层', 'entry': '入口层', 'js': 'JS语法',
    'kpi_sync': 'KPI同源', 'links': '互链', 'llm_pipeline': '大模型产物', 'miniprogram': '小程序',
    'parity': '两端同源', 'portal': '统一门户', 'preview': '预览页结构',
    'preview_style': '预览页样式', 'render': '网页渲染', 'runtime': '运行时',
    'submission': '参赛交付', 'two_versions': '两版交叉', 'wxml': 'wxml绑定',
    'wxml_compile': 'wxml编译',
}


def group_of(path):
    """分组按路径前缀独立判断（不依赖是否命中功能名映射）。"""
    name = path.split('/')[-1]
    if '/' not in path and (name.startswith(('知时', '交互', '小程序', '打开', '一键'))
                            or name in ('提交核对清单.md', 'CHANGELOG.md', 'README.md',
                                        'README_可用版.txt', 'package.json', '.gitignore')):
        return 'A'
    if path.startswith('web/'):
        return 'B'
    if path.startswith('docs/'):
        return 'F'
    if path.startswith('tools/checks/'):
        return 'H'
    if path.startswith('tools/agent/'):
        return 'I'
    if path.startswith('tools/_archive/'):
        return 'M'       # 历史归档脚本
    if path.startswith('tools/cloud/'):
        return 'N'       # 云端导入数据
    if path.startswith('tools/'):
        return 'G'
    if path.startswith('config/'):
        return 'J'
    if path.startswith('data/'):
        return 'K'
    if path.startswith('miniprogram/'):
        return 'E'
    return 'L'


def clean_name(path):
    """未命中映射时的规则化功能名：保留中文、去常见前后缀、下划线转空格。"""
    name = path.split('/')[-1]
    stem = re.sub(r'\.(js|py|json|md|txt|html|bat|ps1|sql|b64|wxss|wxml|docx)$', '', name)
    stem = re.sub(r'^[_\-]+', '', stem)          # 去前导下划线
    stem = re.sub(r'\.(bak|prev|backup)$', '·备份', stem)
    # 云导入数据块 rNN
    m = re.match(r'r(\d+)\.(b64|sql)$', name)
    if m:
        return f"云数据块{int(m.group(1)):02d}·{'Base64' if m.group(2)=='b64' else 'SQL'}"
    # 常见构建脚本
    stem = stem.replace('_', ' ').replace('-', ' ')
    return stem


def func_name(path):
    """返回 (分组字母, 简明功能名)。"""
    g = group_of(path)
    if path in FUNC:
        return g, FUNC[path]

    # 小程序页面：pages/xxx/xxx.ext
    m = re.match(r'miniprogram/pages/([^/]+)/([^/]+)\.(js|json|wxml|wxss)$', path)
    if m:
        page, _, ext = m.groups()
        cn = PAGE_CN.get(page, page)
        tail = '' if cn.endswith('页') else '页'
        return g, f"{cn}{tail}·{FILE_TYPE[ext]}"

    if 'privacy' in path and path.startswith('miniprogram/'):
        return g, '隐私配置'

    # 自检脚本
    m = re.match(r'tools/checks/(check_|verify_|run_)?(.+?)\.(js|py)$', path)
    if m:
        key = m.group(2)
        label = CHECK_CN.get(key, key)
        pre = m.group(1) or ''
        verb = {'check_': '校验', 'verify_': '验证', 'run_': ''}.get(pre, '校验')
        return g, f"{label}{verb}"

    return g, clean_name(path)


GROUP_NAME = {
    'A': '应用入口与脚本', 'B': '网页版', 'C': '小程序工具',
    'D': '小程序页面', 'E': '小程序数据与配置', 'F': '文档',
    'G': '工具链', 'H': '自检脚本', 'I': '智能体后端',
    'J': '配置', 'K': '数据', 'L': '其他',
    'M': '历史归档脚本', 'N': '云端导入数据',
}


def build_index(names_raw, title):
    names = [n for n in names_raw if n != INDEX_NAME]
    groups = {}
    for n in names:
        g, fn = func_name(n.replace('\\', '/'))
        groups.setdefault(g, []).append((fn, n))
    lines = [
        f'# 文件编名索引 · {title}',
        '',
        f'> 共 **{len(names)}** 个文件。原文件名保持不变以保证程序可运行；',
        '> 本表给出每个文件的「序号 + 简明功能名」，便于快速定位与核对。',
        '> **改文件名会破坏 HTML 跳转与小程序页面路由，故采用对照索引方式。**',
        '',
    ]
    for g in sorted(groups):
        lines += [f'## {g} · {GROUP_NAME.get(g, "其他")}（{len(groups[g])}）', '',
                  '| 序号 | 简明功能名 | 原文件名 |', '|---|---|---|']
        for i, (fn, n) in enumerate(sorted(groups[g], key=lambda x: x[1]), 1):
            lines.append(f'| {g}{i:02d} | {fn} | `{n}` |')
        lines.append('')
    return '\n'.join(lines) + '\n', len(names)


def append_index(zp, idx_text):
    """把索引写入 zip 根目录；若已存在则整体重建替换。"""
    with zipfile.ZipFile(zp, 'r') as z:
        items = [(item, z.read(item.filename)) for item in z.infolist()]
    tmp = zp.with_suffix('.zip.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as nz:
        for item, data in items:
            if item.filename != INDEX_NAME:
                nz.writestr(item, data)
        nz.writestr(INDEX_NAME, idx_text.encode('utf-8'))
    tmp.replace(zp)


def main():
    zips = sorted(DIST.glob('*.zip'))
    # 先只读一次每个包的原始清单，生成索引文本（不依赖是否已写入索引）
    plans = []
    for zp in zips:
        names = [n for n in zipfile.ZipFile(zp).namelist() if n != INDEX_NAME]
        idx, cnt = build_index(names, zp.name)
        plans.append((zp, idx, cnt))

    # 主索引汇总（dist 下独立文件，便于直接查看）
    summary = ['# 知时 · zip 文件编名总索引', '',
               '> 三个 zip 的文件编名对照。原文件名保持不变（保证程序可运行）；',
               '> 每个文件的「序号 + 简明功能名」见下。各 zip 内也附带 `00_文件编名索引.md`。', '',
               '> 分组：A 应用入口 · B 网页版 · C 小程序工具 · D 小程序页面 · E 小程序数据配置 ·',
               '> F 文档 · G 工具链 · H 自检 · I 智能体后端 · J 配置 · K 数据 · L 其他', '']
    for zp, idx, cnt in plans:
        append_index(zp, idx)
        print(f'[OK] {zp.name}: 编名 {cnt} 个文件，索引已写入包内')
        summary += [f'## {zp.name}（{cnt} 文件）', '',
                    f'详见包内 `{INDEX_NAME}`，或 dist 下的分包索引文件。', '']
    (DIST / '文件编名索引.md').write_text('\n'.join(summary), encoding='utf-8')

    # 另存各包索引的可读版
    for zp, idx, cnt in plans:
        out = DIST / (zp.stem[:16].replace('+', '_') + '_编名.md')
        out.write_text(idx, encoding='utf-8')
        print(f'[OK] 已写 {out.name}')


if __name__ == '__main__':
    main()
