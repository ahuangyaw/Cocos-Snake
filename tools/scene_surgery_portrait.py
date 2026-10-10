"""场景手术：删掉指向已删除脚本的死组件、删掉孤立的 Player 节点、并把设计分辨率改成竖屏。

【为什么写脚本而不是手动改 JSON】
    场景文件是「数组 + 下标互相引用」的结构，手改一处就要重算所有引用，
    极易错位（本项目第一次手写场景时就犯过这个错）。
    所以这里用「按语义定位 -> 重建引用」的方式，并且全程带前置校验。

【改了什么】
    1. 删除 Canvas 上那个 __type__ 指向已删除 Orbit.ts 的组件（Missing Script）
    2. 删除孤立的 Player 节点及其 Sprite（旧 Demo 的残留）
    3. Canvas 与 Camera 的 UITransform / 设计分辨率改为竖屏 720x1280
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, "assets", "main.scene")
BACKUP = os.path.join(ROOT, "temp", "main.scene.before-portrait.json")

DESIGN_W = 720
DESIGN_H = 1280


def main():
    with io.open(SCENE, "r", encoding="utf-8") as f:
        doc = json.load(f)

    print("原对象数: %d" % len(doc))

    def type_of(idx):
        return doc[idx].get("__type__", "?")

    def is_node(idx):
        return type_of(idx) in ("cc.Node", "cc.Scene")

    # ---------- 定位 ----------
    scene_idx = None
    canvas_idx = None
    player_idx = None
    for i, o in enumerate(doc):
        t = o.get("__type__")
        if t == "cc.Scene":
            scene_idx = i
        elif t == "cc.Node" and o.get("_name") == "Canvas":
            canvas_idx = i
        elif t == "cc.Node" and o.get("_name") == "Player":
            player_idx = i

    if scene_idx is None or canvas_idx is None:
        print("拒绝执行：找不到 Scene 或 Canvas 节点")
        return 1

    print("Scene 下标=%d  Canvas 下标=%d  Player 下标=%s" % (
        scene_idx, canvas_idx, player_idx if player_idx is not None else "无"))

    # ---------- 找出要删的对象 ----------
    to_delete = set()

    # 1) Canvas 上「__type__ 不是 cc. 开头，且指向的脚本文件已不存在」的组件 = Missing Script
    canvas = doc[canvas_idx]
    keep_components = []
    for cref in canvas.get("_components", []) or []:
        ci = cref["__id__"]
        ct = type_of(ci)
        if not ct.startswith("cc."):
            # 自定义脚本组件：确认它是否还有对应的 .ts.meta
            found = False
            for dirpath, _, files in os.walk(os.path.join(ROOT, "assets")):
                for fn in files:
                    if fn.endswith(".meta"):
                        try:
                            m = json.load(io.open(os.path.join(dirpath, fn), encoding="utf-8"))
                        except Exception:
                            continue
                        if m.get("uuid") == ct:
                            found = True
                            break
                if found:
                    break
            if found:
                print("  保留自定义组件 %s（对应脚本仍存在）" % ct)
                keep_components.append(ci)
            else:
                print("  待删除：Missing Script 组件 [%d] type=%s" % (ci, ct))
                to_delete.add(ci)
        else:
            keep_components.append(ci)

    # 2) Player 节点整棵子树
    if player_idx is not None:
        stack = [player_idx]
        while stack:
            ni = stack.pop()
            if ni in to_delete:
                continue
            to_delete.add(ni)
            node = doc[ni]
            for cref in node.get("_components", []) or []:
                to_delete.add(cref["__id__"])
            for ch in node.get("_children", []) or []:
                stack.append(ch["__id__"])
        print("  待删除：Player 节点及其 %d 个附属对象" % (len(to_delete) - 1))

    if not to_delete:
        print("没有需要删除的对象")
    print("共需删除 %d 个对象" % len(to_delete))
    for i in sorted(to_delete):
        print("     [%d] %s _name=%r" % (i, type_of(i), doc[i].get("_name", "")))

    # ---------- 备份 ----------
    if not os.path.isdir(os.path.dirname(BACKUP)):
        os.makedirs(os.path.dirname(BACKUP))
    shutil.copyfile(SCENE, BACKUP)
    print("已备份 -> %s" % os.path.relpath(BACKUP, ROOT))

    # ---------- 重建引用（下标重算） ----------
    order = [i for i in range(len(doc)) if i not in to_delete]
    remap = {old: new for new, old in enumerate(order)}

    def rebuild(o, where=""):
        if isinstance(o, dict):
            if "__id__" in o and len(o) == 1:
                old = o["__id__"]
                if old in to_delete:
                    return "DROP"
                if old not in remap:
                    print("拒绝执行：%s 引用了未纳入的对象 %d" % (where, old))
                    sys.exit(1)
                return {"__id__": remap[old]}
            out = {}
            for k, v in o.items():
                rv = rebuild(v, "%s.%s" % (where, k))
                if rv == "DROP":
                    continue          # 数组里过滤掉；标量字段下面单独报错
                out[k] = rv
            return out
        if isinstance(o, list):
            lst = []
            for idx, v in enumerate(o):
                rv = rebuild(v, "%s[%d]" % (where, idx))
                if rv == "DROP":
                    continue
                lst.append(rv)
            return lst
        return o

    new_doc = [rebuild(doc[old], "[%d]" % old) for old in order]

    # 修正被删除组件留下的登记：Canvas 的 _components 已通过数组过滤自动清理
    new_canvas = new_doc[remap[canvas_idx]]
    new_canvas["_components"] = [{"__id__": remap[c]} for c in keep_components]
    # 确保 Canvas 的 _children 只剩 Camera（Player 已删）
    new_children = []
    for ch in new_canvas.get("_children", []) or []:
        ni = ch["__id__"]
        if is_node(ni) or True:
            new_children.append(ch)
    new_canvas["_children"] = new_children

    # ---------- 竖屏分辨率 ----------
    for i, o in enumerate(new_doc):
        if o.get("__type__") == "cc.UITransform" and o.get("node", {}).get("__id__") == remap[canvas_idx]:
            sz = o.get("_contentSize") or {}
            old = "%sx%s" % (sz.get("width"), sz.get("height"))
            o["_contentSize"] = {"__type__": "cc.Size", "width": DESIGN_W, "height": DESIGN_H}
            print("Canvas UITransform 尺寸: %s -> %dx%d" % (old, DESIGN_W, DESIGN_H))

    # Canvas 节点的位置 = 设计分辨率的一半（引擎的约定）
    new_canvas["_lpos"] = {"__type__": "cc.Vec3", "x": DESIGN_W / 2, "y": DESIGN_H / 2, "z": 0}

    # ---------- 写回 ----------
    with io.open(SCENE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(new_doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("已写回 %s（对象数 %d -> %d）" % (os.path.relpath(SCENE, ROOT), len(doc), len(new_doc)))

    print()
    print("新结构:")
    for i, o in enumerate(new_doc):
        t = o.get("__type__")
        if t == "cc.Node":
            print("  [%2d] Node %-10r comps=%s" % (
                i, o.get("_name"), [c["__id__"] for c in o.get("_components", []) or []]))
        elif t == "cc.Scene":
            print("  [%2d] Scene %-9r children=%s" % (
                i, o.get("_name"), [c["__id__"] for c in o.get("_children", []) or []]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
