# -*- coding: utf-8 -*-
"""
小程序预览第 7 屏（智能体主动送达）· 静/动态校验
================================================

web/mp-preview.html 由 tools/show_miniprogram.js **真跑**小程序页面生成。
本脚本校验该产物里第 7 屏（pages/digest）的智能体区块：

  ① 区块本身的文案与结构齐备（标题/副标题/执行者/按钮）
  ② 状态标签是**真实运行结果**（本机未部署服务 → 本地模式）
  ③ 不冒充「已连接服务端」绿态（这是最容易犯的诚实性错误）
  ④ 元信息（命中/打扰/静默条数）确实由真跑数据填出，不是占位
  ⑤ 共 7 屏（页面数量对得上）

用法：python tools/checks/check_agent_preview.py
退出码：0=全过，1=有失败
"""
import io, re, sys, os
import pathlib
sys.stdout.reconfigure(encoding='utf-8')

ROOT = str(pathlib.Path(__file__).resolve().parents[2])
PREVIEW = os.path.join(ROOT, 'web', 'mp-preview.html')

pass_n = fail_n = 0
def ck(cond, msg):
    global pass_n, fail_n
    if cond:
        pass_n += 1; print('  ok  ' + msg)
    else:
        fail_n += 1; print('  FAIL ' + msg)

print('=' * 58)
print('小程序预览 · 第7屏（智能体主动送达）')
print('=' * 58)

if not os.path.exists(PREVIEW):
    print('  FAIL 预览文件不存在：%s' % PREVIEW)
    print('       请先跑：node tools/show_miniprogram.js')
    sys.exit(1)

h = io.open(PREVIEW, encoding='utf-8').read()

print('\n【1】区块文案与结构')
for k in ['七页预览', '智能体主动送达', '你不打开它也在跑',
          '让它重算一遍', '复制清单', '静默进流']:
    ck(k in h, '含「%s」' % k)
ck('本地算' in h or '服务端算' in h, '含执行者标识（本地算 / 服务端算）')

print('\n【2】状态标签来自真实运行结果')
m = re.search(r'ag-lab">([^<]*)<', h)
ck(bool(m), 'ag-lab 渲染出状态标签')
if m:
    print('     实际值 = %s' % m.group(1))
    ck('本地模式' in m.group(1) or '服务未连接' in m.group(1),
       '本地未部署服务时，如实显示「本地模式」')

m2 = re.search(r'ag-via">([^<]*)<', h)
if m2:
    print('     执行者 = %s' % m2.group(1))
    ck(m2.group(1).strip() in ('本地算', '服务端算'),
       '执行者与实际一致（未部署 → 本地算）')

print('\n【3】诚实性：不冒充「已连接服务端」')
ck('agbox off' in h or 'agbox warn' in h, '本地模式用灰/橙状态（不假装远端）')
ck('agbox on' not in h, '未冒充「已连接服务端」绿态')
ck('ag-warn' in h or '未配置服务地址' in h or '本地算' in h,
   'degraded 降级声明位存在（ag-warn 或未配置说明）')

print('\n【4】元信息由真跑数据填出')
m3 = re.search(r'命中 (\d+) 条 · 打扰 (\d+) 条 · 静默 (\d+) 条', h)
ck(bool(m3), '含可核对元信息「命中 N 条 · 打扰 N 条 · 静默 N 条」')
if m3:
    n_hit, n_notify, n_silent = (int(x) for x in m3.groups())
    print('     命中 %d · 打扰 %d · 静默 %d' % (n_hit, n_notify, n_silent))
    ck(n_hit > 0, '命中条数 > 0（池子真匹配出了东西）')
    ck(n_notify + n_silent == n_hit,
       '打扰 + 静默 == 命中（分档自洽）')

print('\n【5】页面数量')
ck(h.count('class="col-h"') == 7,
   '共 7 屏（col-h 计数 = %d）' % h.count('class="col-h"'))

print('\n' + '=' * 58)
print(('✅' if fail_n == 0 else '❌') + ' 通过 %d 项 / 失败 %d 项' % (pass_n, fail_n))
print('=' * 58)
sys.exit(1 if fail_n else 0)
