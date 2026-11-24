"""Assemble and render EQ character (NPC) models from a zone's <zone>_chr.s3d.

    python3 tools/eq_chr.py list   templeveeshan
    python3 tools/eq_chr.py render templeveeshan DRK out.png [yaw_degrees] [height_px]

A model is a skeleton (WLD fragment 0x10) whose bones carry a transform track
(0x13 -> 0x12) and skinned meshes (0x36) whose vertices are stored per bone.
We pose it with frame 0 of the base tracks (the standing pose) and draw it with
its textures, orthographically, as a sprite.
"""
import io
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402
from s3d import open_image, read_archive  # noqa: E402
from wld import Wld  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def _quat_matrix(w, x, y, z):
    n = np.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def keep_faces(verts, tris):
    """The faces to keep in a model posed for good (a sprite, a seated driver): a few player-race
    bones carry bad rest data (HUM/BAM hip) that stretches faces across the model - drop a face
    longer than half the model's size, its largest extent in any direction (a bat rests with its
    wings spread flat: 3 tall, 23 across). Never for a skinned, animated model (`model(...,
    guard=False)`): skinning cancels the rest pose out (each face takes its shape from the
    animation), so there the rule only cut real geometry - a fae drake's wings, a mimic's chest."""
    size = lambda v: max(float(np.ptp(v, axis=0).max()), 1e-6)
    edge = np.ptp(verts[tris], axis=1).max(axis=1)
    ok = edge < 0.5 * size(verts) + 1.0
    if not ok.all():
        ok &= edge < 0.5 * size(verts[np.unique(tris[ok])]) + 1.0
    return ok


