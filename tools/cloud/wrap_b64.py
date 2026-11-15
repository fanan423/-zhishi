# -*- coding: utf-8 -*-
"""
把 33 条 INSERT 合并成 1 条多行 INSERT，再按 1800 字符一行输出 base64，
便于逐行读取后拼接（Read 工具单行上限 2000 字符）。
"""
import json, pathlib, base64, sys, io
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
OUTDIR = ROOT / "tools" / "cloud"

lines = [l for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
first = json.loads(lines[0])["sql"]
cols = first[first.index("("):first.index(") VALUES") + 1]
on_conflict = first[first.index("ON CONFLICT"):]

vals = []
for line in lines:
    sql = json.loads(line)["sql"]
    vals.append(sql[sql.index(" VALUES (") + len(" VALUES ("):sql.index(") ON CONFLICT")])

# 分 4 批
BATCH = 9
idx = 0
for i in range(0, len(vals), BATCH):
    idx += 1
    chunk = vals[i:i + BATCH]
    one = ("INSERT INTO zhishi_notices " + cols + " VALUES\n("
           + "),\n(".join(chunk) + ")\n" + on_conflict)
    b64 = base64.b64encode(one.encode("utf-8")).decode("ascii")
    wrapped = "\n".join(b64[j:j + 1800] for j in range(0, len(b64), 1800))
    (OUTDIR / f"b64w_{idx:02d}.txt").write_text(wrapped, encoding="ascii")

print(f"OK: 4 wrapped base64 files written; rows={len(vals)}")
