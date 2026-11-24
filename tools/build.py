#!/usr/bin/env python3
"""Build EverKart from your EverQuest files.

    python3 tools/build.py            # everything: pull what the game needs out of Everquest/,
                                      # then build the desktop app for this system:
                                      #   Linux    game/release/EverKart-<version>.AppImage
                                      #   Windows  game/release/EverKart-Setup-<version>.exe
    python3 tools/build.py kael       # one track only (development: no app build)

The installers (install.sh, install.bat) check what the build needs and run this. Needs: Python
3.10+ with tools/requirements.txt, Node.js 18+ (npm), FFmpeg. Optional: FluidSynth and a General
MIDI soundfont for the zones' music (set SOUNDFONT=/path/to/soundfont.sf2 if it is not found).
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from eqfiles import EQ, eq, need  # noqa: E402

# where a General MIDI soundfont usually is (the first one found renders the music)
SOUNDFONTS = ["/usr/share/soundfonts/FluidR3_GM.sf2", "/usr/share/sounds/sf2/FluidR3_GM.sf2",
              "/usr/share/soundfonts/default.sf2", "/usr/share/sounds/sf2/default-GM.sf2",
              "/usr/share/soundfonts/GeneralUser-GS.sf2", "/usr/share/sounds/sf2/TimGM6mb.sf2",
              "/usr/share/soundfonts/FluidR3_GS.sf2", "C:/soundfonts/FluidR3_GM.sf2"]


def tool(name):
    """A program on the PATH (npm is npm.cmd on Windows), or None."""
    return shutil.which(name)


def soundfont():
    for p in [os.environ.get("SOUNDFONT"), *SOUNDFONTS]:
        if p and Path(p).is_file():
            return p
    return None


def preflight(app):
    """Stop early, with what to do, when something the build needs is missing."""
    missing = []
    for mod, pkg in (("numpy", "numpy"), ("PIL", "Pillow"), ("scipy", "scipy"), ("matplotlib", "matplotlib")):
        try:
            __import__(mod)
        except ImportError:
            missing.append(f"Python package {pkg}  (pip install -r tools/requirements.txt)")
    if not tool("ffmpeg"):
        missing.append("FFmpeg  (the sound effects and music are converted with it)")
    if app and not tool("npm"):
        missing.append("Node.js 18 or newer, with npm  (builds the desktop app)")
    if missing:
        raise SystemExit("EverKart cannot be built yet - missing:\n  " + "\n  ".join(missing)
                         + "\nThe installers (install.sh / install.bat) set these up: see docs/INSTALL.md")
    if not (tool("fluidsynth") and soundfont()):
        print("note: no music - FluidSynth and a General MIDI soundfont render the zones' music "
              "(set SOUNDFONT=/path/to/file.sf2); the game runs without it\n")
TRACKS = ["veeshan", "kael", "gfaydark", "oasis", "everfrost", "nektulos", "lavastorm",
          "fearplane", "hateplane", "growthplane", "mischiefplane", "unrest", "vpeak", "butcher", "northkarana", "ecommons"]


def run(*args):
    print("+", " ".join(map(str, args)))
    subprocess.run([sys.executable, *map(str, args)], check=True, cwd=ROOT)


def main():
    need("global_chr.s3d")                          # stops with what to do if Everquest/ is empty
    print(f"EverQuest files: {EQ}")
    preflight(app=not sys.argv[1:])
    tracks = sys.argv[1:] or TRACKS
    sf = soundfont() if tool("fluidsynth") else None
    for name in tracks:
        cfg = json.loads((ROOT / "tracks" / f"{name}.json").read_text())
        zone = cfg["zone"]
        tune = cfg.get("music_zone", zone)          # zones with no music of their own borrow a neighbour's
        if not (ROOT / "work" / "zones" / zone / "mesh.npz").exists():
            run("tools/extract_zone.py", zone)
            run("tools/floorplan.py", zone)
        run("tools/export_gltf.py", zone)
        run("tools/export_track.py", name)
        run("tools/export_gltf.py", zone)               # again: clears trees / props off the routed road
        run("tools/export_npcs.py", name)
        music = ROOT / "game" / "public" / "music"
        if sf and eq(f"{tune}.xmi").exists() and not list(music.glob(f"{tune}_*.ogg")):
            run("tools/xmi2mid.py", eq(f"{tune}.xmi"), f"work/music/{tune}")
            music.mkdir(parents=True, exist_ok=True)
            for mid in sorted((ROOT / "work" / "music").glob(f"{tune}_*.mid")):
                wav = mid.with_suffix(".wav")
                subprocess.run([tool("fluidsynth"), "-ni", "-q", "-g", "0.8", "-r", "44100", "-F", str(wav),
                                sf, str(mid)], check=True, stdout=subprocess.DEVNULL)
                subprocess.run([tool("ffmpeg"), "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libvorbis",
                                "-q:a", "4", str(music / f"{mid.stem}.ogg")], check=True)
                wav.unlink()
    run("tools/export_drivers.py")                       # classic racers, kart textures, portraits
    run("tools/export_fx.py")                            # EQ spell-effect sprites
    run("tools/export_spellfx.py")                       # EQ spell particle emitters (spellsnew.eff/.edd)
    run("tools/export_sfx.py")                           # EQ sound effects (snd*.pfs)
    sky = ROOT / "game" / "public" / "sky"
    skies = ("normalsky", "normalcloud", "desertsky", "desertcloud", "cottonysky", "fluffycloud", "redcloud", "moon", "sun")
    if not all((sky / f"{n}.png").exists() for n in skies):   # sky.wld's sets, and the sun and the moon
        sky.mkdir(parents=True, exist_ok=True)
        import io
        sys.path.insert(0, str(ROOT / "tools"))
        from PIL import Image
        from s3d import read_archive
        files = read_archive(need("sky.s3d"))
        for n in skies:
            Image.open(io.BytesIO(files[f"{n}.bmp"])).convert("RGB").save(sky / f"{n}.png")
    icons = ROOT / "game" / "public" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    from PIL import Image
    spells = {"wolf": (5, 0), "fireball": (2, 15), "whirlwind": (3, 13), "snare": (4, 28),
              "gate": (4, 13), "invis": (3, 29), "lightning": (5, 18), "icecomet": (2, 20)}   # (spells0N.tga, icon index)
    for name, (sheet, i) in spells.items():
        im = Image.open(need("uifiles", "default_old", f"spells0{sheet}.tga")).convert("RGB")
        im.crop(((i % 6) * 40, (i // 6) * 40, (i % 6) * 40 + 40, (i // 6) * 40 + 40)).save(icons / f"{name}.png")
    icon = ROOT / "game" / "electron" / "icon.png"            # the desktop app's icon
    if not icon.exists():
        from PIL import ImageDraw
        im = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse((16, 16, 496, 496), fill=(168, 133, 63, 255))            # a gold ring
        d.ellipse((30, 30, 482, 482), fill=(43, 26, 12, 255))
        for i in range(6):                                                 # a chequered flag
            for j in range(4):
                d.rectangle((136 + i * 40, 156 + j * 40, 176 + i * 40, 196 + j * 40),
                            fill=(238, 238, 238, 255) if (i + j) % 2 else (17, 17, 17, 255))
        d.rectangle((126, 156, 136, 380), fill=(168, 133, 63, 255))       # its pole
        d.text((150, 330), "EverKart", fill=(255, 207, 74, 255))
        im.save(icon)
    if not sys.argv[1:]:                              # the whole game: build the desktop app too
        game = ROOT / "game"
        npm = tool("npm")
        subprocess.run([npm, "install"], check=True, cwd=game)
        subprocess.run([npm, "run", "dist"], check=True, cwd=game)
        app = sorted((game / "release").glob("EverKart-Setup-*.exe" if os.name == "nt" else "EverKart-*.AppImage"),
                     key=lambda p: p.stat().st_mtime)
        print(f"\ndone - {'install' if os.name == 'nt' else 'play'}: {app[-1] if app else game / 'release'}")
    else:
        print("\ndone - cd game && npm run dev")


if __name__ == "__main__":
    main()