class Characters:
    def __init__(self, zone=None, archive=None):
        """zone: reads Everquest/<zone>_chr.s3d; archive: any character .s3d path."""
        self.files = read_archive(archive or need(f"{zone}_chr.s3d"))
        self.frame = 0                    # animation frame used for posing (-1 = last)
        self.anim_source = None           # borrow animations from another race code (EQ shares them)
        self.armor = None                 # classic armor material: 1 leather, 2 chain, 3 plate, ...
        self.variant = None               # NPC texture set (a dragon's colour): every part, the head too
        self.anim_archive = None          # Characters holding anim_source's tracks (default: this one)
        self.seated = False               # a kart driver: this model's own standing pose, seated (_seat)
        self.wld = Wld(next(v for k, v in self.files.items() if k.endswith(".wld")))
        self._tex = {}
        self._track_index = {n: i + 1 for i, (t, n, _) in enumerate(self.wld.fragments) if t == 0x13}

    def names(self):
        return [n.replace("_HS_DEF", "") for n, _ in self.wld.of_type(0x10)]

    def _frag(self, i):
        return self.wld.fragments[i - 1]

    def _raw_frames(self, track_ref):
        _, _, tr = self._frag(track_ref)                     # 0x13 -> 0x12
        _, _, d = self._frag(struct.unpack_from("<I", tr, 0)[0])
        count = struct.unpack_from("<I", d, 4)[0]
        return [struct.unpack_from("<8h", d, 8 + 16 * f) for f in range(count)]

    def _donor(self, track_ref, anim):
        """(archive, animated track, length scale): a borrowed animation keeps this model's own
        bone lengths - the donor's translations are rescaled to them - so limbs stay attached.
        The donor can live in another archive (`anim_archive`), e.g. an NPC sitting like an elf."""
        name = self._frag(track_ref)[1]
        src = self.anim_archive or self
        scale = 1.0
        if self.anim_source and name.startswith(self._code):
            donor = self.anim_source + name[len(self._code):]
            rest_d = src._track_index.get(donor)
            if rest_d:
                own = np.array(self._raw_frames(track_ref)[0][4:7], float)
                don = np.array(src._raw_frames(rest_d)[0][4:7], float)
                od, dd = np.linalg.norm(own), np.linalg.norm(don)
                scale = od / dd if dd > 1e-6 else 1.0
            name = donor
        else:
            src = self
        alt = src._track_index.get(anim + name) or src._track_index.get(anim + "A" + name)
        return src, alt, scale

    def _bone_transform(self, track_ref, anim=None):
        scale, src = 1.0, self
        if anim:                                             # e.g. P01 = idle, frame 0
            arch, alt, scale = self._donor(track_ref, anim)
            if alt:
                track_ref, src = alt, arch
            else:
                scale = 1.0
        frames = src._raw_frames(track_ref)
        f = (len(frames) - 1 if self.frame == -1 else min(self.frame, len(frames) - 1)) if anim else 0
        rw, rx, ry, rz, sx, sy, sz, sd = frames[f]
        m = np.eye(4)
        m[:3, :3] = _quat_matrix(rw, rx, ry, rz)
        m[:3, 3] = np.array([sx, sy, sz]) / float(sd if sd else 256) * scale
        return m

    def track_frames(self, track_ref, anim=None):
        """All frames of a bone's track for `anim` (None = rest): list of (quat xyzw, translation)."""
        scale, src = 1.0, self
        if anim:
            arch, alt, scale = self._donor(track_ref, anim)
            if not alt:
                return None
            track_ref, src = alt, arch
        out = []
        for rw, rx, ry, rz, sx, sy, sz, sd in src._raw_frames(track_ref):
            q = np.array([rx, ry, rz, rw], float)
            q /= np.linalg.norm(q) or 1.0
            out.append((q, np.array([sx, sy, sz]) / float(sd if sd else 256) * scale))
        return out

    # a kart driver's pose: where each limb points, in the body's own frame (EQ model: +x ahead,
    # +y to its left, +z up; "out" = to that limb's side). Knees up, as a kart driver sits: thighs
    # ahead and raised, shins ahead and down (the legs are solved so the feet land on the kart's
    # floor, inside it - see _seat; these directions are the fallback), upper arms down and a
    # little ahead, forearms ahead to the hands. Aiming each limb (rather than bending it by a set
    # angle) seats any stance the same way: idle, A-pose or arms-out T-pose.
    SEAT = (("TH_", (1.0, 0.1, 0.34)), ("CA_", (0.78, 0.03, -0.62)),
            ("BI_", (0.32, 0.2, -0.93)), ("FO_", (0.93, -0.12, -0.2)))

    def _seat(self, name, bones, world):
        """Seat a standing pose as a kart driver (SEAT). Working from the model's own stance keeps
        its head, face and hands exactly as EverQuest draws them standing."""
        def subtree(i):
            out, todo = [], [i]
            while todo:
                j = todo.pop()
                out.append(j)
                todo += list(bones[j][1])
            return out

        def aim(i, target, child=None):
            """Turn bone i (and everything below it) about its joint so that it (towards `child`,
            by default its first) points along target."""
            kids = [c for c in bones[i][1] if "POINT" not in sfx[c]]
            if child is None and not kids:
                return
            p = world[i][:3, 3].copy()
            d = world[kids[0] if child is None else child][:3, 3] - p
            if np.linalg.norm(d) < 1e-6:
                return
            d /= np.linalg.norm(d)
            t = np.array(target, float)
            t /= np.linalg.norm(t)
            axis = np.cross(d, t)
            sin, cos = np.linalg.norm(axis), float(np.dot(d, t))
            if sin < 1e-6:
                return
            k = axis / sin
            K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
            r = np.eye(4)
            r[:3, :3] = np.eye(3) + sin * K + (1 - cos) * (K @ K)    # Rodrigues: d -> t
            t0, t1 = np.eye(4), np.eye(4)
            t0[:3, 3], t1[:3, 3] = -p, p
            m = t1 @ r @ t0
            for j in subtree(i):
                world[j] = m @ world[j]

        sfx = [self._frag(track)[1][len(name):] for track, _ in bones]
        find = lambda key: next((i for i in range(len(bones)) if sfx[i].split("_")[0] == key), None)
        kid = lambda i: next((c for c in bones[i][1] if "POINT" not in sfx[c]), None)
        hand_of = lambda fo: kid(fo)                  # the forearm's first child: the hand (FI_)
        pe, ch, ne, he = find("PE"), find("CH"), find("NE"), find("HE")
        head0 = world[he][:3, :3].copy() if he is not None else None      # how the head is held, standing
        # sit up straight: the spine upright (a hunched or crouching stance too), a little forward lean
        if pe is not None and ch is not None:
            aim(pe, (0.05, 0.0, 1.0), child=ch)
        if ch is not None and ne is not None:
            aim(ch, (0.12, 0.0, 1.0), child=ne)
        if ne is not None and he is not None:
            aim(ne, (0.06, 0.0, 1.0), child=he)
        if head0 is not None:                        # the head held as it was standing: face ahead, level
            r = np.eye(4)
            r[:3, :3] = head0 @ np.linalg.inv(world[he][:3, :3])
            p0 = world[he][:3, 3].copy()
            t0, t1 = np.eye(4), np.eye(4)
            t0[:3, 3], t1[:3, 3] = -p0, p0
            m = t1 @ r @ t0
            for j in subtree(he):
                world[j] = m @ world[j]
        # the body above the hips, sitting up (the game sizes a driver by it)
        torso = (world[he][2, 3] - world[pe][2, 3]) * 1.3 if pe is not None and he is not None else None
        for prefix, (fx, fy, fz) in self.SEAT:
            for i in range(len(bones)):
                if not sfx[i].startswith(prefix) or "POINT" in sfx[i]:
                    continue
                side = 1 if "_L" in sfx[i] else -1 if "_R" in sfx[i] else 0
                knee = kid(i) if prefix == "TH_" else None
                foot = kid(knee) if knee is not None else None
                if prefix == "CA_" and torso and foot is not None:
                    continue                             # (placed with its thigh, below)
                if prefix == "FO_" and torso and hand_of(i) is not None:
                    continue                             # (placed with its upper arm, below)
                if prefix == "BI_" and torso and kid(i) is not None and hand_of(kid(i)) is not None:
                    # the arm as a two-joint chain: the hands on the steering wheel's rim, in front of
                    # the chest, elbows out and down (the game puts the wheel where the hands are)
                    elbow = kid(i)
                    S_ = world[i][:3, 3].copy()
                    A = np.linalg.norm(world[elbow][:3, 3] - S_)
                    B = np.linalg.norm(world[hand_of(elbow)][:3, 3] - world[elbow][:3, 3])
                    hip = world[pe][:3, 3]
                    Ht = hip + np.array([0.6 * torso, side * 0.16 * torso, 0.42 * torso])
                    d = Ht - S_
                    dist = min(np.linalg.norm(d), A + B - 1e-6)
                    u = d / (np.linalg.norm(d) or 1.0)
                    a_ = (A * A - B * B + dist * dist) / (2 * dist)
                    h = np.sqrt(max(A * A - a_ * a_, 0.0))
                    pole = np.array([0.0, side * 0.8, -1.0])
                    pole -= u * np.dot(pole, u)
                    pole /= np.linalg.norm(pole) or 1.0
                    E = S_ + u * a_ + pole * h
                    aim(i, E - S_)
                    aim(elbow, (S_ + u * dist) - world[elbow][:3, 3])
                    continue
                if prefix == "TH_" and torso and foot is not None:
                    # the leg as a two-joint chain: the foot on the kart's floor, a set share of the
                    # body below the hips and no further ahead than the hull is wide there; the
                    # knee rises as high as it must (long legs fold, short ones stay near straight)
                    H = world[i][:3, 3].copy()
                    T = np.linalg.norm(world[knee][:3, 3] - H)
                    L = np.linalg.norm(world[foot][:3, 3] - world[knee][:3, 3])
                    drop = 0.17 * torso                  # (the seat is low in the tub: legs stretched ahead)
                    reach = min(1.32 * torso, 0.95 * np.sqrt(max((T + L) ** 2 - drop ** 2, 0.0)))
                    F = H + np.array([reach, side * 0.05 * T, -drop])
                    d = F - H
                    dist = min(np.linalg.norm(d), T + L - 1e-6)
                    u = d / np.linalg.norm(d)
                    a_ = (T * T - L * L + dist * dist) / (2 * dist)
                    h = np.sqrt(max(T * T - a_ * a_, 0.0))
                    up = np.array([0.0, 0.0, 1.0]) - u * u[2]
                    up /= np.linalg.norm(up) or 1.0
                    K = H + u * a_ + up * h + np.array([0.0, side * fy * T, 0.0])
                    aim(i, K - H)
                    aim(knee, F - world[knee][:3, 3])
                    continue
                aim(i, (fx, fy * side, fz))

    def anims_of(self, code):
        """Animation codes (P01, L01 ...) that exist for a model code."""
        import re
        found = set()
        for n in self._track_index:
            m = re.match(r"([A-Z]\d\d)A?([A-Z]{3})", n)
            if m and m.group(2) == code:
                found.add(m.group(1))
        return found

    def texture(self, name):
        if name not in self._tex:
            data = self.files.get(name)
            self._tex[name] = (np.asarray(open_image(data).convert("RGB"), float)
                               if data else None)
        return self._tex[name]

    def skin(self, tex):
        """Classic armor: <race><part>00<variant>.bmp -> the chosen material if it exists."""
        import re
        if self.variant:
            m = re.match(r"([a-z]{3})(ch|fa|ft|hn|lg|ua|he)00(\d\d)\.bmp$", tex or "")
            alt = m and f"{m.group(1)}{m.group(2)}{self.variant:02d}{m.group(3)}.bmp"
            return alt if alt and alt in self.files else tex
        m = re.match(r"([a-z]{3})(ch|fa|ft|hn|lg|ua)00(\d\d)\.bmp$", tex or "")
        if m and self.armor:
            alt = f"{m.group(1)}{m.group(2)}{self.armor:02d}{m.group(3)}.bmp"
            if alt in self.files:
                return alt
        return tex

    def model(self, name, anim="P01", guard=True):
        self._code = name
        """Posed model: verts (N,3), uv (N,2), tris (M,3), tri_tex (list of texture arrays/None)."""
        b = next(b for n, b in self.wld.of_type(0x10) if n == f"{name}_HS_DEF")
        flags, n_bones = struct.unpack_from("<II", b, 0)
        pos = 12 + (12 if flags & 1 else 0) + (4 if flags & 2 else 0)
        bones = []
        for _ in range(n_bones):
            _, _, track, _mesh, n_child = struct.unpack_from("<iIIII", b, pos)
            children = struct.unpack_from(f"<{n_child}I", b, pos + 20)
            bones.append((track, children))
            pos += 20 + 4 * n_child
        world = [None] * n_bones
        parents = [-1] * n_bones

        def walk(i, parent):
            world[i] = parent @ self._bone_transform(bones[i][0], anim)
            for c in bones[i][1]:
                parents[c] = i
                walk(c, world[i])
        frame0 = self.frame
        if self.seated:                              # the standing pose (own, or the shared set's), first frame
            anim, self.frame = "P01", 0
        walk(0, np.eye(4))
        self.frame = frame0
        if self.seated:
            self._seat(name, bones, world)
        self.last_skeleton = {"tracks": [b[0] for b in bones], "parents": parents, "world": world}
        joints = []

        mesh_names = {f"{name}_DMSPRITEDEF", f"{name}HE00_DMSPRITEDEF",
                      f"{name}EYE_L_DMSPRITEDEF", f"{name}EYE_R_DMSPRITEDEF"}
        verts, uvs, tris, tri_tex, base = [], [], [], [], 0
        self.last_materials = []          # per triangle: (texture name or None, render mode)
        for m in self.wld.meshes(skinned=True):
            if m["name"] not in mesh_names:
                continue
            v = m["verts"].copy()
            i = 0
            jv = np.zeros(len(v), np.int32)
            for count, bone in m["vertex_pieces"]:
                w = world[bone] if bone < n_bones else np.eye(4)
                v[i:i + count] = v[i:i + count] @ w[:3, :3].T + w[:3, 3]
                jv[i:i + count] = bone if bone < n_bones else 0
                i += count
            joints.append(jv)
            mats = self.wld.material_list(m["material_list"])
            for t, mi in zip(m["tris"], m["tri_material"]):
                mat = mats[mi] if mi < len(mats) else None
                tname = self.skin(mat["texture"]) if mat else None
                tri_tex.append(self.texture(tname) if mat and mat["visible"] and tname else None)
                self.last_materials.append((tname if mat and mat["visible"] else None,
                                            mat["render"] & 0xFF if mat else 0))
                tris.append(t + base)
            verts.append(v)
            uvs.append(m["uv"] if len(m["uv"]) == len(v) else np.zeros((len(v), 2)))
            base += len(v)
        verts, uvs, tris = np.concatenate(verts), np.concatenate(uvs), np.array(tris)
        self.last_joints = np.concatenate(joints)
        ok = keep_faces(verts, tris) if guard else np.ones(len(tris), bool)
        tri_tex = [x for x, k in zip(tri_tex, ok) if k]
        self.last_materials = [x for x, k in zip(self.last_materials, ok) if k]
        return verts, uvs, tris[ok], tri_tex

    def render(self, name, yaw_deg=0.0, height_px=128, pitch_deg=8.0, anim="P01"):
        """Orthographic sprite, RGBA uint8. yaw 0 looks at the model's front.
        anim: animation whose first frame poses the model (P01 = idle); base pose if absent."""
        verts, uv, tris, tri_tex = self.model(name, anim)
        used, inv = np.unique(tris.ravel(), return_inverse=True)   # only vertices that are drawn
        verts, uv, tris = verts[used], uv[used], inv.reshape(-1, 3)
        a, p = np.radians(yaw_deg), np.radians(pitch_deg)
        # EQ models: +x forward, +y left, +z up. Camera in front, looking back along -x.
        rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        v = verts @ rz.T
        sx, sy, depth = -v[:, 1], -(v[:, 2] * np.cos(p) + v[:, 0] * np.sin(p)), v[:, 0] * np.cos(p) - v[:, 2] * np.sin(p)
        scale = (height_px - 2) / max(sy.max() - sy.min(), 1e-6)
        width = int(np.ceil((sx.max() - sx.min()) * scale)) + 2
        px = np.stack([(sx - sx.min()) * scale + 1, (sy - sy.min()) * scale + 1], axis=1)
        ss = 3
        W, H = width * ss, height_px * ss
        rgb = np.zeros((H, W, 3), np.float32)
        zbuf = np.full((H, W), -np.inf, np.float32)
        hit = np.zeros((H, W), bool)
        pp = px * ss
        n = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        shade = 0.55 + 0.45 * np.abs(n @ np.array([0.6, 0.3, 0.74]))     # soft top/front light
        for t in range(len(tris)):
            tex = tri_tex[t]
            if tex is None:
                continue
            i0, i1, i2 = tris[t]
            A, B, C = pp[i0], pp[i1], pp[i2]
            x0, x1 = max(int(min(A[0], B[0], C[0])), 0), min(int(max(A[0], B[0], C[0])) + 2, W)
            y0, y1 = max(int(min(A[1], B[1], C[1])), 0), min(int(max(A[1], B[1], C[1])) + 2, H)
            den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
            if x1 <= x0 or y1 <= y0 or abs(den) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            w0 = ((B[1] - C[1]) * (gx - C[0]) + (C[0] - B[0]) * (gy - C[1])) / den
            w1 = ((C[1] - A[1]) * (gx - C[0]) + (A[0] - C[0]) * (gy - C[1])) / den
            w2 = 1 - w0 - w1
            z = w0 * depth[i0] + w1 * depth[i1] + w2 * depth[i2]
            ins = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4) & (z > zbuf[y0:y1, x0:x1])
            if not ins.any():
                continue
            u = w0 * uv[i0, 0] + w1 * uv[i1, 0] + w2 * uv[i2, 0]
            vv = w0 * uv[i0, 1] + w1 * uv[i1, 1] + w2 * uv[i2, 1]
            th, tw = tex.shape[:2]
            col = tex[np.floor(-vv * th).astype(int) % th, np.floor(u * tw).astype(int) % tw] * shade[t]
            rgb[y0:y1, x0:x1][ins] = col[ins]
            zbuf[y0:y1, x0:x1][ins] = z[ins]
            hit[y0:y1, x0:x1][ins] = True
        rgb = rgb.reshape(height_px, ss, width, ss, 3).mean(axis=(1, 3))
        cov = hit.reshape(height_px, ss, width, ss).mean(axis=(1, 3))
        rgb = np.where(cov[..., None] > 0, rgb / np.maximum(cov[..., None], 1e-6), 0)
        return np.dstack([np.clip(rgb, 0, 255), (cov > 0.5) * 255]).astype(np.uint8)


if __name__ == "__main__":
    cmd, zone = sys.argv[1], sys.argv[2]
    ch = Characters(zone)
    if cmd == "list":
        print(" ".join(ch.names()))
    else:
        yaw = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
        h = int(sys.argv[6]) if len(sys.argv) > 6 else 128
        Image.fromarray(ch.render(sys.argv[3], yaw, h), "RGBA").save(sys.argv[4])
