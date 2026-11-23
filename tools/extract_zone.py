"""Extract a zone's world geometry + metadata from Everquest/ into work/zones/<zone>/.

    python3 tools/extract_zone.py kael

Writes:
    mesh.npz        verts, uv, tris, tri_normal_z, tri_solid, tri_material (merged world mesh)
    textures/*.png  every zone texture
    materials.json  material index -> texture file, render mode
    mesh.obj        same mesh for viewing in Blender/MeshLab
    meta.json       bounds, counts, texture names, materials
    objects.json    object placements from objects.wld
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402
from s3d import read_archive  # noqa: E402
from wld import Wld  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def extract_objects(archive, placements, out):
    """Write objects_mesh.npz + objects_materials.json: every placement's static mesh,
    rotated, scaled and moved into world coordinates. Animated (skeletal) objects are skipped."""
    import io
    from PIL import Image
    files = read_archive(archive)
    w = Wld(next(v for k, v in files.items() if k.endswith(".wld")))
    meshes = {m["name"].replace("_DMSPRITEDEF", ""): m for m in w.meshes()}
    materials, mat_base, shapes = [], {}, {}
    for name, m in meshes.items():
        if len(m["tris"]) == 0:
            continue
        mats = w.material_list(m["material_list"])
        mat_base[name] = len(materials)
        materials += mats
        nz = (m["normals"][m["tris"]][:, :, 2].mean(axis=1) if len(m["normals"]) == len(m["verts"])
              else np.zeros(len(m["tris"])))
        shapes[name] = (m["verts"], m["uv"] if len(m["uv"]) == len(m["verts"]) else np.zeros((len(m["verts"]), 2)),
                        m["tris"], nz, m["tri_material"])
    verts, uvs, tris, nzs, tmat, bases, inst, base, missing = [], [], [], [], [], [], [], 0, set()
    for p in placements:
        if p["name"] not in shapes:
            missing.add(p["name"])
            continue
        v, uv, t, nz, tm = shapes[p["name"]]
        a = np.radians(p["heading"] / 512 * 360)
        rot = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        verts.append(v @ rot.T * p["scale"] + [p["x"], p["y"], p["z"]])
        uvs.append(uv)
        tris.append(t + base)
        nzs.append(nz)
        tmat.append(tm + mat_base[p["name"]])
        bases.append(np.full(len(t), p["z"], np.float32))
        inst.append(np.full(len(t), len(inst), np.int32))
        base += len(v)
    if not verts:
        return
    np.savez_compressed(out / "objects_mesh.npz", verts=np.concatenate(verts), uv=np.concatenate(uvs),
                        tris=np.concatenate(tris), tri_normal_z=np.concatenate(nzs),
                        tri_solid=np.ones(sum(len(t) for t in tris), bool), tri_material=np.concatenate(tmat),
                        tri_base_z=np.concatenate(bases), tri_instance=np.concatenate(inst))
    (out / "objects_materials.json").write_text(json.dumps(materials, indent=1))
    tex_dir = out / "textures"
    for fname, data in files.items():
        if fname.endswith((".bmp", ".dds")):
            try:
                Image.open(io.BytesIO(data)).convert("RGB").save(tex_dir / (fname.rsplit(".", 1)[0] + ".png"))
            except Exception as e:
                print(f"  texture {fname}: {e}")
    print(f"  objects: {len(verts)} placed, {sum(len(t) for t in tris)} triangles"
          + (f"; no static mesh for {sorted(missing)[:8]}" if missing else ""))


def main(zone):
    out = ROOT / "work" / "zones" / zone
    out.mkdir(parents=True, exist_ok=True)
    files = read_archive(need(f"{zone}.s3d"))
    wld = Wld(files[f"{zone}.wld"])

    verts, tris, nz, solid, mats, uvs = [], [], [], [], [], []
    base = 0
    materials = None
    for m in wld.meshes():
        v, t = m["verts"], m["tris"]
        if len(t) == 0:
            continue
        # per-triangle up-ness from the file's vertex normals (robust to winding)
        nz.append(m["normals"][t][:, :, 2].mean(axis=1) if len(m["normals"]) == len(v)
                  else np.zeros(len(t)))
        if materials is None:
            materials = wld.material_list(m["material_list"])
        uvs.append(m["uv"] if len(m["uv"]) == len(v) else np.zeros((len(v), 2)))
        verts.append(v)
        tris.append(t + base)
        solid.append(m["solid"])
        mats.append(m["tri_material"])
        base += len(v)
    verts = np.concatenate(verts)
    tris = np.concatenate(tris)
    nz = np.concatenate(nz)
    solid = np.concatenate(solid)
    mats = np.concatenate(mats)

    uvs = np.concatenate(uvs)
    np.savez_compressed(out / "mesh.npz", verts=verts, tris=tris, tri_normal_z=nz,
                        tri_solid=solid, tri_material=mats, uv=uvs)

    # textures: every bitmap in the archive as PNG, plus the material table
    import io
    from PIL import Image
    tex_dir = out / "textures"
    tex_dir.mkdir(exist_ok=True)
    for fname, data in files.items():
        if fname.endswith((".bmp", ".dds")):
            try:
                Image.open(io.BytesIO(data)).convert("RGB").save(tex_dir / (fname.rsplit(".", 1)[0] + ".png"))
            except Exception as e:  # a few archives carry odd formats; skip, report
                print(f"  texture {fname}: {e}")
    (out / "materials.json").write_text(json.dumps(materials, indent=1))
    with open(out / "mesh.obj", "w") as f:
        f.write(f"# {zone} world geometry, EQ coords (z up)\n")
        np.savetxt(f, verts, fmt="v %.3f %.3f %.3f")
        np.savetxt(f, tris + 1, fmt="f %d %d %d")

    objects = []
    if "objects.wld" in files:
        objects = Wld(files["objects.wld"]).placements()
    (out / "objects.json").write_text(json.dumps(objects, indent=1))

    # placed objects (trees, braziers, torches, ...) as one world-space mesh
    obj_arc = eq(f"{zone}_obj.s3d")
    if obj_arc.exists() and objects:
        extract_objects(obj_arc, objects, out)

    meta = {
        "zone": zone,
        "wld_format": "old" if wld.old else "new",
        "vertices": int(len(verts)),
        "triangles": int(len(tris)),
        "solid_triangles": int(solid.sum()),
        "bounds_min": verts.min(axis=0).round(2).tolist(),
        "bounds_max": verts.max(axis=0).round(2).tolist(),
        "object_placements": len(objects),
        "textures": sorted(set(wld.texture_names())),
        "archive_files": len(files),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: v for k, v in meta.items() if k != "textures"}, indent=1))
    print(f"textures: {len(meta['textures'])}  e.g. {meta['textures'][:8]}")


if __name__ == "__main__":
    main(sys.argv[1])
