"""EverQuest's own sound effects for the game, from its snd*.pfs archives (Everquest/).

    python3 tools/export_sfx.py

Writes game/public/sfx/<name>.ogg for each sound below (the game's name -> EQ's file).
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from s3d import read_archive  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
from eqfiles import EQ  # noqa: E402  (read only)

SOUNDS = {
    "kart": "mining_cart_lp.wav",        # a kart rolling: the mine cart loop, pitched with speed
    "tick": "button_1.wav",              # 3, 2, 1
    "go": "spelhit4.wav",                # GO!
    "ding": "levelup.wav",               # you finished: EQ's level-up ding
    "pickup": "spelgdht.wav",            # a spell gem picked up
    "cast": "spelcast.wav",              # the casting chant (the first moment of it)
    "travel": "spelltrav.wav",           # a bolt in flight (loop)
    "fire": "fire_att.wav",              # flame bolt lands
    "hit": "spelhit1.wav",               # a spell lands
    "snare": "spelhit3.wav",
    "thunder": "thunder1.wav",
    "gate": "teleport.wav",
    "wolf": "wolf_howl.wav",
    "invis": "spelhit2.wav",
    "whirl": "wind_magical.wav",         # a whirlwind waiting on the road (loop)
    "whoosh": "ghost_wind_whoosh.wav",   # ... and catching someone
    "bump": "punchhit.wav",              # a kart hits a wall
}


def main():
    archives = [read_archive(p) for p in sorted(EQ.glob("snd*.pfs"))]
    out = ROOT / "game" / "public" / "sfx"
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, src in SOUNDS.items():
            data = next((a[src] for a in archives if src in a), None)
            if data is None:
                raise SystemExit(f"{src} not found in EverQuest's sound archives")
            wav = Path(tmp) / src
            wav.write_bytes(data)
            subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "libvorbis", "-q:a", "5",
                            str(out / f"{name}.ogg")], check=True)
            print(f"  {name:8s} <- {src}")


if __name__ == "__main__":
    main()
