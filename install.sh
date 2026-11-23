#!/usr/bin/env bash
# EverKart - Linux installer
#
# Builds EverKart from your own EverQuest files and puts it in your applications menu (Games).
#
#   1. Copy your EverQuest folder into Everquest/        (see Everquest/README.md)
#   2. ./install.sh
#
# Options
#   --build-only   build the game (game/release/EverKart-<version>.AppImage), do not install it
#   --uninstall    remove the installed game (your EverQuest files and this folder are kept)
#   --yes          install missing system packages without asking
#   --help         this text
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
ROOT="$PWD"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA/everkart"
APP="$APP_DIR/EverKart.AppImage"
DESKTOP="$DATA/applications/everkart.desktop"
ICON="$DATA/icons/hicolor/512x512/apps/everkart.png"
BIN="$HOME/.local/bin/everkart"

BUILD_ONLY=0 UNINSTALL=0 YES=0
for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --yes|-y) YES=1 ;;
    --help|-h) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (see --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B='' G='' Y='' R='' N=''; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '\n%sError:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
ask()  { [ "$YES" = 1 ] && return 0; [ -t 0 ] || return 1; read -r -p "  $1 [Y/n] " a; [[ -z "$a" || "$a" =~ ^[Yy] ]]; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- uninstall -------------------------------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  step "Removing EverKart"
  rm -f "$APP" "$DESKTOP" "$ICON"
  [ -L "$BIN" ] && rm -f "$BIN"
  rmdir "$APP_DIR" 2>/dev/null || true
  have update-desktop-database && update-desktop-database -q "$DATA/applications" 2>/dev/null || true
  ok "removed (your EverQuest files, this folder and your settings in ~/.config/EverKart are kept)"
  exit 0
fi

printf '%sEverKart%s - kart racing through real EverQuest zones\n' "$B" "$N"

# --- 1. the tools the build needs --------------------------------------------------------------
step "Checking the tools the build needs"
PM=''
for p in apt-get pacman dnf zypper; do have "$p" && { PM=$p; break; }; done

need_pkgs=() music_pkgs=()
add_need()  { local -a a; read -ra a <<< "$1"; need_pkgs+=("${a[@]}"); }     # (space-separated package lists)
add_music() { local -a a; read -ra a <<< "$1"; music_pkgs+=("${a[@]}"); }
py_ok() { have python3 && python3 -c 'import sys, venv, ensurepip; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; }
node_ok() { have node && have npm && node -e 'process.exit(+process.versions.node.split(".")[0] < 18 ? 1 : 0)' 2>/dev/null; }
soundfont_ok() {
  [ -n "${SOUNDFONT:-}" ] && [ -f "$SOUNDFONT" ] && return 0
  for f in /usr/share/soundfonts/FluidR3_GM.sf2 /usr/share/sounds/sf2/FluidR3_GM.sf2 \
           /usr/share/soundfonts/default.sf2 /usr/share/sounds/sf2/default-GM.sf2 \
           /usr/share/soundfonts/GeneralUser-GS.sf2 /usr/share/sounds/sf2/TimGM6mb.sf2; do
    [ -f "$f" ] && return 0
  done
  return 1
}
fuse_ok() { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }

case "$PM" in
  apt-get) PY_PKGS="python3 python3-venv python3-pip"; NODE_PKGS="nodejs npm"; FF_PKGS="ffmpeg"
           MUSIC_PKGS="fluidsynth fluid-soundfont-gm"
           FUSE_PKGS=$(apt-cache show libfuse2t64 >/dev/null 2>&1 && echo libfuse2t64 || echo libfuse2) ;;
  pacman)  PY_PKGS="python"; NODE_PKGS="nodejs npm"; FF_PKGS="ffmpeg"; MUSIC_PKGS="fluidsynth soundfont-fluid"; FUSE_PKGS="fuse2" ;;
  dnf)     PY_PKGS="python3"; NODE_PKGS="nodejs npm"; FF_PKGS="ffmpeg-free"; MUSIC_PKGS="fluidsynth fluid-soundfont-gm"; FUSE_PKGS="fuse-libs" ;;
  zypper)  PY_PKGS="python3"; NODE_PKGS="nodejs npm"; FF_PKGS="ffmpeg"; MUSIC_PKGS="fluidsynth"; FUSE_PKGS="libfuse2" ;;
  *)       PY_PKGS="" NODE_PKGS="" FF_PKGS="" MUSIC_PKGS="" FUSE_PKGS="" ;;
esac

