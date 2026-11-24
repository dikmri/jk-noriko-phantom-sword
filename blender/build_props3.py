"""第 3 弾の小道具（屋上・工事現場・夏祭り・ドミノ）のモデルを作る。

実行: blender -b --factory-startup -P blender/build_props3.py
出力: public/models/p_*.glb, blender/preview/props3_*.png

原点は足元（底面の中心）。Blender の座標は Z が上、-Y が正面。
土管（p_dokan）は X 方向に寝かせた形で作る（ゲーム側で横向きの円柱として扱う）。
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


ivory = mat('r_ivory', (244, 240, 228))
black = mat('r_black', (28, 28, 32))
steel = mat('r_steel', (150, 156, 166))
steel_d = mat('r_steel_d', (96, 100, 108))
rust = mat('r_rust', (150, 84, 50))
white = mat('r_white', (240, 240, 236))
gray = mat('r_gray', (120, 120, 126))
concrete = mat('r_concrete', (176, 172, 164))
yellow = mat('r_yellow', (246, 200, 40))
red = mat('r_red', (206, 44, 40))
vermilion = mat('r_vermilion', (220, 80, 50))
wood = mat('r_wood', (176, 130, 80))
wood_d = mat('r_wood_d', (110, 74, 44))
skin = mat('r_skin', (236, 220, 190))
stone = mat('r_stone', (150, 148, 140))
blue = mat('r_blue', (60, 110, 210))
pink = mat('r_pink', (246, 140, 180))
paper = mat('r_paper', (255, 236, 200), emit=(255, 200, 120))

# ---------------------------------------------------------------- ドミノ
p = Part('domino')
p.box((0.8, 0.22, 1.6), (0, 0, 0.8), ivory)
p.box((0.7, 0.23, 0.03), (0, 0, 0.8), black)
for (x, z) in ((0, 1.2), (-0.2, 0.4), (0.2, 0.4), (-0.2, 1.4), (0.2, 1.0)):
    for sy in (-1, 1):
        p.cyl(0.07, 0.07, 0.02, (x, sy * 0.115, z), black, segs=8, rot=(R(90), 0, 0), anchor='center')
model('p_domino', [p], 1.0)

# ---------------------------------------------------------------- 給水塔のタンク
p = Part('watertank')
p.cyl(1.6, 1.6, 2.4, (0, 0, 0.0), mat('r_tank', (200, 214, 226)), segs=16)
p.cyl(1.62, 1.62, 0.1, (0, 0, 0.6), steel_d, segs=16)
p.cyl(1.62, 1.62, 0.1, (0, 0, 1.6), steel_d, segs=16)
p.cyl(1.6, 0.2, 0.5, (0, 0, 2.4), mat('r_tank', (200, 214, 226)), segs=16)
p.box((0.6, 0.02, 0.4), (0, -1.6, 1.2), blue)
model('p_watertank', [p], 3.4)

# ---------------------------------------------------------------- 室外機
p = Part('acunit')
p.box((0.9, 0.36, 0.7), (0, 0, 0.35), mat('r_ac', (226, 226, 220)))
p.cyl(0.26, 0.26, 0.02, (0.12, -0.18, 0.35), gray, segs=14, rot=(R(90), 0, 0), anchor='center')
for k in range(5):
    p.box((0.5, 0.025, 0.012), (0.12, -0.195, 0.2 + k * 0.075), black)
p.box((0.12, 0.02, 0.5), (-0.33, -0.185, 0.35), gray)
model('p_acunit', [p], 1.0)

# ---------------------------------------------------------------- 鉄球（解体用）
p = Part('wreckball')
p.sphere(1.2, (0, 0, 1.2), mat('r_ball', (60, 60, 66), rough=0.5, metal=0.7), segs=16, rings=10)
p.cyl(0.25, 0.25, 0.4, (0, 0, 2.3), steel_d, segs=8)
p.cyl(0.3, 0.3, 0.12, (0, 0, 2.5), steel_d, segs=8, rot=(R(90), 0, 0), anchor='center')
model('p_wreckball', [p], 2.6)

# ---------------------------------------------------------------- 鉄骨（H 形鋼）
p = Part('beam')
L = 6.0
p.box((L, 0.5, 0.06), (0, 0, 0.03), rust)
p.box((L, 0.5, 0.06), (0, 0, 0.57), rust)
p.box((L, 0.05, 0.5), (0, 0, 0.3), rust)
for k in range(4):
    p.box((0.06, 0.52, 0.02), (-2.2 + k * 1.5, 0, 0.61), yellow)
model('p_beam', [p], 6.2)

# ---------------------------------------------------------------- 土管（X 方向に寝かせる）
p = Part('dokan')
p.cyl(0.8, 0.8, 2.2, (-1.1, 0, 0.8), concrete, segs=16, rot=(0, R(90), 0), anchor='bottom')
p.cyl(0.62, 0.62, 2.24, (-1.12, 0, 0.8), mat('r_inner', (90, 88, 84)), segs=16, rot=(0, R(90), 0), anchor='bottom')
model('p_dokan', [p], 2.4)

# ---------------------------------------------------------------- 屋台
p = Part('yatai')
p.box((2.4, 1.2, 0.95), (0, 0.2, 0.475), wood)
p.box((2.42, 0.06, 0.25), (0, -0.42, 0.85), white)
p.box((2.42, 0.07, 0.12), (0, -0.43, 0.85), red)
for sx in (-1, 1):
    for sy in (-1, 1):
        p.box((0.08, 0.08, 1.4), (sx * 1.15, sy * 0.7 + 0.1, 1.65), wood_d)
p.box((2.6, 1.8, 0.08), (0, 0.1, 2.4), red, rot=(R(-10), 0, 0))
for k in range(5):
    p.box((0.26, 1.82, 0.085), (-1.04 + k * 0.52, 0.1, 2.41), white, rot=(R(-10), 0, 0))
p.box((1.6, 0.04, 0.42), (0, -0.66, 2.05), white)
p.box((1.4, 0.05, 0.08), (0, -0.67, 2.05), red)
p.box((0.5, 0.4, 0.2), (-0.6, 0.0, 1.05), steel)
p.box((0.3, 0.3, 0.25), (0.5, 0.0, 1.07), pink)
model('p_yatai', [p], 2.8)

# ---------------------------------------------------------------- 大太鼓（台つき）
p = Part('taiko')
p.box((1.8, 1.0, 0.25), (0, 0, 0.125), wood_d)
for sx in (-1, 1):
    p.box((0.15, 0.5, 0.9), (sx * 0.9, 0, 0.6), wood_d)
p.cyl(0.85, 0.85, 1.3, (-0.65, 0, 1.3), vermilion, segs=16, rot=(0, R(90), 0), anchor='bottom')
for sx in (-1, 1):
    p.cyl(0.82, 0.82, 0.02, (sx * 0.66, 0, 1.3), skin, segs=16, rot=(0, R(90), 0), anchor='center')
    p.cyl(0.88, 0.88, 0.06, (sx * 0.6, 0, 1.3), black, segs=16, rot=(0, R(90), 0), anchor='center')
p.box((0.5, 0.02, 0.5), (0, -0.85, 1.3), mat('r_tomoe', (250, 220, 90)))
model('p_taiko', [p], 2.0)

# ---------------------------------------------------------------- 石灯籠
p = Part('toro')
p.box((0.8, 0.8, 0.2), (0, 0, 0.1), stone)
p.cyl(0.18, 0.2, 0.9, (0, 0, 0.2), stone, segs=8)
p.box((0.7, 0.7, 0.12), (0, 0, 1.16), stone)
p.box((0.48, 0.48, 0.4), (0, 0, 1.42), paper)
for sx in (-1, 1):
    p.box((0.06, 0.5, 0.42), (sx * 0.24, 0, 1.42), stone)
p.box((0.9, 0.9, 0.12), (0, 0, 1.7), stone, taper=(0.5, 0.5))
p.cyl(0.08, 0.02, 0.2, (0, 0, 1.76), stone, segs=6)
model('p_toro', [p], 1.0)


def sheet(prefix, names, target_z, ortho, angles):
    for name, root, _w in built:
        root.hide_render = True
        for c in root.children:
            c.hide_render = True
    picked = [b for b in built if b[0] in names]
    total = sum(b[2] for b in picked) + 0.25 * (len(picked) - 1)
    x = -total / 2
    for name, root, w in picked:
        root.location = (x + w / 2, 0, 0)
        x += w + 0.25
        root.hide_render = False
        for c in root.children:
            c.hide_render = False
    aspect = max(1.0, total / (ortho * 0.9))
    lib.render_views(prefix, target=(0, 0, target_z), dist=18, angles=angles, res=(int(560 * aspect), 560), ortho_scale=ortho * aspect, elev=0.14)
    for name, root, _w in picked:
        root.location = (0, 0, 0)


sheet('props3_a', ['p_domino', 'p_acunit', 'p_watertank', 'p_wreckball', 'p_toro'], 1.3, 3.6, (25,))
sheet('props3_b', ['p_beam', 'p_dokan', 'p_yatai', 'p_taiko'], 1.2, 3.4, (25,))
print('PROPS3_OK', len(built))
