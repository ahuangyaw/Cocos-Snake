"""预览：按 .gitignore 规则算出「首次提交会包含哪些文件」。

为什么写这个：
    首次提交是最容易搞砸的一步 —— 一旦把 library/ 或 temp/ 提交进去，
    仓库会瞬间膨胀到几百 MB，而且以后很难干净移除。
    所以在执行 git add 之前，先用脚本把结果算出来看一眼，成本几乎为零。

用法：python tools/preview_gitignore.py
"""
import io
import os
import sys

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_patterns(path):
    """读取 .gitignore，返回 (目录模式, 文件模式) 两组，已去掉注释与空行"""
    dir_pats, file_pats, all_pats = [], [], []
    if not os.path.isfile(path):
        return dir_pats, file_pats, all_pats
    with io.open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            all_pats.append(s)
            # 以 / 结尾 = 只匹配目录；无通配符的裸名 = 匹配任意层级的同名文件或目录
            if s.endswith("/"):
                dir_pats.append(s.rstrip("/"))
            elif any(ch in s for ch in "*?["):
                file_pats.append(s)
            else:
                dir_pats.append(s)      # 裸名：目录或文件都可能
    return dir_pats, file_pats, all_pats


def main():
    dir_pats, file_pats, all_pats = load_patterns(os.path.join(ROOT, ".gitignore"))
    print("从 .gitignore 读到 %d 条规则:" % len(all_pats))
    for p in all_pats:
        print("   ", p)
    print()

    tracked = []
    ignored_dirs = set()
    ignored_count = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir == ".":
            rel_dir = ""

        # 目录剪枝：命中忽略规则的目录整棵跳过（和 git 行为一致）
        keep = []
        for d in dirnames:
            if d == ".git":
                continue
            rel = (rel_dir + "/" + d) if rel_dir else d
            if d in dir_pats:
                ignored_dirs.add(rel)
                continue
            keep.append(d)
        dirnames[:] = keep

        for fn in filenames:
            rel = (rel_dir + "/" + fn) if rel_dir else fn
            if fn in dir_pats:
                ignored_count += 1
                continue
            tracked.append(rel.replace("\\", "/"))
        # 统计被忽略的文件数（粗略：只看被剪掉的目录，数量另算）
        for d in list(ignored_dirs):
            pass

    tracked.sort()

    print("=" * 70)
    print("会被提交的文件（%d 个）:" % len(tracked))
    print("=" * 70)
    total_bytes = 0
    by_top = {}
    for rel in tracked:
        top = rel.split("/")[0] if "/" in rel else "(根目录)"
        by_top[top] = by_top.get(top, 0) + 1
        p = os.path.join(ROOT, rel.replace("/", os.sep))
        try:
            total_bytes += os.path.getsize(p)
        except Exception:
            pass
        print("   ", rel)

    print()
    print("=" * 70)
    print("按顶层目录统计:")
    for k in sorted(by_top):
        print("   %-20s %d 个文件" % (k, by_top[k]))
    print()
    print("总体积: %.2f MB" % (total_bytes / 1024.0 / 1024.0))
    print("被忽略的目录: %s" % (sorted(ignored_dirs) if ignored_dirs else "无"))
    print()
    print("⚠️ 检查要点:")
    bad = [t for t in tracked if t.startswith("library/") or t.startswith("temp/")
           or t.startswith("build/") or t.startswith("profiles/")]
    if bad:
        print("   ❌ 有派生数据混进来了！前几个: %s" % bad[:5])
    else:
        print("   ✅ 没有 library/ temp/ build/ profiles/ 混入")
    meta = [t for t in tracked if t.endswith(".meta")]
    print("   %s .meta 文件数量: %d（必须 > 0）" % ("✅" if meta else "❌", len(meta)))


if __name__ == "__main__":
    main()
