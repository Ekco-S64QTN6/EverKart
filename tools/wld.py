"""Minimal reader for the parts of EverQuest .wld files we need for track design:
world meshes (fragment 0x36), texture names (0x03) and object placements (0x15).

Fragment layouts follow the LanternExtractor documentation. This is deliberately
not a full WLD parser.
"""
import struct

import numpy as np

WLD_MAGIC = 0x54503D02
OLD_VERSION = 0x00015500
HASH_KEY = bytes([0x95, 0x3A, 0xC5, 0x2A, 0x95, 0x7A, 0x95, 0x6A])


class Wld:
    def __init__(self, data):
        magic, version, frag_count, _, _, hash_size, _ = struct.unpack_from("<7I", data, 0)
        if magic != WLD_MAGIC:
            raise ValueError("not a WLD file")
        self.old = version == OLD_VERSION
        raw = np.frombuffer(data, np.uint8, hash_size, 28)
        key = np.resize(np.frombuffer(HASH_KEY, np.uint8), hash_size)
        self.strings = (raw ^ key).tobytes()
        self.fragments = []  # (type, name, body) - body starts after the name ref
        pos = 28 + hash_size
        for _ in range(frag_count):
            size, ftype, name_ref = struct.unpack_from("<IIi", data, pos)
            self.fragments.append((ftype, self.string(name_ref), data[pos + 12:pos + 8 + size]))
            pos += 8 + size

    def string(self, ref):
        if ref >= 0 or -ref >= len(self.strings):
            return ""  # unnamed fragment (some store a non-string value here)
        end = self.strings.find(b"\0", -ref)
        if end < 0:
            end = len(self.strings)
        return self.strings[-ref:end].decode("latin-1")

    def of_type(self, ftype):
        return [(n, b) for t, n, b in self.fragments if t == ftype]

    def meshes(self, skinned=False):
        """Yield dicts: name, verts (N,3 float), normals (N,3), tris (M,3), solid (M,) bool,
        tri_material (M,) index into the mesh's material list."""
        by_index = {}
        for index, (ftype, name, b) in enumerate(self.fragments, 1):
            if ftype != 0x36:
                continue
            cx, cy, cz = struct.unpack_from("<3f", b, 20)
            (n_vert, n_tex, n_norm, n_col, n_poly, n_vpiece, n_ptex, n_vtex, _size9,
             scale) = struct.unpack_from("<9Hh", b, 72)
            pos = 92
            verts = np.frombuffer(b, "<i2", n_vert * 3, pos).reshape(-1, 3) / float(1 << scale)
            verts = verts + np.array([cx, cy, cz])
            pos += n_vert * 6
            if self.old:
                uv = np.frombuffer(b, "<i2", n_tex * 2, pos).reshape(-1, 2) / 256.0
            else:
                uv = np.frombuffer(b, "<f4", n_tex * 2, pos).reshape(-1, 2).astype(float)
            uv = uv * np.array([1.0, -1.0])        # EQ's v runs down the bitmap: faces, signs and
            pos += n_tex * (4 if self.old else 8)   # banners were upside down before this
            normals = np.frombuffer(b, "i1", n_norm * 3, pos).reshape(-1, 3) / 127.0
            pos += n_norm * 3
            colors = np.frombuffer(b, np.uint8, n_col * 4, pos).reshape(-1, 4)   # BGRA baked light
            pos += n_col * 4
            polys = np.frombuffer(b, "<u2", n_poly * 4, pos).reshape(-1, 4)
            pos += n_poly * 8
            pieces = np.frombuffer(b, "<u2", n_vpiece * 2, pos).reshape(-1, 2)  # (count, bone)
            pos += n_vpiece * 4
            groups = np.frombuffer(b, "<u2", n_ptex * 2, pos).reshape(-1, 2)
            tri_material = np.repeat(groups[:, 1], groups[:, 0]) if n_ptex else np.zeros(n_poly, int)
            by_index[index] = mesh = {
                "name": name,
                "verts": verts,
                "normals": normals,
                "colors": colors[:, [2, 1, 0, 3]],                           # -> RGBA
                "uv": uv,
                "material_list": struct.unpack_from("<I", b, 4)[0],  # 1-based fragment index
                "tris": polys[:, 1:4].astype(np.int64),
                "solid": (polys[:, 0] & 0x10) == 0,
                "tri_material": tri_material[:n_poly],
                "vertex_pieces": pieces if skinned else None,
            }
            yield mesh
        if not skinned:
            yield from self._actor_meshes(by_index)

    def _actor_meshes(self, by_index):
        """Placed objects that are small skeletons with a mesh per bone (trees that sway:
        a trunk and branches), assembled in their rest pose into one static mesh named like
        any other object's, so they are placed the same way."""
        def rest(track_ref):
            _, _, tr = self.fragments[track_ref - 1]                 # 0x13 -> 0x12
            _, _, d = self.fragments[struct.unpack_from("<I", tr, 0)[0] - 1]
            rw, rx, ry, rz, sx, sy, sz, sd = struct.unpack_from("<8h", d, 8)
            n = np.sqrt(float(rw * rw + rx * rx + ry * ry + rz * rz)) or 1.0
            w, x, y, z = rw / n, rx / n, ry / n, rz / n
            m = np.eye(4)
            m[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
            m[:3, 3] = np.array([sx, sy, sz]) / float(sd if sd else 256)
            return m

        for name, b in self.of_type(0x10):
            flags, n_bones = struct.unpack_from("<II", b, 0)
            pos = 12 + (12 if flags & 1 else 0) + (4 if flags & 2 else 0)
            bones = []
            for _ in range(n_bones):
                _, _, track, mesh_ref, n_child = struct.unpack_from("<iIIII", b, pos)
                bones.append((track, mesh_ref, struct.unpack_from(f"<{n_child}I", b, pos + 20)))
                pos += 20 + 4 * n_child
            world = [None] * n_bones

            def walk(i, parent):
                world[i] = parent @ rest(bones[i][0])
                for c in bones[i][2]:
                    walk(c, world[i])
            try:
                walk(0, np.eye(4))
            except (struct.error, IndexError, RecursionError):
                continue
            parts = []
            for i, (_, mesh_ref, _) in enumerate(bones):
                if not mesh_ref:
                    continue
                ftype, _, body = self.fragments[mesh_ref - 1]
                m = by_index.get(struct.unpack_from("<I", body, 0)[0]) if ftype == 0x2D else by_index.get(mesh_ref)
                if m is not None and len(m["tris"]):
                    parts.append((world[i], m))
            if not parts or len({m["material_list"] for _, m in parts}) != 1:
                continue                                    # no per-bone meshes: a skinned character
            verts, normals, colors, uv, tris, solid, tri_material, base = [], [], [], [], [], [], [], 0
            for w, m in parts:
                v = m["verts"] @ w[:3, :3].T + w[:3, 3]
                verts.append(v)
                normals.append(m["normals"] @ w[:3, :3].T if len(m["normals"]) == len(v) else np.zeros((len(v), 3)))
                uv.append(m["uv"] if len(m["uv"]) == len(v) else np.zeros((len(v), 2)))
                colors.append(m["colors"] if len(m["colors"]) == len(v) else np.full((len(v), 4), [128, 128, 128, 255], np.uint8))
                tris.append(m["tris"] + base)
                solid.append(m["solid"])
                tri_material.append(m["tri_material"])
                base += len(v)
            yield {
                "name": name.replace("_HS_DEF", "_DMSPRITEDEF"),
                "verts": np.concatenate(verts), "normals": np.concatenate(normals),
                "colors": np.concatenate(colors), "uv": np.concatenate(uv),
                "material_list": parts[0][1]["material_list"],
                "tris": np.concatenate(tris), "solid": np.concatenate(solid),
                "tri_material": np.concatenate(tri_material), "vertex_pieces": None,
            }

    def material_list(self, frag_index):
        """Materials of a 0x31 list: [{name, texture (bitmap filename or None), render}]."""
        def frag(i):
            return self.fragments[i - 1]
        _, _, b = frag(frag_index)
        (count,) = struct.unpack_from("<I", b, 4)
        out = []
        for ref in struct.unpack_from(f"<{count}I", b, 8):
            _, name, m = frag(ref)
            render, = struct.unpack_from("<I", m, 4)
            info_ref, = struct.unpack_from("<I", m, 20)
            texture = None
            if info_ref:
                _, _, r5 = frag(info_ref)
                _, _, r4 = frag(struct.unpack_from("<I", r5, 0)[0])
                flags, n_bmp = struct.unpack_from("<II", r4, 0)
                refs = struct.unpack_from(f"<{n_bmp}I", r4, len(r4) - 4 * n_bmp)
                frames = [self._bitmap_names(frag(r)[2])[0] for r in refs]
                texture = frames[0]
                # animated (fire, water, lava): several frames, `sleep` ms each (0x04's flags bit 3)
                sleep = 0
                if n_bmp > 1 and flags & 0x08:
                    sleep, = struct.unpack_from("<I", r4, 8 + (4 if flags & 0x04 else 0))
            # render 0 = invisible boundary; low bits pick opaque / masked / translucent
            out.append({"name": name.replace("_MDF", ""), "texture": texture,
                        "frames": frames if info_ref and len(frames) > 1 else None,
                        "sleep": sleep if info_ref else 0,
                        "render": render & 0x7FFFFFFF, "visible": render != 0})
        return out

    def _bitmap_names(self, b):
        (count,) = struct.unpack_from("<I", b, 0)
        pos, names = 4, []
        for _ in range(count + 1):
            if pos + 2 > len(b):
                break
            (n,) = struct.unpack_from("<H", b, pos)
            pos += 2
            enc = np.frombuffer(b, np.uint8, n, pos)
            key = np.resize(np.frombuffer(HASH_KEY, np.uint8), n)
            names.append((enc ^ key).tobytes().rstrip(b"\0").decode("latin-1").lower())
            pos += n
        return names

    def texture_names(self):
        """Bitmap filenames referenced by the zone (fragment 0x03)."""
        names = []
        for _, b in self.of_type(0x03):
            (count,) = struct.unpack_from("<I", b, 0)
            pos = 4
            for _ in range(count + 1):  # stored count is one less than actual
                if pos + 2 > len(b):
                    break
                (n,) = struct.unpack_from("<H", b, pos)
                pos += 2
                enc = np.frombuffer(b, np.uint8, n, pos)
                key = np.resize(np.frombuffer(HASH_KEY, np.uint8), n)
                names.append((enc ^ key).tobytes().rstrip(b"\0").decode("latin-1").lower())
                pos += n
        return names

    def placements(self):
        """Object instances (fragment 0x15): name, x, y, z, heading (0-512 units)."""
        out = []
        for _, b in self.of_type(0x15):
            ref, _flags, _sphere = struct.unpack_from("<iII", b, 0)
            x, y, z, rot_z, _rot_y, _rot_x = struct.unpack_from("<6f", b, 12)
            scale = struct.unpack_from("<f", b, 44)[0] if len(b) >= 48 else 1.0
            out.append({"name": self.string(ref).replace("_ACTORDEF", ""),
                        "x": x, "y": y, "z": z, "heading": rot_z,
                        "scale": scale if 0.01 < scale < 100 else 1.0})
        return out
