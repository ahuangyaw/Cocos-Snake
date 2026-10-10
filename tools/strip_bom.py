"""去掉文件开头的 UTF-8 BOM（幂等，可重复运行）。

为什么单独做这件事：
    PowerShell 的 Set-Content -Encoding UTF8 会**强制加上 BOM**。
    对 TS/JS/Python 源码，BOM 通常无害但多余，某些工具链会因此报错或产生脏 diff
    （例如 TypeScript 的 include glob 曾被 BOM 影响过）。
    所以统一清理掉。

本脚本只动**前三个字节**，不碰文件其余内容 —— 这是关键：
   之前我用 PowerShell 处理文本，导致整个文件被重新编码，风险极大。
   处理源码的正确做法就是「按字节操作」，不理解内容就不会破坏内容。
"""
import io
import os
import sys

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOM = b"\xef\xbb\xbf"

EXTS = (".ts", ".js", ".py", ".json", ".md", ".txt", ".html", ".css")

SKIP_DIRS = {".git", "library", "temp", "build", "node_modules", "profiles", "local", "native"}


def main():
    fixed = []
    scanned = 0

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.lower().endswith(EXTS):
                continue
            p = os.path.join(dirpath, fn)
            scanned += 1
            try:
                with open(p, "rb") as f:
                    raw = f.read()
            except Exception as e:
                print("  读取失败 %s: %s" % (p, e))
                continue
            if raw.startswith(BOM):
                with open(p, "wb") as f:
                    f.write(raw[len(BOM):])          # 只去掉前 3 个字节
                rel = os.path.relpath(p, ROOT)
                fixed.append(rel)
                print("  已去 BOM: %s" % rel)

    print()
    print("扫描 %d 个文件，去掉 %d 个 BOM" % (scanned, len(fixed)))
    if not fixed:
        print("没有需要处理的文件 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
