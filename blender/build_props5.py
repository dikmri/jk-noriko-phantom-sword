"""新しいスキルの小道具: 転がる地球儀。

実行: blender -b --factory-startup -P blender/build_props5.py
出力: public/models/p_globe.glb, blender/preview/props5_*.png
転がる球なので、陸地や子午線の輪は球からほとんどはみ出さないように作る（当たり判定は球）。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Part, empty, mat  # noqa: E402

lib.reset_scene()
built = []


def model(name, parts, width):
    root = empty(name, (0, 0, 0))
    objs = [root]
    for p in parts:
        objs.append(p.finish((0, 0, 0), root))
    lib.export_glb(name + '.glb', objs)
    built.append((name, root, width))


sea = mat('g_sea', (58, 123, 213))
land = mat('g_land', (96, 170, 84))
sand = mat('g_sand', (222, 196, 120))
ice = mat('g_ice', (240, 246, 252))
brass = mat('g_brass', (200, 160, 70), rough=0.4, metal=0.6)

R0 = 0.9
C = (0, 0, R0)
p = Part('globe')
p.sphere((R0, R0, R0), C, sea, segs=16, rings=10)
# 陸地: 球の表面に、少しだけ盛り上がった塊を置く
lands = [
    ((0.55, 0.35, 0.55), 0.6, land),
    ((-0.5, 0.5, 0.25), 0.55, land),
    ((0.1, -0.7, 0.2), 0.5, sand),
    ((-0.3, -0.35, -0.6), 0.5, land),
    ((0.6, -0.2, -0.45), 0.42, land),
    ((-0.75, 0.0, -0.2), 0.4, sand),
]
for d, r, m in lands:
    n = math.sqrt(sum(v * v for v in d))
    u = tuple(v / n for v in d)
    k = R0 - r + 0.035
    p.sphere((r, r, r), (C[0] + u[0] * k, C[1] + u[1] * k, C[2] + u[2] * k), m, segs=8, rings=5)
# 北極と南極の氷
p.sphere((0.3, 0.3, 0.12), (0, 0, C[2] + R0 - 0.08), ice, segs=10, rings=4)
p.sphere((0.3, 0.3, 0.12), (0, 0, C[2] - R0 + 0.08), ice, segs=10, rings=4)
# 子午線の輪（細い真ちゅう）
ring = [(math.sin(a) * (R0 + 0.02), 0, C[2] + math.cos(a) * (R0 + 0.02)) for a in [i * math.pi * 2 / 40 for i in range(41)]]
p.tube(ring, [0.035] * len(ring), brass, segs=5)
model('p_globe', [p], 2.0)

x = 0
for name, root, w in built:
    root.location = (x, 0, 0)
lib.render_views('props5', target=(0, 0, 0.9), dist=8, angles=(25,), res=(420, 420), ortho_scale=2.4, elev=0.14)
print('PROPS5_OK', len(built))
