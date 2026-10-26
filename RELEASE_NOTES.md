# MyBoards 0.2.0

The first public release of MyBoards, a local desktop canvas built with Rust and Tauri.

- Arrange images, videos, and styled text on a freeform board.
- Select several objects and connect them in flexible chains. Drop an object onto a line to insert it.
- Organize boards in nested, collapsible groups; rename or move boards and groups.
- Keep changes on your device with autosave, recovery backups, and undo/redo.
- Choose light or dark mode and a custom accent color.

Download the package for your system:

| System | Package |
| --- | --- |
| Windows x64 | `windows-x64-setup.exe`, or the standalone `windows-x64.exe` |
| Linux x64 | `.deb` or `.AppImage` |
| macOS Apple Silicon | `macos-arm64.dmg` |
| macOS Intel | `macos-x64.dmg` |

The Windows installer handles the WebView2 runtime; the standalone executable requires it to be installed. Linux packages are built on Ubuntu 22.04. Make an AppImage executable before launching it. Media decoding depends on platform codecs.

Windows packages are unsigned. macOS packages are ad-hoc signed and are not notarized. Your operating system may require approval before opening them.

Close any earlier MyBoards version before starting this release. Existing local boards and media remain in the same application data directory. `SHA256SUMS.txt` lists the SHA-256 digest of each application download.
