# -*- coding: utf-8 -*-
"""生成【单条】多行 INSERT（33 行）并输出 base64（每 1800 字符一行）。"""
import json, pathlib, base64, sys, io
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
OUT = ROOT / "tools" / "cloud"

lines = [l for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
first = json.loads(lines[0])["sql"]
cols = first[first.index("("):first.index(") VALUES") + 1]
on_conflict = first[first.index("ON CONFLICT"):]

vals = []
for line in lines:
    sql = json.loads(line)["sql"]
    vals.append(sql[sql.index(" VALUES (") + len(" VALUES ("):sql.index(") ON CONFLICT")])

one = ("INSERT INTO zhishi_notices " + cols + " VALUES\n("
       + "),\n(".join(vals) + ")\n" + on_conflict)

(OUT / "all_in_one.sql").write_text(one, encoding="utf-8")
b64 = base64.b64encode(one.encode("utf-8")).decode("ascii")
wrapped = "\n".join(b64[j:j + 1800] for j in range(0, len(b64), 1800))
(OUT / "all_in_one.b64").write_text(wrapped, encoding="ascii")

info = f"sql_chars={len(one)}\nb64_chars={len(b64)}\nb64_lines={len(wrapped.splitlines())}\nrows={len(vals)}"
(OUT / "_all_in_one_info.txt").write_text(info, encoding="utf-8")
print(info)
