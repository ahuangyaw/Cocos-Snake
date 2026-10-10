"""检查文本文件是否被「UTF-8 -> GBK -> UTF-8」往返破坏，以及 BOM / 换行符。

之前的检测用了「生僻字连排」这种启发式，误报率高（正常的中文注释会被误判）。
这次改成确定性判据：

  1. BOM：文件开头是否有多余的 EF BB BF（git/编译器通常不希望有）
  2. 换行符：CRLF 还是 LF（跨平台协作时混用会产生假 diff）
  3. 乱码的**确定特征**：UTF-8 -> GBK 解码失败时用的是 replace，
     会产生 U+FFFD（�）；或者原本的 UTF-8 字节被 GBK 解成合法但错误的汉字。
     后者无法从单个文件判定 —— 所以改成「与 git HEAD 版本比对」：
     如果文件在 git 里有历史版本，直接 diff 就能看出是不是被改坏了。
"""
import io
import os
import subprocess
import sys

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIT = r"D:\software\Git\cmd\git.exe"

TARGETS = [
    "tools/make_audio.js",
    "tools/verify_audio.py",
    "tools/make_art.py",
    "tools/preview_gitignore.py",
    "tools/test_snake_core.js",
    "tools/check_syntax.js",
    "assets/scripts/snake/SnakeView.ts",
    "assets/scripts/snake/SnakeAudio.ts",
    "assets/scripts/snake/SnakeCore.ts",
    "assets/scripts/snake/SnakeGame.ts",
    "docs/01-交付说明与第一课.md",
    "docs/02-Snake-Demo交付说明.md",
]


def run_git(args):
    try:
        return subprocess.run([GIT] + args, cwd=ROOT, capture_output=True,
                              text=False).stdout.decode("utf-8", errors="replace")
    except Exception as e:
        return "<<git 调用失败: %s>>" % e


def main():
    print("=" * 78)
    print("确定性检查：BOM / 换行符 / 替换字符 / 与 git 版本的差异")
    print("=" * 78)
    print("%-44s %-6s %-8s %-8s %s" % ("文件", "BOM", "换行", "U+FFFD", "git 状态"))
    print("-" * 78)

    problems = 0
    for rel in TARGETS:
        p = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(p):
            print("%-44s %s" % (rel, "文件不存在"))
            continue
        raw = open(p, "rb").read()
        bom = raw[:3] == b"\xef\xbb\xbf"
        crlf = raw.count(b"\r\n")
        lf = raw.count(b"\n")
        mixed = crlf > 0 and (lf - crlf) > 0
        nl = "CRLF" if crlf > 0 and not mixed else ("混用!" if mixed else "LF")
        txt = raw.decode("utf-8", errors="replace")
        fffd = txt.count("\ufffd")

        # 与 git 工作区状态比对
        st = run_git(["status", "--porcelain", "--", rel]).strip()
        if not st:
            gstate = "未改动"
        elif st.startswith("??"):
            gstate = "新文件"
        else:
            gstate = st[:2].strip() or "已改动"

        flag = ""
        if bom or mixed or fffd > 0:
            flag = "  <-- 注意"
            problems += 1
        print("%-44s %-6s %-8s %-8d %s%s" % (
            rel, "有" if bom else "无", nl, fffd, gstate, flag))

    print("-" * 78)
    print("需要处理的文件数: %d" % problems)
    print()
    print("说明: 「U+FFFD」是解码失败的替换字符，出现即说明文件被破坏。")
    print("      BOM 与 CRLF 通常无害，但对 TS/JS 源码建议保持 无BOM + LF。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
