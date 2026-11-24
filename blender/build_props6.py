"""理科室の人体模型（スキルで跳ねて動かす小道具）。

実行: blender -b --factory-startup -P blender/build_props6.py
出力: public/models/p_jintai.glb, blender/preview/props6_*.png
高さ約 1.6m。体の右半分は肌、左半分は赤い筋肉。胸とおなかの前に臓器を見せる。台座なしで足で立つ。
座標は Blender 既定（Z 上、正面は -Y、模型の右手側は -X）。原点は足元の中心。関節は無い。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import Part, empty, mat  # noqa: E402

lib.reset_scene()

skin = mat('j_skin', (238, 200, 170))
muscle = mat('j_muscle', (198, 64, 58))
fiber = mat('j_fiber', (150, 38, 40))
tendon = mat('j_tendon', (236, 222, 200))
cavity = mat('j_cavity', (92, 22, 28))
lung = mat('j_lung', (228, 144, 156))
heart = mat('j_heart', (176, 26, 38))
liver = mat('j_liver', (124, 46, 38))
stomach = mat('j_stomach', (234, 176, 150))
gut = mat('j_gut', (242, 166, 146))
gut_d = mat('j_gut_d', (206, 118, 108))
eye_w = mat('j_eye_w', (246, 244, 236))
iris = mat('j_iris', (64, 96, 150))
dark = mat('j_dark', (50, 34, 30))


def side(x):
    """模型の右（-X）は肌、左（+X）は筋肉。"""
    return skin if x < 0 else muscle


def split(part, faces):
    """首や頭のように真ん中にまたがる形は、面の中心で左右の色を分ける。"""
    left = [f for f in faces if f.calc_center_median().x > 0.001]
    part.set_material(left, muscle)


body = Part('jintai_body')
# 足
for s in (-1, 1):
    body.box((0.085, 0.2, 0.06), (s * 0.09, -0.04, 0), side(s), anchor='bottom')
# 脚（足首 -> ひざ -> 腰）
for s in (-1, 1):
    body.tube([(s * 0.09, 0.0, 0.06), (s * 0.095, -0.012, 0.46), (s * 0.092, 0.0, 0.86)], [0.042, 0.056, 0.082], side(s), segs=8)
# 骨盤と胴（左右の半分を別の箱にして、真ん中で色が分かれるようにする）
for s in (-1, 1):
    body.box((0.15, 0.2, 0.16), (s * 0.075, 0, 0.84), side(s), anchor='bottom')
    body.box((0.17, 0.22, 0.38), (s * 0.085, 0, 0.98), side(s), anchor='bottom')
# 肩と腕（肩 -> ひじ -> 手首）、手
for s in (-1, 1):
    body.sphere(0.058, (s * 0.2, 0, 1.32), side(s), segs=8, rings=6)
    body.tube([(s * 0.2, 0.0, 1.32), (s * 0.24, 0.012, 1.07), (s * 0.262, -0.02, 0.84)], [0.05, 0.042, 0.032], side(s), segs=8)
    body.sphere((0.026, 0.02, 0.05), (s * 0.265, -0.022, 0.785), side(s), segs=8, rings=5)
# 首と頭
split(body, body.cyl(0.05, 0.048, 0.08, (0, 0, 1.355), skin, segs=8))
split(body, body.sphere((0.09, 0.102, 0.105), (0, -0.005, 1.495), skin, segs=12, rings=8))
# 肌の側: 目・耳・眉
body.sphere(0.011, (-0.036, -0.1, 1.51), dark, segs=6, rings=4)
body.sphere((0.012, 0.022, 0.03), (-0.09, 0.0, 1.5), skin, segs=6, rings=4)
body.box((0.03, 0.008, 0.006), (-0.036, -0.1, 1.535), dark)
# 筋肉の側: むき出しの目玉と、筋の線（腕・脚・胸）
body.sphere(0.02, (0.036, -0.088, 1.51), eye_w, segs=8, rings=5)
body.sphere(0.009, (0.036, -0.106, 1.51), iris, segs=6, rings=4)
for dx, dy in ((0.0, -0.05), (0.03, 0.03), (-0.03, 0.03)):
    body.tube([(0.2 + dx * 0.5, dy, 1.30), (0.24 + dx * 0.5, dy + 0.012, 1.07), (0.262 + dx * 0.4, dy * 0.8 - 0.02, 0.86)], [0.012, 0.01, 0.007], fiber, segs=5)
for dx, dy in ((0.0, -0.075), (0.045, -0.02), (-0.045, -0.02)):
    body.tube([(0.092 + dx * 0.8, dy, 0.82), (0.095 + dx, dy - 0.012, 0.46), (0.09 + dx * 0.6, dy * 0.6, 0.12)], [0.014, 0.012, 0.008], fiber, segs=5)
body.sphere((0.06, 0.02, 0.07), (0.125, -0.108, 1.24), fiber, segs=8, rings=5)
body.box((0.05, 0.01, 0.02), (0.135, -0.112, 0.95), tendon)
body.box((0.05, 0.01, 0.02), (0.135, -0.112, 1.02), tendon)
body.box((0.012, 0.012, 0.09), (0.262, -0.05, 0.86), tendon)

# 胸とおなかの臓器（前にくぼみを開け、その中に置く）
org = Part('jintai_organs')
org.box((0.2, 0.012, 0.44), (0, -0.112, 0.88), cavity, anchor='bottom')
for s in (-1, 1):
    org.sphere((0.045, 0.026, 0.085), (s * 0.052, -0.124, 1.2), lung, segs=8, rings=6)
org.sphere((0.036, 0.03, 0.042), (0.022, -0.138, 1.145), heart, segs=8, rings=6)
org.cyl(0.012, 0.01, 0.06, (0.02, -0.135, 1.18), heart, segs=6)
org.sphere((0.07, 0.024, 0.034), (-0.035, -0.126, 1.05), liver, segs=8, rings=5)
org.sphere((0.04, 0.026, 0.034), (0.05, -0.13, 1.04), stomach, segs=8, rings=5)
# 大腸（コの字）と小腸（小さな玉の山）
org.tube([(-0.07, -0.126, 0.9), (-0.075, -0.126, 0.99), (0.075, -0.126, 0.99), (0.07, -0.126, 0.9)], [0.018, 0.018, 0.018, 0.018], gut_d, segs=6)
for i in range(3):
    for j in range(3):
        org.sphere(0.022, (-0.04 + i * 0.04, -0.13 - (i + j) % 2 * 0.006, 0.905 + j * 0.03), gut if (i + j) % 2 == 0 else gut_d, segs=6, rings=4)

root = empty('p_jintai', (0, 0, 0))
objs = [root, body.finish((0, 0, 0), root), org.finish((0, 0, 0), root)]
lib.export_glb('p_jintai.glb', objs)

# 大きさを出す
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
tris = 0
for o in objs[1:]:
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
print('JINTAI size(x,y,z)=', [round(hi[i] - lo[i], 3) for i in range(3)], 'min', [round(v, 3) for v in lo], 'tris', tris)
lib.render_views('props6', target=(0, 0, 0.8), dist=4, angles=(0, 40, 140, 180), res=(300, 520), ortho_scale=1.85, elev=0.08)
print('PROPS6_OK')
