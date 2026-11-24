"""新しいマップと新スキル用の小道具モデルを作る（build_assets.py の続き）。

実行: blender -b --factory-startup -P blender/build_props2.py
出力: public/models/p_*.glb, blender/preview/props2_*.png

どのモデルも原点は足元（底面の中心）。Blender の座標は Z が上、-Y が正面。
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
    return root


wood = mat('q_wood', (196, 150, 96))
wood_d = mat('q_wood_d', (130, 88, 50))
steel = mat('q_steel', (150, 158, 170))
steel_b = mat('q_steel_b', (120, 150, 190))
black = mat('q_black', (30, 30, 34))
white = mat('q_white', (246, 246, 244))
red = mat('q_red', (214, 44, 40))
yellow = mat('q_yellow', (250, 210, 50))
green = mat('q_green', (60, 150, 80))
blue = mat('q_blue', (58, 110, 210))
navy = mat('q_navy', (40, 52, 130))
orange = mat('q_orange', (250, 130, 40))
pink = mat('q_pink', (250, 150, 190))
glass = mat('q_glass', (190, 225, 240))
liquid = mat('q_liquid', (120, 230, 90))
gray = mat('q_gray', (110, 110, 118))
leather = mat('q_leather', (240, 236, 222))
cream = mat('q_cream', (250, 240, 214))

# ---------------------------------------------------------------- ボウリング球
p = Part('bowling')
faces = p.sphere(0.28, (0, 0, 0.28), navy, segs=14, rings=10)
for k, (a, b) in enumerate(((0, 0.08), (-0.06, -0.02), (0.06, -0.02))):
    p.cyl(0.026, 0.026, 0.02, (a, -0.268, 0.36 + b), black, segs=8, rot=(R(90), 0, 0))
p.box((0.3, 0.012, 0.03), (0.0, -0.272, 0.18), pink, rot=(0, R(20), 0))
model('p_bowling', [p], 0.7)

# ---------------------------------------------------------------- ロッカー
p = Part('locker')
p.box((0.9, 0.5, 1.8), (0, 0, 0.9), steel_b)
p.box((0.012, 0.51, 1.7), (0, 0, 0.9), gray)
for sx in (-1, 1):
    x = sx * 0.225
    for k in range(4):
        p.box((0.22, 0.01, 0.018), (x, -0.255, 1.55 + k * 0.04), black)
    p.box((0.03, 0.02, 0.12), (sx * 0.05, -0.26, 0.95), gray)
    p.box((0.16, 0.01, 0.1), (x, -0.255, 1.25), white)
model('p_locker', [p], 1.0)

# ---------------------------------------------------------------- グランドピアノ
p = Part('piano')
p.box((1.5, 1.6, 0.36), (0, 0.15, 0.82), black, taper=(1.0, 0.8))
p.box((1.5, 0.3, 0.1), (0, -0.78, 0.74), black)
p.box((1.36, 0.16, 0.03), (0, -0.78, 0.8), white)
for k in range(24):
    if k % 7 in (2, 6):
        continue
    p.box((0.022, 0.09, 0.03), (-0.62 + k * 0.054, -0.74, 0.825), black)
for x, y in ((-0.62, -0.6), (0.62, -0.6), (0.0, 0.8)):
    p.cyl(0.05, 0.04, 0.66, (x, y, 0.0), black, segs=8)
p.box((1.4, 1.5, 0.03), (0.05, 0.25, 1.32), black, rot=(R(-28), 0, 0))
p.box((0.03, 0.03, 0.55), (0.6, 0.05, 1.0), gray, rot=(R(-12), 0, 0))
p.box((0.6, 0.3, 0.5), (0, 0.3, 0.25), black)
model('p_piano', [p], 1.7)

# ---------------------------------------------------------------- 消火器
p = Part('extinguisher')
p.cyl(0.1, 0.1, 0.5, (0, 0, 0.0), red, segs=10)
p.sphere((0.1, 0.1, 0.06), (0, 0, 0.5), red, segs=10, rings=4)
p.cyl(0.03, 0.03, 0.08, (0, 0, 0.53), gray, segs=6)
p.box((0.16, 0.03, 0.02), (0.04, 0, 0.61), black)
p.tube([(0.03, 0, 0.58), (0.12, -0.02, 0.5), (0.12, -0.02, 0.2)], [0.012, 0.012, 0.016], black, segs=5, smooth=False)
p.box((0.12, 0.01, 0.1), (0, -0.1, 0.3), white)
model('p_extinguisher', [p], 0.4)

# ---------------------------------------------------------------- 実験用フラスコ
p = Part('flask')
p.cyl(0.13, 0.05, 0.22, (0, 0, 0.0), liquid, segs=10)
p.cyl(0.05, 0.04, 0.12, (0, 0, 0.22), glass, segs=8)
p.cyl(0.045, 0.045, 0.03, (0, 0, 0.34), wood_d, segs=8)
model('p_flask', [p], 0.4)

# ---------------------------------------------------------------- 本棚
p = Part('shelf')
p.box((1.0, 0.35, 0.04), (0, 0, 0.02), wood_d)
p.box((1.0, 0.35, 0.04), (0, 0, 1.98), wood_d)
for sx in (-1, 1):
    p.box((0.04, 0.35, 2.0), (sx * 0.48, 0, 1.0), wood_d)
p.box((1.0, 0.02, 2.0), (0, 0.165, 1.0), wood)
book_cols = [(200, 60, 60), (60, 110, 200), (230, 190, 60), (70, 160, 90), (150, 90, 170), (240, 240, 230)]
for r_ in range(4):
    z = 0.04 + r_ * 0.49
    p.box((0.96, 0.33, 0.025), (0, 0, z), wood_d)
    x = -0.44
    k = 0
    while x < 0.42:
        w_ = 0.05 + ((k * 37 + r_ * 11) % 5) * 0.012
        h_ = 0.28 + ((k * 13 + r_ * 7) % 4) * 0.03
        bm = mat(f'q_book{k % 6}', book_cols[(k + r_) % 6])
        p.box((w_ * 0.9, 0.26, h_), (x + w_ / 2, -0.02, z + 0.012 + h_ / 2), bm)
        x += w_
        k += 1
model('p_shelf', [p], 1.2)

# ---------------------------------------------------------------- 跳び箱
p = Part('tobibako')
for k in range(4):
    p.box((1.0 - k * 0.06, 0.62 - k * 0.03, 0.2), (0, 0, 0.1 + k * 0.2), wood, taper=(0.97, 0.97))
    p.box((1.0 - k * 0.06 + 0.005, 0.12, 0.05), (0, -0.25, 0.12 + k * 0.2), wood_d)
p.box((0.78, 0.5, 0.1), (0, 0, 0.85), leather)
model('p_tobibako', [p], 1.2)

# ---------------------------------------------------------------- スワンボート
p = Part('boat')
p.box((1.4, 2.4, 0.42), (0, 0, 0.21), white, taper=(0.86, 0.86))
p.box((1.2, 0.9, 0.06), (0, 0.4, 0.45), cream)
for sx in (-1, 1):
    p.sphere((0.15, 0.7, 0.3), (sx * 0.62, 0.3, 0.5), white, segs=8, rings=5)
p.box((1.0, 0.3, 0.3), (0, 0.85, 0.6), pink)
p.tube([(0, -0.9, 0.4), (0, -1.15, 0.9), (0, -1.05, 1.45), (0, -1.2, 1.7)], [0.16, 0.12, 0.1, 0.09], white, segs=8, smooth=True)
p.sphere((0.15, 0.2, 0.15), (0, -1.25, 1.75), white, segs=8, rings=6)
p.cyl(0.06, 0.0, 0.18, (0, -1.42, 1.72), orange, segs=6, rot=(R(90), 0, 0))
for sx in (-1, 1):
    p.sphere(0.025, (sx * 0.1, -1.36, 1.8), black, segs=6, rings=4)
model('p_boat', [p], 1.6)

# ---------------------------------------------------------------- ガチャガチャ
p = Part('gacha')
p.box((0.5, 0.45, 0.75), (0, 0, 0.375), red)
p.box((0.46, 0.02, 0.22), (0, -0.23, 0.45), white)
p.cyl(0.08, 0.08, 0.05, (0.0, -0.23, 0.3), steel, segs=10, rot=(R(90), 0, 0))
p.box((0.12, 0.03, 0.08), (0.12, -0.23, 0.12), black)
p.cyl(0.24, 0.22, 0.04, (0, 0, 0.75), steel, segs=12)
p.sphere((0.21, 0.19, 0.27), (0, 0.02, 1.0), glass, segs=12, rings=8)
cap_cols = [(250, 80, 80), (80, 160, 250), (250, 220, 70), (120, 220, 120), (240, 140, 220)]
# ドームの手前側の面に、カプセルが透けて見えるように並べる
for k in range(10):
    ang = R(-60 + (k % 5) * 30)
    zz = 0.86 + (k // 5) * 0.16
    rr = 0.2 if k < 5 else 0.17
    cm = mat(f'q_cap{k % 5}', cap_cols[k % 5])
    p.sphere(0.06, (math.sin(ang) * rr, -math.cos(ang) * rr, zz), cm, segs=8, rings=5)
p.cyl(0.05, 0.05, 0.06, (0, 0, 1.28), red, segs=8)
model('p_gacha', [p], 0.7)

# ---------------------------------------------------------------- ガチャのカプセル
p = Part('capsule')
p.sphere(0.075, (0, 0, 0.075), white, segs=10, rings=6)
faces = p.sphere((0.077, 0.077, 0.04), (0, 0, 0.105), pink, segs=10, rings=4)
model('p_capsule', [p], 0.3)

# ---------------------------------------------------------------- 立て看板（A 型）
p = Part('sign')
for sy in (-1, 1):
    p.box((0.6, 0.03, 0.95), (0, sy * 0.14, 0.45), white, rot=(R(sy * -10), 0, 0))
    p.box((0.6, 0.032, 0.22), (0, sy * 0.155, 0.78), pink if sy < 0 else blue, rot=(R(sy * -10), 0, 0))
    p.box((0.42, 0.032, 0.06), (0, sy * 0.13, 0.5), black, rot=(R(sy * -10), 0, 0))
    p.box((0.32, 0.032, 0.05), (0, sy * 0.12, 0.38), gray, rot=(R(sy * -10), 0, 0))
model('p_sign', [p], 0.8)

# ---------------------------------------------------------------- ゴミ箱
p = Part('trash')
p.cyl(0.25, 0.22, 0.7, (0, 0, 0.0), green, segs=12)
p.cyl(0.27, 0.27, 0.06, (0, 0, 0.68), gray, segs=12)
p.box((0.2, 0.02, 0.1), (0, -0.25, 0.5), white)
model('p_trash', [p], 0.6)

# ---------------------------------------------------------------- 街灯（公園）
p = Part('lamp')
p.cyl(0.12, 0.12, 0.2, (0, 0, 0.0), black, segs=8)
p.cyl(0.05, 0.04, 3.2, (0, 0, 0.2), black, segs=8)
p.cyl(0.04, 0.2, 0.25, (0, 0, 3.35), black, segs=8)
p.sphere((0.17, 0.17, 0.2), (0, 0, 3.35), mat('q_light', (255, 245, 200), emit=(255, 240, 190)), segs=8, rings=5)
model('p_lamp', [p], 0.5)

# ---------------------------------------------------------------- シーソーの板
p = Part('seesaw')
p.box((4.0, 0.36, 0.1), (0, 0, 0.05), yellow)
for sx in (-1, 1):
    p.box((0.06, 0.06, 0.4), (sx * 1.7, 0, 0.25), blue)
    p.box((0.06, 0.36, 0.06), (sx * 1.7, 0, 0.43), blue)
    p.box((0.4, 0.36, 0.04), (sx * 1.85, 0, 0.12), red)
model('p_seesaw', [p], 4.2)

# ---------------------------------------------------------------- 理科室の実験台
p = Part('labtable')
p.box((1.8, 0.9, 0.06), (0, 0, 0.87), black)
p.box((1.7, 0.8, 0.8), (0, 0, 0.42), wood)
p.box((0.3, 0.3, 0.05), (0.6, 0.0, 0.92), steel)
p.cyl(0.02, 0.02, 0.3, (0.6, 0.12, 0.9), steel, segs=6)
for sx in (-1, 1):
    p.box((0.7, 0.01, 0.3), (sx * 0.42, -0.405, 0.5), wood_d)
model('p_labtable', [p], 2.0)

# ---------------------------------------------------------------- 体操マット
p = Part('mat')
p.box((2.0, 1.0, 0.14), (0, 0, 0.07), blue)
for k in range(1, 4):
    p.box((0.02, 1.01, 0.142), (-1.0 + k * 0.5, 0, 0.07), navy)
model('p_mat', [p], 2.2)


# ---------------------------------------------------------------- 黒板（壁に掛ける。叩くと落ちる）
p = Part('blackboard')
board = mat('q_board', (40, 84, 58))
p.box((2.4, 0.1, 1.3), (0, 0, 0.65), wood_d)
p.box((2.25, 0.11, 1.15), (0, -0.005, 0.65), board)
p.box((2.3, 0.14, 0.04), (0, -0.07, 0.06), wood_d)
for k, c_ in enumerate(((250, 250, 250), (250, 200, 210), (250, 230, 120))):
    p.box((0.08, 0.02, 0.02), (-0.6 + k * 0.15, -0.12, 0.09), mat(f'q_chalk{k}', c_))
p.box((0.6, 0.012, 0.03), (-0.4, -0.06, 1.0), white)
p.box((0.4, 0.012, 0.03), (-0.5, -0.06, 0.88), white)
p.box((0.5, 0.012, 0.03), (0.4, -0.06, 0.6), white, rot=(0, R(-20), 0))
model('p_blackboard', [p], 2.5)


# ====================================================================== 確認用の画像
def sheet(prefix, names, target_z, ortho, angles):
    for name, root, _w in built:
        root.hide_render = True
        for c in root.children:
            c.hide_render = True
    picked = [b for b in built if b[0] in names]
    total = sum(b[2] for b in picked) + 0.2 * (len(picked) - 1)
    x = -total / 2
    for name, root, w in picked:
        root.location = (x + w / 2, 0, 0)
        x += w + 0.2
        root.hide_render = False
        for c in root.children:
            c.hide_render = False
    aspect = max(1.0, total / (ortho * 0.9))
    lib.render_views(prefix, target=(0, 0, target_z), dist=14, angles=angles, res=(int(560 * aspect), 560), ortho_scale=ortho * aspect, elev=0.14)
    for name, root, _w in picked:
        root.location = (0, 0, 0)


sheet('props2_small', ['p_bowling', 'p_extinguisher', 'p_flask', 'p_capsule', 'p_trash', 'p_gacha', 'p_sign', 'p_lamp'], 0.9, 2.4, (25,))
sheet('props2_big', ['p_locker', 'p_piano', 'p_shelf', 'p_tobibako', 'p_boat', 'p_labtable'], 1.0, 2.6, (25,))
sheet('props2_flat', ['p_seesaw', 'p_mat', 'p_blackboard'], 0.5, 1.6, (25,))
print('PROPS2_OK', len(built))
