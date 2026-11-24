"""追加のボス（戦車・攻撃ヘリ）のモデルを作る。

実行: blender -b --factory-startup -P blender/build_bosses.py
出力: public/models/e_tank.glb, e_heli.glb, blender/preview/bosses_*.png

原点は足元（底面の中心）。正面は -Y（ゲームの中では +Z）。
ヘリの回転翼はゲーム側で別に描いて回すので、ここでは軸だけ作る。
色はゲーム側で掛け算するので、明るめにしてある。
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


olive = mat('b_olive', (120, 128, 84))
olive_d = mat('b_olive_d', (82, 88, 58))
black = mat('b_black', (30, 30, 34))
steel = mat('b_steel', (130, 134, 140))
red = mat('b_red', (214, 44, 40))
white = mat('b_white', (240, 240, 236))
glass = mat('b_glass', (120, 170, 210))
sand = mat('b_sand', (200, 182, 140))
yellow = mat('b_yellow', (240, 200, 60))

# ---------------------------------------------------------------- 戦車
p = Part('tank')
# 車体と履帯
p.box((2.6, 4.6, 0.9), (0, 0, 0.85), olive, taper=(0.92, 0.9))
for sx in (-1, 1):
    p.box((0.62, 4.9, 0.8), (sx * 1.35, 0, 0.42), black)
    for k in range(6):
        p.cyl(0.3, 0.3, 0.64, (sx * 1.35 - 0.32, -1.9 + k * 0.76, 0.36), steel, segs=10, rot=(0, R(90), 0))
    p.box((0.7, 4.95, 0.08), (sx * 1.35, 0, 0.84), olive_d)
# 砲塔と砲身
p.cyl(1.0, 0.85, 0.6, (0, 0.3, 1.3), olive, segs=10)
p.box((1.4, 1.6, 0.5), (0, 0.2, 1.55), olive_d, taper=(0.85, 0.85))
p.cyl(0.13, 0.11, 2.8, (0, -0.6, 1.62), olive_d, segs=8, rot=(R(90), 0, 0))
p.cyl(0.17, 0.17, 0.35, (0, -3.35, 1.62), black, segs=8, rot=(R(90), 0, 0))
p.cyl(0.22, 0.2, 0.25, (0.45, 0.6, 1.9), black, segs=8)
# 目出し帽の印（テロリストの戦車）
p.box((0.8, 0.02, 0.5), (0, -0.62, 1.55), white)
p.box((0.6, 0.03, 0.08), (0, -0.635, 1.55), red, rot=(0, R(35), 0))
p.box((0.6, 0.03, 0.08), (0, -0.635, 1.55), red, rot=(0, R(-35), 0))
model('e_tank', [p], 3.6)

# ---------------------------------------------------------------- 攻撃ヘリ
p = Part('heli')
p.sphere((0.9, 1.7, 0.85), (0, 0.0, 1.35), sand, segs=12, rings=8)
p.sphere((0.75, 0.9, 0.6), (0, -0.85, 1.55), glass, segs=10, rings=6)
p.tube([(0, 1.3, 1.45), (0, 2.6, 1.7), (0, 3.6, 2.0)], [0.32, 0.22, 0.14], sand, segs=8, smooth=True)
p.box((0.08, 0.7, 0.9), (0, 3.6, 2.3), sand)
p.cyl(0.42, 0.42, 0.06, (0.08, 3.6, 2.1), steel, segs=10, rot=(0, R(90), 0))
for sx in (-1, 1):
    p.box((0.08, 2.4, 0.08), (sx * 0.75, 0, 0.12), black)
    for y in (-0.6, 0.6):
        p.box((0.06, 0.06, 0.5), (sx * 0.7, y, 0.38), black, rot=(0, R(sx * -15), 0))
    # 武器の羽と、ロケットの筒
    p.box((0.9, 0.5, 0.08), (sx * 1.1, 0.1, 1.2), olive_d)
    p.cyl(0.14, 0.14, 0.8, (sx * 1.5, -0.3, 1.08), steel, segs=8, rot=(R(90), 0, 0))
    p.cyl(0.07, 0.07, 0.05, (sx * 1.5, -0.72, 1.08), red, segs=6, rot=(R(90), 0, 0))
p.cyl(0.12, 0.12, 0.45, (0, 0, 2.15), black, segs=8)
p.box((0.5, 0.02, 0.32), (0, -1.68, 1.25), yellow)
model('e_heli', [p], 3.4)


def sheet(prefix, names, target_z, ortho, angles):
    picked = [b for b in built if b[0] in names]
    total = sum(b[2] for b in picked) + 0.3 * (len(picked) - 1)
    x = -total / 2
    for name, root, w in picked:
        root.location = (x + w / 2, 0, 0)
        x += w + 0.3
    aspect = max(1.0, total / (ortho * 0.9))
    lib.render_views(prefix, target=(0, 0, target_z), dist=18, angles=angles, res=(int(560 * aspect), 560), ortho_scale=ortho * aspect, elev=0.14)


sheet('bosses', ['e_tank', 'e_heli'], 1.4, 4.4, (30,))
print('BOSSES_OK', len(built))
