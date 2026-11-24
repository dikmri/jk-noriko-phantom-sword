"""温泉街の小道具: 酒樽（菰樽を横に倒した形）と湯桶。

実行: blender -b --factory-startup -P blender/build_onsen.py
出力: public/models/p_taru.glb, p_oke.glb, blender/preview/onsen_*.png
酒樽（p_taru）は X 方向に寝かせた形で作る（ゲームでは X 軸の円柱として転がる）。
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


straw = mat('o_straw', (204, 178, 124))
straw_d = mat('o_straw_d', (170, 142, 92))
rope = mat('o_rope', (96, 66, 40))
lid = mat('o_lid', (214, 182, 128))
red = mat('o_red', (200, 40, 36))
white = mat('o_white', (246, 240, 226))
black = mat('o_black', (30, 26, 24))
wood = mat('o_wood', (200, 160, 104))
wood_d = mat('o_wood_d', (150, 112, 68))
hoop = mat('o_hoop', (70, 60, 52))

# ---- 酒樽（菰樽）: 直径 0.96、長さ 1.1。中心の高さは半径と同じ（寝かせて置く）
RAD = 0.48
L = 1.1
p = Part('taru')
p.cyl(RAD, RAD, L, (-L / 2, 0, RAD), straw, segs=14, rot=(0, R(90), 0), anchor='bottom')
# 縄の帯
for x in (-0.44, -0.16, 0.16, 0.44):
    p.cyl(RAD + 0.015, RAD + 0.015, 0.05, (x, 0, RAD), rope, segs=14, rot=(0, R(90), 0), anchor='center')
# 両端のふた
for sx in (-1, 1):
    p.cyl(RAD - 0.05, RAD - 0.05, 0.02, (sx * (L / 2 + 0.005), 0, RAD), lid, segs=14, rot=(0, R(90), 0), anchor='center')
    p.cyl(RAD + 0.01, RAD + 0.01, 0.04, (sx * (L / 2 - 0.02), 0, RAD), straw_d, segs=14, rot=(0, R(90), 0), anchor='center')
# 正面と背面の札（赤地に白い丸と黒い字の帯）
# 札は胴からほとんど出さない（当たり判定の円柱の半径が、横の広がりで決まるため）
for sy in (-1, 1):
    p.box((0.5, 0.03, 0.46), (0, sy * (RAD - 0.005), RAD), red)
    p.cyl(0.13, 0.13, 0.01, (0, sy * (RAD + 0.006), RAD + 0.06), white, segs=12, rot=(R(90), 0, 0), anchor='center')
    p.box((0.06, 0.012, 0.16), (0, sy * (RAD + 0.008), RAD + 0.06), black)
    p.box((0.4, 0.01, 0.06), (0, sy * (RAD + 0.006), RAD - 0.15), white)
model('p_taru', [p], 1.2)

# ---- 湯桶: 直径 0.54、高さ 0.3
p = Part('oke')
p.cyl(0.24, 0.27, 0.3, (0, 0, 0), wood, segs=14)
p.cyl(0.235, 0.235, 0.02, (0, 0, 0.26), wood_d, segs=14)
for z in (0.06, 0.22):
    p.cyl(0.255 + z * 0.1, 0.258 + z * 0.1, 0.03, (0, 0, z), hoop, segs=14)
model('p_oke', [p], 0.6)

x = -1.0
for name, root, w in built:
    root.location = (x + w / 2, 0, 0)
    x += w + 0.4
lib.render_views('onsen', target=(0, 0, 0.4), dist=10, angles=(20, 110), res=(700, 380), ortho_scale=2.8, elev=0.2)
print('ONSEN_OK', len(built))
