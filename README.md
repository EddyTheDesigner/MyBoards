# MyBoards

A small, local desktop canvas for images, videos, and styled text. Built with Rust, Tauri, and TypeScript. No account or AI service is needed to use the app.

## Features

- Arrange and resize images, videos, and text on an open canvas.
- Format text with fonts, colors, backgrounds, and alignment.
- Connect selected objects into chains that follow their positions. Drop an object onto a line to insert it.
- Organize boards in collapsible groups with no fixed nesting depth.
- Customize light/dark mode, accent color, and canvas dots.
- Undo changes and automatically save boards and imported media on your device.

## Download

Open this repository's **Releases** page and choose a package for your system:

| System | Package |
| --- | --- |
| Windows x64 | Setup installer, or the standalone executable with WebView2 installed |
| Linux x64 | AppImage or Debian/Ubuntu `.deb` |
| macOS Apple Silicon | ARM64 `.dmg` |
| macOS Intel | x64 `.dmg` |

Release files include SHA-256 checksums. The first release uses unsigned Windows binaries and ad-hoc-signed macOS applications; macOS packages are not notarized. Video playback depends on the format and available system codecs.

## Use

Drag images or videos onto the canvas, or use the media icon. Press **T**, then click to add text; double-click text to edit it. Drag objects to move them and use a corner handle to resize. Shift-click or drag a selection box to select multiple objects, then right-click and choose **Connect**.

Hold **Space** and drag to pan. **Ctrl/Cmd + scroll** zooms, **F** fits the board, **Ctrl/Cmd + Z** undoes, and **Ctrl/Cmd + D** duplicates. The help icon lists the shortcuts.

In the Boards panel, use the folder-plus icon to create a group. Select a group before adding boards or subgroups inside it; click the **Boards** heading to create at the top level. Right-click a board or group, or use its ellipsis menu, to rename or move it. **Ungroup** keeps the group's boards and subgroups in its parent.

## Local data

The app saves to the operating system's application data directory under `app.myboards.desktop`. Settings shows the exact location. Imported media is copied into a managed `media` folder, and each workspace save keeps a previous valid backup.

To back up your boards, copy the entire data directory. Restore it to its original location because media references currently use absolute paths. Media copies are retained after object deletion so undo can restore them. Browser-preview data is separate from desktop data.

## Build from source

Install Node.js 22.12 or later, Rust 1.90 or later, and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
npm ci
npm run tauri -- dev
```

For a production package:

```sh
npm run tauri -- build
```

Build each platform on its corresponding operating system. Packages are written to `src-tauri/target/release/bundle/`. The included GitHub Actions workflow builds Windows, Linux, and both macOS architectures from the same release tag.

`npm run dev` runs only the browser preview. `npm run build` checks TypeScript and creates its production assets.
