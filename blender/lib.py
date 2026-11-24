"""Blender でローポリモデルを組み立てるための共通部品。

座標系は Blender 既定（Z 上、キャラの正面は -Y、キャラの右手側は -X）。
glTF へ書き出すと Y 上・正面 +Z になる。
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
TEX = os.path.join(ROOT, 'public', 'tex')
MODELS = os.path.join(ROOT, 'public', 'models')
PREVIEW = os.path.join(ROOT, 'blender', 'preview')

_mats = {}
_pivots = {}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    _pivots.clear()


def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, rgb, image=None, rough=0.9, metal=0.0, emit=None):
    """名前つきマテリアルを作る（同名は使い回す）。image は public/tex 内のファイル名。"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    lin = (srgb_to_lin(rgb[0]), srgb_to_lin(rgb[1]), srgb_to_lin(rgb[2]), 1.0)
    bsdf.inputs['Base Color'].default_value = lin
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (srgb_to_lin(emit[0]), srgb_to_lin(emit[1]), srgb_to_lin(emit[2]), 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if image:
        img = bpy.data.images.load(os.path.join(TEX, image))
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.nodes.active = tex
    m.diffuse_color = lin
    _mats[name] = m
    return m


class Part:
    """1 つのメッシュオブジェクトになる部品。ワールド座標で形を足していき、finish() で原点（関節位置）を決める。"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _commit(self, verts, M, m, smooth, deform):
        for v in verts:
            if deform:
                v.co = Vector(deform(v.co.copy()))
            v.co = M @ v.co
        faces = set()
        for v in verts:
            for f in v.link_faces:
                faces.add(f)
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        return list(faces)

    @staticmethod
    def _matrix(loc, rot, scale=(1, 1, 1)):
        return Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))

    def box(self, size, loc, m, rot=(0, 0, 0), taper=(1.0, 1.0), anchor='center', smooth=False, deform=None):
        """直方体。taper は上面(+Z)の XY 縮小率。anchor: center / bottom / top。"""
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = r['verts']
        off = {'center': 0.0, 'bottom': 0.5, 'top': -0.5}[anchor]
        for v in verts:
            if v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
            v.co.z += off
        return self._commit(verts, self._matrix(loc, rot, size), m, smooth, deform)

    def cyl(self, r1, r2, h, loc, m, segs=8, rot=(0, 0, 0), anchor='bottom', scale=(1.0, 1.0), smooth=False, cap=True, deform=None):
        """角柱/円錐台。軸はローカル +Z。r1 が下、r2 が上。"""
        r = bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
        verts = r['verts']
        off = {'center': 0.0, 'bottom': h / 2, 'top': -h / 2}[anchor]
        for v in verts:
            v.co.z += off
        return self._commit(verts, self._matrix(loc, rot, (scale[0], scale[1], 1.0)), m, smooth, deform)

    def sphere(self, radii, loc, m, segs=8, rings=6, rot=(0, 0, 0), smooth=True, deform=None):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0)
        if isinstance(radii, (int, float)):
            radii = (radii, radii, radii)
        return self._commit(r['verts'], self._matrix(loc, rot, radii), m, smooth, deform)

    def poly(self, pts, m, smooth=False):
        """任意の頂点列から 1 枚の面を作る（両面表示が必要な薄い板などに使う）。"""
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(m)
        f.smooth = smooth
        return [f]

    def tube(self, pts, radii, m, segs=6, smooth=True, scale=(1.0, 1.0), ref=(1, 0, 0)):
        """点列に沿った管。radii が 0 の端は 1 点に閉じる。ポニーテールや手足、枝などに使う。"""
        pts = [Vector(p) for p in pts]
        ref = Vector(ref)
        rings = []
        for i, p in enumerate(pts):
            a = pts[max(0, i - 1)]
            b = pts[min(len(pts) - 1, i + 1)]
            t = (b - a).normalized()
            n1 = t.cross(ref)
            if n1.length < 1e-5:
                n1 = t.cross(Vector((0, 1, 0)))
            n1.normalize()
            n2 = t.cross(n1).normalized()
            r = radii[i]
            if r <= 1e-6:
                rings.append([self.bm.verts.new(p)])
            else:
                ring = []
                for j in range(segs):
                    ang = 2 * math.pi * j / segs
                    ring.append(self.bm.verts.new(p + n1 * (math.cos(ang) * r * scale[0]) + n2 * (math.sin(ang) * r * scale[1])))
                rings.append(ring)
        faces = []
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            for j in range(segs):
                k = (j + 1) % segs
                if len(A) == 1 and len(B) == 1:
                    continue
                if len(A) == 1:
                    faces.append(self.bm.faces.new([A[0], B[j], B[k]]))
                elif len(B) == 1:
                    faces.append(self.bm.faces.new([A[j], A[k], B[0]]))
                else:
                    faces.append(self.bm.faces.new([A[j], A[k], B[k], B[j]]))
        if len(rings[0]) > 1:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        if len(rings[-1]) > 1:
            faces.append(self.bm.faces.new(rings[-1]))
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        return faces

    def wedge(self, a, b, tip, n, thick, m, smooth=False):
        """上辺 a-b から tip へすぼまる三角の板。n が厚み方向。前髪などに使う。"""
        a, b, tip, n = Vector(a), Vector(b), Vector(tip), Vector(n).normalized()
        a2, b2, t2 = a + n * thick, b + n * thick, tip + n * thick * 0.35
        v = [self.bm.verts.new(p) for p in (a, b, tip, a2, b2, t2)]
        faces = [
            self.bm.faces.new([v[0], v[1], v[2]]),
            self.bm.faces.new([v[3], v[5], v[4]]),
            self.bm.faces.new([v[0], v[3], v[4], v[1]]),
            self.bm.faces.new([v[1], v[4], v[5], v[2]]),
            self.bm.faces.new([v[2], v[5], v[3], v[0]]),
        ]
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = smooth
        return faces

    def set_material(self, faces, m):
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi

    def uv_map(self, faces, fn):
        """fn(ワールド座標) -> (u, v) で UV を付ける。"""
        for f in faces:
            for lp in f.loops:
                u, v = fn(lp.vert.co)
                lp[self.uv].uv = (u, v)

    def delete_faces(self, faces):
        bmesh.ops.delete(self.bm, geom=list(faces), context='FACES')

    def finish(self, pivot=(0, 0, 0), parent=None, recalc=True):
        pivot = Vector(pivot)
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        for v in self.bm.verts:
            v.co -= pivot
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        place(ob, pivot, parent)
        return ob


def place(ob, pivot, parent=None):
    pivot = Vector(pivot)
    _pivots[ob.name] = pivot
    if parent is not None:
        ob.parent = parent
        ob.location = pivot - _pivots[parent.name]
    else:
        ob.location = pivot


def empty(name, pivot=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    place(ob, pivot, parent)
    return ob


def export_glb(filename, objects=None):
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, filename)
    bpy.ops.object.select_all(action='DESELECT')
    use_sel = False
    if objects is not None:
        use_sel = True
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=use_sel,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_materials='EXPORT',
    )
    print('exported', path, os.path.getsize(path), 'bytes')
    return path


def render_views(prefix, target=(0, 0, 0.75), dist=3.0, angles=(0, 40, 90, 180), res=(420, 560), ortho_scale=1.9, elev=0.12, light='STUDIO'):
    """Workbench で確認用の画像を書き出す。angles は Z 軸まわりの角度（0 = 正面）。"""
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = light
    sh.color_type = 'TEXTURE'
    sh.show_shadows = False
    sh.show_cavity = False
    try:
        sh.show_object_outline = True
        sh.object_outline_color = (0.15, 0.1, 0.08)
    except Exception:
        pass
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    w = bpy.data.worlds.new('w')
    w.color = (0.55, 0.68, 0.80)
    sc.world = w
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = Vector(target)
    paths = []
    for a in angles:
        r = math.radians(a)
        pos = tgt + Vector((math.sin(r) * dist, -math.cos(r) * dist, dist * elev))
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(PREVIEW, f'{prefix}_{a:03d}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    bpy.data.objects.remove(cam)
    return paths
