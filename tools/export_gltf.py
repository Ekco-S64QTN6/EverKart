"""Export an EQ zone (world mesh + placed objects) as a binary glTF for the 3D game.

    python3 tools/export_gltf.py kael

Writes game/public/zones/<zone>.glb with two top-level nodes:
    render     - textured triangles, one primitive per material, baked vertex lighting
                 in COLOR_0; masked materials use alpha-test, translucent ones blend
    collision  - plain triangles the karts drive on / bump into (passable polygons
                 and see-through foliage left out)

Axes: EQ is x east, y north, z up. glTF/three.js is y up, so (x, y, z) -> (x, z, -y),
which keeps handedness; EQ's triangle winding is flipped to face the right way.
"""
import io
import json
import re
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

# EQ material render modes (low bits) -> how we draw them
MASKED = {0x13, 0x14, 0x17}                 # palette index 0 is a hole (leaves, railings)
TRANSLUCENT = {0x05, 0x09, 0x0A, 0x0B}      # water, ice, glass, fire glow


def axes(v):
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)


def load_textures(archives):
    """bitmap name -> PIL image (as stored: paletted BMPs stay paletted)."""
    out = {}
    for files in archives:
        for name, data in files.items():
            if not name.endswith((".bmp", ".dds")) or name in out:
                continue
            try:
                out[name] = open_image(data)
            except Exception:
                continue
    return out


def bleed(rgba, passes=8):
    """Spread the colour of opaque pixels into the transparent ones next to them, so smooth
    filtering does not pull EQ's colour key (black, magenta) into the edges of leaves."""
    from scipy import ndimage
    out = rgba.astype(np.float32)
    solid = rgba[..., 3] > 0
    if solid.all() or not solid.any():
        return rgba
    filled = solid.copy()
    k = np.ones((3, 3), np.float32)
    for _ in range(passes):
        w = ndimage.convolve(filled.astype(np.float32), k, mode="wrap")
        grow = (~filled) & (w > 0)
        if not grow.any():
            break
        for c in range(3):
            sm = ndimage.convolve(out[..., c] * filled, k, mode="wrap")
            out[..., c] = np.where(grow, sm / np.maximum(w, 1e-6), out[..., c])
        filled |= grow
    res = rgba.copy()
    res[..., :3] = np.clip(out[..., :3], 0, 255).astype(np.uint8)
    return res


def encode(im, masked):
    """Masked materials: PNG with palette index 0 as a hole. Everything else: JPEG."""
    buf = io.BytesIO()
    if masked:
        rgba = np.asarray(im.convert("RGBA")).copy()
        if im.mode == "P":
            rgba[..., 3] = np.where(np.asarray(im) == 0, 0, 255)
        rgba = bleed(rgba)
        Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
        return buf.getvalue(), "image/png"
    im.convert("RGB").save(buf, "JPEG", quality=88)
    return buf.getvalue(), "image/jpeg"


class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.j = {"asset": {"version": "2.0", "generator": "EverKart export_gltf.py"},
                  "buffers": [], "bufferViews": [], "accessors": [], "meshes": [], "nodes": [],
                  "materials": [], "textures": [], "images": [], "samplers": [
                      # bilinear + trilinear mipmaps, as EQ's own renderer draws its textures
                      {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
                  "scenes": [{"nodes": []}], "scene": 0}
        self.tex_index = {}

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.j["bufferViews"].append(v)
        return len(self.j["bufferViews"]) - 1

    def accessor(self, arr, kind, normalized=False, target=34962):
        comp = {np.float32: 5126, np.uint32: 5125, np.uint16: 5123, np.uint8: 5121}[arr.dtype.type]
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": comp,
             "count": int(arr.shape[0]), "type": kind}
        if normalized:
            a["normalized"] = True
        if kind in ("VEC3", "SCALAR") and arr.dtype == np.float32 and target is None:
            a["min"] = np.atleast_1d(arr.min(axis=0)).tolist()
            a["max"] = np.atleast_1d(arr.max(axis=0)).tolist()
        elif kind == "VEC3" and arr.dtype == np.float32:
            a["min"] = arr.min(axis=0).tolist()
            a["max"] = arr.max(axis=0).tolist()
        self.j["accessors"].append(a)
        return len(self.j["accessors"]) - 1

    def texture(self, name, im, masked):
        key = (name, masked)
        if key not in self.tex_index:
            data, mime = encode(im, masked)
            self.j["images"].append({"bufferView": self.view(data), "mimeType": mime, "name": name})
            self.j["textures"].append({"sampler": 0, "source": len(self.j["images"]) - 1})
            self.tex_index[key] = len(self.j["textures"]) - 1
        return self.tex_index[key]

