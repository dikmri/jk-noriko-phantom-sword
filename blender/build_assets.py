"""敵・武器・小道具のローポリモデルを作る。

実行: blender -b --factory-startup -P blender/build_assets.py
出力: public/models/{e_*, w_*, p_*}.glb, blender/preview/assets_*.png

どのモデルも原点は足元（底面の中心）。武器は握りが原点で、+Z（glTF では +Y）へ伸びる。
敵は色違いを掛け算で作るので、クマの毛は明るい色にしてある（ゲーム側で茶色などを掛ける）。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import lib  # noqa: E402
from lib import Part, empty, mat  # noqa: E402
from mathutils import Vector  # noqa: E402

lib.reset_scene()
R = math.radians
built = []  # (名前, ルート, 幅)


def model(name, parts, width):
    """parts: Part のリスト。ルートの空オブジェクトにぶら下げて書き出す。"""
    root = empty(name, (0, 0, 0))
    objs = [root]
    for p in parts:
        objs.append(p.finish((0, 0, 0), root))
    lib.export_glb(name + '.glb', objs)
    built.append((name, root, width))
    return root


# ====================================================================== 敵
def build_pervert():
    skin = mat('pv_skin', (236, 196, 160))
    coat = mat('pv_coat', (206, 178, 128))
    coat_d = mat('pv_coat_d', (160, 134, 92))
    black = mat('pv_black', (30, 28, 30))
    white = mat('pv_white', (250, 250, 250))
    red = mat('pv_red', (220, 30, 40))
    hat = mat('pv_hat', (96, 70, 48))
    hair = mat('pv_hair', (60, 44, 34))
    p = Part('pervert')
    for sx in (-1, 1):
        x = sx * 0.11
        p.cyl(0.055, 0.07, 0.62, (x, 0, 0.12), skin, segs=6)
        p.cyl(0.058, 0.06, 0.2, (x, 0, 0.08), black, segs=6)
        p.box((0.11, 0.24, 0.09), (x, -0.04, 0.045), black)
        # すね毛
        for k in range(3):
            p.box((0.004, 0.004, 0.05), (x + sx * 0.058, -0.02 + k * 0.02, 0.42 + k * 0.07), hair)
    # コート（すそが広がる）
    p.cyl(0.33, 0.25, 0.86, (0, 0.02, 0.56), coat, segs=8, scale=(1.0, 0.72))
    p.cyl(0.25, 0.14, 0.06, (0, 0.02, 1.42), coat, segs=8, scale=(1.0, 0.72))
    # 前を開いた左右の合わせ
    for sx in (-1, 1):
        p.box((0.05, 0.3, 0.8), (sx * 0.3, -0.22, 0.98), coat_d, rot=(0, 0, sx * R(28)))
        # 腕（コートを開いて持つ）
        p.tube([(sx * 0.25, 0.0, 1.38), (sx * 0.4, -0.1, 1.18), (sx * 0.36, -0.3, 1.1)], [0.075, 0.07, 0.06], coat, segs=6, smooth=False)
        p.sphere(0.06, (sx * 0.36, -0.33, 1.1), skin, segs=6, rings=4, smooth=False)
    # 見せられないよ！ の札
    p.box((0.46, 0.03, 0.5), (0, -0.25, 0.98), white)
    p.box((0.5, 0.034, 0.07), (0, -0.262, 0.98), red, rot=(0, R(42), 0))
    p.box((0.5, 0.034, 0.07), (0, -0.262, 0.98), red, rot=(0, R(-42), 0))
    # 頭
    p.cyl(0.07, 0.07, 0.08, (0, 0, 1.44), skin, segs=6)
    p.sphere((0.165, 0.165, 0.175), (0, 0, 1.64), skin, segs=10, rings=7)
    p.box((0.3, 0.05, 0.075), (0, -0.14, 1.67), black)  # サングラス
    p.box((0.2, 0.06, 0.1), (0, -0.135, 1.56), white)  # マスク
    p.cyl(0.27, 0.27, 0.02, (0, 0, 1.74), hat, segs=10)
    p.cyl(0.17, 0.15, 0.14, (0, 0, 1.76), hat, segs=10)
    p.cyl(0.172, 0.172, 0.03, (0, 0, 1.775), black, segs=10)
    model('e_pervert', [p], 1.0)


def build_terrorist():
    cloth = mat('tr_cloth', (104, 118, 78))
    vest = mat('tr_vest', (64, 72, 52))
    pants = mat('tr_pants', (120, 108, 80))
    black = mat('tr_black', (34, 34, 38))
    skin = mat('tr_skin', (232, 190, 150))
    white = mat('tr_white', (245, 245, 245))
    gun = mat('tr_gun', (70, 70, 78))
    red = mat('tr_red', (210, 40, 40))
    p = Part('terrorist')
    for sx in (-1, 1):
        x = sx * 0.11
        p.box((0.15, 0.17, 0.62), (x, 0, 0.47), pants, taper=(1.15, 1.1))
        p.box((0.16, 0.27, 0.16), (x, -0.03, 0.08), black)
    p.box((0.44, 0.26, 0.56), (0, 0, 1.06), cloth, taper=(1.12, 1.0))
    p.box((0.46, 0.29, 0.36), (0, -0.01, 1.08), vest)
    for k in range(3):
        p.box((0.1, 0.05, 0.12), (-0.14 + k * 0.14, -0.17, 1.0), black)
    p.box((0.47, 0.3, 0.06), (0, -0.01, 0.8), black)  # ベルト
    # 腕と銃
    p.tube([(-0.26, 0, 1.3), (-0.34, -0.12, 1.08), (-0.14, -0.3, 1.02)], [0.075, 0.07, 0.06], cloth, segs=6, smooth=False)
    p.tube([(0.26, 0, 1.3), (0.33, -0.16, 1.14), (0.12, -0.36, 1.14)], [0.075, 0.07, 0.06], cloth, segs=6, smooth=False)
    p.box((0.085, 0.062, 0.06), (-0.26, 0.0, 1.22), red)  # 腕章
    p.box((0.07, 0.86, 0.09), (0.0, -0.36, 1.1), gun, rot=(0, 0, R(-24)))
    p.box((0.05, 0.1, 0.2), (-0.05, -0.3, 0.98), gun, rot=(0, 0, R(-24)))
    p.box((0.08, 0.2, 0.13), (-0.2, -0.02, 1.12), black, rot=(0, 0, R(-24)))
    for sx, pos in ((-1, (-0.13, -0.31, 1.02)), (1, (0.11, -0.38, 1.14))):
        p.sphere(0.058, pos, black, segs=6, rings=4, smooth=False)
    # 頭（目出し帽）
    p.cyl(0.075, 0.075, 0.07, (0, 0, 1.33), black, segs=6)
    p.sphere((0.17, 0.17, 0.18), (0, 0, 1.55), black, segs=10, rings=7)
    p.box((0.24, 0.05, 0.065), (0, -0.145, 1.58), skin)
    for sx in (-1, 1):
        p.box((0.06, 0.02, 0.04), (sx * 0.06, -0.172, 1.58), white)
        p.box((0.025, 0.02, 0.03), (sx * 0.06, -0.182, 1.578), black)
        p.box((0.09, 0.02, 0.018), (sx * 0.065, -0.176, 1.612), black, rot=(0, sx * R(-18), 0))
    model('e_terrorist', [p], 1.0)


def build_bear():
    fur = mat('br_fur', (238, 226, 206))
    belly = mat('br_belly', (255, 250, 238))
    black = mat('br_black', (26, 22, 22))
    white = mat('br_white', (255, 255, 255))
    mouth = mat('br_mouth', (190, 60, 70))
    p = Part('bear')
    for sx in (-1, 1):
        p.cyl(0.19, 0.21, 0.5, (sx * 0.24, 0.02, 0.0), fur, segs=8)
        p.box((0.34, 0.42, 0.14), (sx * 0.24, -0.06, 0.07), fur)
        for k in range(3):
            p.cyl(0.03, 0.0, 0.09, (sx * 0.24 + (k - 1) * 0.09, -0.28, 0.05), white, segs=5, rot=(R(90), 0, 0))
    p.sphere((0.5, 0.43, 0.6), (0, 0.02, 0.95), fur, segs=12, rings=8)
    p.sphere((0.34, 0.2, 0.42), (0, -0.25, 0.9), belly, segs=10, rings=7)
    # 腕（がおー、と振り上げる）
    for sx in (-1, 1):
        p.tube([(sx * 0.4, 0, 1.25), (sx * 0.66, -0.1, 1.5), (sx * 0.7, -0.22, 1.82)], [0.17, 0.15, 0.13], fur, segs=7, smooth=True)
        p.sphere((0.16, 0.14, 0.14), (sx * 0.7, -0.25, 1.88), fur, segs=8, rings=5)
        for k in range(3):
            p.cyl(0.03, 0.0, 0.12, (sx * 0.7 + (k - 1) * 0.085, -0.33, 1.94), white, segs=5, rot=(R(-35), 0, 0))
    # 頭
    p.sphere((0.35, 0.33, 0.31), (0, -0.02, 1.62), fur, segs=12, rings=8)
    for sx in (-1, 1):
        p.sphere((0.12, 0.07, 0.12), (sx * 0.26, 0.02, 1.9), fur, segs=8, rings=5)
        p.sphere((0.065, 0.04, 0.065), (sx * 0.26, -0.03, 1.9), belly, segs=6, rings=4)
        p.sphere((0.04, 0.03, 0.045), (sx * 0.13, -0.315, 1.69), black, segs=6, rings=4)
        p.box((0.15, 0.03, 0.035), (sx * 0.135, -0.325, 1.765), black, rot=(0, sx * R(-24), 0))
    p.sphere((0.17, 0.13, 0.13), (0, -0.3, 1.55), belly, segs=8, rings=6)
    p.sphere((0.06, 0.04, 0.045), (0, -0.425, 1.6), black, segs=6, rings=4)
    p.box((0.16, 0.05, 0.07), (0, -0.39, 1.49), mouth)
    for sx in (-1, 1):
        p.cyl(0.022, 0.0, 0.055, (sx * 0.055, -0.415, 1.52), white, segs=4, rot=(R(180), 0, 0))
    model('e_bear', [p], 1.6)


# ====================================================================== 武器
def build_weapons():
    wood = mat('w_wood', (132, 86, 48))
    wood_d = mat('w_wood_d', (96, 60, 32))
    bamboo = mat('w_bamboo', (226, 204, 138))
    white = mat('w_white', (245, 245, 240))
    black = mat('w_black', (36, 36, 40))
    steel = mat('w_steel', (176, 184, 196), rough=0.4, metal=0.8)
    iron = mat('w_iron', (110, 114, 122), rough=0.5, metal=0.8)
    gray = mat('w_gray', (200, 204, 210))
    yellow = mat('w_yellow', (246, 220, 110))
    red = mat('w_red', (214, 51, 42))
    gold = mat('w_gold', (240, 190, 60), rough=0.3, metal=0.9)
    blade = mat('w_blade', (214, 232, 255), rough=0.2, metal=0.9)
    blue = mat('w_blue', (60, 110, 220))

    p = Part('stick')
    p.tube([(0, 0, -0.12), (0.006, 0, 0.2), (-0.012, 0.004, 0.52), (0.014, -0.004, 0.8), (0.0, 0.0, 1.0)], [0.03, 0.03, 0.027, 0.024, 0.02], wood, segs=6, smooth=False)
    p.tube([(-0.008, 0, 0.5), (-0.07, 0.01, 0.62)], [0.014, 0.008], wood_d, segs=5, smooth=False)
    p.tube([(0.01, 0, 0.74), (0.06, -0.01, 0.82)], [0.012, 0.006], wood_d, segs=5, smooth=False)
    model('w_stick', [p], 0.5)

    p = Part('shinai')
    p.cyl(0.02, 0.02, 0.26, (0, 0, -0.2), white, segs=8)
    p.cyl(0.055, 0.055, 0.018, (0, 0, 0.06), black, segs=10)
    p.cyl(0.02, 0.017, 1.1, (0, 0, 0.078), bamboo, segs=8)
    p.cyl(0.021, 0.021, 0.02, (0, 0, 0.7), white, segs=8)
    p.cyl(0.019, 0.012, 0.03, (0, 0, 1.17), white, segs=8)
    model('w_shinai', [p], 0.5)

    p = Part('mop')
    p.cyl(0.016, 0.016, 1.55, (0, 0, -0.2), bamboo, segs=6)
    p.box((0.34, 0.07, 0.05), (0, 0, 1.33), blue)
    for k in range(7):
        p.box((0.04, 0.09, 0.24), (-0.15 + k * 0.05, 0, 1.44), gray, rot=(R((k % 3 - 1) * 8), 0, 0))
    model('w_mop', [p], 0.6)

    p = Part('bat')
    p.cyl(0.03, 0.03, 0.02, (0, 0, -0.15), steel, segs=8)
    p.tube([(0, 0, -0.13), (0, 0, 0.2), (0, 0, 0.5), (0, 0, 0.85), (0, 0, 0.92)], [0.016, 0.017, 0.03, 0.036, 0.028], steel, segs=8, smooth=True)
    p.cyl(0.018, 0.018, 0.22, (0, 0, -0.12), black, segs=8)
    model('w_bat', [p], 0.5)

    p = Part('harisen')
    p.cyl(0.03, 0.03, 0.2, (0, 0, -0.14), white, segs=6)
    n = 9
    for k in range(n):
        a0 = R(-34 + 68 * k / n)
        a1 = R(-34 + 68 * (k + 1) / n)
        y = 0.018 if k % 2 == 0 else -0.018
        pts = [(math.sin(a0) * 0.06, -y, 0.06), (math.sin(a1) * 0.06, y, 0.06), (math.sin(a1) * 0.86, y, math.cos(a1) * 0.86), (math.sin(a0) * 0.86, -y, math.cos(a0) * 0.86)]
        p.poly(pts, white if k % 2 == 0 else gray)
        p.poly(list(reversed(pts)), white if k % 2 == 0 else gray)
    p.box((0.1, 0.05, 0.05), (0, 0, 0.07), red)
    model('w_harisen', [p], 1.0)

    p = Part('ruler')
    p.box((0.045, 0.006, 0.6), (0, 0, 0.2), yellow)
    for k in range(11):
        p.box((0.02 if k % 5 else 0.034, 0.008, 0.004), (0.008, 0, -0.06 + k * 0.055), black)
    model('w_ruler', [p], 0.4)

    p = Part('pipe')
    p.cyl(0.03, 0.03, 1.5, (0, 0, -0.15), iron, segs=8)
    p.cyl(0.036, 0.036, 0.06, (0, 0, 1.3), iron, segs=8)
    p.cyl(0.03, 0.03, 0.22, (0, 0, 1.33), iron, segs=8, rot=(0, R(90), 0))
    p.cyl(0.036, 0.036, 0.05, (0.2, 0, 1.33), iron, segs=8, rot=(0, R(90), 0))
    model('w_pipe', [p], 0.6)

    p = Part('excalibur')
    p.cyl(0.02, 0.02, 0.2, (0, 0, -0.15), blue, segs=6)
    p.sphere(0.035, (0, 0, -0.17), gold, segs=6, rings=4, smooth=False)
    p.box((0.32, 0.05, 0.05), (0, 0, 0.07), gold)
    p.sphere(0.03, (0, 0, 0.07), red, segs=6, rings=4, smooth=False)
    p.box((0.09, 0.022, 1.2), (0, 0, 0.1), blade, anchor='bottom', taper=(0.7, 0.6))
    p.box((0.063, 0.014, 0.16), (0, 0, 1.3), blade, anchor='bottom', taper=(0.05, 0.3))
    p.box((0.016, 0.03, 1.1), (0, 0, 0.15), gold, anchor='bottom')
    model('w_excalibur', [p], 0.6)


# ====================================================================== 小道具
def build_props():
    wood = mat('p_wood', (214, 178, 122))
    wood_d = mat('p_wood_d', (150, 104, 60))
    steel = mat('p_steel', (150, 156, 166))
    card = mat('p_card', (196, 152, 100))
    tape = mat('p_tape', (224, 198, 150))
    red = mat('p_red', (206, 44, 44))
    yellow = mat('p_yellow', (246, 206, 50))
    black = mat('p_black', (34, 34, 38))
    white = mat('p_white', (245, 245, 245))
    blue = mat('p_blue', (58, 123, 213))
    orange = mat('p_orange', (255, 122, 26))
    glass = mat('p_glass', (120, 170, 210))
    bronze = mat('p_bronze', (96, 122, 100))
    stone = mat('p_stone', (170, 168, 160))
    green = mat('p_green', (70, 150, 80))
    pink = mat('p_pink', (255, 178, 204))
    pink_d = mat('p_pink_d', (245, 140, 178))
    bark = mat('p_bark', (104, 74, 52))

    p = Part('desk')
    p.box((0.66, 0.46, 0.035), (0, 0, 0.7), wood)
    p.box((0.6, 0.4, 0.1), (0, 0, 0.62), steel)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.03, 0.03, 0.68), (sx * 0.3, sy * 0.2, 0.34), steel)
        p.box((0.03, 0.4, 0.03), (sx * 0.3, 0, 0.12), steel)
    model('p_desk', [p], 0.9)

    p = Part('chair')
    p.box((0.4, 0.4, 0.03), (0, 0, 0.42), wood)
    p.box((0.4, 0.03, 0.22), (0, 0.185, 0.72), wood)
    for sx in (-1, 1):
        p.box((0.028, 0.028, 0.42), (sx * 0.18, -0.18, 0.21), steel)
        p.box((0.028, 0.028, 0.84), (sx * 0.18, 0.185, 0.42), steel)
    model('p_chair', [p], 0.7)

    p = Part('box')
    p.box((0.6, 0.5, 0.5), (0, 0, 0.25), card)
    p.box((0.1, 0.505, 0.505), (0, 0, 0.25), tape)
    p.box((0.2, 0.01, 0.12), (0.12, -0.25, 0.3), white)
    model('p_box', [p], 0.9)

    p = Part('barrel')
    p.cyl(0.29, 0.29, 0.88, (0, 0, 0.0), red, segs=12)
    for z in (0.02, 0.3, 0.58, 0.84):
        p.cyl(0.305, 0.305, 0.04, (0, 0, z), black if z in (0.02, 0.84) else red, segs=12)
    p.cyl(0.293, 0.293, 0.16, (0, 0, 0.38), yellow, segs=12)
    for k in range(6):
        p.box((0.06, 0.01, 0.16), (math.cos(k * 1.047) * 0.295, math.sin(k * 1.047) * 0.295, 0.46), black, rot=(0, 0, k * 1.047 + R(90)))
    p.cyl(0.05, 0.05, 0.03, (0.14, 0, 0.88), black, segs=6)
    model('p_barrel', [p], 0.9)

    p = Part('bike')
    for y in (-0.56, 0.56):
        p.cyl(0.33, 0.33, 0.035, (-0.0175, y, 0.33), black, segs=14, rot=(0, R(90), 0))
        p.cyl(0.27, 0.27, 0.04, (-0.02, y, 0.33), steel, segs=14, rot=(0, R(90), 0))
    p.tube([(0, 0.56, 0.33), (0, 0.2, 0.62), (0, -0.4, 0.78), (0, -0.56, 0.33)], [0.022, 0.022, 0.022, 0.022], blue, segs=5, smooth=False)
    p.tube([(0, 0.2, 0.62), (0, 0.22, 0.9)], [0.02, 0.02], blue, segs=5, smooth=False)
    p.tube([(0, 0.2, 0.62), (0, -0.1, 0.36), (0, 0.56, 0.33)], [0.02, 0.02, 0.02], blue, segs=5, smooth=False)
    p.box((0.16, 0.26, 0.05), (0, 0.24, 0.92), black)
    p.tube([(0, -0.4, 0.78), (0, -0.44, 1.0)], [0.02, 0.02], steel, segs=5, smooth=False)
    p.tube([(-0.25, -0.4, 1.0), (0.25, -0.4, 1.0)], [0.018, 0.018], steel, segs=5, smooth=False)
    p.box((0.34, 0.26, 0.2), (0, -0.66, 0.84), steel)
    p.box((0.3, 0.22, 0.18), (0, -0.66, 0.86), black)
    model('p_bike', [p], 0.8)

    p = Part('vending')
    p.box((1.0, 0.72, 1.85), (0, 0, 0.925), red)
    p.box((0.86, 0.02, 0.86), (0, -0.365, 1.3), white)
    cols = [(60, 140, 220), (250, 200, 40), (60, 170, 90), (230, 90, 40), (150, 80, 190)]
    for r_ in range(3):
        for c in range(5):
            cm = mat(f'p_can{c}', cols[(c + r_) % 5])
            p.box((0.1, 0.03, 0.19), (-0.32 + c * 0.16, -0.375, 1.02 + r_ * 0.27), cm)
    p.box((0.86, 0.03, 0.2), (0, -0.365, 0.62), black)
    p.box((0.5, 0.03, 0.14), (0, -0.365, 0.25), black)
    p.box((0.12, 0.03, 0.2), (0.34, -0.37, 0.62), yellow)
    model('p_vending', [p], 1.3)

    p = Part('cone')
    p.box((0.38, 0.38, 0.03), (0, 0, 0.015), orange)
    p.cyl(0.15, 0.03, 0.62, (0, 0, 0.03), orange, segs=8)
    p.cyl(0.108, 0.082, 0.12, (0, 0, 0.2), white, segs=8)
    model('p_cone', [p], 0.6)

    p = Part('car')
    p.box((1.6, 3.4, 0.62), (0, 0, 0.62), white)
    p.box((1.5, 2.0, 0.56), (0, 0.25, 1.2), white, taper=(0.9, 0.82))
    p.box((1.4, 0.04, 0.38), (0, -0.67, 1.2), glass, rot=(R(-18), 0, 0))
    p.box((1.4, 0.04, 0.36), (0, 1.17, 1.2), glass, rot=(R(18), 0, 0))
    for sx in (-1, 1):
        p.box((0.04, 1.6, 0.34), (sx * 0.71, 0.25, 1.22), glass)
        for y in (-1.1, 1.1):
            p.cyl(0.3, 0.3, 0.2, (sx * 0.72 - 0.1, y, 0.3), black, segs=10, rot=(0, R(90), 0))
            p.cyl(0.16, 0.16, 0.21, (sx * 0.72 - 0.105, y, 0.3), steel, segs=8, rot=(0, R(90), 0))
        p.box((0.3, 0.04, 0.14), (sx * 0.55, -1.7, 0.7), yellow)
        p.box((0.3, 0.04, 0.12), (sx * 0.55, 1.7, 0.7), red)
    p.box((1.64, 0.1, 0.16), (0, -1.7, 0.42), black)
    p.box((1.64, 0.1, 0.16), (0, 1.7, 0.42), black)
    p.box((0.34, 0.02, 0.14), (0, -1.71, 0.56), white)
    model('p_car', [p], 2.2)

    p = Part('statue')
    p.box((0.86, 0.86, 0.7), (0, 0, 0.35), stone, taper=(0.86, 0.86))
    p.box((0.5, 0.03, 0.2), (0, -0.4, 0.38), black)
    for sx, yy in ((-1, -0.08), (1, 0.1)):
        p.cyl(0.07, 0.085, 0.5, (sx * 0.1, yy, 0.7), bronze, segs=6)
        p.box((0.13, 0.24, 0.07), (sx * 0.1, yy - 0.04, 0.735), bronze)
    p.cyl(0.19, 0.17, 0.52, (0, 0.02, 1.18), bronze, segs=8, scale=(1.0, 0.75))
    p.sphere((0.14, 0.14, 0.15), (0, -0.03, 1.86), bronze, segs=8, rings=6)
    p.cyl(0.05, 0.03, 0.08, (0, 0.02, 1.98), bronze, segs=5)
    for sx in (-1, 1):
        p.tube([(sx * 0.19, 0, 1.64), (sx * 0.22, -0.16, 1.5), (sx * 0.1, -0.3, 1.56)], [0.055, 0.05, 0.045], bronze, segs=5, smooth=False)
    p.box((0.26, 0.04, 0.18), (0, -0.33, 1.6), bronze, rot=(R(-30), 0, 0))
    # 背中の薪
    for k in range(5):
        p.cyl(0.045, 0.045, 0.62, (-0.3, 0.22 + (k % 2) * 0.07, 1.3 + k * 0.075), bronze, segs=5, rot=(0, R(90), 0))
    model('p_statue', [p], 1.3)

    p = Part('goal')
    w_, h_, d_ = 2.5, 2.2, 1.5
    for sx in (-1, 1):
        p.tube([(sx * w_, 0, 0), (sx * w_, 0, h_), (sx * w_, d_, 0.02)], [0.06, 0.06, 0.05], white, segs=6, smooth=False)
        p.tube([(sx * w_, 0, 0.02), (sx * w_, d_, 0.02)], [0.04, 0.04], white, segs=5, smooth=False)
    p.tube([(-w_, 0, h_), (w_, 0, h_)], [0.06, 0.06], white, segs=6, smooth=False)
    p.tube([(-w_, d_, 0.02), (w_, d_, 0.02)], [0.04, 0.04], white, segs=5, smooth=False)
    for k in range(1, 8):
        x = -w_ + k * (2 * w_ / 8)
        p.tube([(x, 0, h_), (x, d_, 0.02)], [0.012, 0.012], steel, segs=4, smooth=False)
    model('p_goal', [p], 5.6)

    p = Part('tree')
    p.tube([(0, 0, 0), (0.04, 0, 1.2), (-0.03, 0.03, 2.3), (0.05, 0, 3.2)], [0.26, 0.2, 0.16, 0.1], bark, segs=7, smooth=False)
    p.tube([(-0.02, 0.02, 1.9), (-0.7, 0.1, 2.8)], [0.09, 0.05], bark, segs=5, smooth=False)
    p.tube([(0.02, 0.0, 2.1), (0.75, -0.2, 2.9)], [0.08, 0.05], bark, segs=5, smooth=False)
    blobs = [((0, 0, 3.9), 1.25, pink), ((-0.95, 0.2, 3.2), 0.85, pink_d), ((1.0, -0.3, 3.3), 0.8, pink), ((0.2, 0.8, 3.4), 0.8, pink_d), ((0.1, -0.85, 3.6), 0.75, pink), ((0, 0, 4.8), 0.75, pink_d)]
    for c, r_, m_ in blobs:
        p.sphere((r_, r_, r_ * 0.8), c, m_, segs=7, rings=5, smooth=False)
    model('p_tree', [p], 3.2)

    p = Part('bench')
    for k in range(3):
        p.box((1.6, 0.13, 0.04), (0, -0.16 + k * 0.16, 0.44), wood_d)
    for k in range(2):
        p.box((1.6, 0.04, 0.13), (0, 0.24, 0.62 + k * 0.17), wood_d)
    for sx in (-1, 1):
        p.box((0.06, 0.5, 0.42), (sx * 0.66, 0, 0.21), steel)
        p.box((0.06, 0.06, 0.44), (sx * 0.66, 0.24, 0.64), steel)
    model('p_bench', [p], 1.9)

    p = Part('ball')
    faces = p.sphere(0.17, (0, 0, 0.17), white, segs=10, rings=6)
    dark = [f for i, f in enumerate(sorted(faces, key=lambda f: (round(f.calc_center_median().z, 3), math.atan2(f.calc_center_median().y, f.calc_center_median().x)))) if i % 5 == 0]
    p.set_material(dark, black)
    model('p_ball', [p], 0.5)
    _ = green


build_pervert()
build_terrorist()
build_bear()
build_weapons()
build_props()


# ====================================================================== 確認用の画像
def sheet(prefix, names, target_z, ortho, angles):
    for name, root, _w in built:
        root.hide_render = True
        for c in root.children:
            c.hide_render = True
    x = 0.0
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


sheet('assets_enemies', ['e_pervert', 'e_terrorist', 'e_bear'], 1.0, 2.3, (0, 35, 180))
sheet('assets_weapons', [b[0] for b in built if b[0].startswith('w_')], 0.55, 1.9, (0,))
sheet('assets_props', ['p_desk', 'p_chair', 'p_box', 'p_barrel', 'p_bike', 'p_vending', 'p_cone', 'p_bench', 'p_ball', 'p_statue'], 1.0, 2.5, (25,))
sheet('assets_big', ['p_car', 'p_goal', 'p_tree'], 2.6, 5.8, (25,))
print('ASSETS_OK', len(built))
