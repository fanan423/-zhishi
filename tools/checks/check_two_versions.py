# -*- coding: utf-8 -*-
"""
两版交付 zip 交叉校验守卫
================================================================
用 Python 标准库 zipfile（与 Node 侧 zip_writer.js 完全独立的实现）
交叉验证 dist/ 下两个 zip，防止「自己写、自己验」的假绿：

  · ZIP 结构可解析、CRC 逐条正确（testzip()）
  · 中文文件名正确（UTF-8 flag 0x0800 + 能被 zipfile 原样读出）
  · 路径规范：只用 `/`、无绝对路径、无 `..` 穿越
  · 演示版：必需条目齐、屏 6 依赖的 知时.html 在包内、HTML 自包含
  · 可用版：完整程序骨架齐、数据源/守卫/模板配置齐
  · 两版均不含敏感配置、内部评估材料、探针文件、历史快照

行为：dist 下两个 zip 都缺 → 打印「尚未打包，跳过」并 exit 0（不阻塞自检）；
      只要有一个存在就严格校验，缺任一个即失败。
用法：python tools/checks/check_two_versions.py
"""
import os
import sys
import zipfile
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, 'dist')
DEMO = '知时_演示版.zip'
USABLE = '知时_可用版.zip'

passed = 0
failed = 0


