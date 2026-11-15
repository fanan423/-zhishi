# -*- coding: utf-8 -*-
"""
把 ingest_ahau.sql.jsonl 拆成 N 批（每批一条多行 INSERT），
每批输出一个 base64 文本文件，供 MCP 工具分批执行。

输出：tools/cloud/batch_01.b64.txt ... batch_NN.b64.txt
"""
import json, pathlib, sys, io, base64
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
OUTDIR = ROOT / "tools" / "cloud"

lines = [l for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
first = json.loads(lines[0])["sql"]
col_start = first.index("(")
col_end = first.index(") VALUES")
cols = first[col_start:col_end + 1]
on_conflict = first[first.index("ON CONFLICT"):]

vals = []
for line in lines:
    sql = json.loads(line)["sql"]
    vi = sql.index(" VALUES (")
    ci = sql.index(") ON CONFLICT")
    vals.append(sql[vi + len(" VALUES ("): ci])

BATCH = 9
n = 0
idx = 0
for i in range(0, len(vals), BATCH):
    idx += 1
    chunk = vals[i:i + BATCH]
    one = ("INSERT INTO zhishi_notices " + cols + " VALUES\n("
           + "),\n(".join(chunk) + ")\n" + on_conflict)
    b64 = base64.b64encode(one.encode("utf-8")).decode("ascii")
    (OUTDIR / f"batch_{idx:02d}.b64.txt").write_text(b64, encoding="ascii")
    n += len(chunk)

print(f"OK: {idx} batches, {n} rows total")
