"""清理旧 Demo 遗留文件：先打包备份，再删除。带前置校验，绝不误删。

背景：
    项目最初做过一轮「接宝石」小游戏（PlayerController / CollectibleField /
    GameSession / GameBootstrap + 两张程序化贴图）。
    现在主线是贪吃蛇，那批文件已无用，留在仓库里只会让人困惑。

安全设计：
    1. 先校验每个目标文件**确实没有被 snake 主线引用**，否则拒绝执行
    2. 打包成 zip 放到 temp/ 下（temp/ 已被 .gitignore 忽略，不会进仓库）
    3. 逐个删除并打印，删除前再次确认文件存在
    4. 全程只处理白名单里的路径，不做通配符递归删除
"""
import io
import os
import re
import shutil
import sys
import zipfile

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(ROOT, "temp")
BACKUP_ZIP = os.path.join(BACKUP_DIR, "legacy-gem-demo-backup.zip")

# ---- 白名单：只删这些（相对路径） ----
TARGETS = [
    "assets/scripts/CollectibleField.ts",
    "assets/scripts/CollectibleField.ts.meta",
    "assets/scripts/GameBootstrap.ts",
    "assets/scripts/GameBootstrap.ts.meta",
    "assets/scripts/GameSession.ts",
    "assets/scripts/GameSession.ts.meta",
    "assets/scripts/PlayerController.ts",
    "assets/scripts/PlayerController.ts.meta",
    "assets/textures/dot.png",
    "assets/textures/dot.png.meta",
    "assets/textures/player.png",
    "assets/textures/player.png.meta",
    "assets/textures.meta",
]

# snake 主线里**不允许**出现这些名字，出现就说明还在用
FORBIDDEN_REFS = ["PlayerController", "CollectibleField", "GameSession", "GameBootstrap"]


def to_abs(rel):
    return os.path.join(ROOT, rel.replace("/", os.sep))


def check_not_referenced():
    """前置校验：snake 主线里不能引用待删脚本"""
    snake_dir = os.path.join(ROOT, "assets", "scripts", "snake")
    violations = []
    for fn in os.listdir(snake_dir):
        if not fn.endswith(".ts"):
            continue
        p = os.path.join(snake_dir, fn)
        txt = io.open(p, "r", encoding="utf-8").read()
        # 去掉注释后再找，避免注释里提到名字造成误报
        code = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
        code = re.sub(r"//[^\n]*", "", code)
        for ref in FORBIDDEN_REFS:
            if ref in code:
                violations.append("%s 引用了 %s" % (fn, ref))
    return violations


def main():
    print("=" * 72)
    print("步骤 1/3：前置校验（确认旧脚本未被主线引用）")
    print("=" * 72)
    violations = check_not_referenced()
    if violations:
        print("拒绝执行！以下引用关系说明文件仍在被使用：")
        for v in violations:
            print("   -", v)
        return 1
    print("✅ 通过：蛇主线里没有任何对旧脚本的引用")

    print()
    print("=" * 72)
    print("步骤 2/3：打包备份")
    print("=" * 72)
    if not os.path.isdir(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)

    existing = [t for t in TARGETS if os.path.isfile(to_abs(t))]
    missing = [t for t in TARGETS if not os.path.isfile(to_abs(t))]
    print("待处理文件 %d 个（存在 %d，缺失 %d）" % (len(TARGETS), len(existing), len(missing)))
    if missing:
        for m in missing:
            print("   缺失(跳过): %s" % m)

    with zipfile.ZipFile(BACKUP_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in existing:
            z.write(to_abs(rel), rel)
    print("已备份 -> %s" % os.path.relpath(BACKUP_ZIP, ROOT))
    print("备份大小: %.1f KB" % (os.path.getsize(BACKUP_ZIP) / 1024.0))

    print()
    print("=" * 72)
    print("步骤 3/3：删除")
    print("=" * 72)
    deleted = 0
    failed = []
    for rel in existing:
        p = to_abs(rel)
        try:
            os.remove(p)
            deleted += 1
            print("  已删除 %s" % rel)
        except Exception as e:
            failed.append((rel, str(e)))
            print("  删除失败 %s: %s" % (rel, e))

    # 顺手清理空的 textures 目录
    tex_dir = os.path.join(ROOT, "assets", "textures")
    if os.path.isdir(tex_dir):
        rest = os.listdir(tex_dir)
        if not rest:
            os.rmdir(tex_dir)
            print("  已删除空目录 assets/textures/")
        else:
            print("  assets/textures/ 仍有内容，保留: %s" % rest)

    print()
    print("删除 %d 个文件，失败 %d 个" % (deleted, len(failed)))
    print()
    print("如需恢复：解压 %s 到项目根目录即可" % os.path.relpath(BACKUP_ZIP, ROOT))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
