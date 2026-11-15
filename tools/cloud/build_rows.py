# -*- coding: utf-8 -*-
"""用正则（而非字符状态机）切分 VALUES 字面量，稳健处理含括号/逗号的 jsonb 串。"""
import json, pathlib, re, sys, io
import pathlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"
OUT = ROOT / "tools" / "cloud" / "_cloud_rows.json"

COLS = ["id", "real", "source", "publish_date", "title", "event", "audience",
        "deadline", "countdown", "materials", "entry", "confidence", "priority",
        "points", "digest_one", "digest_points", "raw", "url", "site", "unit",
        "src_generated_at"]

# 字面量：单引号串（可含 ::jsonb）；或 NULL；或布尔；或数字
LIT = re.compile(r"'(?:[^']|'')*'(?:::jsonb)?|NULL|TRUE|FALSE|[-\d.]+")


def parse_values(seg):
    return [m.group(0) for m in LIT.finditer(seg)]


rows = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    sql = json.loads(line)["sql"]
    seg = sql[sql.index("VALUES") + 6: sql.index("ON CONFLICT")]
    toks = parse_values(seg)
    if len(toks) != len(COLS):
        raise SystemExit(f"{sql[:40]} 列数 got={len(toks)} want={len(COLS)}\n{toks}")
    raw = dict(zip(COLS, toks))

    def s(col):
        t = raw[col]
        if t == "NULL":
            return None
        if t.startswith("'"):
            body = t[1:t.rindex("'")].replace("''", "'")
            return body
        return t

    def j(col):
        t = raw[col]
        if t == "NULL":
            return None
        inner = t[1:t.rindex("'")]
        try:
            return json.loads(inner)
        except Exception:
            return None

    rows.append({
        "id": s("id"),
        "real": raw["real"].upper() == "TRUE",
        "source": s("source"),
        "publish_date": s("publish_date"),
        "title": s("title"),
        "event": s("event"),
        "audience": s("audience"),
        "deadline": s("deadline"),
        "countdown": None if raw["countdown"] == "NULL" else float(raw["countdown"]),
        "materials": s("materials"),
        "entry": s("entry"),
        "confidence": None if raw["confidence"] == "NULL" else float(raw["confidence"]),
        "priority": s("priority"),
        "points": j("points") or [],
        "digest_one": s("digest_one"),
        "digest_points": j("digest_points") or [],
        "raw": s("raw"),
        "url": s("url"),
        "site": s("site"),
        "unit": s("unit"),
    })

OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"OK: {len(rows)} rows -> {OUT}")
bad = [r["id"] for r in rows if not r["url"] or "ahau.edu.cn" not in r["url"]]
print("非安农链接:", bad if bad else "无")
print("全部 real:", all(r["real"] for r in rows))
print("示例:", rows[0]["id"], rows[0]["event"], "|", rows[0]["title"][:24])
