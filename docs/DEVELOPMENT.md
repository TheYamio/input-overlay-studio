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

`INPUT_OVERLAY_STUDIO_DATA_DIR` позволяет проверить сборку с отдельными настройками. Перед запуском другой сборки завершите приложение через Exit в трее: одновременно работает только один экземпляр независимо от папки данных. Обычный повторный запуск открывает существующий редактор. `--tray` запускает захват без главного окна; повторный запуск с этим флагом не открывает редактор.

Сценарии проверок: [TESTING.md](TESTING.md). Упаковка: [RELEASING.md](RELEASING.md). Устройство проекта: [ARCHITECTURE.md](ARCHITECTURE.md).
