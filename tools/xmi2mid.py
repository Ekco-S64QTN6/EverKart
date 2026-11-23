"""Convert EverQuest .xmi (Miles XMIDI) music into standard MIDI files.

    python3 tools/xmi2mid.py Everquest/kael.xmi work/music/kael     # -> kael_0.mid, kael_1.mid ...

XMIDI differences from MIDI handled here:
  * delays are runs of bytes < 0x80 that add up (not variable-length numbers)
  * note-on carries its duration (variable-length) instead of a separate note-off
  * no running status
  * timing is 120 ticks per second; written out as 60 ticks per quarter at 120 bpm
"""
import struct
import sys
from pathlib import Path


def chunks(data, pos, end):
    while pos + 8 <= end:
        cid = data[pos:pos + 4]
        size = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        yield cid, pos + 8, size
        pos += 8 + size + (size & 1)


def vlq(data, pos):
    v = 0
    while True:
        b = data[pos]
        pos += 1
        v = (v << 7) | (b & 0x7F)
        if not b & 0x80:
            return v, pos


def write_vlq(v):
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append(0x80 | (v & 0x7F))
        v >>= 7
    return bytes(reversed(out))


def sequences(data):
    """Yield each EVNT chunk's bytes."""
    def walk(pos, end):
        for cid, start, size in chunks(data, pos, end):
            if cid in (b"FORM", b"CAT "):
                yield from walk(start + 4, start + size)
            elif cid == b"EVNT":
                yield data[start:start + size]
    yield from walk(0, len(data))


def convert(evnt):
    events = []           # (abs_time, order, bytes)
    t, pos, order = 0, 0, 0
    while pos < len(evnt):
        b = evnt[pos]
        if b < 0x80:
            t += b
            pos += 1
            continue
        status = b
        pos += 1
        kind = status & 0xF0
        if status == 0xFF:                               # meta
            mtype = evnt[pos]
            length, p2 = vlq(evnt, pos + 1)
            body = evnt[p2:p2 + length]
            pos = p2 + length
            if mtype == 0x2F:
                break
            if mtype == 0x51:                            # XMI tempo: timing is fixed, drop it
                continue
            events.append((t, order, bytes([0xFF, mtype]) + write_vlq(length) + body))
        elif status in (0xF0, 0xF7):
            length, p2 = vlq(evnt, pos)
            events.append((t, order, bytes([status]) + write_vlq(length) + evnt[p2:p2 + length]))
            pos = p2 + length
        elif kind == 0x90:
            note, vel = evnt[pos], evnt[pos + 1]
            dur, pos = vlq(evnt, pos + 2)
            events.append((t, order, bytes([status, note, vel])))
            events.append((t + dur, -1, bytes([0x80 | (status & 0x0F), note, 0])))
        elif kind in (0xC0, 0xD0):
            events.append((t, order, bytes([status, evnt[pos]])))
            pos += 1
        else:
            events.append((t, order, bytes([status, evnt[pos], evnt[pos + 1]])))
            pos += 2
        order += 1
    events.sort(key=lambda e: (e[0], e[1]))
    track = bytearray(b"\x00\xff\x51\x03\x07\xa1\x20")  # 500000 us per quarter
    last = 0
    for at, _, ev in events:
        track += write_vlq(at - last) + ev
        last = at
    track += b"\x00\xff\x2f\x00"
    return (b"MThd" + struct.pack(">IHHH", 6, 0, 1, 60) +
            b"MTrk" + struct.pack(">I", len(track)) + bytes(track)), last / 120.0


def main(src, dest_prefix):
    data = Path(src).read_bytes()
    Path(dest_prefix).parent.mkdir(parents=True, exist_ok=True)
    for i, ev in enumerate(sequences(data)):
        mid, seconds = convert(ev)
        out = Path(f"{dest_prefix}_{i}.mid")
        out.write_bytes(mid)
        print(f"{out}: {seconds:.0f} s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
