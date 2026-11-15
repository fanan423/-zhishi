# -*- coding: utf-8 -*-
import json, sys
SK = r"C:\Users\z'y'f\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.9.3-wb.42398134.gd4692421.h480e8d1fee0f\skills\tencent-docs"
sys.path.insert(0, SK)
import tencentdocs as T

r, err = T.call_tool("tencent-docs", "manage.delete_file", {"file_id": "CKzLkChHxfbP"})
print("err:", err)
print(json.dumps(r, ensure_ascii=False)[:400] if r else "no result")
