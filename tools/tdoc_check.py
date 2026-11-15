# -*- coding: utf-8 -*-
import json, sys
SK = r"C:\Users\z'y'f\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.9.3-wb.42398134.gd4692421.h480e8d1fee0f\skills\tencent-docs"
sys.path.insert(0, SK)
import tencentdocs as T

FID = "CKzLkChHxfbP"

def call(tool, args):
    r, err = T.call_tool("tencent-docs", tool, args)
    if err:
        return {"__err": err}
    try:
        return json.loads(r["result"]["content"][0]["text"])
    except Exception:
        return r

print("=== get_content ===")
c = call("get_content", {"file_id": FID})
s = json.dumps(c, ensure_ascii=False)
print(s[:1500])

print("=== set_privilege 2 ===")
print(json.dumps(call("manage.set_privilege", {"file_id": FID, "policy": 2}), ensure_ascii=False))
