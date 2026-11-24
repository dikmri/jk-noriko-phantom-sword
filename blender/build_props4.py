"""高低差のあるマップ（裏山）の小道具: 落石の大岩と丸太。

実行: blender -b --factory-startup -P blender/build_props4.py
出力: public/models/p_rock.glb, p_log.glb, blender/preview/props4_*.png
丸太（p_log）は X 方向に寝かせた形で作る。
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


rock = mat('s_rock', (140, 136, 128))
rock_d = mat('s_rock_d', (104, 100, 94))
moss = mat('s_moss', (96, 130, 70))
bark = mat('s_bark', (110, 76, 46))
wood = mat('s_wood', (206, 170, 110))

p = Part('rock')
p.sphere((1.3, 1.2, 1.25), (0, 0, 1.25), rock, segs=9, rings=6, smooth=False)
p.sphere((0.6, 0.5, 0.45), (0.5, -0.6, 1.9), rock_d, segs=6, rings=4, smooth=False)
p.sphere((0.7, 0.6, 0.3), (-0.3, 0.3, 2.3), moss, segs=6, rings=4, smooth=False)
model('p_rock', [p], 2.8)

p = Part('log')
p.cyl(0.45, 0.45, 3.2, (-1.6, 0, 0.45), bark, segs=10, rot=(0, R(90), 0), anchor='bottom')
for sx in (-1, 1):
    p.cyl(0.4, 0.4, 0.02, (sx * 1.605, 0, 0.45), wood, segs=10, rot=(0, R(90), 0), anchor='center')
p.tube([(0.3, 0, 0.8), (0.5, 0.1, 1.1)], [0.08, 0.05], bark, segs=5, smooth=False)
model('p_log', [p], 3.4)

for name, root, w in built:
    pass
x = -1.6
for name, root, w in built:
    root.location = (x + w / 2, 0, 0)
    x += w + 0.3
lib.render_views('props4', target=(0, 0, 1.0), dist=16, angles=(25,), res=(800, 420), ortho_scale=6.6, elev=0.14)
print('PROPS4_OK', len(built))
