# -*- coding: utf-8 -*-
import base64, json, os, sys
SK = r"C:\Users\z'y'f\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.9.3-wb.42398134.gd4692421.h480e8d1fee0f\skills\tencent-docs"
sys.path.insert(0, SK)
import tencentdocs as T

def up(path):
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    r = T.call_tool("tencent-docs", "upload_image", {
        "image_base64": b64,
        "file_name": os.path.basename(path),
    })
    return r

if __name__ == "__main__":
    for p in sys.argv[1:]:
        print("=== " + p)
        print(json.dumps(up(p), ensure_ascii=False)[:600])
