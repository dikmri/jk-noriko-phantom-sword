"""USDCraft-10K（nvidia/USDCraft-10K, Apache-2.0）の物体を、ゲームの小物（部品ごとのノード）へ変換する。

実行:
  見比べ用の一覧: blender -b --factory-startup -P blender/build_usd.py -- sheet
  変換:           blender -b --factory-startup -P blender/build_usd.py -- build [キー ...]
入力: runtime/usdcraft/<manifest の path>/physx/model.usdc（tools は curl で取り寄せ済み）
出力: public/models/usd/<key>.glb（リンクごとのノード、glTF は Y 上・メートル）
      src/game/usd/catalog.ts（部品の箱・質量・関節）
      blender/preview/usd_*.png（確認用の絵。関節を範囲の端まで動かした絵も描く）

座標: USD は Z 上（Blender と同じ）。glTF へは (x, y, z) -> (x, z, -y) で移す。
物体の正面は USD の -Y（glTF の +Z）。
"""
import csv
import glob
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(ROOT, 'blender'))
import lib  # noqa: E402

from pxr import Gf, Usd, UsdGeom, UsdPhysics  # noqa: E402

USD_DIR = os.path.join(ROOT, 'runtime', 'usdcraft')
OUT_DIR = os.path.join(ROOT, 'public', 'models', 'usd')
CATALOG = os.path.join(ROOT, 'src', 'game', 'usd', 'catalog.ts')
PREVIEW = os.path.join(ROOT, 'blender', 'preview')

# 見比べる候補（キー -> カテゴリ ID）
CANDIDATES = {
    'piano': 'R564', 'cart': 'R331', 'forklift': 'R420', 'locker': 'R720', 'merrygo': 'R936', 'gascyl': 'R435',
    'signal': 'R940', 'seesaw': 'R505', 'robovac': 'R249', 'drone': 'R694', 'drums': 'R566', 'dumbbell': 'R554',
    'vending': 'R339', 'hydrant': 'R445', 'schooldesk': 'R320', 'tabletchair': 'R741', 'lectern': 'R324',
    'trophy': 'R739', 'bookcart': 'R322', 'copier': 'R305', 'wetsign': 'R799', 'hoop': 'R562', 'pingpong': 'R563',
    'fountain': 'R509', 'slide': 'R503', 'swing': 'R504', 'springrider': 'R515', 'parktrash': 'R497',
    'picnic': 'R935', 'hvac': 'R868', 'turbine': 'R870', 'mixer': 'R429', 'wheelbarrow': 'R428', 'oildrum': 'R417',
    'barrier': 'R431', 'jersey': 'R432', 'generator': 'R447', 'toilet': 'R901', 'skip': 'R902', 'arcade': 'R698',
    'pinball': 'R991', 'jukebox': 'R992', 'phonebooth': 'R943', 'mailbox': 'R498', 'cablereel': 'R879',
    'luggagecart': 'R362', 'popcorn': 'R610', 'cooler': 'R569', 'can': 'R043', 'excavator': 'R440',
}

