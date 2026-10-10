"""按语义重新序列化场景，修正数组下标错位（带前置校验，绝不盲改）。

背景：Creator 场景 = JSON 数组 + 下标互相引用。手工/脚本编辑时一旦
某个对象的位置变了，所有引用它的 __id__ 都要跟着变 —— 极易错位。

做法：
    1. 先把数组解析成「语义对象」并找出真正的场景根与 GameRoot；
    2. 按固定顺序重排：[SceneAsset, Scene, Canvas, CameraNode, Camera,
       CanvasUITransform, CanvasComponent, GameRoot, ...GameRoot组件,
       ...SceneGlobals...]
    3. 重建所有引用（写新的 __id__）；
    4. 覆盖写回前自动备份。
"""
import io
import json
import os
import shutil
import sys

SCENE = r"assets\main.scene"
BACKUP_DIR = r"temp"


def load(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def dump(path, doc):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    doc = load(SCENE)
    print("原对象数: %d" % len(doc))

    # ---------- 定位关键对象（按语义，不按下标猜） ----------
    def find(pred, what):
        hits = [i for i, o in enumerate(doc) if pred(o)]
        if len(hits) != 1:
            print("拒绝执行：期望恰好 1 个 %s，实际找到 %d 个 -> %s" % (what, len(hits), hits))
            sys.exit(1)
        return hits[0]

    scene_idx = find(lambda o: o.get("__type__") == "cc.Scene", "cc.Scene")
    scene = doc[scene_idx]

    def node_named(name):
        return find(lambda o: o.get("__type__") == "cc.Node" and o.get("_name") == name,
                    "名为 %r 的节点" % name)

    canvas_idx = node_named("Canvas")
    game_idx = node_named("GameRoot")

    # Canvas 的组件：一个 cc.UITransform，一个 cc.Canvas
    canvas_ui = find(lambda o: o.get("__type__") == "cc.UITransform"
                     and o.get("node", {}).get("__id__") == canvas_idx, "Canvas 的 UITransform")
    canvas_comp = find(lambda o: o.get("__type__") == "cc.Canvas", "cc.Canvas 组件")

    # Camera 节点（Canvas 的子节点）
    cam_node_idx = find(lambda o: o.get("__type__") == "cc.Node" and o.get("_name") == "Camera",
                        "Camera 节点")
    cam_comp_idx = find(lambda o: o.get("__type__") == "cc.Camera", "cc.Camera 组件")

    # GameRoot 的组件（保持原有顺序）
    # 注意：先前手写场景时，组件里的 node 引用误写成了 GameRoot 旁边的下标，
    # 所以这里不能只信任 node 字段，还要用「节点自己登记的 _components」来交叉确认。
    game_comps_raw = [c["__id__"] for c in doc[game_idx].get("_components", []) or []]
    for c in game_comps_raw:
        ref = doc[c].get("node")
        if not ref or ref.get("__id__") != game_idx:
            print("修正组件 [%d] %s 的 node 引用: %s -> %d"
                  % (c, doc[c].get("__type__"), ref, game_idx))
            doc[c]["node"] = {"__id__": game_idx}
    # 找出「node 指向 GameRoot」以及「node 指向无效下标」的组件。
    # 后者是手写场景时的典型残留：那个多余的 UITransform 的 node 指向了 8，
    # 而 8 位置上其实还是个 UITransform（不是节点）。这种悬空引用必须据实归属。
    NODE_TYPES = ("cc.Node", "cc.Scene")
    for i, o in enumerate(doc):
        if o.get("__type__") in NODE_TYPES or not o.get("node"):
            continue
        nidx = o["node"].get("__id__")
        target_type = doc[nidx].get("__type__") if isinstance(nidx, int) and 0 <= nidx < len(doc) else None
        if target_type in NODE_TYPES:
            # node 指向合法节点，靠节点自身的 _components 登记即可，无需额外处理
            continue
        print("组件 [%d] %s 的 node 指向无效下标 %s（那里是 %s），归属到 GameRoot"
              % (i, o.get("__type__"), nidx, target_type))
        o["node"] = {"__id__": game_idx}
        if i not in game_comps_raw:
            game_comps_raw.append(i)

    # GameRoot 不需要 UITransform：它的子节点在创建时会各自带上自己的 UITransform。
    # 因此把挂在 GameRoot 上的 UITransform 排除掉（否则它成为孤儿对象）。
    dropped = []
    game_comps = []
    for c in game_comps_raw:
        if doc[c].get("__type__") == "cc.UITransform":
            dropped.append(c)
        else:
            game_comps.append(c)
    print("GameRoot 组件下标: %s（排除 %s）" % (game_comps, dropped))

    # 全局设置对象（SceneGlobals 及其子对象）
    globals_idx = find(lambda o: o.get("__type__") == "cc.SceneGlobals", "cc.SceneGlobals")
    globals_obj = doc[globals_idx]
    globals_children = []
    for key in ("ambient", "shadows", "_skybox", "fog", "octree", "skin"):
        ref = globals_obj.get(key)
        if ref:
            globals_children.append((key, ref["__id__"]))
    print("全局对象: %s" % [(k, i) for k, i in globals_children])

    # ---------- 计算新顺序 ----------
    order = [0, scene_idx, canvas_idx, cam_node_idx, cam_comp_idx,
             canvas_ui, canvas_comp, game_idx]
    order += game_comps
    globals_start = len(order)
    order.append(globals_idx)
    for _, i in globals_children:
        order.append(i)
    print("新顺序（原下标）: %s" % order)
    if len(set(order)) != len(order):
        print("拒绝执行：新顺序里有重复对象")
        sys.exit(1)
    missing = [i for i in range(len(doc)) if i not in order and i not in dropped]
    if missing:
        print("拒绝执行：以下对象未被纳入新顺序，且没有被显式排除 %s" % missing)
        for i in missing:
            print("   [%d] %s _name=%r" % (i, doc[i].get("__type__"), doc[i].get("_name", "")))
        sys.exit(1)
    if dropped:
        print("已显式排除（不写入新文件）: %s" % dropped)

    # ---------- 解析「资源引用标记」 ----------
    # 手写场景时不可能预先知道资源对象在数组里的下标，所以允许先写语义标记：
    #     "spriteFrame": { "__assetUuid__": "xxx@f9941", "__assetType__": "cc.SpriteFrame" }
    # 这里统一为每个不同的 uuid 追加一个资源对象，并把标记替换成 {"__id__": n}。
    asset_uuid_to_idx = {}
    for i in list(order):
        o = doc[i]

        def resolve(o, where):
            if isinstance(o, dict):
                if "__assetUuid__" in o:
                    uuid = o["__assetUuid__"]
                    type_name = o.get("__assetType__", "cc.Asset")
                    if uuid in asset_uuid_to_idx:
                        new_idx = asset_uuid_to_idx[uuid]
                    else:
                        new_idx = len(doc)
                        doc.append({
                            "__type__": type_name,
                            "_name": "",
                            "_objFlags": 0,
                            "__editorExtras__": {},
                            "_native": "",
                            "_uuid__": uuid,
                        })
                        asset_uuid_to_idx[uuid] = new_idx
                        print("登记资源引用 %s (%s) -> 新下标 %d" % (uuid, type_name, new_idx))
                    return {"__id__": new_idx}
                return {k: resolve(v, "%s.%s" % (where, k)) for k, v in o.items()}
            if isinstance(o, list):
                return [resolve(v, "%s[%d]" % (where, j)) for j, v in enumerate(o)]
            return o

        doc[i] = resolve(o, "[%d]" % i)

    # 资源对象追加到末尾；它们不参与重排，因此恒等映射（新下标 == 原下标）
    for uuid, idx in asset_uuid_to_idx.items():
        if idx not in order:
            order.append(idx)
    remap = {old: new for new, old in enumerate(order)}
    print("下标映射: %s" % remap)

    # ---------- 深拷贝并按新下标重建引用 ----------
    # 对被显式排除的对象（如多余的 UITransform）：不再报错中止，而是「过滤掉该引用」。
    # 场景里的 _components / _children 这类数组，去掉一个元素正是我们想要的结果；
    # 若是标量字段引用了被排除对象，那才是真错误 —— 那种情况下面会单独报出来。
    dropped_set = set(dropped)

    def rebuild(o, where=""):
        if isinstance(o, dict):
            if "__id__" in o and len(o) == 1:
                old = o["__id__"]
                if old in dropped_set:
                    return "DROP"
                if old not in remap:
                    print("拒绝执行：引用指向未纳入的对象 %d（来自 %s）" % (old, where))
                    sys.exit(1)
                return {"__id__": remap[old]}
            out = {}
            for k, v in o.items():
                rv = rebuild(v, "%s.%s" % (where, k))
                if rv == "DROP":
                    print("拒绝执行：标量字段 %s.%s 引用了被排除的对象" % (where, k))
                    sys.exit(1)
                out[k] = rv
            return out
        if isinstance(o, list):
            lst = []
            for idx, v in enumerate(o):
                rv = rebuild(v, "%s[%d]" % (where, idx))
                if rv == "DROP":
                    continue        # 数组里过滤掉
                lst.append(rv)
            return lst
        return o

    new_doc = []
    for old in order:
        new_doc.append(rebuild(doc[old]))

    # ---------- 修正结构：GameRoot 挂在 Scene 下，去掉多余的 UITransform ----------
    scene_new = new_doc[remap[scene_idx]]
    scene_new["_children"] = [{"__id__": remap[canvas_idx]}, {"__id__": remap[game_idx]}]
    scene_new["_globals"] = {"__id__": remap[globals_idx]}

    canvas_new = new_doc[remap[canvas_idx]]
    canvas_new["_parent"] = {"__id__": remap[scene_idx]}
    canvas_new["_components"] = [{"__id__": remap[canvas_ui]}, {"__id__": remap[canvas_comp]}]
    canvas_new["_children"] = [{"__id__": remap[cam_node_idx]}]

    cam_node_new = new_doc[remap[cam_node_idx]]
    cam_node_new["_parent"] = {"__id__": remap[canvas_idx]}
    cam_node_new["_components"] = [{"__id__": remap[cam_comp_idx]}]
    cam_node_new["_children"] = []

    cam_comp_new = new_doc[remap[cam_comp_idx]]
    cam_comp_new["node"] = {"__id__": remap[cam_node_idx]}

    game_new = new_doc[remap[game_idx]]
    game_new["_parent"] = {"__id__": remap[scene_idx]}
    game_new["_components"] = [{"__id__": remap[c]} for c in game_comps]
    game_new["_children"] = []
    game_new.pop("_prefab", None)
    game_new["_prefab"] = None

    for c in game_comps:
        new_doc[remap[c]]["node"] = {"__id__": remap[game_idx]}

    new_doc[remap[canvas_ui]]["node"] = {"__id__": remap[canvas_idx]}
    new_doc[remap[canvas_comp]]["node"] = {"__id__": remap[canvas_idx]}

    # 全局对象引用
    g = new_doc[remap[globals_idx]]
    for key, old in globals_children:
        g[key] = {"__id__": remap[old]}

    # ---------- 备份 + 写回 ----------
    if not os.path.isdir(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    backup = os.path.join(BACKUP_DIR, "main.scene.before-reserialize.json")
    shutil.copyfile(SCENE, backup)
    print("已备份 -> %s" % backup)

    dump(SCENE, new_doc)
    print("已写回 %s（对象数 %d）" % (SCENE, len(new_doc)))

    print()
    print("新结构预览:")
    for i, o in enumerate(new_doc):
        t = o.get("__type__")
        if t == "cc.Node":
            print("  [%2d] Node %-14r parent=%s comps=%s"
                  % (i, o.get("_name"), o.get("_parent", {}).get("__id__"),
                     [c["__id__"] for c in o.get("_components", []) or []]))
        elif t == "cc.Scene":
            print("  [%2d] Scene %-13r children=%s"
                  % (i, o.get("_name"), [c["__id__"] for c in o.get("_children", []) or []]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
