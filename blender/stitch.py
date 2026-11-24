"""確認用レンダーを横に並べて 1 枚にまとめる。 python blender/stitch.py <prefix> [角度...]"""
import os, sys
from PIL import Image
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview')
prefix = sys.argv[1]
angles = sys.argv[2:] or ['000', '040', '090', '180']
ims = [Image.open(os.path.join(d, f'{prefix}_{a}.png')).convert('RGB') for a in angles]
w = sum(i.width for i in ims); h = max(i.height for i in ims)
out = Image.new('RGB', (w, h), (0, 0, 0)); x = 0
for i in ims:
    out.paste(i, (x, 0)); x += i.width
p = os.path.join(d, f'{prefix}_sheet.png'); out.save(p); print(p)