# 選んだ物体（キー -> object_id, 三角形の上限）。sheet の結果を見て決める。
SELECTED = {
    # 親のスキル用
    'piano': ('ds_R564_01', 2000), 'cart': ('ds_R331_01', 4500, 12), 'forklift': ('ds_R420_03', 4000),
    'locker': ('ds_R720_01', 2500), 'merrygo': ('ds_R936_04', 3000), 'gascyl': ('ds_R435_03', 800),
    'signal': ('ds_R940_01', 1500), 'seesaw': ('ds_R505_01', 1500), 'robovac': ('ds_R249_01', 1000),
    'drone': ('ds_R694_01', 1500), 'drums': ('ds_R566_01', 4500), 'dumbbell': ('ds_R554_01', 400),
    'vending': ('ds_R339_03', 2500),
    # 障害物と仕掛け
    'hydrant': ('ds_R445_01', 1500), 'schooldesk': ('ds_R320_02', 1500), 'tabletchair': ('ds_R741_01', 1500),
    'lectern': ('ds_R324_02', 600), 'trophy': ('ds_R739_01', 1000), 'bookcart': ('ds_R322_01', 1500),
    'copier': ('ds_R305_02', 2500), 'wetsign': ('ds_R799_01', 400), 'hoop': ('ds_R562_03', 2000),
    'pingpong': ('ds_R563_01', 2500), 'slide': ('ds_R503_01', 3000), 'swing': ('ds_R504_01', 2500),
    'springrider': ('ds_R515_04', 2500), 'parktrash': ('ds_R497_03', 1200), 'picnic': ('ds_R935_01', 1200),
    'hvac': ('ds_R868_01', 2500), 'turbine': ('ds_R870_01', 2500), 'mixer': ('ds_R429_02', 4000),
    'wheelbarrow': ('ds_R428_01', 2000), 'oildrum': ('ds_R417_02', 800), 'barrier': ('ds_R431_02', 720),
    'jersey': ('ds_R432_01', 200), 'generator': ('ds_R447_03', 2500), 'toilet': ('ds_R901_01', 2400),
    'skip': ('ds_R902_01', 1500), 'arcade': ('ds_R698_02', 3500), 'pinball': ('ds_R991_01', 3000),
    'jukebox': ('ds_R992_03', 2200), 'phonebooth': ('ds_R943_02', 2500), 'mailbox': ('ds_R498_03', 1200),
    'cablereel': ('ds_R879_01', 2000), 'luggagecart': ('ds_R362_02', 2500), 'popcorn': ('ds_R610_01', 2500),
    'cooler': ('ds_R569_01', 1500), 'can': ('ds_R043_01', 360), 'excavator': ('ds_R440_01', 5000),
    # 追加（親のスキル・アイテム用）
    'fridge': ('ds_R002_01', 3000), 'washer': ('ds_R244_01', 4000), 'jackbox': ('ds_R666_08', 3000),
}
MAX_LINKS = 10


def manifest():
    rows = list(csv.DictReader(open(os.path.join(USD_DIR, 'manifest.csv'), encoding='utf-8')))
    return {r['object_id']: r for r in rows}


def usdc_of(row):
    return os.path.join(USD_DIR, row['path'].replace('/', os.sep), 'physx', 'model.usdc')


def base(name):
    return name.split('.')[0]


# ------------------------------------------------------------------ 読み込み
def import_asset(path):
    """USD を読み込み、リンク名 -> 見た目のメッシュ（当たり判定用は捨てる）を返す。"""
    before = set(bpy.data.objects)
    kw = dict(filepath=path)
    for k, v in (('import_guide', False), ('import_proxy', False), ('import_render', True)):
        kw[k] = v
    try:
        bpy.ops.wm.usd_import(**kw)
    except TypeError:
        bpy.ops.wm.usd_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None and o.type != 'MESH']
    links = {}
    junk = []
    for o in new:
        if o.type != 'MESH':
            continue
        # 親をたどり、Collisions の下なら捨てる。Links の直下の物がリンク
        p = o
        link = None
        coll = False
        while p is not None:
            if base(p.name) == 'Collisions':
                coll = True
            if p.parent is not None and base(p.parent.name) == 'Links':
                link = base(p.name)
                break
            p = p.parent
        if coll or link is None:
            junk.append(o)
            continue
        links.setdefault(link, []).append(o)
    for o in junk:
        bpy.data.objects.remove(o, do_unlink=True)
    flatten_materials([o for v in links.values() for o in v], links)
    return links, roots


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def image_average(img):
    """画像の平均色（sRGB の 0..1）と平均の不透明度。"""
    try:
        import numpy as np
        px = np.array(img.pixels[:], dtype=np.float32)
        if px.size == 0:
            return None
        px = px.reshape(-1, 4)
        a = px[:, 3]
        w = a.sum()
        if w <= 1e-6:
            return (0.5, 0.5, 0.5), 0.0
        rgb = (px[:, :3] * a[:, None]).sum(axis=0) / w
        return tuple(float(x) for x in rgb), float(a.mean())
    except Exception as e:  # noqa: BLE001
        print('IMG_AVG_FAIL', img.name, e)
        return None


