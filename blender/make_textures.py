"""ノリコの顔・服などの手描き風テクスチャを PIL で生成する。

実行: python blender/make_textures.py   (プロジェクトルートで)
出力: public/tex/*.png
顔テクスチャは頭の正面への平面投影（u = 0.5 + x/(2*HEAD_RX), v = 0.5 + z/(2*HEAD_RZ)）を前提にしている。
build_noriko.py の HEAD_RX / HEAD_RZ と値をそろえること。
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'tex')
os.makedirs(OUT, exist_ok=True)

HEAD_RX = 0.165
HEAD_RZ = 0.17
SKIN = (255, 226, 200)
SKIN_SHADE = (240, 196, 168)
LASH = (58, 30, 16)
BROW = (110, 58, 28)
IRIS_TOP = (104, 48, 12)
IRIS_BOTTOM = (245, 170, 60)
PUPIL = (52, 22, 8)

SIZE = 512
SS = 4
S = SIZE * SS


def P(x, z):
    """頭ローカル座標(m) → 拡大キャンバス上のピクセル。x は画像の右向き。"""
    return ((0.5 + x / (2 * HEAD_RX)) * S, (0.5 - z / (2 * HEAD_RZ)) * S)


def M(d):
    """長さ(m) → ピクセル（横方向の縮尺）。"""
    return d / (2 * HEAD_RX) * S


def ell(draw, cx, cz, w, h, **kw):
    px, py = P(cx, cz)
    rw, rh = M(w) / 2, M(h) / 2
    draw.ellipse([px - rw, py - rh, px + rw, py + rh], **kw)


def bbox(cx, cz, w, h):
    px, py = P(cx, cz)
    rw, rh = M(w) / 2, M(h) / 2
    return [px - rw, py - rh, px + rw, py + rh]


def gradient_ellipse(img, cx, cz, w, h, top, bottom):
    box = [int(v) for v in bbox(cx, cz, w, h)]
    bw, bh = box[2] - box[0], box[3] - box[1]
    grad = Image.new('RGB', (bw, bh))
    gd = ImageDraw.Draw(grad)
    for y in range(bh):
        t = y / max(1, bh - 1)
        t = t * t * (3 - 2 * t)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (bw, y)], fill=c)
    mask = Image.new('L', (bw, bh), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, bw - 1, bh - 1], fill=255)
    img.paste(grad, (box[0], box[1]), mask)


def open_eye(img, d, side, squint=0.0, look=(0.0, 0.0)):
    """side: -1 = 画像左の目, +1 = 画像右の目。squint: 0..1 で上まぶたが下がる。"""
    cx, cz = 0.070 * side, -0.022
    w, h = 0.074, 0.092
    # 白目
    ell(d, cx, cz, w, h, fill=(255, 255, 255))
    # 虹彩
    icx, icz = cx + look[0], cz - 0.004 + look[1]
    gradient_ellipse(img, icx, icz, w * 0.80, h * 0.94, IRIS_TOP, IRIS_BOTTOM)
    d2 = ImageDraw.Draw(img)
    ell(d2, icx, icz + 0.004, w * 0.36, h * 0.46, fill=PUPIL)
    # 虹彩の縁
    px, py = P(icx, icz)
    rw, rh = M(w * 0.80) / 2, M(h * 0.94) / 2
    d2.ellipse([px - rw, py - rh, px + rw, py + rh], outline=(70, 30, 8), width=int(S * 0.006))
    # ハイライト
    ell(d2, icx - 0.014, icz + 0.024, 0.024, 0.028, fill=(255, 255, 255))
    ell(d2, icx + 0.014, icz - 0.022, 0.011, 0.012, fill=(255, 250, 235))
    # 上まぶた（肌色で上から覆う）
    if squint > 0:
        cover = h * squint
        x0, y0 = P(cx - w, cz + h)
        x1, y1 = P(cx + w, cz + h / 2 - cover)
        d2.rectangle([x0, y0, x1, y1], fill=SKIN)
        lx0, ly = P(cx - w * 0.56, cz + h / 2 - cover)
        lx1, _ = P(cx + w * 0.56, cz + h / 2 - cover)
        d2.line([(lx0, ly), (lx1, ly)], fill=LASH, width=int(S * 0.02))
    else:
        # 上まつげ（太い弧）
        b = bbox(cx, cz - 0.003, w * 1.10, h * 1.10)
        d2.arc(b, 190, 350, fill=LASH, width=int(S * 0.022))
        # 目尻のはね
        ox, oy = P(cx + side * w * 0.52, cz + h * 0.20)
        tx, ty = P(cx + side * w * 0.74, cz + h * 0.40)
        d2.line([(ox, oy), (tx, ty)], fill=LASH, width=int(S * 0.014))
        # 二重の線
        b2 = bbox(cx, cz + 0.006, w * 1.10, h * 1.28)
        d2.arc(b2, 215, 325, fill=(196, 132, 100), width=int(S * 0.005))
    # 下まつげ（細い）
    b3 = bbox(cx, cz, w * 1.02, h * 1.02)
    d2.arc(b3, 35, 145, fill=(150, 90, 60), width=int(S * 0.005))


def closed_eye(d, side, kind):
    cx, cz = 0.070 * side, -0.030
    w = 0.074
    wd = int(S * 0.016)
    if kind == 'blink':
        d.arc(bbox(cx, cz + 0.020, w * 1.05, 0.05), 20, 160, fill=LASH, width=wd)
    elif kind == 'happy':
        d.arc(bbox(cx, cz - 0.015, w * 1.05, 0.07), 200, 340, fill=LASH, width=wd)
    elif kind == 'hurt':
        # ＞ ＜
        ax, ay = P(cx + side * 0.034, cz + 0.034)
        bx, by = P(cx - side * 0.030, cz)
        ex, ey = P(cx + side * 0.034, cz - 0.034)
        d.line([(ax, ay), (bx, by), (ex, ey)], fill=LASH, width=wd, joint='curve')
    elif kind == 'dead':
        for sx in (-1, 1):
            ax, ay = P(cx - 0.028, cz + 0.028 * sx)
            bx, by = P(cx + 0.028, cz - 0.028 * sx)
            d.line([(ax, ay), (bx, by)], fill=LASH, width=wd)


def brow(d, side, angle=0.0, raise_=0.0):
    """angle>0 で眉尻が上がる（怒り眉）。"""
    cx, cz = 0.072 * side, 0.058 + raise_
    half = 0.030
    inner = (cx - side * half, cz - angle * half)
    outer = (cx + side * half, cz + angle * half)
    mid = (cx, cz + 0.006)
    pts = [P(*inner), P(*mid), P(*outer)]
    d.line(pts, fill=BROW, width=int(S * 0.012), joint='curve')


def blush(img, strength=110):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for side in (-1, 1):
        ell(ld, 0.098 * side, -0.074, 0.058, 0.030, fill=(255, 120, 120, strength))
    layer = layer.filter(ImageFilter.GaussianBlur(S * 0.012))
    img.paste(layer, (0, 0), layer)


def mouth(d, kind):
    cz = -0.100
    line = (120, 40, 30)
    if kind == 'smile_open':  # 案Bの「にぱっ」と開いた口 + 八重歯
        b = bbox(0, cz + 0.020, 0.056, 0.064)
        d.chord(b, 0, 180, fill=(214, 84, 84), outline=line, width=int(S * 0.005))
        tb = bbox(0, cz + 0.004, 0.026, 0.020)
        d.chord(tb, 0, 180, fill=(250, 150, 150))
        fx, fy = P(0.014, cz + 0.020)
        d.polygon([(fx - M(0.006), fy), (fx + M(0.006), fy), (fx, fy + M(0.012))], fill=(255, 255, 255))
        x0, y0 = P(-0.028, cz + 0.020)
        x1, _ = P(0.028, cz + 0.020)
        d.line([(x0, y0), (x1, y0)], fill=line, width=int(S * 0.006))
    elif kind == 'shout':
        b = bbox(0, cz + 0.004, 0.058, 0.060)
        d.ellipse(b, fill=(190, 60, 60), outline=line, width=int(S * 0.005))
        tb = bbox(0, cz - 0.014, 0.036, 0.020)
        d.ellipse(tb, fill=(250, 140, 140))
        fx, fy = P(0.013, cz + 0.030)
        d.polygon([(fx - M(0.006), fy), (fx + M(0.006), fy), (fx, fy + M(0.013))], fill=(255, 255, 255))
    elif kind == 'smirk':
        d.arc(bbox(0.004, cz + 0.030, 0.070, 0.056), 15, 155, fill=line, width=int(S * 0.009))
        fx, fy = P(0.020, cz + 0.006)
        d.polygon([(fx - M(0.005), fy), (fx + M(0.005), fy), (fx, fy + M(0.010))], fill=(255, 255, 255), outline=line)
    elif kind == 'wavy':
        pts = []
        for i in range(25):
            t = i / 24
            x = -0.030 + 0.060 * t
            z = cz + 0.006 * math.sin(t * math.pi * 4)
            pts.append(P(x, z))
        d.line(pts, fill=line, width=int(S * 0.008), joint='curve')
    elif kind == 'small_o':
        d.ellipse(bbox(0, cz + 0.004, 0.022, 0.026), fill=(200, 70, 70), outline=line, width=int(S * 0.005))


def make_face(name, eyes, mouth_kind, brow_angle=0.0, brow_raise=0.0, squint=0.0, extra=None):
    img = Image.new('RGB', (S, S), SKIN)
    d = ImageDraw.Draw(img)
    blush(img, 150 if eyes in ('hurt', 'happy') else 105)
    d = ImageDraw.Draw(img)
    # 鼻（ごく小さい影）
    nx, ny = P(0.004, -0.060)
    d.line([(nx, ny), (nx + M(0.004), ny + M(0.005))], fill=SKIN_SHADE, width=int(S * 0.006))
    for side in (-1, 1):
        if eyes == 'open':
            open_eye(img, d, side, squint)
        else:
            closed_eye(d, side, eyes)
        d = ImageDraw.Draw(img)
        brow(d, side, brow_angle, brow_raise)
    mouth(d, mouth_kind)
    if extra:
        extra(img, d)
    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    out.save(os.path.join(OUT, f'face_{name}.png'))
    return out


def sweat(img, d):
    x, y = P(0.118, 0.050)
    r = M(0.012)
    d.polygon([(x, y - r * 2.2), (x - r, y), (x + r, y)], fill=(150, 210, 255))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(150, 210, 255))


def make_faces():
    faces = [
        make_face('neutral', 'open', 'smile_open'),
        make_face('blink', 'blink', 'smile_open'),
        make_face('attack', 'open', 'shout', brow_angle=0.55, brow_raise=-0.012, squint=0.16),
        make_face('hurt', 'hurt', 'wavy', brow_angle=-0.4, extra=sweat),
        make_face('happy', 'happy', 'smile_open', brow_raise=0.006),
        make_face('smug', 'open', 'smirk', brow_angle=0.35, brow_raise=-0.008, squint=0.30),
        make_face('dead', 'dead', 'small_o', brow_angle=-0.3),
    ]
    sheet = Image.new('RGB', (SIZE * 4, SIZE * 2), (40, 40, 40))
    for i, f in enumerate(faces):
        sheet.paste(f, ((i % 4) * SIZE, (i // 4) * SIZE))
    sheet = sheet.resize((SIZE * 2, SIZE), Image.LANCZOS)
    sheet.save(os.path.join(OUT, '_preview_faces.png'))


def make_plaid():
    n = 256
    img = Image.new('RGB', (n, n), (178, 34, 46))
    d = ImageDraw.Draw(img, 'RGBA')
    for k in range(0, n, 64):
        d.rectangle([k + 6, 0, k + 26, n], fill=(110, 14, 28, 150))
        d.rectangle([0, k + 6, n, k + 26], fill=(110, 14, 28, 150))
        d.line([(k + 40, 0), (k + 40, n)], fill=(245, 235, 225, 200), width=2)
        d.line([(0, k + 40), (n, k + 40)], fill=(245, 235, 225, 200), width=2)
        d.line([(k + 52, 0), (k + 52, n)], fill=(240, 200, 60, 150), width=1)
        d.line([(0, k + 52), (n, k + 52)], fill=(240, 200, 60, 150), width=1)
    # プリーツの影
    for k in range(0, n, 32):
        d.rectangle([k, 0, k + 3, n], fill=(40, 0, 10, 110))
    img.save(os.path.join(OUT, 'plaid.png'))


def make_blazer_front():
    """胴体の正面へ平面投影する。u: 左右, v: 下(裾)→上(肩)。"""
    n = 256
    base = (240, 226, 178)
    line = (150, 120, 70)
    img = Image.new('RGB', (n * 4, n * 4), base)
    d = ImageDraw.Draw(img)
    s = n * 4

    def p(u, v):
        return (u * s, (1 - v) * s)

    # シャツのV
    d.polygon([p(0.36, 1.0), p(0.64, 1.0), p(0.50, 0.50)], fill=(250, 250, 252))
    # ネクタイ
    d.polygon([p(0.455, 0.93), p(0.545, 0.93), p(0.525, 0.84), p(0.475, 0.84)], fill=(196, 30, 44))
    d.polygon([p(0.475, 0.84), p(0.525, 0.84), p(0.555, 0.60), p(0.50, 0.52), p(0.445, 0.60)], fill=(176, 22, 38))
    d.line([p(0.475, 0.84), p(0.525, 0.84)], fill=(120, 10, 24), width=6)
    # シャツの襟
    d.polygon([p(0.36, 1.0), p(0.50, 0.90), p(0.44, 0.83)], fill=(255, 255, 255), outline=(190, 190, 200))
    d.polygon([p(0.64, 1.0), p(0.50, 0.90), p(0.56, 0.83)], fill=(255, 255, 255), outline=(190, 190, 200))
    # ラペル
    d.polygon([p(0.30, 1.0), p(0.36, 1.0), p(0.50, 0.50), p(0.44, 0.50), p(0.27, 0.72)], fill=(232, 215, 160), outline=line)
    d.polygon([p(0.70, 1.0), p(0.64, 1.0), p(0.50, 0.50), p(0.56, 0.50), p(0.73, 0.72)], fill=(232, 215, 160), outline=line)
    d.line([p(0.27, 0.72), p(0.36, 0.76)], fill=line, width=5)
    d.line([p(0.73, 0.72), p(0.64, 0.76)], fill=line, width=5)
    # 前合わせ
    d.line([p(0.50, 0.50), p(0.50, 0.0)], fill=line, width=6)
    # ボタン
    for v in (0.40, 0.22):
        x, y = p(0.50, v)
        r = s * 0.028
        d.ellipse([x - r, y - r, x + r, y + r], fill=(246, 200, 50), outline=(150, 110, 20), width=4)
    # ポケット
    for u0, u1 in ((0.10, 0.34), (0.66, 0.90)):
        d.line([p(u0, 0.20), p(u1, 0.20)], fill=line, width=6)
    img = img.resize((n, n), Image.LANCZOS)
    img.save(os.path.join(OUT, 'blazer_front.png'))


def make_wood():
    random.seed(7)
    w, h = 128, 256
    img = Image.new('RGB', (w, h), (132, 86, 48))
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(140):
        x = random.randint(0, w)
        y = random.randint(0, h)
        ln = random.randint(20, 120)
        c = random.choice([(90, 54, 26, 120), (160, 110, 66, 110), (70, 40, 20, 90)])
        d.line([(x, y), (x + random.randint(-3, 3), y + ln)], fill=c, width=random.randint(1, 3))
    for _ in range(4):
        x, y = random.randint(10, w - 10), random.randint(10, h - 10)
        d.ellipse([x - 7, y - 10, x + 7, y + 10], outline=(60, 34, 16, 220), width=2)
        d.ellipse([x - 3, y - 5, x + 3, y + 5], fill=(70, 40, 20, 200))
    img.save(os.path.join(OUT, 'wood.png'))


if __name__ == '__main__':
    make_faces()
    make_plaid()
    make_blazer_front()
    make_wood()
    print('textures written to', os.path.normpath(OUT))
