"""採石場の小道具: TNT の箱とトロッコ。

実行: blender -b --factory-startup -P blender/build_quarry.py
出力: public/models/p_tnt.glb, p_minecart.glb, blender/preview/quarry_*.png
トロッコは長い方を Blender の Y（ゲームでは Z）に向けて作る。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Part, empty, mat  # noqa: E402

lib.reset_scene()
R = math.radians
built = []


def model(name, parts, width):
    root = empty(name, (0, 0, 0))
    objs = [root]
    for p in parts:
        objs.append(p.finish((0, 0, 0), root))
    lib.export_glb(name + '.glb', objs)
    built.append((name, root, width))


wood = mat('q_wood', (196, 150, 92))
wood_d = mat('q_wood_d', (130, 92, 52))
red = mat('q_red', (212, 38, 36))
red_d = mat('q_red_d', (150, 24, 24))
yellow = mat('q_yellow', (246, 200, 30))
black = mat('q_black', (34, 32, 30))
fuse = mat('q_fuse', (220, 210, 180))
iron = mat('q_iron', (104, 96, 88), rough=0.7, metal=0.4)
rust = mat('q_rust', (150, 82, 46), rough=0.95)
ore = mat('q_ore', (128, 124, 118))
ore_d = mat('q_ore_d', (96, 92, 86))

# ---- TNT の箱: 木の箱の上にダイナマイトの束。四面に黄色と赤の警告の札
p = Part('tnt')
p.box((0.8, 0.8, 0.5), (0, 0, 0), wood, anchor='bottom')
for sx in (-1, 1):
    for sy in (-1, 1):
        p.box((0.08, 0.08, 0.5), (sx * 0.37, sy * 0.37, 0), wood_d, anchor='bottom')
for z in (0.04, 0.46):
    p.box((0.84, 0.84, 0.06), (0, 0, z), wood_d, anchor='center')
# 警告の札（ひし形）: 前後と左右
for rot, loc in (((R(90), 0, 0), (0, -0.405, 0.25)), ((R(90), 0, 0), (0, 0.405, 0.25)), ((R(90), 0, R(90)), (-0.405, 0, 0.25)), ((R(90), 0, R(90)), (0.405, 0, 0.25))):
    p.box((0.26, 0.26, 0.012), loc, yellow, rot=(rot[0], R(45), rot[2]))
    p.box((0.17, 0.17, 0.016), loc, red, rot=(rot[0], R(45), rot[2]))
# ダイナマイト 6 本と帯・導火線
for i, (x, y) in enumerate(((-0.2, -0.1), (0, -0.1), (0.2, -0.1), (-0.1, 0.1), (0.1, 0.1), (0.3, 0.1))):
    p.cyl(0.085, 0.085, 0.3, (x - 0.05, y, 0.5), red if i % 2 == 0 else red_d, segs=8, anchor='bottom')
p.box((0.66, 0.36, 0.05), (0.0, 0, 0.62), black, anchor='center')
p.tube([(0.05, 0.1, 0.8), (0.12, 0.05, 0.92), (0.22, 0.12, 0.98)], [0.02, 0.018, 0.015], fuse, segs=4, smooth=False)
model('p_tnt', [p], 0.9)

# ---- トロッコ: 上が少し広い鉄の箱、4 つの車輪、中に砕石
p = Part('minecart')
p.box((1.1, 1.7, 0.62), (0, 0, 0.3), rust, taper=(1.16, 1.1), anchor='bottom')
p.box((1.3, 1.9, 0.08), (0, 0, 0.9), iron, anchor='center')
for sy in (-1, 1):
    p.box((1.18, 0.07, 0.5), (0, sy * 0.86, 0.33), iron, anchor='bottom')
for sx in (-1, 1):
    for sy in (-1, 1):
        p.cyl(0.2, 0.2, 0.1, (sx * 0.5, sy * 0.55, 0.2), black, segs=10, rot=(0, R(90), 0), anchor='center')
        p.cyl(0.07, 0.07, 0.12, (sx * 0.5, sy * 0.55, 0.2), iron, segs=6, rot=(0, R(90), 0), anchor='center')
p.box((0.9, 0.1, 0.1), (0, 0.98, 0.42), iron, anchor='center')
for i, (x, y, r) in enumerate(((-0.25, -0.4, 0.3), (0.2, -0.3, 0.28), (0.0, 0.2, 0.34), (-0.3, 0.45, 0.26), (0.3, 0.5, 0.25))):
    p.sphere((r, r, r * 0.8), (x, y, 0.92), ore if i % 2 == 0 else ore_d, segs=6, rings=4, smooth=False)
model('p_minecart', [p], 1.4)

x = -1.2
for name, root, w in built:
    root.location = (x + w / 2, 0, 0)
    x += w + 0.4
lib.render_views('quarry', target=(0, 0, 0.6), dist=10, angles=(25,), res=(700, 420), ortho_scale=3.4, elev=0.2)
print('QUARRY_OK', len(built))
