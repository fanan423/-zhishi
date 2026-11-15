# -*- coding: utf-8 -*-
"""把云端导出的行 JSON（从 SQL 结果手工粘贴）写盘（占位说明）。
实际实现见 tools/cloud/export_cloud_rows.ps1 —— 由 PowerShell 调 MCP 不方便，
改为把已查得的结果存为文件。本文件仅为占位与规范化。
"""
import pathlib, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parents[2]
print("see tools/cloud/_cloud_rows.json")
