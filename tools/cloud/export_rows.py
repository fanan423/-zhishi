# -*- coding: utf-8 -*-
"""
逐行导出：每行一条 INSERT 的 SQL，写入 tools/cloud/rows/rNN.sql
再另外写一份 base64 文件，供小步验证。
"""
import json, pathlib, base64, sys, io
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
ROWDIR = ROOT / "tools" / "cloud" / "rows"
ROWDIR.mkdir(exist_ok=True)

lines = [l for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
for i, line in enumerate(lines, 1):
    sql = json.loads(line)["sql"]
    (ROWDIR / f"r{i:02d}.sql").write_text(sql, encoding="utf-8")
    b64 = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    (ROWDIR / f"r{i:02d}.b64").write_text(b64, encoding="ascii")

# 摘要
info = []
for i, line in enumerate(lines, 1):
    sql = json.loads(line)["sql"]
    b64 = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    info.append(f"r{i:02d}: sql={len(sql)} b64={len(b64)}")

(ROWDIR / "_sizes.txt").write_text("\n".join(info), encoding="utf-8")
print(f"OK: {len(lines)} rows exported")
