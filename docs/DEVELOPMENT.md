# Development

## Requirements

- Node.js 22.12+ or 24+ and pnpm.
- Stable Rust.
- A Windows C/C++ toolchain: MSVC Build Tools with the Windows SDK, or Rust `gnullvm` with LLVM-MinGW UCRT.

## Build

Run from the repository root:

```powershell
pnpm --dir studio install --frozen-lockfile
pnpm --dir studio test
pnpm --dir studio build
cargo test --locked --manifest-path ws-server/src-tauri/Cargo.toml --lib
cargo build --locked --release --manifest-path ws-server/src-tauri/Cargo.toml
```

Build the frontend first. Tauri uses `studio/dist`, and `build.rs` embeds the same assets in the local HTTP server. The Windows executable is `ws-server/src-tauri/target/release/input-overlay-ws.exe`.

## Run locally

Start the frontend with `pnpm --dir studio dev`. Run the capture application for live input.

| Address | View |
| :--- | :--- |
| `/studio/index.html` | Studio editor |
| `/studio/overlay.html` | OBS overlay |

Set `INPUT_OVERLAY_STUDIO_DATA_DIR` to use an isolated data directory. Close the running application through **Exit** in the system tray before starting a different build. A second normal launch opens the existing editor. `--tray` starts capture in the background.

## Verify changes

```powershell
pnpm --dir studio test:browser
pnpm --dir studio test:editor
pnpm --dir studio test:sync
```

Additional checks are listed in `studio/package.json`. Browser suites use Playwright Chromium; install it with `pnpm --dir studio exec playwright install chromium`. Local results are written to `studio/artifacts`.

For protocol or schema changes, cover saving, migrations, backups and reconnecting. For editor changes, check Undo/Redo, keyboard interaction and small windows. See [Contributing](../.github/CONTRIBUTING.md).

## Package a Windows build

```powershell
pwsh -File scripts/build-studio.ps1
```

Use `-SkipBuild` to package an already built and verified executable. Commit the source changes before packaging and match the executable version to the project version.

A GitHub release contains the Windows application ZIP and a link to its source tag.
