# Installing EverKart

EverKart is built on your own computer from **your own EverQuest files**. You copy your
EverQuest folder in, run the installer, and it builds the game and installs it.

- [What you need](#what-you-need)
- [Linux](#linux)
- [Windows](#windows)
- [Music](#music-optional)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

## What you need

| | |
|---|---|
| **EverQuest** | your EverQuest game folder. EverKart is built and tested with [Project 1999](https://www.project1999.com/)'s client |
| **Disk space** | about 4 GB for the build |
| **Python** | 3.10 or newer |
| **Node.js** | 18 or newer, with npm |
| **FFmpeg** | converts EverQuest's sounds |
| **FluidSynth + a soundfont** | optional: renders the zones' music |
| **A graphics card** | any that runs WebGL 2 (practically all from the last decade) |

The installers check for all of these and offer to install what is missing.

## Linux

1. **Get EverKart:** `git clone` the repository, or download the ZIP and unpack it.
2. **Copy your EverQuest folder** into the project's `Everquest/` folder, so that
   `Everquest/global_chr.s3d` exists. See [Everquest/README.md](../Everquest/README.md).
3. **Run the installer** from the project folder:

   ```bash
   ./install.sh
   ```

   The installer runs four steps:
   1. It checks for Python, Node.js, FFmpeg and FUSE (which runs AppImages), and offers to
      install any that are missing with your package manager. Supported package managers are
      apt (Debian, Ubuntu, Mint), pacman (Arch, Manjaro), dnf (Fedora) and zypper (openSUSE).
   2. It sets up the build's Python packages in `.venv/`, inside the project.
   3. It builds the game: `game/release/EverKart-<version>.AppImage`.
   4. It installs it to `~/.local/share/everkart/`, adds **EverKart** to your applications menu
      (Games), and adds an `everkart` command.

| Option | |
|---|---|
| `--build-only` | build the AppImage, do not install it |
| `--yes` | install missing system packages without asking |
| `--uninstall` | remove the installed game |

Your EverQuest folder is somewhere else? Point the build at it instead of copying:
`EVERQUEST_DIR=~/Games/EverQuest ./install.sh`.

## Windows

1. **Get EverKart:** on the repository page, **Code → Download ZIP**, and unpack it (or
   `git clone` it).
2. **Copy your EverQuest folder** into the project's `Everquest` folder, so that
   `Everquest\global_chr.s3d` exists. See [Everquest/README.md](../Everquest/README.md).
3. **Double-click `install.bat`.**

   The installer runs four steps:
   1. It checks for Python, Node.js and FFmpeg, and offers to install any that are missing with
      `winget` (the Windows package manager, built into Windows 10 and 11).
   2. It sets up the build's Python packages in `.venv\`, inside the project.
   3. It builds the game into EverKart's own Windows installer:
      `game\release\EverKart-Setup-<version>.exe`.
   4. It runs that installer, which puts **EverKart** in your Start menu and on your desktop.

From PowerShell you can also run `.\install.ps1 -BuildOnly` (make the installer, don't run it)
or `.\install.ps1 -Yes` (install missing tools without asking).

> [!NOTE]
> If Windows SmartScreen warns about `EverKart-Setup-<version>.exe`: the installer is built on
> your own computer and is not code-signed. Choose **More info → Run anyway**.

## Music (optional)

The zones' music is EverQuest's own MIDI music. The build renders it with **FluidSynth** and a
**General MIDI soundfont**. Without them the game builds and plays, just without music.

- **Linux:** the installer offers the packages (for example `fluidsynth fluid-soundfont-gm` on
  Debian or Ubuntu, `fluidsynth soundfont-fluid` on Arch).
- **Windows:** install FluidSynth (for example `choco install fluidsynth`, or from
  [fluidsynth.org](https://www.fluidsynth.org/)) and download any General MIDI soundfont
  (`.sf2`). Then set `SOUNDFONT` to it and run the installer again:

  ```bat
  set SOUNDFONT=C:\soundfonts\FluidR3_GM.sf2
  install.bat
  ```

Any General MIDI soundfont works; you can also point `SOUNDFONT` at one on Linux.

## Updating

Get the new version (`git pull`, or download the ZIP again and keep your `Everquest` folder),
then run the installer again. The slow first step (pulling the zones out of your EverQuest
files) is kept from the last build, so updates are quicker.

## Uninstalling

- **Linux:** `./install.sh --uninstall`
- **Windows:** Settings → Apps → EverKart → Uninstall

Your EverQuest files are never touched. Your settings live in `~/.config/EverKart/`
(Windows: `%APPDATA%\EverKart\`).

## Troubleshooting

| Problem | What to do |
|---|---|
| `no EverQuest files in .../Everquest` | the EverQuest folder isn't in `Everquest/`: copy it so that `Everquest/global_chr.s3d` (or `Everquest/<folder>/global_chr.s3d`) exists |
| `missing EverQuest file: ...` | your EverQuest is missing a file the game uses. EverKart is built with Project 1999's files |
| The AppImage doesn't start (Linux) | it needs FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04+). Or run it with `--appimage-extract-and-run` |
| A black screen or very low frame rate | update your graphics drivers; EverKart needs WebGL 2 |
| No music | see [Music](#music-optional) |
| Anything else | every session writes a log: Linux `~/.config/EverKart/logs/`, Windows `%APPDATA%\EverKart\logs\`. [Open an issue](../../../issues) and attach the newest one |
