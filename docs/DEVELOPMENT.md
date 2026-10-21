# Разработка Input Overlay Studio

Нужны Node.js 22.12+ (либо 24+), pnpm, Rust stable и Windows C/C++ toolchain. Стандартный путь — MSVC Build Tools с Windows SDK. Альтернативный путь этой среды: Rust `stable-x86_64-pc-windows-gnullvm` и LLVM-MinGW UCRT. Обычный `windows-gnu` нельзя смешивать с LLVM-MinGW UCRT.

```powershell
cd studio
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
cd ..
cargo test --manifest-path ws-server/src-tauri/Cargo.toml --lib
cargo build --release --manifest-path ws-server/src-tauri/Cargo.toml
```

`pnpm build` подготавливает Studio для Tauri. `build.rs` встраивает тот же frontend в существующий HTTP-сервер. Сначала собирайте frontend. `scripts/build-studio.ps1` выполняет сборку и упаковку в версионный каталог; [порядок публикации](RELEASING.md). Для разработки UI: `cd studio; pnpm dev`. Реальный ввод поступает только из запущенного native server.


## Проверки

Сценарии и требования: [TESTING.md](TESTING.md). Результаты стабильной сборки: [TEST_RESULTS_0.4.0.md](TEST_RESULTS_0.4.0.md).

## Публикация

[RELEASING.md](RELEASING.md) — версии, portable-архивы, исходники и контрольные суммы.
