"""雪山のスキー場の小道具: 雪だるま・雪玉・リフトの支柱・雪の積もった針葉樹。

実行: blender -b --factory-startup -P blender/build_ski.py
出力: public/models/p_snowman.glb, p_snowball.glb, p_pylon.glb, p_pine.glb, blender/preview/ski_*.png
雪玉は球として当たり判定を作る（半径 = 高さの半分）ので、ほぼ真球にする。
リフトの支柱は、横木（ケーブルを掛ける所）を X 方向に向ける。横木の中心は地面から 6.55m。
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


snow = mat('k_snow', (240, 246, 252))
snow_s = mat('k_snow_s', (214, 226, 240))
coal = mat('k_coal', (36, 36, 40))
carrot = mat('k_carrot', (240, 120, 30))
red = mat('k_red', (206, 40, 46))
red_d = mat('k_red_d', (150, 28, 34))
twig = mat('k_twig', (96, 66, 40))
steel = mat('k_steel', (120, 124, 132), rough=0.5, metal=0.6)
steel_d = mat('k_steel_d', (70, 72, 78), rough=0.6, metal=0.5)
yellow = mat('k_yellow', (240, 196, 40))
concrete = mat('k_concrete', (168, 164, 156))
bark = mat('k_bark', (92, 62, 40))
pine = mat('k_pine', (40, 92, 62))
pine_d = mat('k_pine_d', (28, 70, 48))

# ---- 雪だるま（高さ 1.9、幅 1.0 に収める）
p = Part('snowman')
p.sphere((0.5, 0.5, 0.45), (0, 0, 0.45), snow, segs=14, rings=9)
p.sphere((0.37, 0.37, 0.34), (0, 0, 1.1), snow, segs=12, rings=8)
p.sphere(0.27, (0, 0, 1.6), snow, segs=12, rings=8)
for z in (0.98, 1.16, 1.32):
    p.sphere(0.035, (0, -0.33 - (1.32 - z) * 0.08, z), coal, segs=6, rings=4)
for sx in (-1, 1):
    p.sphere(0.035, (sx * 0.09, -0.24, 1.66), coal, segs=6, rings=4)
p.cyl(0.05, 0.0, 0.26, (0, -0.25, 1.6), carrot, segs=6, rot=(R(90), 0, 0), anchor='bottom')
# バケツの帽子とマフラー
p.cyl(0.17, 0.21, 0.24, (0.02, 0, 1.78), red, segs=12, rot=(0, R(-12), 0))
p.cyl(0.3, 0.3, 0.1, (0, 0, 1.33), red_d, segs=14, anchor='bottom')
p.box((0.12, 0.05, 0.36), (0.18, -0.28, 1.2), red_d, rot=(R(10), 0, R(15)))
# 枝の腕（幅 1.0 を超えないように短く）
p.tube([(0.3, 0, 1.15), (0.44, 0.02, 1.3), (0.49, 0.0, 1.42)], [0.03, 0.025, 0.015], twig, segs=5, smooth=False)
p.tube([(-0.3, 0, 1.15), (-0.45, -0.02, 1.32), (-0.49, 0.03, 1.4)], [0.03, 0.025, 0.015], twig, segs=5, smooth=False)
model('p_snowman', [p], 1.1)

# ---- 雪玉（直径 1.6 のほぼ真球。表面に少しだけ雪の塊）
p = Part('snowball')
p.sphere(0.8, (0, 0, 0.8), snow, segs=16, rings=11)
for a, z, r_ in ((0.3, 1.3, 0.2), (2.1, 0.6, 0.22), (3.9, 1.0, 0.18), (5.1, 0.4, 0.16)):
    p.sphere(r_, (math.cos(a) * 0.68, math.sin(a) * 0.68, z), snow_s, segs=8, rings=6)
model('p_snowball', [p], 1.7)

# ---- リフトの支柱（横木は X 方向、幅 2.8）
p = Part('pylon')
p.box((0.9, 0.9, 0.4), (0, 0, 0.2), concrete, anchor='center')
p.cyl(0.24, 0.18, 6.4, (0, 0, 0.4), steel, segs=10)
p.box((2.8, 0.26, 0.26), (0, 0, 6.55), steel_d)
for sx in (-1, 1):
    p.cyl(0.22, 0.22, 0.12, (sx * 1.3, 0, 6.4), steel, segs=12, rot=(R(90), 0, 0), anchor='center')
    p.box((0.08, 0.08, 0.5), (sx * 1.3, 0, 6.3), steel_d)
# 番号札と、のぼるための足場
p.box((0.36, 0.04, 0.5), (0, -0.25, 3.2), yellow)
for k in range(8):
    p.box((0.3, 0.04, 0.04), (0.2, 0, 1.0 + k * 0.6), steel_d)
# てっぺんの雪
p.box((2.7, 0.3, 0.08), (0, 0, 6.72), snow)
model('p_pylon', [p], 3.0)

# ---- 雪の積もった針葉樹（高さ 5.5）
p = Part('pine')
p.cyl(0.2, 0.15, 1.2, (0, 0, 0), bark, segs=7)
layers = [(1.55, 0.8, 1.9), (1.25, 1.75, 1.7), (0.95, 2.65, 1.5), (0.62, 3.5, 1.3), (0.32, 4.3, 1.2)]
for i, (r_, z, h_) in enumerate(layers):
    p.cyl(r_, 0.05, h_, (0, 0, z), pine if i % 2 == 0 else pine_d, segs=9)
    # 枝の上に積もった雪（少し小さい円錐を、少し上へずらして重ねる）
    p.cyl(r_ * 0.78, 0.04, h_ * 0.55, (0, 0, z + h_ * 0.42), snow, segs=9)
model('p_pine', [p], 3.3)

x = -4.5
for name, root, w in built:
    root.location = (x + w / 2, 0, 0)
    x += w + 0.4
lib.render_views('ski', target=(0, 0, 2.6), dist=20, angles=(25,), res=(900, 520), ortho_scale=9.5, elev=0.14)
print('SKI_OK', len(built))
