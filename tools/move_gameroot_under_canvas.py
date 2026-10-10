"""结构性微调：把 GameRoot 移到 Canvas 之下（2D 渲染的正确层级）。

为什么：
    Creator 的 2D/UI 渲染由「渲染根」驱动：cc.Canvas 本身是一个 RenderRoot2D。
    节点挂在场景根下、即使 layer 是 UI_2D，也可能因为没有所属的渲染根而**不被渲染**。
    标准做法是：需要渲染的 2D 节点都放在 Canvas 之下。
    （本脚本另一个作用：演示「结构性修改要用工具做，不要手改 JSON 下标」）
"""
import io
import json
import os
import shutil
import sys

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

SCENE = r"assets\main.scene"
BACKUP = r"temp\main.scene.before-move-gameroot.json"


def main():
    with io.open(SCENE, "r", encoding="utf-8") as f:
        doc = json.load(f)

    def find_one(pred, what):
        hits = [i for i, o in enumerate(doc) if pred(o)]
        if len(hits) != 1:
            print("拒绝执行：期望 1 个 %s，实际 %d 个 %s" % (what, len(hits), hits))
            sys.exit(1)
        return hits[0]

    scene_idx = find_one(lambda o: o.get("__type__") == "cc.Scene", "cc.Scene")
    canvas_idx = find_one(lambda o: o.get("__type__") == "cc.Node" and o.get("_name") == "Canvas",
                          "Canvas 节点")
    game_idx = find_one(lambda o: o.get("__type__") == "cc.Node" and o.get("_name") == "GameRoot",
                        "GameRoot 节点")
    cam_idx = find_one(lambda o: o.get("__type__") == "cc.Node" and o.get("_name") == "Camera",
                       "Camera 节点")

    scene, canvas, game = doc[scene_idx], doc[canvas_idx], doc[game_idx]

    # 前置校验：当前状态必须是我预期的（否则拒绝，避免在错误前提上改）
    cur_parent = game.get("_parent", {}).get("__id__")
    if cur_parent != scene_idx:
        print("拒绝执行：GameRoot 当前父节点是 %s，预期是 Scene(%d)" % (cur_parent, scene_idx))
        sys.exit(1)
    if game.get("_lpos", {}).get("x") != 0 or game.get("_lpos", {}).get("y") != 0:
        print("拒绝执行：GameRoot 位置不是 (0,0)，移动父节点会改变它的世界坐标")
        sys.exit(1)

    shutil.copyfile(SCENE, BACKUP)
    print("已备份 -> %s" % BACKUP)

    # 移动层级
    game["_parent"] = {"__id__": canvas_idx}
    canvas["_children"] = [{"__id__": cam_idx}, {"__id__": game_idx}]
    scene["_children"] = [{"__id__": canvas_idx}]

    with io.open(SCENE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("已更新 %s" % SCENE)
    print()
    print("新的节点层级:")
    for i, o in enumerate(doc):
        if o.get("__type__") == "cc.Node":
            print("  [%2d] %-10r parent=%s comps=%s"
                  % (i, o.get("_name"), o.get("_parent", {}).get("__id__"),
                     [c["__id__"] for c in o.get("_components", []) or []]))
        elif o.get("__type__") == "cc.Scene":
            print("  [%2d] Scene      children=%s"
                  % (i, [c["__id__"] for c in o.get("_children", []) or []]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
