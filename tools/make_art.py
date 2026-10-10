"""生成 2D 教学用精灵图（无外部依赖，纯 PNG 编码写盘）。

为什么用脚本造素材：
    1. 不依赖你去找图、不涉及版权；
    2. 形状有明确"朝向"（右端有个尖角），这样转起来你一眼能看出角度对不对；
    3. 边界干净，不加抗锯齿半透明边 —— 这是 2D 素材导入的常见坑，
       PNG 的透明像素如果是半透明的杂色，Sprite 会出现一圈脏边。
"""
import io
import os
import struct
import sys
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "textures")


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, w, h, rgba_rows):
    """rgba_rows: 每行是 bytes，长度 = w*4"""
    raw = b"".join(b"\x00" + row for row in rgba_rows)  # 每行前加 filter byte 0
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, 9))
    png += _chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def make_player(size=64):
    """一个朝右的箭头形飞船/质点：中间亮、边缘暗，带 2px 透明留白。"""
    w = h = size
    m = 2                       # 留白
    cx, cy = w / 2.0, h / 2.0
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            px, py = x + 0.5, y + 0.5
            # 菱形（|dx|+|dy| <= r）：给出明确的尖角朝向，便于观察旋转
            r = size / 2.0 - m
            d = abs(px - cx) + abs(py - cy)
            if d <= r:
                t = d / r                      # 0 = 中心, 1 = 边缘
                # 用位置做一点明暗，让旋转肉眼可辨
                shade = int(255 * (1.0 - 0.45 * t))
                row += bytes((60, shade, 240, 255))   # R, G(明暗), B, A
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return w, h, rows


def make_dot(size=32, rgb=(255, 170, 40)):
    """一个实心圆，用作"可拾取物"，也是后续课的素材。"""
    w = h = size
    cx = cy = size / 2.0
    r = size / 2.0 - 3
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            px, py = x + 0.5, y + 0.5
            dx, dy = px - cx, py - cy
            if dx * dx + dy * dy <= r * r:
                t = (dx * dx + dy * dy) ** 0.5 / r
                k = 1.0 - 0.35 * t
                row += bytes((int(rgb[0] * k), int(rgb[1] * k), int(rgb[2] * k), 255))
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return w, h, rows


def main():
    out = os.path.normpath(OUT_DIR)
    if not os.path.isdir(out):
        os.makedirs(out)
    jobs = [
        ("player.png", make_player(64)),
        ("dot.png", make_dot(32)),
    ]
    for name, (w, h, rows) in jobs:
        p = os.path.join(out, name)
        write_png(p, w, h, rows)
        print("已生成 %-12s %dx%d  %d 字节" % (name, w, h, os.path.getsize(p)))
    print("输出目录:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
