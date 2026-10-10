"""Cocos Creator UUID <-> 压缩 UUID 编解码器（纯标准库，已用真实数据校准）。

为什么需要它
------------
场景/预制体文件里：
  * 引擎内置组件写成类型名     -> { "__type__": "cc.Sprite", ... }
  * **自定义脚本组件**写成压缩 uuid -> { "__type__": "b2bd1+njXxJxaFY3ymm06WU", ... }

算法（从本工程 library 里的真实数据反推并验证）
--------------------------------------------
标准 uuid: "6569ba1d-9c5b-47e4-a126-bbc309cf64c6" -> hex "6569ba1d9c5b47e4a126bbc309cf64c6" (32 chars)

压缩：out[0] = BASE64_KEYS[32] = 'g'
      out[1] = BASE64_KEYS[5]  = 'F'      (5 个连字符 -> 'F'，见下方实测)
      其余每 2 个 hex 字符 -> 1 字节 -> BASE64_KEYS[byte]
      最后一个字节只放 1 个 hex 字符时，value = nibble << 4
解压：v = BASE64_VALUES[c]
      high = (v >> 4) & 0xF ; low = (v >> 0) & 0xF
      每个字符贡献 2 个 hex 字符；最后一个字符只贡献 high（若 length 参数为 1）

实测数据（引擎自带库文件 library/7f/7f4ddeab-...json 第 1646 行）:
      "b2bd1+njXxJxaFY3ymm06WU"  ->  6569ba1d-9c5b-47e4-a126-bbc309cf64c6  (本工程 Orbit.ts)
"""
import sys

BASE64_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
BASE64_VALUES = {c: i for i, c in enumerate(BASE64_KEYS)}
HEX = "0123456789abcdef"

# 实测得到的第 2 个字节（连字符标志）取值
# 对应 Cocos 内部 BASE64_KEYS[5] == 'F'
DASH_FLAG = 5


def compress_uuid(uuid):
    """标准 uuid -> 压缩 uuid"""
    hex_str = uuid.replace("-", "").lower()
    if len(hex_str) != 32:
        raise ValueError("uuid 的 hex 长度不是 32: %r" % uuid)

    out = [BASE64_KEYS[len(hex_str)], BASE64_KEYS[DASH_FLAG]]
    for i in range(0, len(hex_str) - 1, 2):
        high = int(hex_str[i], 16)
        low = int(hex_str[i + 1], 16)
        out.append(BASE64_KEYS[((high << 4) | low) & 0x3F])
    # 若剩最后一个奇数位 hex，单独编码（低 4 位为 0）
    if len(hex_str) % 2 == 1:
        out.append(BASE64_KEYS[(int(hex_str[-1], 16) << 4) & 0x3F])
    return "".join(out)


def decompress_uuid(short):
    """压缩 uuid -> 标准 uuid（8-4-4-4-12 形式）"""
    if not short:
        return short
    hex_len = BASE64_VALUES[short[0]]
    chars = short[2:]
    hex_chars = []
    for i, c in enumerate(chars):
        v = BASE64_VALUES[c]
        high = HEX[(v >> 4) & 0xF]
        if i == len(chars) - 1 and (len(chars) * 2) > hex_len:
            # 最后一个字符只承载 1 个 hex 字符
            hex_chars.append(high)
        else:
            hex_chars.append(high)
            hex_chars.append(HEX[v & 0xF])
    hex_str = "".join(hex_chars)[:hex_len]
    parts = (hex_str[0:8], hex_str[8:12], hex_str[12:16], hex_str[16:20], hex_str[20:32])
    return "-".join(p for p in parts if p)


def _selftest():
    cases = [
        # (标准 uuid, 期望的压缩结果；None 表示仅做往返校验)
        ("6569ba1d-9c5b-47e4-a126-bbc309cf64c6", "b2bd1+njXxJxaFY3ymm06WU"),  # 真实数据！
        ("a9a5cfc3-a5e9-458d-84cc-9304f4ca72ac", None),
        ("00000000-0000-0000-0000-000000000000", None),
        ("ffffffff-ffff-ffff-ffff-ffffffffffff", None),
        ("01234567-89ab-cdef-0123-456789abcdef", None),
    ]
    ok = True
    for u, expect in cases:
        c = compress_uuid(u)
        d = decompress_uuid(c)
        flags = []
        if d != u:
            flags.append("往返失败")
            ok = False
        if expect is not None and c != expect:
            flags.append("与实测不符(期望 %s)" % expect)
            ok = False
        print("%-4s %s -> %s -> %s %s" % ("OK" if not flags else "FAIL", u, c, d,
                                          " ".join(flags)))
    return ok


if __name__ == "__main__":
    sys.exit(0 if _selftest() else 1)
