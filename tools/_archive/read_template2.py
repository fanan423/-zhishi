# -*- coding: utf-8 -*-
import subprocess, sys, io, json

SDK = r"D:\新建文件夹\WorkBuddy\resources\app.asar.unpacked\resources\plugins\workbuddy-builtin\skills\workbuddy-local-office-edit\edsdk.py"
PY = r"C:\hclaw\python\python.exe"
FID = r"C:\Users\z'y'f\AppData\Local\Temp\workbuddy-weixin-media\inbound\weixin-file-99400a55586e2d14-项目说明文档（模板）.docx"

def run(args):
    p = subprocess.run([PY, SDK] + args, capture_output=True)
    return p.stdout.decode('utf-8', 'replace'), p.stderr.decode('utf-8', 'replace')

out, err = run(["call", "doc_resolve_document_structure", "file_id=" + FID, "mode=full", "limit=0"])
d = json.loads(out)

lines = []
for n in d.get("nodes", []):
    t = n.get("type")
    if t == "Table":
        lines.append("【表格 %d：%d行x%d列】" % (n.get("table_index"), n.get("row_count"), n.get("col_count")))
        for r in n.get("table_rows", []):
            cells = [c.get("text_preview", "") for c in r.get("cells", [])]
            lines.append("  | " + " | ".join(cells) + " |")
    else:
        lines.append("[%s] %s" % (t, n.get("text_preview", "")))

txt = "\n".join(lines)
with open(r"D:\新建文件夹\Claw\校园信息雷达\docs\_extract\template_text.txt", "w", encoding="utf-8") as f:
    f.write(txt)
print("nodes:", len(d.get("nodes", [])))