    def node(self, name, primitives, extras=None):
        self.j["meshes"].append({"name": name, "primitives": primitives})
        n = {"name": name, "mesh": len(self.j["meshes"]) - 1}
        if extras:
            n["extras"] = extras
        self.j["nodes"].append(n)
        self.j["scenes"][0]["nodes"].append(len(self.j["nodes"]) - 1)

    def save(self, path):
        self.j["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.j, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        bn = bytes(self.bin) + b"\0" * (-len(self.bin) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)))
            f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            f.write(struct.pack("<II", len(bn), 0x004E4942) + bn)


def gather(wld, placements=None, keep=None):
    """List of (verts, uv, colors, tris, tri_material_index into `materials`, solid) + materials."""
    meshes = {m["name"]: m for m in wld.meshes()}
    materials, mat_base, parts = [], {}, []

    def mats_of(m):
        key = m["material_list"]
        if key not in mat_base:
            mat_base[key] = len(materials)
            materials.extend(wld.material_list(key))
        return mat_base[key]

    if placements is None:
        for m in meshes.values():
            if len(m["tris"]):
                parts.append((m["verts"], m["uv"], m["colors"], m["tris"], m["tri_material"] + mats_of(m), m["solid"]))
        return parts, materials
    by_name = {k.replace("_DMSPRITEDEF", ""): v for k, v in meshes.items()}
    for p in placements:
        m = by_name.get(p["name"])
        if m is None or not len(m["tris"]):
            ROADS.setdefault("missing", {})[p["name"]] = ROADS.get("missing", {}).get(p["name"], 0) + 1
            continue
        a = np.radians(p["heading"] / 512 * 360)
        rot = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        v = m["verts"] @ rot.T * p["scale"] + [p["x"], p["y"], p["z"]]
        if keep is not None and not keep(p, v):
            continue
        if not keeps(p["name"]) and on_road(v):   # any part of it at kart height over a road
            ROADS["cleared"] += 1
            continue
        parts.append((v, m["uv"], np.zeros((0, 4), np.uint8), m["tris"], m["tri_material"] + mats_of(m),
                      m["solid"]))
    return parts, materials


ROADS = {"tracks": [], "cleared": 0, "keep": set()}


def load_roads(zone):
    """The exported tracks through this zone: (path xy, path z, half width)."""
    ROADS["tracks"], ROADS["cleared"], ROADS["missing"], ROADS["keep"] = [], 0, {}, set()
    for tf in (ROOT / "game" / "public" / "tracks").glob("*.json"):
        t = json.loads(tf.read_text())
        if t.get("zone") == f"{zone}.glb":
            cfg_file = ROOT / "tracks" / f"{t['name']}.json"
            if cfg_file.exists():                     # architecture the road passes through (door frames)
                ROADS["keep"] |= set(json.loads(cfg_file.read_text()).get("keep_objects", []))
            path = np.array(t["path"])
            ROADS["tracks"].append((np.stack([path[:, 0], -path[:, 2]], axis=1), path[:, 1], t["width"]))


# loose dressing the road may be cleared of (and the planner ignores): rocks, crates, braziers ...
CLUTTER = r"ROCK|STONE|BOULDER|CRATE|BARREL|BOX|STEAM|BRAZ|TORCH|COIN|BONE|SKULL|URN|VASE|CANDLE|BOOK|CHAIR|TABLE|RUG|JEWL|WAGON|CART"


def keeps(name):
    """Architecture (export_track.ARCHITECTURE) and the track's keep_objects stay, road or not."""
    import re
    from export_track import ARCHITECTURE
    return name in ROADS["keep"] or bool(re.search(ARCHITECTURE, name))


def on_road(v):
    """True when a placed object's geometry (not just its origin) stands on a road."""
    from scipy.spatial import cKDTree
    for pxy, pz, width in ROADS["tracks"]:
        tree = ROADS.setdefault(id(pxy), cKDTree(pxy))
        d, j = tree.query(v[:, :2])
        if np.any((d < width + 9) & (v[:, 2] > pz[j] - 2) & (v[:, 2] < pz[j] + 12)):   # the road, its rails and a kart's width beyond
            return True
    return False


def clear_road(zone, placements):
    """Remove trees / props standing on the road of any exported track in this zone."""
    keep = placements
    for tf in (ROOT / "game" / "public" / "tracks").glob("*.json"):
        t = json.loads(tf.read_text())
        if t.get("zone") != f"{zone}.glb":
            continue
        path = np.array(t["path"])
        pxy = np.stack([path[:, 0], -path[:, 2]], axis=1)
        clear = t["width"] + 7
        cfg_file = ROOT / "tracks" / f"{t['name']}.json"
        reach = json.loads(cfg_file.read_text()).get("object_reach") if cfg_file.exists() else None
        out, far = [], 0
        cfg_keep = set(json.loads(cfg_file.read_text()).get("keep_objects", [])) if cfg_file.exists() else set()
        for p in keep:
            if p["name"] in cfg_keep or keeps(p["name"]):
                out.append(p)
                continue
            d = np.hypot(pxy[:, 0] - p["x"], pxy[:, 1] - p["y"])
            j = int(np.argmin(d))
            if d[j] < clear and abs(p["z"] - path[j, 1]) < 40:
                continue
            if reach and d[j] > reach:                # dense zones: only dress what you can see
                far += 1
                continue
            out.append(p)
        print(f"  {len(keep) - len(out) - far} objects cleared off the {t['name']} road"
              + (f", {far} beyond {reach} units dropped" if far else ""))
        keep = out
    return keep


def save_planner(zone, parts, materials, textures, n_zone=None):
    """The route planner's triangles (planner.npz): the zone with every placed object, before any
    is cleared off a road - a route must not change because its own clearing opened a gap.
    tri_obj marks a placed object's triangles (the first n_zone parts are the zone itself): the
    road's bed never reshapes those, so the road's edges stop at them."""
    V, T, TM, SOLID, OBJ, base = [], [], [], [], [], 0
    for k, (v, _uv, _c, t, tm, s) in enumerate(parts):
        V.append(v); T.append(t + base); TM.append(tm); SOLID.append(s)
        OBJ.append(np.full(len(t), n_zone is not None and k >= n_zone))
        base += len(v)
    V, T, TM, SOLID, OBJ = (np.concatenate(V), np.concatenate(T), np.concatenate(TM), np.concatenate(SOLID),
                            np.concatenate(OBJ))
    collide = np.zeros(len(T), bool)
    for mi in np.unique(TM):
        mat = materials[mi] if mi < len(materials) else {"visible": False, "texture": None, "render": 0}
        sel = TM == mi
        if mat["visible"] and mat["texture"] and mat["texture"] in textures:
            collide[sel] = SOLID[sel] & ((mat["render"] & 0xFF) not in MASKED)
        else:
            collide[sel] = SOLID[sel]
    tex_names = sorted({str(m["texture"]) for m in materials})
    tri_tex = np.array([tex_names.index(str(materials[mi]["texture"])) if mi < len(materials) else -1
                        for mi in TM[collide]], np.int32)
    np.savez_compressed(ROOT / "work" / "zones" / zone / "planner.npz", verts=V.astype(np.float32),
                        tris=T[collide].astype(np.int32), tri_tex=tri_tex, tex_names=np.array(tex_names),
                        tri_obj=OBJ[collide])


def main(zone):
    zfiles = read_archive(need(f"{zone}.s3d"))
    wld = Wld(zfiles[f"{zone}.wld"])
    parts, materials = gather(wld)
    zparts, zmats = list(parts), list(materials)
    archives = [zfiles]
    planner = None
    obj_path = eq(f"{zone}_obj.s3d")
    if obj_path.exists():
        ofiles = read_archive(obj_path)
        owld = Wld(next(v for k, v in ofiles.items() if k.endswith(".wld")))
        placements = json.loads((ROOT / "work" / "zones" / zone / "objects.json").read_text())
        # the planner's zone: every object but low clutter (rocks, crates, braziers - cleared off a
        # road anyway); architecture and tall things (trees) stay in the way
        allparts, allmats = gather(owld, placements, keep=lambda p, v: keeps(p["name"]) or (
            v[:, 2].max() - v[:, 2].min() >= 12 and not re.search(CLUTTER, p["name"])))
        planner = (zparts + [(v, uv, c, t, tm + len(zmats), so) for v, uv, c, t, tm, so in allparts], zmats + allmats)
        load_roads(zone)
        placements = clear_road(zone, placements)
        oparts, omats = gather(owld, placements)
        if ROADS.get("missing"):                      # a zone without its trees is not the zone
            raise SystemExit(f"{zone}: placed objects with no model: {ROADS['missing']}")
        if ROADS["cleared"]:
            print(f"  {ROADS['cleared']} more objects overlapping a road removed")
        base = len(materials)
        parts += [(v, uv, c, t, tm + base, s) for v, uv, c, t, tm, s in oparts]
        materials += omats
        archives.append(ofiles)
    textures = load_textures(archives)
    save_planner(zone, *(planner or (zparts, zmats)), textures, n_zone=len(zparts))

    # merge everything, then split by material
    V, UV, C, T, TM, SOLID, base = [], [], [], [], [], [], 0
    for v, uv, c, t, tm, s in parts:
        V.append(v)
        UV.append(uv if len(uv) == len(v) else np.zeros((len(v), 2)))
        C.append(c if len(c) == len(v) else np.full((len(v), 4), [128, 128, 128, 255], np.uint8))
        T.append(t + base)
        TM.append(tm)
        SOLID.append(s)
        base += len(v)
    V, UV, C = np.concatenate(V), np.concatenate(UV), np.concatenate(C)
    T, TM, SOLID = np.concatenate(T), np.concatenate(TM), np.concatenate(SOLID)
    pos = axes(V).astype(np.float32)
    uv = np.stack([UV[:, 0], -UV[:, 1]], axis=1).astype(np.float32)
    col = C.copy()
    col[:, 3] = 255

    g = Gltf()
    prims = []
    collide = np.zeros(len(T), bool)
    for mi in np.unique(TM):
        mat = materials[mi] if mi < len(materials) else {"visible": False, "texture": None, "render": 0}
        sel = TM == mi
        mode = mat["render"] & 0xFF
        if mat["visible"] and mat["texture"] and mat["texture"] in textures:
            collide[sel] = SOLID[sel] & (mode not in MASKED)
        else:
            collide[sel] = SOLID[sel]                 # invisible walls still block
            continue
        tri = T[sel][:, [0, 2, 1]]                    # flip EQ winding
        used, inv = np.unique(tri.ravel(), return_inverse=True)
        m = {"name": mat["name"], "pbrMetallicRoughness": {
            "baseColorTexture": {"index": g.texture(mat["texture"], textures[mat["texture"]], mode in MASKED)},
            "metallicFactor": 0.0, "roughnessFactor": 1.0}, "extras": {"eqRender": mat["render"]}}
        frames = [f for f in (mat.get("frames") or []) if f in textures]
        if len(frames) > 1:                            # animated: fire, lava, water (the game cycles them)
            m["extras"]["eqFrames"] = [g.texture(f, textures[f], mode in MASKED) for f in frames]
            m["extras"]["eqSleep"] = mat.get("sleep") or 150
        if mode in MASKED:
            m.update(alphaMode="MASK", alphaCutoff=0.5, doubleSided=True)
        elif mode in TRANSLUCENT:
            m.update(alphaMode="BLEND", doubleSided=True)
            m["pbrMetallicRoughness"]["baseColorFactor"] = [1, 1, 1, 0.55]
        g.j["materials"].append(m)
        prims.append({"attributes": {
            "POSITION": g.accessor(pos[used], "VEC3"),
            "TEXCOORD_0": g.accessor(uv[used], "VEC2"),
            "COLOR_0": g.accessor(col[used], "VEC4", normalized=True)},
            "indices": g.accessor(inv.astype(np.uint32), "SCALAR", target=34963),
            "material": len(g.j["materials"]) - 1})
    g.node("render", prims)

    # same triangles for the route planner (EQ axes, EQ winding)
    tex_names = sorted({str(m["texture"]) for m in materials})
    tri_tex = np.array([tex_names.index(str(materials[mi]["texture"])) if mi < len(materials) else -1
                        for mi in TM[collide]], np.int32)
    np.savez_compressed(ROOT / "work" / "zones" / zone / "collision.npz", verts=V.astype(np.float32),
                        tris=T[collide].astype(np.int32), tri_tex=tri_tex, tex_names=np.array(tex_names))
    ct = T[collide][:, [0, 2, 1]]
    used, inv = np.unique(ct.ravel(), return_inverse=True)
    g.node("collision", [{"attributes": {"POSITION": g.accessor(pos[used], "VEC3")},
                          "indices": g.accessor(inv.astype(np.uint32), "SCALAR", target=34963)}],
           extras={"collision": True})
    out = ROOT / "game" / "public" / "zones"
    out.mkdir(parents=True, exist_ok=True)
    g.save(out / f"{zone}.glb")
    print(f"{zone}: {len(T)} triangles ({collide.sum()} collide), {len(prims)} materials, "
          f"{len(g.tex_index)} textures, {(out / f'{zone}.glb').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