def flatten_materials(objs, links):
    """画像を使う材質を平均色に置き換える。ほとんど透明な画像（シール）を貼った面は消す。"""
    done = {}
    for o in list(objs):
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in done or not m.node_tree:
                continue
            done[m.name] = True
            bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is None:
                continue
            inp = bsdf.inputs['Base Color']
            if inp.is_linked:
                node = inp.links[0].from_node
                # 画像まで遡る
                seen = 0
                while node is not None and node.type != 'TEX_IMAGE' and seen < 5:
                    nxt = None
                    for i in node.inputs:
                        if i.is_linked:
                            nxt = i.links[0].from_node
                            break
                    node = nxt
                    seen += 1
                col = (0.7, 0.7, 0.7)
                alpha = 1.0
                if node is not None and node.type == 'TEX_IMAGE' and node.image is not None:
                    r = image_average(node.image)
                    if r:
                        col, alpha = r
                for l in list(inp.links):
                    m.node_tree.links.remove(l)
                inp.default_value = (srgb_to_lin(col[0]), srgb_to_lin(col[1]), srgb_to_lin(col[2]), 1.0)
                m['decal'] = alpha < 0.55
            a = bsdf.inputs.get('Alpha')
            if a is not None and a.is_linked:
                for l in list(a.links):
                    m.node_tree.links.remove(l)
                a.default_value = 1.0
    # シールの面を消す
    for name, lst in links.items():
        keep = []
        for o in lst:
            if o.material_slots and all(s.material is not None and s.material.get('decal') for s in o.material_slots):
                bpy.data.objects.remove(o, do_unlink=True)
            else:
                keep.append(o)
        links[name] = keep
    # 材質の無いメッシュは灰色
    grey = None
    for lst in links.values():
        for o in lst:
            if not o.material_slots or all(s.material is None for s in o.material_slots):
                if grey is None:
                    grey = lib.mat('u_grey', (150, 150, 150))
                o.data.materials.clear()
                o.data.materials.append(grey)


def tri_count(objs):
    n = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = o.evaluated_get(dg).data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


