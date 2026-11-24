"""ノリコ（案B: 茶髪ポニテ・ベージュのブレザー・赤チェックのスカート）のローポリモデルを作る。

実行: blender -b --factory-startup -P blender/build_noriko.py
出力: public/models/noriko.glb, blender/preview/noriko_*.png

関節ごとに別メッシュに分け、原点を関節位置に置く。ゲーム側はノードを名前で探して回転させる。
  noriko > hips > torso > head > ponytail
                        > armR_upper > armR_lower > handR > socket_weapon
                        > armL_upper > armL_lower > handL
                > legR_upper > legR_lower > footR
                > legL_upper > legL_lower > footL
右手側は Blender の -X。
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Part, empty, mat  # noqa: E402
from mathutils import Vector  # noqa: E402

HEAD_RX, HEAD_RY, HEAD_RZ = 0.180, 0.168, 0.182
NECK_Z = 0.965
HEAD_CZ = NECK_Z + HEAD_RZ - 0.014
TORSO_Z0, TORSO_Z1 = 0.66, 0.925
TORSO_R0, TORSO_R1 = 0.100, 0.108
SHOULDER_Z = 0.912
SHOULDER_X = 0.130
ELBOW_Z = 0.745
WRIST_Z = 0.585
HAND_Z = 0.553
WAIST_Z = 0.70
HIP_Z = 0.60
HIP_X = 0.062
KNEE_Z = 0.34
ANKLE_Z = 0.08

lib.reset_scene()

SKIN = mat('skin', (255, 226, 200))
FACE = mat('face', (255, 226, 200), image='face_neutral.png')
HAIR = mat('hair', (140, 74, 40))
HAIR_D = mat('hair_dark', (112, 56, 30))
BLAZER = mat('blazer', (240, 226, 178))
BLAZER_F = mat('blazer_front', (240, 226, 178), image='blazer_front.png')
SHIRT = mat('shirt', (250, 250, 252))
PLAID = mat('plaid', (178, 34, 46), image='plaid.png')
NAVY = mat('navy', (40, 44, 88))
SHOE = mat('shoe', (118, 68, 40))
SOLE = mat('sole', (52, 32, 22))
YELLOW = mat('scrunchie', (250, 205, 40))


def on_head(theta_deg, zu, off=0.0):
    """頭の楕円体表面の点。theta は正面(-Y)を 0 として +X 側へ回る角度。zu は -1..1 の高さ。"""
    th = math.radians(theta_deg)
    r = math.sqrt(max(0.0, 1.0 - zu * zu))
    return Vector(((HEAD_RX + off) * r * math.sin(th), -(HEAD_RY + off) * r * math.cos(th), HEAD_CZ + (HEAD_RZ + off) * zu))


def chin(co):
    """単位球の下半分をすぼめて、あごを作る。"""
    if co.z < 0:
        t = -co.z
        co.x *= 1.0 - 0.20 * t ** 1.6
        co.y *= 1.0 - 0.10 * t ** 1.6
    return co


root = empty('noriko', (0, 0, 0))

# ---- 腰・スカート ---------------------------------------------------------
p = Part('hips')
p.cyl(0.080, 0.090, 0.12, (0, 0, 0.58), NAVY, segs=8, scale=(1.0, 0.78))
skirt = p.cyl(0.205, 0.104, 0.225, (0, 0, 0.485), PLAID, segs=12, scale=(1.0, 0.86))


def skirt_uv(co):
    ang = math.atan2(co.y, co.x) / (2 * math.pi)
    return (ang * 4.0, (co.z - 0.485) / 0.225)


for f in skirt:
    if abs(f.normal.z) > 0.9 or f.calc_center_median().z < 0.48:
        pass
p.uv_map(skirt, skirt_uv)
p.bm.normal_update()
for f in skirt:
    if f.normal.z < -0.9 or f.normal.z > 0.9:
        p.set_material([f], NAVY)
hips = p.finish((0, 0, 0.64), root)

# ---- 胴体（ブレザー）-------------------------------------------------------
p = Part('torso')
body = p.cyl(TORSO_R0, TORSO_R1, TORSO_Z1 - TORSO_Z0, (0, 0, TORSO_Z0), BLAZER, segs=12, scale=(1.0, 0.66))
p.bm.normal_update()
front = [f for f in body if f.normal.y < -0.5 and abs(f.normal.z) < 0.5]
p.set_material(front, BLAZER_F)
p.uv_map(front, lambda co: (0.5 + co.x / (2.18 * TORSO_R1), (co.z - TORSO_Z0) / (TORSO_Z1 - TORSO_Z0)))
# 肩のなだらかな傾斜と首
p.cyl(TORSO_R1, 0.048, 0.045, (0, 0, TORSO_Z1), BLAZER, segs=12, scale=(1.0, 0.66))
p.cyl(0.034, 0.034, 0.07, (0, 0.004, 0.945), SKIN, segs=8)
# シャツの襟
p.cyl(0.050, 0.044, 0.022, (0, 0.002, 0.958), SHIRT, segs=8, scale=(1.0, 0.8))
torso = p.finish((0, 0, WAIST_Z), hips)

# ---- 頭 --------------------------------------------------------------------
p = Part('head')
head = p.sphere((HEAD_RX, HEAD_RY, HEAD_RZ), (0, 0, HEAD_CZ), SKIN, segs=16, rings=10, deform=chin)
p.bm.normal_update()
face = [f for f in head if f.normal.y < -0.22]
p.set_material(face, FACE)
p.uv_map(face, lambda co: (0.5 + co.x / (2 * HEAD_RX), 0.5 + (co.z - HEAD_CZ) / (2 * HEAD_RZ)))

# 髪（頭を覆う殻。顔の部分と、うなじの下は開ける）
cap_c = Vector((0, 0.012, HEAD_CZ + 0.012))
cap_r = Vector((HEAD_RX + 0.016, HEAD_RY + 0.022, HEAD_RZ + 0.018))
cap = p.sphere(tuple(cap_r), tuple(cap_c), HAIR, segs=16, rings=10)
drop = []
for f in cap:
    c = f.calc_center_median() - cap_c
    u = Vector((c.x / cap_r.x, c.y / cap_r.y, c.z / cap_r.z))
    front_open = u.y < -0.34 and u.z < 0.50
    nape_open = u.z < -0.66
    if front_open or nape_open:
        drop.append(f)
p.delete_faces(drop)

# 前髪: 生え際の帯 + その下に垂れる束
BAND_TOP, BAND_BOTTOM = 0.70, 0.42
STEPS = 12
for i in range(STEPS):
    t0 = -78 + 156 * i / STEPS
    t1 = -78 + 156 * (i + 1) / STEPS
    p.poly([on_head(t0, BAND_TOP, 0.020), on_head(t1, BAND_TOP, 0.020), on_head(t1, BAND_BOTTOM, 0.030), on_head(t0, BAND_BOTTOM, 0.030)], HAIR, smooth=True)
BANGS = [
    # (上辺の中心角, 上辺の半幅角, 先端の角, 先端の高さ)
    (-66, 12, -74, -0.20),
    (-44, 11, -50, 0.10),
    (-23, 11, -27, 0.17),
    (-2, 11, -6, 0.02),
    (19, 11, 22, 0.16),
    (41, 11, 46, 0.12),
    (65, 13, 74, -0.20),
]
for th, hw, tip_th, zb in BANGS:
    a = on_head(th - hw, BAND_BOTTOM + 0.02, 0.030)
    b = on_head(th + hw, BAND_BOTTOM + 0.02, 0.030)
    tip = on_head(tip_th, zb, 0.022)
    n = Vector((a.x + b.x, a.y + b.y, 0)).normalized()
    p.wedge(a, b, tip, -n, 0.020, HAIR)

# もみあげ（顔の横に垂れる束）
for sx in (-1, 1):
    a = on_head(sx * 70, 0.44, 0.024)
    b = on_head(sx * 96, 0.44, 0.024)
    tip = on_head(sx * 80, -0.98, 0.040)
    n = Vector((a.x + b.x, a.y + b.y, 0)).normalized()
    p.wedge(a, b, tip, -n, 0.034, HAIR_D)

# アホ毛
p.tube([on_head(-20, 0.985, 0.012), on_head(-28, 0.99, 0.055), on_head(-55, 0.93, 0.085)], [0.009, 0.007, 0.0], HAIR, segs=4, smooth=False)
head_ob = p.finish((0, 0, NECK_Z), torso)

# ---- ポニーテール ----------------------------------------------------------
base = on_head(180, 0.50, 0.01)
p = Part('ponytail')
d0 = Vector((0, 0.75, 0.66)).normalized()
p.tube([base - d0 * 0.01, base + d0 * 0.045], [0.050, 0.050], YELLOW, segs=8, smooth=False)
tail_pts = [
    base + d0 * 0.03,
    base + Vector((0, 0.085, 0.075)),
    base + Vector((0, 0.165, 0.070)),
    base + Vector((0, 0.225, -0.010)),
    base + Vector((0, 0.250, -0.130)),
    base + Vector((0, 0.235, -0.250)),
    base + Vector((0, 0.275, -0.330)),
]
p.tube(tail_pts, [0.036, 0.070, 0.082, 0.078, 0.064, 0.040, 0.0], HAIR, segs=7, smooth=True, scale=(1.15, 0.85))
ponytail = p.finish(tuple(base), head_ob)

# ---- 腕 --------------------------------------------------------------------
for name, sx in (('R', -1), ('L', 1)):
    x = sx * SHOULDER_X
    p = Part(f'arm{name}_upper')
    p.cyl(0.035, 0.040, SHOULDER_Z - ELBOW_Z, (x, 0, ELBOW_Z), BLAZER, segs=8)
    p.sphere(0.042, (x, 0, SHOULDER_Z), BLAZER, segs=8, rings=5, smooth=False)
    upper = p.finish((x, 0, SHOULDER_Z), torso)

    p = Part(f'arm{name}_lower')
    p.sphere(0.036, (x, 0, ELBOW_Z), BLAZER, segs=8, rings=5, smooth=False)
    p.cyl(0.041, 0.035, ELBOW_Z - (WRIST_Z + 0.012), (x, 0, WRIST_Z + 0.012), BLAZER, segs=8)
    p.cyl(0.036, 0.037, 0.022, (x, 0, WRIST_Z - 0.008), SHIRT, segs=8)
    lower = p.finish((x, 0, ELBOW_Z), upper)

    p = Part(f'hand{name}')
    p.sphere((0.038, 0.034, 0.042), (x, 0, HAND_Z), SKIN, segs=8, rings=6)
    hand = p.finish((x, 0, WRIST_Z), lower)
    if name == 'R':
        empty('socket_weapon', (x, 0, HAND_Z), hand)

# ---- 脚 --------------------------------------------------------------------
for name, sx in (('R', -1), ('L', 1)):
    x = sx * HIP_X
    p = Part(f'leg{name}_upper')
    p.cyl(0.043, 0.056, HIP_Z - KNEE_Z, (x, 0, KNEE_Z), SKIN, segs=8)
    upper = p.finish((x, 0, HIP_Z), hips)

    p = Part(f'leg{name}_lower')
    p.sphere(0.043, (x, 0, KNEE_Z), SKIN, segs=8, rings=5, smooth=False)
    p.cyl(0.037, 0.046, 0.235, (x, 0, ANKLE_Z - 0.01), NAVY, segs=8)
    lower = p.finish((x, 0, KNEE_Z), upper)

    p = Part(f'foot{name}')
    p.box((0.092, 0.175, 0.060), (x, -0.030, 0.045), SHOE, taper=(0.86, 0.80))
    p.box((0.096, 0.180, 0.016), (x, -0.030, 0.008), SOLE)
    p.box((0.060, 0.030, 0.012), (x, -0.062, 0.078), SOLE)
    foot = p.finish((x, 0, ANKLE_Z), lower)

lib.export_glb('noriko.glb')
lib.render_views('noriko', target=(0, 0.02, 0.69), angles=(0, 40, 90, 180), ortho_scale=1.56)
lib.render_views('noriko_flat', target=(0, 0.0, 1.10), angles=(0, 25), ortho_scale=0.66, light='FLAT')
print('NORIKO_OK')