if py_ok; then ok "Python $(python3 -c 'import platform; print(platform.python_version())')"; else add_need "$PY_PKGS"; warn "Python 3.10 or newer (with venv) is missing"; fi
if node_ok; then ok "Node.js $(node --version)"; else add_need "$NODE_PKGS"; warn "Node.js 18 or newer (with npm) is missing"; fi
if have ffmpeg; then ok "FFmpeg"; else add_need "$FF_PKGS"; warn "FFmpeg is missing"; fi
if [ "$BUILD_ONLY" = 0 ] && ! fuse_ok; then add_need "$FUSE_PKGS"; warn "FUSE 2 (runs AppImages) is missing"; fi
if have fluidsynth && soundfont_ok; then ok "FluidSynth and a General MIDI soundfont (the zones' music)"
else add_music "$MUSIC_PKGS"; warn "FluidSynth / a General MIDI soundfont is missing: the game builds without music"; fi

install_pkgs() {
  case "$PM" in
    apt-get) sudo apt-get update -qq && sudo apt-get install -y "$@" ;;
    pacman)  sudo pacman -S --needed --noconfirm "$@" ;;
    dnf)     sudo dnf install -y "$@" ;;
    zypper)  sudo zypper --non-interactive install "$@" ;;
  esac
}
if [ ${#need_pkgs[@]} -gt 0 ]; then
  [ -n "$PM" ] || die "install the missing tools above with your package manager, then run ./install.sh again"
  if ask "Install ${need_pkgs[*]} with $PM (needs sudo)?"; then install_pkgs "${need_pkgs[@]}"
  else die "the build needs them: sudo $PM install ${need_pkgs[*]}"; fi
  py_ok || die "Python 3.10+ with venv is still missing"
  node_ok || die "Node.js 18+ is still missing (older distributions: install it from https://nodejs.org)"
  have ffmpeg || die "FFmpeg is still missing"
fi
if [ ${#music_pkgs[@]} -gt 0 ] && [ -n "$PM" ]; then
  if ask "Install ${music_pkgs[*]} for the music (optional, needs sudo)?"; then install_pkgs "${music_pkgs[@]}" || warn "no music: continuing without it"; fi
fi

# --- 2. your EverQuest files -------------------------------------------------------------------
step "Looking for your EverQuest files"
EQDIR=$(python3 -c 'import sys; sys.path.insert(0, "tools"); import eqfiles; print(eqfiles.EQ)')
if [ ! -f "$EQDIR/global_chr.s3d" ]; then
  die "no EverQuest files in $EQDIR

  Copy your EverQuest folder into the Everquest/ folder here (it then holds global_chr.s3d,
  the zones' .s3d files and so on), or point EVERQUEST_DIR at it:
      EVERQUEST_DIR=~/Games/EverQuest ./install.sh
  EverKart is built and tested with Project 1999's EverQuest files. See Everquest/README.md."
fi
ok "$EQDIR"

# --- 3. build -----------------------------------------------------------------------------------
step "Setting up the build (Python packages in .venv/)"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r tools/requirements.txt
ok "ready"

step "Building EverKart from your EverQuest files (the first build takes a while)"
PYTHONUTF8=1 .venv/bin/python tools/build.py
BUILT=$(ls -t game/release/EverKart-*.AppImage 2>/dev/null | head -n 1 || true)
[ -n "$BUILT" ] || die "the build did not produce an AppImage (see the messages above)"
ok "$ROOT/$BUILT"

if [ "$BUILD_ONLY" = 1 ]; then
  printf '\n%sDone.%s Play: %s\n' "$G" "$N" "$ROOT/$BUILT"
  exit 0
fi

# --- 4. install -----------------------------------------------------------------------------------
step "Installing"
mkdir -p "$APP_DIR" "$(dirname "$DESKTOP")" "$(dirname "$ICON")" "$(dirname "$BIN")"
cp -f "$BUILT" "$APP.new" && mv -f "$APP.new" "$APP" && chmod +x "$APP"
cp -f game/electron/icon.png "$ICON"
ln -sf "$APP" "$BIN"
EXEC="\"$APP\""
fuse_ok || EXEC="env APPIMAGE_EXTRACT_AND_RUN=1 \"$APP\""     # no FUSE: unpack and run each time
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=EverKart
GenericName=Kart Racer
Comment=Kart racing through real EverQuest zones
Exec=$EXEC %U
Icon=everkart
Terminal=false
Categories=Game;
Keywords=kart;racing;everquest;
EOF
have update-desktop-database && update-desktop-database -q "$DATA/applications" 2>/dev/null || true
ok "Applications menu → Games → EverKart"
ok "or from a terminal: everkart   (--windowed, --track=vpeak, --mute)"

printf '\n%sDone.%s Have fun in Norrath.\n' "$G" "$N"
