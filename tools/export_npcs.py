"""Export posed EQ NPC models as glTF for the 3D game.

    python3 tools/export_npcs.py veeshan kael gfaydark

For every NPC listed under "npcs3d" in tracks/<name>.json, writes
game/public/npcs/<zone>_<MODEL>.glb: the model in its idle pose (first frame of P01),
textured, in game axes (EQ model x forward, y left, z up -> game x, y up, -z), feet
at y = 0, facing -z (the game's "forward").
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from eqfiles import eq, need  # noqa: E402
from eq_chr import Characters  # noqa: E402
from export_gltf import MASKED, Gltf  # noqa: E402
from s3d import open_image, read_archive  # noqa: E402
from wld import Wld  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def export(zone, model, chars):
    verts, uv, tris, _ = chars.model(model)
    used, inv = np.unique(tris.ravel(), return_inverse=True)
    verts, uv, tris = verts[used], uv[used], inv.reshape(-1, 3)
    mats = chars.last_materials
    # model faces +x; turn it to face game -z: EQ (x, y, z) -> game (-y, z, -x)
    pos = np.stack([-verts[:, 1], verts[:, 2], -verts[:, 0]], axis=1).astype(np.float32)
    pos[:, 1] -= pos[:, 1].min()
    uvs = np.stack([uv[:, 0], -uv[:, 1]], axis=1).astype(np.float32)
    # smooth normals for lighting (the game lights characters; the zone has baked light)
    t = tris[:, [0, 2, 1]]
    fn = np.cross(pos[t[:, 1]] - pos[t[:, 0]], pos[t[:, 2]] - pos[t[:, 0]])
    normals = np.zeros_like(pos)
    for k in range(3):
        np.add.at(normals, t[:, k], fn)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-9
    normals = normals.astype(np.float32)
    g = Gltf()
    prims = []
    keys = sorted({m for m in mats if m[0]}, key=str)
    for tex, mode in keys:
        sel = np.array([m == (tex, mode) for m in mats])
        data = chars.files.get(tex)
        if data is None:
            continue
        import io
        from PIL import Image
        im = open_image(data)
        tri = tris[sel][:, [0, 2, 1]]
        used, inv = np.unique(tri.ravel(), return_inverse=True)
        mat = {"name": tex, "pbrMetallicRoughness": {"baseColorTexture": {"index": g.texture(tex, im, mode in MASKED)},
                                                     "metallicFactor": 0.0, "roughnessFactor": 1.0},
               "doubleSided": True}
        if mode in MASKED:
            mat.update(alphaMode="MASK", alphaCutoff=0.5)
        g.j["materials"].append(mat)
        prims.append({"attributes": {"POSITION": g.accessor(pos[used], "VEC3"),
                                     "NORMAL": g.accessor(normals[used], "VEC3"),
                                     "TEXCOORD_0": g.accessor(uvs[used], "VEC2")},
                      "indices": g.accessor(inv.astype(np.uint32), "SCALAR", target=34963),
                      "material": len(g.j["materials"]) - 1})
    extras = {"height": float(pos[:, 1].max())}
    sk = getattr(chars, "last_skeleton", None)       # a driver: its hips (it sits by them) and hands (the wheel goes there)
    if sk:
        game = lambda w: [float(-w[1, 3]), float(w[2, 3] - verts[:, 2].min()), float(-w[0, 3])]
        hands = []
        for i, t in enumerate(sk["tracks"]):
            sfx = chars._frag(t)[1][len(model):]
            if sfx.startswith("PE"):
                extras["hip"] = game(sk["world"][i])
            if re.fullmatch(r"FI_[LR](_TRACK)?", sfx):
                hands.append(game(sk["world"][i]))
        if len(hands) == 2:
            extras["hands"] = [(a + b) / 2 for a, b in zip(*hands)]
    g.node(model, prims, extras=extras)
    out = ROOT / "game" / "public" / "npcs"
    out.mkdir(parents=True, exist_ok=True)
    g.save(out / f"{zone}_{model}.glb")
    print(f"  {zone}_{model}: {len(tris)} tris, {pos[:, 1].max():.0f} units tall, "
          f"{(out / f'{zone}_{model}.glb').stat().st_size // 1024} KB")


def main(names):
    for name in names:
        cfg = json.loads((ROOT / "tracks" / f"{name}.json").read_text())
        chars = Characters(cfg["zone"])
        for npc in cfg.get("npcs3d", []):
            export(cfg["zone"], npc["model"], chars)





# ---------------------------------------------------------------------------------------
# Skinned + animated export
FRAME_S = 0.1                    # EQ animation frames run at ~10 per second
# EQ's animation codes: P01 stand, O01 idle fidget, P03 shuffle, L01 walk, L02 run;
# C01 kick, C02 1h weapon, C03 2h slash, C04 2h blunt, C05 throw (a monster's claw / tail),
# C06 offhand, C07 bash, C08 hand to hand, C09 archery, C10 a monster's bite, C11 round kick;
# T04 / T05 / T06 casting (T06: a dragon's breath), T07 flying kick, T08 rapid punches, T09 big punch
CLIPS = ["P01", "O01", "P03", "L01", "L02", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C10", "C11",
         "T04", "T05", "T06", "T07", "T08", "T09"]


def find_donor(chars, code, suffixes):
    """A model with animations whose bone tracks match ours (EQ shares animations)."""
    best, best_score = None, 0.0
    codes = {n[3:6] for n in chars._track_index if n[:3] in ("P01", "O01") and len(n) > 6}
    for c in sorted(codes):
        if c == code:
            continue
        hits = sum(1 for sfx in suffixes if f"P01{c}{sfx}" in chars._track_index or f"O01{c}{sfx}" in chars._track_index)
        score = hits / max(1, len(suffixes))
        if score > best_score:
            best, best_score = c, score
    return (best, best_score) if best_score >= 0.7 else (None, best_score)


def export_skinned(zone, model, chars, global_chars=None, donor=None, out_name=None):
    """game/public/npcs/<zone>_<model>.glb: skinned mesh + idle/walk clips."""
    chars.anim_source = None
    verts, uv, tris, _ = chars.model(model, None, guard=False)   # rest pose, every face (skinned: see keep_faces)
    joints = chars.last_joints
    sk = chars.last_skeleton
    mats = chars.last_materials
    used, inv = np.unique(tris.ravel(), return_inverse=True)
    verts, uv, joints, tris = verts[used], uv[used], joints[used], inv.reshape(-1, 3)
    names = [chars._frag(t)[1] for t in sk["tracks"]]
    suffixes = [n[len(model):] if n.startswith(model) else n for n in names]

    # which archive / model supplies the animations: a clip the model has of its own is its
    # own; one it lacks (a wurm has only a shuffle, P03) is borrowed from a model with the same
    # bones (the dragon's), so nothing stands frozen in its bind pose
    src_chars, src_code = chars, model
    own = set(chars.anims_of(model)) & set(CLIPS)
    if donor:                                        # e.g. classic player races share sets
        src_code = donor
        own = set()
    elif not {"P01", "O01"} & own or not {"L01", "L02"} & own:
        donor, score = find_donor(chars, model, suffixes)
        if global_chars is not None:                  # a player-race set that fits at least as well wins
            gd, gs = find_donor(global_chars, model, suffixes)
            if gd and (donor is None or gs >= score):
                donor, score, src_chars = gd, gs, global_chars
        if donor:
            src_code = donor
            print(f"    {model}: borrowing what it lacks from {donor} ({score:.0%} bones match); its own: {sorted(own)}")
        else:
            own = set(CLIPS)

    def frames(anim, i):
        if anim in own:                               # the model's own animation
            name = model + suffixes[i]
            ref = chars._track_index.get(anim + name) or chars._track_index.get(anim + "A" + name)
            if ref:
                saved = chars.anim_source
                chars.anim_source = None
                out = chars.track_frames(ref)
                chars.anim_source = saved
                return out
        name = src_code + suffixes[i]
        ref = src_chars._track_index.get(anim + name) or src_chars._track_index.get(anim + "A" + name)
        if not ref:
            return None
        saved = src_chars.anim_source
        src_chars.anim_source = None
        out = src_chars.track_frames(ref)
        src_chars.anim_source = saved
        if out and src_code != model:                 # borrowed: keep our own bone lengths
            donor_rest = src_chars._track_index.get(name)
            if donor_rest:
                dl = np.linalg.norm(src_chars.track_frames(donor_rest)[0][1])
                ol = np.linalg.norm(rest[i][1])
                if dl > 1e-6:
                    out = [(q, t * (ol / dl)) for q, t in out]
        return out

    rest = [chars.track_frames(t)[0] for t in sk["tracks"]]
    world = sk["world"]
    ibm = np.stack([np.linalg.inv(w).T.reshape(-1) for w in world]).astype(np.float32)   # column-major

    g = Gltf()
    # root: EQ model axes -> game axes (faces -z, y up), feet on y = 0
    lift = -verts[:, 2].min()
    root_m = np.array([[0, -1, 0, 0], [0, 0, 1, lift], [-1, 0, 0, 0], [0, 0, 0, 1]], float)
    g.j["nodes"].append({"name": model, "matrix": root_m.T.reshape(-1).tolist(), "children": [],
                         "extras": {"height": float(verts[:, 2].max() - verts[:, 2].min())}})
    g.j["scenes"][0]["nodes"].append(0)
    bone_node = []
    for i, (q, t) in enumerate(rest):
        bone_node.append(len(g.j["nodes"]))
        g.j["nodes"].append({"name": names[i], "rotation": q.tolist(), "translation": t.tolist()})
    for i, p in enumerate(sk["parents"]):
        parent = g.j["nodes"][0] if p < 0 else g.j["nodes"][bone_node[p]]
        parent.setdefault("children", []).append(bone_node[i])
    skin = {"joints": bone_node, "skeleton": bone_node[0],
            "inverseBindMatrices": g.accessor(ibm.reshape(-1, 16), "MAT4", target=None)}
    g.j["skins"] = [skin]

    t = tris[:, [0, 2, 1]]
    fn = np.cross(verts[t[:, 1]] - verts[t[:, 0]], verts[t[:, 2]] - verts[t[:, 0]])
    normals = np.zeros_like(verts)
    for k in range(3):
        np.add.at(normals, t[:, k], fn)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-9
    pos = verts.astype(np.float32)
    uvs = np.stack([uv[:, 0], -uv[:, 1]], axis=1).astype(np.float32)
    j4 = np.zeros((len(pos), 4), np.uint16)
    j4[:, 0] = joints
    w4 = np.zeros((len(pos), 4), np.float32)
    w4[:, 0] = 1
    prims = []
    import io
    from PIL import Image
    for tex, mode in sorted({m for m in mats if m[0]}, key=str):
        sel = np.array([m == (tex, mode) for m in mats])
        data = chars.files.get(tex)
        if data is None or not sel.any():
            continue
        im = open_image(data)
        tri = t[sel]
        used, inv = np.unique(tri.ravel(), return_inverse=True)
        mat = {"name": tex, "doubleSided": True, "pbrMetallicRoughness": {
            "baseColorTexture": {"index": g.texture(tex, im, mode in MASKED)}, "metallicFactor": 0.0, "roughnessFactor": 1.0}}
        if mode in MASKED:
            mat.update(alphaMode="MASK", alphaCutoff=0.5)
        g.j["materials"].append(mat)
        prims.append({"attributes": {
            "POSITION": g.accessor(pos[used], "VEC3"), "NORMAL": g.accessor(normals[used].astype(np.float32), "VEC3"),
            "TEXCOORD_0": g.accessor(uvs[used], "VEC2"), "JOINTS_0": g.accessor(j4[used], "VEC4"),
            "WEIGHTS_0": g.accessor(w4[used], "VEC4")},
            "indices": g.accessor(inv.astype(np.uint32), "SCALAR", target=34963),
            "material": len(g.j["materials"]) - 1})
    g.j["meshes"].append({"name": model, "primitives": prims})
    g.j["nodes"].append({"name": model + "_mesh", "mesh": 0, "skin": 0})
    g.j["nodes"][0]["children"].append(len(g.j["nodes"]) - 1)

    anims = []
    for clip in CLIPS:
        channels, samplers, found = [], [], 0
        for i in range(len(names)):
            fr = frames(clip, i)
            if not fr:
                continue
            found += 1
            qs = np.array([f[0] for f in fr], np.float32)
            for k in range(1, len(qs)):                     # keep quaternions on one hemisphere
                if np.dot(qs[k], qs[k - 1]) < 0:
                    qs[k] = -qs[k]
            ts = np.array([f[1] for f in fr], np.float32)
            times = (np.arange(len(fr)) * FRAME_S).astype(np.float32)
            inp = g.accessor(times, "SCALAR", target=None)
            for path, arr, kind in (("rotation", qs, "VEC4"), ("translation", ts, "VEC3")):
                samplers.append({"input": inp, "output": g.accessor(arr, kind, target=None), "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": bone_node[i], "path": path}})
        if found >= len(names) * 0.5:
            anims.append({"name": clip, "channels": channels, "samplers": samplers})
    if anims:
        g.j["animations"] = anims
    out = ROOT / "game" / "public" / "npcs"
    out.mkdir(parents=True, exist_ok=True)
    g.save(out / f"{out_name or zone + '_' + model}.glb")
    print(f"  {out_name or zone + '_' + model}: {len(tris)} tris, {len(names)} bones, clips {[a['name'] for a in anims]}")


# player characters for the skirmishes beside the track: (file, model, armor)
HEROES = [("pc_HUM", "HUM", 3), ("pc_ELF", "ELF", 1), ("pc_DWM", "DWM", 2), ("pc_HIF", "HIF", 0),
          ("pc_BAM", "BAM", 3), ("pc_ERM", "ERM", 0), ("pc_DAF", "DAF", 1), ("pc_HOM", "HOM", 1),
          ("pc_OGM", "OGM", 3), ("pc_GNF", "GNF", 0),
          # low-level characters in their starting cloth and leather (the zone vignettes)
          ("pc_HUM_lo", "HUM", 0), ("pc_ELF_lo", "ELF", 0), ("pc_DWM_lo", "DWM", 1), ("pc_BAM_lo", "BAM", 1),
          ("pc_GNF_lo", "GNF", 1), ("pc_HIF_lo", "HIF", 0),
          # raiders in their best (Kunark-era plate and chain), a monk in monk's robes
          ("pc_HUM_mnk", "HUM", 4), ("pc_DWM_pl", "DWM", 3), ("pc_DAF_pl", "DAF", 3), ("pc_ERM_pl", "ERM", 3),
          ("pc_HIF_pl", "HIF", 3), ("pc_ELF_ch", "ELF", 2), ("pc_TRM", "TRM", 2)]
# every fighter race again in leather, chain and plate (pc_<race>_a<n>): no two fights dressed alike
HEROES += [(f"pc_{m}_a{a}", m, a) for m in ("HUM", "ELF", "DWM", "HIF", "BAM", "ERM", "DAF", "HOM", "OGM", "GNF", "TRM")
           for a in (1, 2, 3)]


# EQ's held items (gequip.s3d) for the fighters beside the track, by kind (known from their textures:
# the rest of gequip is tools, books, instruments, food) - game/src/npcs.js arms each fighter from these
ITEM_POOLS = {
    "one": ["IT1", "IT26", "IT34", "IT57", "IT58", "IT20", "IT41", "IT42", "IT44", "IT22", "IT76", "IT85", "IT86", "IT87",
            "IT93", "IT95", "IT97", "IT139", "IT5", "IT50", "IT90", "IT7", "IT18", "IT19", "IT37", "IT31", "IT102", "IT112",
            "IT35", "IT51", "IT14", "IT59", "IT43", "IT3", "IT83", "IT84"],
    "two": ["2HNSWORD", "IT53", "IT24", "IT25", "IT60", "IT80", "IT9", "IT88", "IT92", "IT23", "IT16", "IT17", "IT30", "IT79",
            "IT39", "IT49", "IT33"],
    "staff": ["WIZSTAFF", "IT45", "IT29", "IT96", "IT101", "IT111", "IT126", "IT127", "IT122", "IT123", "IT13"],
    "shield": ["IT200", "IT201", "IT202", "IT203", "IT204", "IT205", "IT206", "IT207", "IT208", "IT209", "IT211", "IT212",
               "IT213", "IT214", "IT215", "IT216", "IT217", "IT218", "IT219", "IT220", "IT221", "IT222", "IT223", "IT224",
               "IT225", "IT226", "IT227", "IT229", "IT230"],
}
ITEMS = [i for pool in ITEM_POOLS.values() for i in pool]


def export_items(names=ITEMS):
    """game/public/items/<IT>.glb: each item mesh in its own (EQ) space, as EverQuest attaches
    it to a character's R_POINT / L_POINT / SHIELD_POINT bone."""
    from export_gltf import Gltf, MASKED, TRANSLUCENT
    files = read_archive(need("gequip.s3d"))
    wld = Wld(files["gequip.wld"])
    meshes = {m["name"].replace("_DMSPRITEDEF", ""): m for m in wld.meshes()}
    out = ROOT / "game" / "public" / "items"
    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        m = meshes.get(name)
        if m is None or not len(m["tris"]):
            print(f"  item {name}: not in gequip.s3d")
            continue
        mats = wld.material_list(m["material_list"])
        g = Gltf()
        prims = []
        pos, uv = m["verts"].astype(np.float32), np.stack([m["uv"][:, 0], -m["uv"][:, 1]], axis=1).astype(np.float32)
        for mi in np.unique(m["tri_material"]):
            mat = mats[mi] if mi < len(mats) else None
            if not mat or not mat["visible"] or not mat["texture"] or mat["texture"] not in files:
                continue
            mode = mat["render"] & 0xFF
            tri = m["tris"][m["tri_material"] == mi][:, [0, 2, 1]]
            used, inv = np.unique(tri.ravel(), return_inverse=True)
            mm = {"name": mat["name"], "doubleSided": True, "pbrMetallicRoughness": {
                "baseColorTexture": {"index": g.texture(mat["texture"], open_image(files[mat["texture"]]), mode in MASKED)},
                "metallicFactor": 0.0, "roughnessFactor": 1.0}}
            if mode in MASKED:
                mm.update(alphaMode="MASK", alphaCutoff=0.5)
            g.j["materials"].append(mm)
            prims.append({"attributes": {"POSITION": g.accessor(pos[used], "VEC3"), "TEXCOORD_0": g.accessor(uv[used], "VEC2")},
                          "indices": g.accessor(inv.astype(np.uint32), "SCALAR", target=34963), "material": len(g.j["materials"]) - 1})
        if not prims:
            continue
        g.node(name, prims)
        g.save(out / f"{name}.glb")
    (out / "pools.json").write_text(json.dumps(ITEM_POOLS))   # the game arms its fighters from these
    print(f"  items: {len(names)} held items exported")


