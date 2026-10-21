# Input Overlay Studio

Текущая стабильная версия: **0.4.0**

[Скачать Windows x64 ZIP](https://github.com/TheYamio/input-overlay-studio/releases/download/v0.4.0/Input-Overlay-Studio-0.4.0-Windows-x64.zip) · [Релиз v0.4.0](https://github.com/TheYamio/input-overlay-studio/releases/tag/v0.4.0)

Версия 0.4 объединяет [новые визуальные возможности](docs/VISUAL_FEATURES_0.3.3.md), [удобство кастомизации](docs/CUSTOMIZATION_0.3.3.md) и [оптимизацию](docs/PERFORMANCE_0.3.3.md). Нумерация 0.3.3-dev в подробных отчётах обозначает этапы разработки этого релиза.

Локальное Windows-приложение для визуализации ввода в OBS. Развитие [girlglock/input-overlay](https://github.com/girlglock/input-overlay), GPL-3.0. Механизмы RawInputBuffer, WebSocket-аутентификации, HTTP и аналоговых клавиатур сохранены. Оригинальный README — [README.upstream.md](README.upstream.md).

## Возможности

- Studio: холст 1920×1080, drag/resize, сетка, привязка к соседним элементам, выравнивание, сброс позиции, safe area, слои, блокировка, дублирование, undo/redo.
- Keyboard: одновременные нажатия, левые/правые модификаторы, собственные подписи и позиции, analog fill.
- Mouse Buttons: M1–M5, прокрутка, компактный режим и схема мыши.
- Mouse Trail: пять стилей, fade, click ripple, fixed field / recenter, ручной и DPI-нормализованный масштаб.
- Distance: длина исходных перемещений до прореживания, смена DPI без пересчёта накопленного расстояния, общий сброс, сохранение между запусками.
- Profiles: CS2, Valorant, Apex, Overwatch 2, KovaaK’s с явным выбором шкалы, custom yaw и ручным cm/360.
- Семь заводских тем, пользовательские пресеты, проверяемый JSON-импорт/экспорт, резервные копии.
- Прозрачный OBS-рендерер с пропорциональным масштабированием под размер Browser Source, включая 2560×1440. Настройки синхронизируются через авторизованный WebSocket; редактор можно закрыть.
- Изменение оформления не очищает текущий след; после reconnect удержания восстанавливаются через snapshot.
- Demo включается явно для предпросмотра. Copy OBS URL всегда создаёт источник реального ввода.

Сохранение, конфликты двух редакторов и восстановление: [инструкция](docs/SAVING_AND_SYNC.md).

## Запуск Windows-сборки

Распакуйте **весь ZIP** в отдельный каталог и запустите `Input Overlay Studio.exe` **вместе с DLL из того же каталога**. Нужен Microsoft Edge WebView2 Runtime. Повседневная работа не требует интернета.

1. Откройте Studio. Capture connected подтверждает авторизацию, а не присутствие конкретного USB-устройства.
2. В Profiles укажите DPI, игру и sensitivity.
3. Выберите тему, расположите модули, измените свойства.
4. Нажмите Copy OBS URL, добавьте Browser Source 1920×1080 в OBS.
5. Закройте окно Studio, оставив приложение в трее. Выход — Exit в меню трея.

Инструкция: [docs/OBS_SETUP.md](docs/OBS_SETUP.md). Ручные сценарии: [docs/TESTING.md](docs/TESTING.md). Фактические результаты: [docs/TEST_RESULTS_0.4.0.md](docs/TEST_RESULTS_0.4.0.md).

## Разработка и сборка

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

`pnpm build` подготавливает Studio для Tauri. `build.rs` встраивает тот же frontend в существующий HTTP-сервер. Сначала собирайте frontend. `scripts/build-studio.ps1` выполняет сборку и упаковку в версионный каталог; [порядок публикации](docs/RELEASING.md). Для разработки UI: `cd studio; pnpm dev`. Реальный ввод поступает только из запущенного native server.

## Данные и приватность

Новые установки сохраняют `config.json`, `studio.json`, опциональный `distance.json` и логи в `%LOCALAPPDATA%/InputOverlayStudio`. Существующий portable `config.json` рядом с exe сохраняет прежнее расположение. Для разработки: `INPUT_OVERLAY_STUDIO_DATA_DIR`; флаг `--tray` запускает без окна.

По умолчанию: `127.0.0.1:4455` (WS) и `127.0.0.1:4456` (HTTP). OBS: `/studio/overlay.html`; оригинальный web editor: `/`. LAN требует явного изменения bind host и адресов источника. Токен находится во фрагменте OBS URL, не в HTTP query; не публикуйте ссылку. Экспортируемые профили не содержат токен. Телеметрии, истории текстового ввода, внедрения DLL в игры и фоновой проверки обновлений нет.

## Лицензия

Неизменённая [GPL-3.0](LICENSE). Attribution оригинала сохранён. При распространении сборок предоставляйте соответствующие исходники и скрипты сборки. Зависимости сохраняют собственные лицензии: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Визуальная настройка v0.3

Общий рисунок на кейкапах: загрузка PNG/JPEG/WebP, единая непрерывная картинка с прозрачными промежутками, редактор положения/масштаба/поворота, смешивание и цветокоррекция, настройки поведения при нажатии. Изображения встроены в конфигурацию и экспорт отдельных пресетов.

Также доступны индивидуальные стили клавиш и кнопок, независимая прозрачность фона, типографика, рамки, полноценная геометрия Mouse Diagram и дополнительные настройки Trail. Формат v1 мигрирует в v2 с сохранением исходной копии.

[Как настроить оформление](docs/CUSTOMIZATION.md) · [Результаты проверки](docs/TEST_RESULTS.md).