def ck(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print('  [OK]   ' + msg)
    else:
        failed += 1
        print('  [FAIL] ' + msg)


def norm(names):
    return set(n.replace('\\', '/') for n in names)


def read_entry(z, name, names):
    """从 zip 里读一个条目文本（UTF-8，容错）"""
    if name not in names:
        return ''
    return z.read(name).decode('utf-8', 'replace')


def common_checks(label, zpath, need, forbidden):
    global passed, failed
    print('\n---- %s ----' % label)
    ck(os.path.getsize(zpath) > 1024, label + ' 非空（>1KB）')
    try:
        z = zipfile.ZipFile(zpath, 'r')
    except Exception as e:
        ck(False, label + ' 可被标准 zipfile 打开：' + str(e))
        return None
    ck(True, label + ' 可被标准 zipfile 打开')

    names = z.namelist()
    ns = norm(names)
    ck(len(names) > 0, label + ' 含条目（%d 个）' % len(names))

    bad = z.testzip()
    ck(bad is None, label + ' CRC 全条通过（testzip 返回 None%s）'
       % ('' if bad is None else '，坏条目 ' + str(bad)))

    # UTF-8 文件名标志：所有含非 ASCII 的条目都应置 bit 11
    non_ascii = [i for i in z.infolist() if any(ord(c) > 127 for c in i.filename)]
    ck(len(non_ascii) > 0, label + ' 含中文文件名条目（%d 个）' % len(non_ascii))
    ck(all((i.flag_bits & 0x0800) != 0 for i in non_ascii),
       label + ' 中文名均置 UTF-8 标志 0x0800（解压不乱码）')

    # 路径规范
    ck(all(not n.startswith('/') and not re.match(r'^[A-Za-z]:', n) for n in ns),
       label + ' 无绝对路径条目')
    ck(all('..' not in n.split('/') for n in ns),
       label + ' 无 `..` 路径穿越')
    ck(all('\\' not in n for n in ns),
       label + ' 路径分隔符统一为 `/`')

    for f in need:
        ck(f in ns, label + ' 必需条目：' + f)
    for f in forbidden:
        ck(f not in ns, label + ' 已排除：' + f)
    # 目录型排除（前缀）
    bad_dirs = [n for n in ns if re.match(
        r'^(node_modules|_backups|push_out|_probe|知时_线上|知时小程序_源码|\.git)/', n)]
    ck(not bad_dirs, label + ' 无历史快照/备份/依赖目录'
       + ('' if not bad_dirs else '（发现 ' + bad_dirs[0] + '）'))
    return z


def main():
    demo_p = os.path.join(DIST, DEMO)
    usable_p = os.path.join(DIST, USABLE)
    demo_ok = os.path.exists(demo_p)
    usable_ok = os.path.exists(usable_p)

    print('=== 两版交付 zip 交叉校验（Python zipfile / 独立于 Node 写入器）===')
    if not demo_ok and not usable_ok:
        print('  [SKIP] dist/ 下两个 zip 均未生成 —— 尚未打包，跳过（不阻塞自检）')
        print('         生成命令：node tools/build_two_versions.js')
        print('\n结果：跳过（0 校验 / 0 失败）')
        return 0

    ck(demo_ok, 'dist/知时_演示版.zip 存在')
    ck(usable_ok, 'dist/知时_可用版.zip 存在')

    FORBIDDEN = [
        'config/cloud.local.json', 'cloud.local.json',
        '项目评估报告_2026-11-15.md', 'docs/项目评估报告_2026-11-15.md',
        'docs/扣分点优化复核_2026-11-15.md', '扣分点优化复核_2026-11-15.md',
        '_diag.js', 'push_state.json',
    ]

    # ---------- ① 演示版 ----------
    if demo_ok:
        need = [
            '知时_演示版.html', '知时_可用版.html', '知时.html',
            '两版交付说明.md', '演示视频脚本.md', 'README_演示版.txt',
            # 说明：知时.html 为应用内核，随包保留以便复现；屏 6 引用的是可用版
        ]
        z = common_checks('演示版包', demo_p, need, FORBIDDEN)
        if z:
            ns = norm(z.namelist())
            d = read_entry(z, '知时_演示版.html', ns)
            u = read_entry(z, '知时_可用版.html', ns)
            # 注意：中文 UTF-8 占 3 字节，大小必须用字节数判断，不能用字符数
            u_bytes = z.read('知时_可用版.html') if '知时_可用版.html' in ns else b''
            ck('DEMO_STAT' in d, '演示版含现算 KPI 常量 DEMO_STAT')
            ck('非实时调用' in d or '构建期' in d, '演示版如实标注 AI 为离线预计算')
            ck(not re.search(r'>\s*156\s*<', d), '演示版无旧 KPI 156')
            ck(not re.search(r'<script[^>]+src=', d, re.I), '演示版无外链 script')
            ck(not re.search(r'<link[^>]+href=', d, re.I), '演示版无外链 css')
            # 屏 6 依赖闭环：href / iframe src 指向的文件必须在包内
            refs = set(re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+\.html)["\']', d))
            refs |= set(re.findall(r"frame\.src\s*=\s*['\"]([^'\"]+\.html)['\"]", d))
            html_refs = {r for r in refs if not r.startswith(('http:', 'https:', '#'))}
            missing = sorted(r for r in html_refs if r not in ns)
            ck(not missing, '演示版屏 6 引用的 HTML 均随包携带'
               + ('' if not missing else '（缺 ' + '、'.join(missing) + '）'))
            ck('知时_可用版.html' in html_refs and '知时_可用版.html' in ns,
               '屏 6「打开可用版应用」名实一致且依赖已闭环')
            ck('全绿' in d and '24 / 24' not in d,
               '演示版自检文案不写死 24/24（改为指向 run_all.js）')
            ck('可用版' in u and len(u_bytes) > 400000,
               '可用版 HTML 完整（%d bytes）' % len(u_bytes))
            z.close()

    # ---------- ② 可用版 ----------
    if usable_ok:
        need = [
            '知时_可用版.html', '知时_演示版.html', '知时.html',
            'web/zhishi-data.js', 'miniprogram/data/notices.js',
            'miniprogram/project.config.json',
            'tools/checks/run_all.js', 'tools/build_two_versions.js',
            'tools/lib/zip_writer.js', 'config/cloud.example.json',
            'docs/两版交付说明.md', 'docs/数据血缘与单一事实来源.md',
            'docs/大模型理解层_接入与验证.md', 'README_可用版.txt',
        ]
        z = common_checks('可用版包', usable_p, need, FORBIDDEN)
        if z:
            ns = norm(z.namelist())
            u = read_entry(z, '知时_可用版.html', ns)
            u_bytes = z.read('知时_可用版.html') if '知时_可用版.html' in ns else b''
            ck('可用版' in u and len(u_bytes) > 400000,
               '可用版 HTML 完整自包含（%d bytes）' % len(u_bytes))
            ck(not re.search(r'<script[^>]+src=', u, re.I), '可用版无外链 script')
            ck('ZS_DATA' in read_entry(z, 'web/zhishi-data.js', ns),
               '网页数据源 web/zhishi-data.js 在包内可用')
            ck('module.exports' in read_entry(z, 'miniprogram/data/notices.js', ns)
               or 'NOTICES' in read_entry(z, 'miniprogram/data/notices.js', ns),
               'SSOT 数据文件在包内可用')
            # 模板配置在、真实配置不在
            ck('config/cloud.example.json' in ns, '云端模板配置随包（可复现）')
            ck('config/cloud.local.json' not in ns, '真实密钥配置未随包外泄')
            z.close()

    print('\n==============================================')
    print('  通过 %d 项 / 失败 %d 项' % (passed, failed))
    print('==============================================')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
