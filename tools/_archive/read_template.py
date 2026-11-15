# -*- coding: utf-8 -*-
import subprocess, sys, io, os, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

SDK = r"D:\新建文件夹\WorkBuddy\resources\app.asar.unpacked\resources\plugins\workbuddy-builtin\skills\workbuddy-local-office-edit\edsdk.py"
PY = r"C:\hclaw\python\python.exe"

def run(args):
    p = subprocess.run([PY, SDK] + args, capture_output=True)
    return p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')

out, err = run([
    "call", "doc_resolve_document_structure",
    "file_id=C:\\Users\\z'y'f\\AppData\\Local\\Temp\\workbuddy-weixin-media\\inbound\\weixin-file-99400a55586e2d14-项目说明文档（模板）.docx",
    "mode=full", "limit=0"
])
with open(r"D:\新建文件夹\Claw\校园信息雷达\docs\_extract\template_struct.txt", "w", encoding="utf-8") as f:
    f.write(out or "")
    if err:
        f.write("\n===ERR===\n" + err)
print("len:", len(out), "err:", len(err))