def main_skinned(names):
    from export_drivers import ANIM_FROM
    export_items()
    global_chars = Characters(archive=need("global_chr.s3d"))
    for file, model, armor in HEROES:
        global_chars.armor = armor
        export_skinned("pc", model, global_chars, donor=ANIM_FROM[model], out_name=file)
    global_chars.armor = None
    for name in names:
        cfg = json.loads((ROOT / "tracks" / f"{name}.json").read_text())
        chars = Characters(cfg["zone"])
        models = [n["model"] for n in cfg.get("npcs3d", [])] + [s["model"] for s in cfg.get("scenes", [])]
        for sk in cfg.get("skirmishes", []):
            models += [m for m in sk["foes"] + sk["heroes"] if not m.startswith("pc_")]
        for v in cfg.get("vignettes", []):            # the zone's scenes in the race intro
            models += [m for m in v.get("foes", []) + v.get("heroes", []) + v.get("models", []) + ([v["model"]] if v.get("model") else [])
                       + [v[k] for k in ("foe", "hero") if isinstance(v.get(k), str)] if not m.startswith("pc_")]
        # a creature the zone has no model for, borrowed from another zone's (Greater Faydark's black
        # bears from Nektulos: `"from": "nektulos"`); still exported as <zone>_<model>
        borrowed, srcs = {}, {}
        for spec in cfg.get("npcs3d", []):
            if spec.get("from"):
                srcs[spec["model"]] = borrowed.setdefault(spec["from"], Characters(spec["from"]))
        # NPCs shown in several texture sets (one dragon of each colour, a named dragon's own
        # colours): <zone>_<model>_v<n>
        looks = [(spec["model"], v) for spec in cfg.get("npcs3d", []) for v in spec.get("variants", [])]
        looks += [(sc["model"], sc["variant"]) for sc in cfg.get("scenes", []) if "variant" in sc]
        looks += [(v["foe"], v["foeVariant"]) for v in cfg.get("vignettes", []) if "foeVariant" in v]
        for model, v in dict.fromkeys(looks):
            src = srcs.get(model, chars)
            src.variant = v
            export_skinned(cfg["zone"], model, src, global_chars, out_name=f"{cfg['zone']}_{model}_v{v}")
            src.variant = None
        for model in dict.fromkeys(models):
            try:
                src = srcs.get(model, chars)
                if model not in src.names():             # gods and the like live in global2_chr.s3d
                    src = gods = globals().get("_GODS") or Characters(archive=need("global2_chr.s3d"))
                    globals()["_GODS"] = gods
                export_skinned(cfg["zone"], model, src, global_chars)
            except Exception as e:                      # fall back to the posed statue
                print(f"  {model}: skinned export failed ({e}); exporting a posed statue")
                export(cfg["zone"], model, chars)


if __name__ == "__main__":
    main_skinned(sys.argv[1:])
