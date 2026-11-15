# -*- coding: utf-8 -*-
"""
知时 · 把 tools/cloud/ingest_ahau.sql.jsonl 的 33 条 INSERT
合并成**一条**多行 INSERT（单语句），便于 MCP 工具一次执行。

输出：tools/cloud/ingest_ahau_one.sql.txt
"""
import json, pathlib, sys, io
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
OUT = ROOT / "tools" / "cloud" / "ingest_ahau_one.sql.txt"

rows = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    sql = json.loads(line)["sql"]
    # INSERT INTO zhishi_notices (...) VALUES (...) ON CONFLICT ...
    vi = sql.index(" VALUES (")
    ci = sql.index(") ON CONFLICT")
    values_part = sql[vi + len(" VALUES ("): ci]      # 去掉 " VALUES (" 前缀和 ") ON CONFLICT" 后缀
    rows.append(values_part)

# 用第一条的列定义做模板
first = json.loads(SRC.read_text(encoding="utf-8").splitlines()[0])["sql"]
col_start = first.index("(")
col_end = first.index(") VALUES")
cols = first[col_start:col_end + 1]

on_conflict = first[first.index("ON CONFLICT"):]

one = (
    "INSERT INTO zhishi_notices "
    + cols + " VALUES\n("
    + "),\n(".join(rows)
    + ")\n"
    + on_conflict
)

OUT.write_text(one, encoding="utf-8")
print(f"OK: merged {len(rows)} rows -> {OUT} ({len(one)} chars)")
