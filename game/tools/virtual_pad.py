"""Virtual Xbox controller (uinput) that plays a script, to test the game's gamepad path:
    python3 tools/virtual_pad.py "wait 8" "tap A" "wait 2" "tap A" "wait 25" "tap A" "hold A 6 stick 0.6"
"""
import fcntl, os, struct, sys, time
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
BTN = {"A": 0x130, "B": 0x131, "X": 0x133, "Y": 0x134, "LB": 0x136, "RB": 0x137, "BACK": 0x13a, "START": 0x13b,
       "MODE": 0x13c, "LS": 0x13d, "RS": 0x13e}
ABS = {"X": 0, "Y": 1, "Z": 2, "RX": 3, "RY": 4, "RZ": 5, "HAT0X": 16, "HAT0Y": 17}
fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
fcntl.ioctl(fd, 0x40045564, EV_KEY); fcntl.ioctl(fd, 0x40045564, EV_ABS)
for c in BTN.values(): fcntl.ioctl(fd, 0x40045565, c)
absmax, absmin = [0] * 64, [0] * 64
for n, c in ABS.items():
    fcntl.ioctl(fd, 0x40045567, c)
    absmin[c], absmax[c] = (-1, 1) if n.startswith("HAT") else (0, 1023) if n in ("Z", "RZ") else (-32768, 32767)
dev = struct.pack("80sHHHHI", b"Microsoft X-Box One S pad", 3, 0x045e, 0x02ea, 0x0301, 0)
dev += struct.pack("64i", *absmax) + struct.pack("64i", *absmin) + struct.pack("64i", *[0] * 64) + struct.pack("64i", *[0] * 64)
os.write(fd, dev); fcntl.ioctl(fd, 0x5501)
def ev(t, c, v):
    os.write(fd, struct.pack("llHHi", int(time.time()), 0, t, c, v)); os.write(fd, struct.pack("llHHi", int(time.time()), 0, EV_SYN, 0, 0))
time.sleep(1)
for step in sys.argv[1:]:
    w = step.split()
    if w[0] == "wait": time.sleep(float(w[1]))
    elif w[0] == "tap": ev(EV_KEY, BTN[w[1]], 1); time.sleep(0.15); ev(EV_KEY, BTN[w[1]], 0)
    elif w[0] == "dpad": ev(EV_ABS, ABS["HAT0X"], int(w[1])); time.sleep(0.15); ev(EV_ABS, ABS["HAT0X"], 0)
    elif w[0] == "hold":                       # hold <button> <seconds> [stick <x>]
        ev(EV_KEY, BTN[w[1]], 1)
        if len(w) > 4: ev(EV_ABS, ABS["X"], int(float(w[4]) * 32767))
        time.sleep(float(w[2])); ev(EV_ABS, ABS["X"], 0); ev(EV_KEY, BTN[w[1]], 0)
    print("pad:", step, flush=True)
fcntl.ioctl(fd, 0x5502); os.close(fd)
