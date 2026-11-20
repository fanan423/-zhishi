# -*- coding: utf-8 -*-
import base64, json, os, sys
import pathlib
SK = r"C:\Users\z'y'f\.workbuddy\plugins\cache\workbuddy-builtin\tencent-docs-plugin\5.9.3-wb.42398134.gd4692421.h480e8d1fee0f\skills\tencent-docs"
sys.path.insert(0, SK)
import tencentdocs as T

ROOT = str(pathlib.Path(__file__).resolve().parents[1])

def up(name):
    p = os.path.join(ROOT, name)
    with open(p, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    r, err = T.call_tool("tencent-docs", "upload_image", {"image_base64": b64, "file_name": name})
    if err:
        raise SystemExit("call error: " + err)
    txt = r["result"]["content"][0]["text"]
    d = json.loads(txt)
    if d.get("error"):
        raise SystemExit("upload error: " + d["error"])
    return d["image_id"]

id1 = up("知时_看图1.png")
id2 = up("知时_看图2.png")
print("id1 ok", len(id1), "id2 ok", len(id2))

md = """# 知时 · 想请你看一眼

把学校散在教务处、团委、图书馆各处的通知收到一起，按你关心的事筛出来，提醒哪些快到期了。

我按自己的使用习惯做的，女生用起来可能不太一样，这块我自己看不出来。

## 界面

三屏分别是通知、汇总、订阅，往下翻就行。

![知时界面](%s)

## 三个问题

1. 打开第一眼，你知道它是干什么的吗？（看不懂也直接讲）
2. 有没有哪一步，你会想直接退出去？（哪里嫌麻烦、哪里觉得多余）
3. 如果每天早上给你推一条「三天内要办的事」，你会看吗？

![三个问题](%s)

### 照着这个格式回我就行

```
1）第一眼感受：
2）想退出的地方：
3）每日提醒会不会看：
```

直接在聊天里发我就好，不用整理，想到什么写什么。也可以顺手问一下室友，一两个就够，我这边改不过来太多。

---

只用公开通知数据，不涉及任何个人信息。
""" % (id1, id2)

r, err = T.call_tool("tencent-docs", "create_smartcanvas_by_mdx", {
    "title": "知时 · 想请你看一眼",
    "mdx": md,
    "content_format": "markdown",
})
if err:
    raise SystemExit("create error: " + err)
print(json.dumps(r, ensure_ascii=False)[:1500])
