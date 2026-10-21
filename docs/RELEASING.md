# Публикация Input Overlay Studio

Релиз Studio публикуется из проверенной Windows portable-сборки. Старый workflow `legacy ws-server release (manual)` оставлен только для ручного запуска: его server-only ZIP не является дистрибутивом Studio. CI `nightly` проверяет исходники отдельно.

1. Обновить версию в `studio/package.json`, `studio/src/main.tsx`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`; обновить README, CHANGELOG и отчёт проверки.
2. Собрать frontend: `pnpm --dir studio build`, выполнить `pnpm --dir studio test` и browser/visual/sync/editor/customization/visual-features suites из [TESTING.md](TESTING.md).
3. Собрать и проверить Rust с `--locked`; проверить настоящий native exe и OBS. Для LLVM-MinGW выставить соответствующий PATH, CARGO_HOME и RUSTUP_HOME. Не смешивать MSVC и GNU DLL.
4. Убедиться, что exe имеет новую ProductVersion/FileVersion, проверить новую иконку. Сохранить SHA-256 exe в отчёте. Commit всех исходников релиза; рабочее дерево должно быть чистым.
5. Выполнить `pwsh -File scripts/build-studio.ps1 -SkipBuild`. Для полной сборки из уже подготовленного исходного дерева использовать скрипт без `-SkipBuild`, при необходимости с `-Toolchain stable-x86_64-pc-windows-gnullvm`.
6. Скрипт создаёт `release/Input Overlay Studio <version>/`, версионный Windows x64 ZIP, Source ZIP точно из HEAD и SHA256SUMS. Существующий каталог той же версии блокирует упаковку, чтобы исключить остаточные файлы. Проверить содержимое ZIP, соответствие exe и DLL, запустить native-проверку на копии из архива.
7. Обычный push ветки, тег `v<version>` на проверенном commit, push тега. Создать GitHub Release сначала как draft и загрузить оба ZIP и SHA256SUMS; сверить опубликованные assets и их SHA-256, затем опубликовать релиз.

Установки пользователей и их данные не включать в архив. Нужен установленный Microsoft Edge WebView2 Runtime. Старые архивы разных версий сохраняются отдельно. Подпись кода и автоматическое обновление в этом выпуске не предусмотрены.

## Иконка

Собственный векторный оригинал — `studio/public/logo.svg`. Он используется в Studio и favicon. Native-экспорты — `ws-server/src-tauri/icons/icon.png`, `icon.ico`, `icon.icns`; Windows ICO содержит размеры от 16 до 256 px. При изменении оригинала обновить все экспорты перед сборкой. PNG экспортируется с прозрачностью; ICO/ICNS можно сформировать из PNG через Pillow.
