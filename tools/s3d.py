"""Minimal reader for EverQuest .s3d (PFS) archives.

Usage:
    python3 s3d.py list  <archive.s3d>
    python3 s3d.py unpack <archive.s3d> <out_dir>
"""
import struct
import sys
import zlib
from pathlib import Path

def open_image(data):
    """Texture bytes from an archive -> PIL image, oriented the way EQ's UVs expect.

    Most EQ textures are DDS files stored under .bmp names. A real Windows BMP (barbarians,
    iksar, Plane of Growth's creatures ...) holds its rows in the opposite order to those
    DDS files, so it is flipped to match: otherwise its faces come out upside down."""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.load()
    if data[:2] == b"BM":
        im = im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return im


# CRC of the filename-directory entry; some archives use 0xFFFFFFFF instead
DIRECTORY_CRCS = (0x61580AC9, 0xFFFFFFFF)


def _inflate(buf, offset, size):
    out = bytearray()
    pos = offset
    while len(out) < size:
        deflated_len, inflated_len = struct.unpack_from("<II", buf, pos)
        pos += 8
        out += zlib.decompress(buf[pos:pos + deflated_len])
        pos += deflated_len
    return bytes(out)


def read_archive(path):
    """Return {filename: bytes} for every file in the archive."""
    buf = Path(path).read_bytes()
    dir_offset, magic, _version = struct.unpack_from("<I4sI", buf, 0)
    if magic != b"PFS ":
        raise ValueError(f"{path}: not a PFS archive")
    (count,) = struct.unpack_from("<I", buf, dir_offset)
    entries = []
    names_blob = None
    for i in range(count):
        crc, offset, size = struct.unpack_from("<III", buf, dir_offset + 4 + i * 12)
        if crc in DIRECTORY_CRCS:
            names_blob = _inflate(buf, offset, size)
        else:
            entries.append((offset, size))
    if names_blob is None:
        raise ValueError(f"{path}: no filename directory")
    entries.sort()  # filenames are stored in file-offset order
    (name_count,) = struct.unpack_from("<I", names_blob, 0)
    pos = 4
    names = []
    for _ in range(name_count):
        (n,) = struct.unpack_from("<I", names_blob, pos)
        pos += 4
        names.append(names_blob[pos:pos + n].rstrip(b"\0").decode("latin-1").lower())
        pos += n
    if len(names) != len(entries):
        raise ValueError(f"{path}: {len(names)} names vs {len(entries)} files")
    return {name: _inflate(buf, off, size) for name, (off, size) in zip(names, entries)}


if __name__ == "__main__":
    cmd, archive = sys.argv[1], sys.argv[2]
    files = read_archive(archive)
    if cmd == "list":
        for name, data in sorted(files.items()):
            print(f"{len(data):>10}  {name}")
    elif cmd == "unpack":
        out = Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (out / Path(name).name).write_bytes(data)
        print(f"{len(files)} files -> {out}")
