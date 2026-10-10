"""校验生成的 WAV 文件是否真的是可用的音效（只读）。

我看不到、也听不到音频，所以必须用数据来确认它是对的。检查项：

  1. 文件头合法（RIFF/WAVE/fmt/data），位深 16bit，采样率 44100，单声道
  2. 数据长度与头部声明一致（防止写坏）
  3. 峰值不超过 1.0 —— 超过就是削波（clipping），听起来会"炸"
  4. 峰值不能太小 —— 太小等于没声音
  5. 直流偏移 (DC offset) 接近 0 —— 有 DC 偏移会"咔"一声爆音
  6. 包络形状：起始/中段/结尾的 RMS 应呈现衰减（说明包络真的生效了）
  7. 首尾采样接近 0 —— 否则播放开始/结束会有爆音

用法：python tools/verify_audio.py
"""
import io
import os
import struct
import sys
import wave

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "assets", "resources", "audio")

EXPECT_RATE = 44100
EXPECT_CH = 1
EXPECT_WIDTH = 2      # 16bit

all_ok = True


def read_samples(path):
    with wave.open(path, "rb") as w:
        nch = w.getnchannels()
        width = w.getsampwidth()
        rate = w.getframerate()
        nframes = w.getnframes()
        raw = w.readframes(nframes)
    count = nframes * nch
    samples = struct.unpack("<%dh" % count, raw)
    # 转成 -1..1
    return nch, width, rate, nframes, [s / 32768.0 for s in samples]


def rms(seq):
    if not seq:
        return 0.0
    return (sum(x * x for x in seq) / len(seq)) ** 0.5


def check_file(name):
    global all_ok
    path = os.path.join(AUDIO_DIR, name)
    problems = []

    # ---- 文件头 ----
    with io.open(path, "rb") as f:
        head = f.read(12)
    if head[0:4] != b"RIFF" or head[8:12] != b"WAVE":
        problems.append("文件头不是 RIFF/WAVE")

    nch, width, rate, nframes, s = read_samples(path)

    if nch != EXPECT_CH:
        problems.append("声道数 %d != %d" % (nch, EXPECT_CH))
    if width != EXPECT_WIDTH:
        problems.append("位深 %d 字节 != %d" % (width, EXPECT_WIDTH))
    if rate != EXPECT_RATE:
        problems.append("采样率 %d != %d" % (rate, EXPECT_RATE))

    # ---- 数据量 ----
    expect_bytes = 44 + nframes * nch * width
    actual_bytes = os.path.getsize(path)
    if expect_bytes != actual_bytes:
        problems.append("文件大小 %d != 头部推算 %d" % (actual_bytes, expect_bytes))

    if not s:
        problems.append("没有采样数据")
        return name, nframes, rate, problems, {}

    # ---- 峰值 ----
    peak = max(abs(x) for x in s)
    if peak > 0.999:
        problems.append("削波！峰值 %.4f >= 1.0" % peak)
    if peak < 0.05:
        problems.append("音量过小，峰值仅 %.4f" % peak)

    # ---- 直流偏移 ----
    dc = sum(s) / len(s)
    if abs(dc) > 0.01:
        problems.append("直流偏移过大 %.4f（会有爆音）" % dc)

    # ---- 爆音检查（这才是真正的"咔哒声"来源）----
    # 判据一：第一个采样必须接近 0（非零 = 播放瞬间电平突变 = 爆音）
    if abs(s[0]) > 0.02:
        problems.append("起始采样非零 %.4f（播放会有 '咔' 声）" % s[0])
    # 判据二：最后一个采样也要接近 0（截断爆音）
    if abs(s[-1]) > 0.05:
        problems.append("结束采样非零 %.4f（截断会有爆音）" % s[-1])
    # 判据三：起音过程要跨越足够的采样数（太陡的起音同样会产生咔哒感）
    #   找到首次达到峰值 60% 的采样位置，换算成毫秒
    thresh = 0.6 * peak
    rise_idx = 0
    for k, v in enumerate(s):
        if abs(v) >= thresh:
            rise_idx = k
            break
    rise_ms = rise_idx / float(rate) * 1000.0
    if rise_ms < 1.5:
        problems.append("起音过快 %.2fms（会有咔哒感）" % rise_ms)

    # ---- 包络形状：分成 5 段看 RMS ----
    seg = len(s) // 5
    env = [round(rms(s[i * seg:(i + 1) * seg]), 4) for i in range(5)]
    decaying = env[0] >= env[-1]
    if not decaying:
        problems.append("包络没有衰减，尾部反而更响: %s" % env)

    stats = {
        "peak": peak,
        "dc": dc,
        "env": env,
        "secs": nframes / float(rate),
        "rise_ms": rise_ms,
    }
    if problems:
        all_ok = False
    return name, nframes, rate, problems, stats


def main():
    if not os.path.isdir(AUDIO_DIR):
        print("找不到目录:", AUDIO_DIR)
        return 1

    files = sorted(f for f in os.listdir(AUDIO_DIR) if f.lower().endswith(".wav"))
    if not files:
        print("目录里没有 .wav 文件:", AUDIO_DIR)
        return 1

    print("校验目录:", AUDIO_DIR)
    print("=" * 78)

    total_bytes = 0
    results = []
    for f in files:
        total_bytes += os.path.getsize(os.path.join(AUDIO_DIR, f))
        results.append(check_file(f))

    print("%-14s %7s %7s %7s %7s  %-28s %s" % (
        "文件", "时长s", "峰值", "直流", "起音ms", "包络(5段RMS)", "结论"))
    print("-" * 84)
    for name, nframes, rate, problems, st in results:
        if st:
            envs = " ".join("%.3f" % v for v in st["env"])
            verdict = "OK" if not problems else "问题:" + ";".join(problems)
            print("%-14s %7.3f %7.4f %7.4f %7.2f  %-28s %s" % (
                name, st["secs"], st["peak"], st["dc"], st["rise_ms"], envs, verdict))
        else:
            print("%-14s %7.3f %7s %7s %7s  %-28s %s" % (
                name, nframes / float(rate), "-", "-", "-", "-",
                "问题:" + ";".join(problems)))

    print("-" * 84)
    print("共 %d 个文件, 合计 %.1f KB" % (len(files), total_bytes / 1024.0))
    print()
    print("结论: %s" % ("全部合格 ✅" if all_ok else "存在问题 ❌"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