# ------------------------------------------------------------------ 見比べ用の一覧
def sheet():
    man = manifest()
    by = {}
    for r in man.values():
        by.setdefault(r['category_id'], []).append(r)
    os.makedirs(PREVIEW, exist_ok=True)
    report = {}
    for key, cid in CANDIDATES.items():
        lib.reset_scene()
        x = 0.0
        info = []
        rows = [r for r in by[cid] if os.path.exists(usdc_of(r))][:3]
        for r in rows:
            links, roots = import_asset(usdc_of(r))
            objs = [o for v in links.values() for o in v]
            if not objs:
                continue
            lo, hi = world_bbox(objs)
            for rt in roots:
                rt.location.x += x - lo.x
                rt.location.y -= (lo.y + hi.y) / 2
                rt.location.z -= lo.z
            x += (hi.x - lo.x) + max(0.1, (hi.x - lo.x) * 0.25)
            info.append({'id': r['object_id'], 'tris': tri_count(objs), 'links': len(links), 'size': [round(hi.x - lo.x, 2), round(hi.y - lo.y, 2), round(hi.z - lo.z, 2)], 'title': r['title'][:40]})
        report[key] = info
        if x <= 0:
            continue
        objs = [o for o in bpy.data.objects if o.type == 'MESH']
        lo, hi = world_bbox(objs)
        span = max(hi.x - lo.x, (hi.z - lo.z) * 2.6)
        prefix = f'usdsheet_{key}'
        lib.render_views(prefix, target=((lo.x + hi.x) / 2, 0, (hi.z + lo.z) / 2), dist=max(4, span * 2), angles=(30,), res=(600, 230), ortho_scale=span * 1.1, elev=0.3)
        print('SHEET', key, json.dumps(info, ensure_ascii=False))
    json.dump(report, open(os.path.join(PREVIEW, 'usdsheet.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


# ------------------------------------------------------------------ 物理（関節・質量）
def gl(v):
    """USD（Z 上）の座標を glTF（Y 上）へ。"""
    return [float(v[0]), float(v[2]), -float(v[1])]


def finite(x):
    return x is not None and math.isfinite(x) and abs(x) < 1e6


def read_physics(path):
    st = Usd.Stage.Open(path)
    cache = UsdGeom.XformCache()
    links = {}
    lp = st.GetPrimAtPath('/Asset/Links')
    for c in (lp.GetChildren() if lp else []):
        m = cache.GetLocalToWorldTransform(c)
        mass = None
        if c.HasAPI(UsdPhysics.MassAPI):
            mass = UsdPhysics.MassAPI(c).GetMassAttr().Get()
        # 拡大縮小を除いた変換（関節の枠に使う）
        t = m.ExtractTranslation()
        r = m.ExtractRotationQuat()
        links[c.GetName()] = {'t': Vector((t[0], t[1], t[2])), 'q': Quaternion((r.GetReal(), *r.GetImaginary())), 'mass': mass}
    joints = []
    for p in st.Traverse():
        if not p.IsA(UsdPhysics.Joint):
            continue
        j = UsdPhysics.Joint(p)
        b0 = j.GetBody0Rel().GetTargets()
        b1 = j.GetBody1Rel().GetTargets()
        n0 = b0[0].name if b0 else None
        n1 = b1[0].name if b1 else None
        if n1 is None or n1 not in links:
            continue
        typ, lo, hi, axis = 'fixed', 0.0, 0.0, 'X'
        if p.IsA(UsdPhysics.RevoluteJoint):
            rj = UsdPhysics.RevoluteJoint(p)
            axis = rj.GetAxisAttr().Get() or 'X'
            lo, hi = rj.GetLowerLimitAttr().Get(), rj.GetUpperLimitAttr().Get()
            if not (finite(lo) and finite(hi)) or hi - lo >= 359:
                typ, lo, hi = 'continuous', 0.0, 0.0
            else:
                typ, lo, hi = 'revolute', math.radians(lo), math.radians(hi)
        elif p.IsA(UsdPhysics.PrismaticJoint):
            pj = UsdPhysics.PrismaticJoint(p)
            axis = pj.GetAxisAttr().Get() or 'X'
            lo, hi = pj.GetLowerLimitAttr().Get(), pj.GetUpperLimitAttr().Get()
            typ = 'prismatic'
            lo = lo if finite(lo) else -0.2
            hi = hi if finite(hi) else 0.2
        lp0 = j.GetLocalPos0Attr().Get() or Gf.Vec3f(0, 0, 0)
        lr0 = j.GetLocalRot0Attr().Get() or Gf.Quatf(1, 0, 0, 0)
        q0 = Quaternion((lr0.GetReal(), *lr0.GetImaginary()))
        if n0 in links:
            bt, bq = links[n0]['t'], links[n0]['q']
        else:
            bt, bq = Vector((0, 0, 0)), Quaternion()
        anchor = bt + bq @ Vector((lp0[0], lp0[1], lp0[2]))
        av = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[axis]
        ax = (bq @ (q0 @ av)).normalized()
        joints.append({'n': p.GetName(), 't': typ, 'p': n0, 'c': n1, 'a': anchor, 'x': ax, 'lo': float(lo), 'hi': float(hi)})
    return links, joints


def joint_matrix(j, q):
    """静止姿勢の物体座標で、関節を q 動かす変換（Blender / USD の座標）。"""
    a, x = j['a'], j['x']
    if j['t'] in ('revolute', 'continuous'):
        return Matrix.Translation(a) @ Matrix.Rotation(q, 4, x) @ Matrix.Translation(-a)
    if j['t'] == 'prismatic':
        return Matrix.Translation(x * q)
    return Matrix.Identity(4)


def mesh_bbox(ob):
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    if not vs:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def join_link(name, objs):
    select_only(objs)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.make_single_user(object=True, obdata=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = name
    ob.data.name = name
    return ob


def decimate(objs, budget):
    before = tri_count(objs)
    if before <= budget:
        return before
    for ob in objs:
        mod = ob.modifiers.new('dis', 'DECIMATE')
        mod.decimate_type = 'DISSOLVE'
        mod.angle_limit = math.radians(1.0)
        select_only([ob])
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mid = tri_count(objs)
    if mid > budget:
        r = budget / mid
        for ob in objs:
            n = tri_count([ob])
            if n <= 24:
                continue
            mod = ob.modifiers.new('col', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = max(r, 24 / n)
            select_only([ob])
            bpy.ops.object.modifier_apply(modifier=mod.name)
    return tri_count(objs)


def smooth(objs):
    for ob in objs:
        select_only([ob])
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:  # noqa: BLE001
            pass
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
        except Exception:  # noqa: BLE001
            bpy.ops.object.shade_flat()


def export_glb(path, objs):
    select_only(objs)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(filepath=path, use_selection=True, export_format='GLB', export_yup=True, export_apply=True,
              export_materials='EXPORT', export_normals=True, export_texcoords=False, export_animations=False,
              export_vertex_color='NONE', export_colors=False, export_extras=False, export_cameras=False, export_lights=False)
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})


def build_one(key, oid, budget, man, maxl=MAX_LINKS):
    lib.reset_scene()
    row = man[oid]
    path = usdc_of(row)
    links, _roots = import_asset(path)
    plinks, pjoints = read_physics(path)
    # リンクの親子（関節の body0 -> body1）
    parent = {}
    for j in pjoints:
        if j['p'] in plinks and j['c'] not in parent:
            parent[j['c']] = j['p']
    names = [n for n in plinks if links.get(n)]
    bbox = {n: world_bbox(links[n]) for n in names}
    allo, alhi = world_bbox([o for n in names for o in links[n]])
    omax = max(alhi - allo)
    vol = {}
    for n in names:
        d = bbox[n][1] - bbox[n][0]
        vol[n] = max(1e-6, d.x * d.y * d.z)
    # 根: 親の無いリンクのうち重い物。ほかの根は根へ固定する
    roots = [n for n in names if parent.get(n) not in names]
    root = max(roots, key=lambda n: (plinks[n]['mass'] or 0, vol[n]))
    for n in roots:
        if n != root:
            parent[n] = root
    for n in names:
        if parent.get(n) not in names and n != root:
            parent[n] = root
    jt = {j['c']: j for j in pjoints}
    alive = set(names)

    def top(n):
        while n not in alive:
            n = parent.get(n, root)
        return n
    # 小さい部品・小さく固定された部品は親へまとめる
    for n in sorted(names, key=lambda n: vol[n]):
        if n == root:
            continue
        sz = max(bbox[n][1] - bbox[n][0])
        j = jt.get(n)
        fixed = j is None or j['t'] == 'fixed'
        if sz < 0.07 * omax or (fixed and sz < 0.2 * omax):
            alive.discard(n)
    while len(alive) > maxl:
        n = min((m for m in alive if m != root), key=lambda m: vol[m])
        alive.discard(n)
    groups = {n: [] for n in alive}
    for n in names:
        groups[top(n)].extend(links[n])

    def depth(n):
        d = 0
        while n != root and d < 50:
            n = top(parent.get(n, root))
            d += 1
        return d
    order = sorted(alive, key=lambda n: (depth(n), n))
    obs = [join_link(n, groups[n]) for n in order]
    # 読み込んだ空の親（リンクと同じ名前を持つ）を消してから、部品に正しい名前を付け直す
    keep = set(o.name for o in obs)
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for n, ob in zip(order, obs):
        ob.name = n
        ob.data.name = n
        assert ob.name == n, (ob.name, n)
    tris = decimate(obs, budget)
    smooth(obs)
    os.makedirs(OUT_DIR, exist_ok=True)
    export_glb(os.path.join(OUT_DIR, key + '.glb'), obs)
    # 目録
    idx = {n: i for i, n in enumerate(order)}
    total_mass = sum((plinks[n]['mass'] or 0) for n in names)
    lks = []
    for n, ob in zip(order, obs):
        lo, hi = mesh_bbox(ob)
        m = sum((plinks[k]['mass'] or 0) for k in names if top(k) == n)
        if m <= 0:
            m = max(0.2, vol[n] * 150)
        glo, ghi = gl(lo), gl(hi)
        lks.append({'n': n, 'p': -1 if n == root else idx[top(parent.get(n, root))], 'm': max(0.001, round(m, 3)), 'min': [round(min(glo[i], ghi[i]), 4) for i in range(3)], 'max': [round(max(glo[i], ghi[i]), 4) for i in range(3)]})
    jts = []
    for n in order:
        if n == root:
            continue
        j = jt.get(n)
        if j is None or j['t'] == 'fixed' or j['p'] not in plinks or top(j['p']) == n:
            continue
        jts.append({'n': j['n'], 't': j['t'], 'p': idx[top(j['p'])], 'c': idx[n],
                    'a': [round(v, 4) for v in gl(j['a'])], 'x': [round(v, 4) for v in gl(j['x'])],
                    'lo': round(j['lo'], 4), 'hi': round(j['hi'], 4)})
    glo, ghi = gl(allo), gl(alhi)
    mn = [round(min(glo[i], ghi[i]), 4) for i in range(3)]
    mx = [round(max(glo[i], ghi[i]), 4) for i in range(3)]
    entry = {'id': oid, 'title': row['title'], 'mass': round(total_mass or sum(l['m'] for l in lks), 2), 'min': mn, 'max': mx,
             'tris': tris, 'links': lks, 'joints': jts}
    # 確認用の絵: 静止と、関節を範囲の端まで動かした姿
    span = max(alhi.x - allo.x, alhi.y - allo.y, (alhi.z - allo.z) * 1.2) * 1.5
    tgt = ((allo.x + alhi.x) / 2, (allo.y + alhi.y) / 2, (allo.z + alhi.z) / 2)
    lib.render_views(f'usd_{key}_a', target=tgt, dist=span * 3, angles=(35,), res=(360, 360), ortho_scale=span, elev=0.35)
    D = {}
    for n, ob in zip(order, obs):
        if n == root:
            D[n] = Matrix.Identity(4)
            continue
        P = D.get(top(parent.get(n, root)), Matrix.Identity(4))
        j = jt.get(n)
        if j is None or j['t'] == 'fixed':
            D[n] = P
        else:
            if j['t'] == 'continuous':
                q = math.radians(70)
            else:
                q = j['hi'] if abs(j['hi']) >= abs(j['lo']) else j['lo']
            D[n] = P @ joint_matrix(j, q)
        ob.matrix_world = D[n]
    lib.render_views(f'usd_{key}_b', target=tgt, dist=span * 3, angles=(35,), res=(360, 360), ortho_scale=span, elev=0.35)
    print('BUILT', key, oid, 'links', len(order), 'joints', len(jts), 'tris', tris)
    return entry


def write_catalog(cat):
    os.makedirs(os.path.dirname(CATALOG), exist_ok=True)
    lines = [
        '// blender/build_usd.py が書き出す。手で直さない。',
        '// 出典: NVIDIA USDCraft-10K（https://huggingface.co/datasets/nvidia/USDCraft-10K, Apache-2.0）',
        "import type { ArtDef } from './art';",
        '',
        'export const ART: Record<string, ArtDef> = {',
    ]
    for k in sorted(cat):
        lines.append(f'  {k}: {json.dumps(cat[k], ensure_ascii=False, separators=(",", ":"))},')
    lines.append('};')
    lines.append('')
    open(CATALOG, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))


def build(keys):
    man = manifest()
    store = os.path.join(USD_DIR, 'catalog.json')
    cat = json.load(open(store, encoding='utf-8')) if os.path.exists(store) else {}
    for key in (keys or list(SELECTED)):
        oid, budget = SELECTED[key][:2]
        maxl = SELECTED[key][2] if len(SELECTED[key]) > 2 else MAX_LINKS
        try:
            cat[key] = build_one(key, oid, budget, man, maxl)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print('FAILED', key, e)
        json.dump(cat, open(store, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    write_catalog(cat)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    mode = argv[0] if argv else 'build'
    if mode == 'sheet':
        sheet()
    else:
        build(argv[1:])
