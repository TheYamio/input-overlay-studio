# Разработка Input Overlay Studio

Нужны Node.js 22.12+ или 24+, pnpm, Rust stable и Windows C/C++ toolchain (обычно MSVC Build Tools с Windows SDK). Альтернатива — Rust gnullvm и LLVM-MinGW UCRT; не смешивайте их с обычным windows-gnu CRT.

Из корня проекта:

```powershell
pnpm --dir studio install --frozen-lockfile
pnpm --dir studio test
pnpm --dir studio build
cargo test --locked --manifest-path ws-server/src-tauri/Cargo.toml --lib
cargo build --locked --release --manifest-path ws-server/src-tauri/Cargo.toml
```

Сначала собирается frontend. Tauri использует `studio/dist` напрямую, а `build.rs` встраивает ту же сборку в локальный HTTP-сервер. Выходной exe: `ws-server/src-tauri/target/release/input-overlay-ws.exe`.

Для UI: `pnpm --dir studio dev`. Живой ввод требует запущенного capture-приложения. OBS — `/studio/overlay.html`, браузерный редактор — `/studio/index.html`.

`INPUT_OVERLAY_STUDIO_DATA_DIR` позволяет проверить сборку с отдельными настройками рядом с обычной установкой. `--tray` запускает её без главного окна.

Сценарии проверок: [TESTING.md](TESTING.md). Упаковка: [RELEASING.md](RELEASING.md). Устройство проекта: [ARCHITECTURE.md](ARCHITECTURE.md).
