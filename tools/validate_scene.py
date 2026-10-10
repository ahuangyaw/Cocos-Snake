"""场景/预制体文件完整性校验器（只读）。

Creator 的场景文件是「一个 JSON 数组 + 用数组下标互相引用」的结构，
手写或脚本生成时最容易犯的错就是**下标错位**——而且引擎报的错往往指向别处，极难排查。

本脚本检查 6 件事：
  1. JSON 能否解析、顶层是否为数组
  2. 所有 {"__id__": n} 引用的下标是否在合法范围内
  3. 节点 <-> 子节点 的父子关系是否双向一致（child._parent == parent，且 parent._children 含 child）
  4. 组件 <-> 节点 的双向登记（comp.node == node，且 node._components 含 comp）
  5. 场景/预制体的根节点是否可达
  6. 每个对象是否被引用（孤儿对象只是浪费，不致命，但会警告）
"""
import io
import json
import sys

# Windows 控制台默认 GBK，中文与 ✅/❌ 会崩；强制 UTF-8
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ok_flag = True


def err(msg):
    global ok_flag
    ok_flag = False
    print("  [错误] %s" % msg)


def warn(msg):
    print("  [警告] %s" % msg)


def info(msg):
    print("  %s" % msg)


def check(path):
    print("=" * 72)
    print("校验文件: %s" % path)
    with io.open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        doc = json.loads(raw)
    except Exception as e:
        err("JSON 解析失败: %s" % e)
        return
    if not isinstance(doc, list):
        err("顶层不是数组，而是 %s" % type(doc).__name__)
        return
    info("对象数: %d" % len(doc))
    print()

    # ---------- 1. __id__ 引用范围 ----------
    print("① 检查所有 __id__ 引用")
    bad_refs = 0
    ref_count = 0

    def scan_refs(o, ctx):
        nonlocal bad_refs, ref_count
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "__id__" and isinstance(v, int):
                    ref_count += 1
                    if v < 0 or v >= len(doc):
                        err("%s 的 __id__=%d 越界（合法范围 0..%d）" % (ctx, v, len(doc) - 1))
                        bad_refs += 1
                else:
                    scan_refs(v, ctx)
        elif isinstance(o, list):
            for v in o:
                scan_refs(v, ctx)

    for i, o in enumerate(doc):
        scan_refs(o, "[%d] %s" % (i, o.get("__type__", "?")))
    if bad_refs == 0:
        info("共 %d 处引用，全部合法" % ref_count)

    # ---------- 2. 父子关系 ----------
    print()
    print("② 检查节点父子关系")
    node_count = 0
    parent_issues = 0
    for i, o in enumerate(doc):
        if o.get("__type__") != "cc.Node":
            continue
        node_count += 1
        name = o.get("_name", "?")
        parent_ref = o.get("_parent")
        if parent_ref is None:
            continue
        pidx = parent_ref["__id__"]
        parent = doc[pidx]
        if parent.get("__type__") == "cc.Scene":
            pass
        elif parent.get("__type__") != "cc.Node":
            err("节点 %r 的父对象 [%d] 不是节点（%s）" % (name, pidx, parent.get("__type__")))
            parent_issues += 1
            continue
        kids = [c["__id__"] for c in parent.get("_children", []) or []]
        if i not in kids:
            err("节点 %r [%d] 声称父节点是 [%d]，但父节点的 _children 里没有它" % (name, i, pidx))
            parent_issues += 1
    # 反向：children 里的节点必须回指
    for i, o in enumerate(doc):
        if o.get("__type__") not in ("cc.Node", "cc.Scene"):
            continue
        for c in o.get("_children", []) or []:
            cidx = c["__id__"]
            child = doc[cidx]
            if child.get("__type__") != "cc.Node":
                err("[%d] 的 _children 指向 [%d]，但那是 %s 不是节点" % (i, cidx, child.get("__type__")))
                parent_issues += 1
                continue
            pref = child.get("_parent")
            if not pref or pref["__id__"] != i:
                err("父 [%d] 的 _children 含子 [%d]，但子的 _parent 是 %s"
                    % (i, cidx, pref["__id__"] if pref else None))
                parent_issues += 1
    if parent_issues == 0:
        info("%d 个节点，父子关系双向一致" % node_count)

    # ---------- 3. 组件 <-> 节点 ----------
    print()
    print("③ 检查组件与节点的双向登记")
    comp_count = 0
    comp_issues = 0
    for i, o in enumerate(doc):
        t = o.get("__type__", "")
        if t in ("cc.Node", "cc.Scene") or not t:
            continue
        node_ref = o.get("node")
        if not node_ref:
            # 全局配置类对象（SceneGlobals/AmbientInfo/...）没有 node 字段，属正常
            continue
        comp_count += 1
        nidx = node_ref["__id__"]
        node = doc[nidx]
        if node.get("__type__") != "cc.Node":
            err("组件 [%d] %s 的 node 指向 [%d]，但那是 %s" % (i, t, nidx, node.get("__type__")))
            comp_issues += 1
            continue
        comps = [c["__id__"] for c in node.get("_components", []) or []]
        if i not in comps:
            err("组件 [%d] %s 属于节点 %r [%d]，但该节点的 _components 里没有它"
                % (i, t, node.get("_name"), nidx))
            comp_issues += 1
    if comp_issues == 0:
        info("%d 个组件，双向登记一致" % comp_count)

    # ---------- 4. 根可达性 ----------
    print()
    print("④ 检查根节点可达性")
    roots = []
    for i, o in enumerate(doc):
        if o.get("__type__") == "cc.Node" and o.get("_parent") is None:
            roots.append(i)
    scene_children = []
    for o in doc:
        if o.get("__type__") == "cc.Scene":
            scene_children = [c["__id__"] for c in o.get("_children", []) or []]
    if roots:
        err("存在 _parent 为 null 的节点 %s —— 它们不会出现在场景里（应为 cc.Scene._children）" % roots)
    else:
        info("场景根节点 %s 全部通过 _children 挂载" % scene_children)

    # ---------- 5. 孤儿对象 ----------
    print()
    print("⑤ 检查未被引用的对象")
    referenced = set()
    for o in doc:
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "__id__" and isinstance(v, int):
                    referenced.add(v)
    # 顶层资源对象（SceneAsset / Prefab）本身就是入口
    entry = set([0])
    for o in doc:
        if o.get("__type__") in ("cc.Scene", "cc.Prefab"):
            entry.add(doc.index(o))
    orphans = [i for i in range(1, len(doc)) if i not in referenced and i not in entry]
    if orphans:
        warn("对象 %s 没有被任何地方引用（可能是残留数据）" % orphans)
        for i in orphans:
            warn("   [%d] %s _name=%r" % (i, doc[i].get("__type__"), doc[i].get("_name", "")))
    else:
        info("无孤儿对象")

    # ---------- 6. 概览 ----------
    print()
    print("⑥ 结构概览")
    for i, o in enumerate(doc):
        if o.get("__type__") == "cc.Node":
            print("   [%2d] 节点 %-16r layer=%s components=%s"
                  % (i, o.get("_name"), o.get("_layer"),
                     [c["__id__"] for c in o.get("_components", []) or []]))
        elif o.get("__type__") == "cc.Scene":
            print("   [%2d] 场景 %-16r children=%s"
                  % (i, o.get("_name"), [c["__id__"] for c in o.get("_children", []) or []]))
    print()
    print("组件类型清单:")
    from collections import Counter
    c = Counter(o.get("__type__") for o in doc)
    for t, n in c.most_common():
        print("   x%-3d %s" % (n, t))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        check(p)
    print("=" * 72)
    print("结论: %s" % ("全部通过 ✅" if ok_flag else "存在问题 ❌"))
    sys.exit(0 if ok_flag else 1)
