# Результаты проверки v0.3.0 — 20 октября 2026

## Проверки финальной версии

| Проверка | Результат |
|---|---|
| TypeScript strict + Vite production build | Успешно; отдельные Studio и OBS entry |
| Vitest | **47/47**: прежние core/layout проверки, миграция v1→v2, sparse overrides, asset references/limits, перенос preset с переназначением ID, вычисление Cover/Contain, неизменные границы mouse layout при скрытии в том числе изменённых кнопок |
| Rust | **15/15**: прежний capture/snapshot/storage набор; v2 assets envelope и сохранение исходного v1 после нескольких записей |
| Browser integration | **16/16**: editor/undo/профили/presets, прозрачный OBS entry, fit, demo isolation, reconnect/ordered snapshots и сохранение DOM/Canvas/trail при изменениях |
| Visual integration | **14/14**: миграция, независимая прозрачность подложки и текста, индивидуальные стили, upload/sync, реальная пиксельная маска и непрерывный градиент, position/scale/rotation/cancel/undo, исключение клавиш, pressed mode, перенос preset с asset, геометрия мыши, reload/reconnect, отклонение SVG, alpha исходного PNG, типографика/рамки/short taps и reload до debounce save |
| Native release smoke | **8/8**: настоящий exe/HTTP/WS/Raw Input, compiled frontend, сохранение embedded artwork в Rust storage, auth/snapshot/restart, production overlay и Tauri bootstrap |
| Готовая portable-поставка | Повторно **8/8** из папки поставки: exe и обе runtime DLL работают вместе |
| Настоящий OBS/CEF | **6/6**: production source/auth, прозрачность, 1080p/1440p, общая картинка на кейкапах с alpha=0 в промежутках, live update, восстановление изображения после рестарта сервера |
| Windows release | ProductVersion/FileVersion **0.3.0**, x64 GNU LLVM/UCRT; exe + WebView2Loader.dll + libunwind.dll |
| Git whitespace | Без ошибок |

Всего **106 проверок**, плюс минутный нагрузочный прогон. Native и OBS используют compiled production assets. Browser/visual integration используют явно синтетический authenticated transport и не заменяют аппаратную приёмку.

SHA-256 release exe: `362a1cbc1f8b91dad8197c588ae96f10350775fbc2bb7a303754bee842797fb7`.

## Проверка коронной функции

В Playwright загружен настоящий PNG с градиентом; importer оптимизировал его в WebP и передал через общий документ второму overlay-клиенту. Снимок keyboard module декодирован обратно в пиксели: alpha промежутка равна **0**, на соседних A/S/D цвет последовательно меняется по общему рисунку. Это проверяет фактический вывод, а не только значения CSS. Отдельно PNG с полупрозрачной и пустой областями прошёл importer без потери alpha (около 128 и 0 соответственно).

Черновик положения картинки не меняет документ до Apply; Cancel отменяет, Undo возвращает применённое изменение. Экспортированный отдельный preset содержит используемый raster asset и не содержит токен. После импорта картинка получает отдельный ID и сохраняет содержимое. Изображение и переопределения восстанавливаются после reload/reconnect. Быстрый reload сразу после изменения рамки сохраняет последнее изменение.

В настоящем portable OBS **32.2.2** через WebSocket API создан только Browser Source. CEF получил embedded PNG из нативного сервера и показал непрерывный рисунок; пиксели промежутков имеют alpha=0. Нативный studio.json содержит asset; после рестарта сервера OBS восстановил и изображение, и прозрачные промежутки без редактора. На коротком прогоне OBS сообщил около **60 active FPS** и 0 renderSkippedFrames. Это не обещание частоты в игре.

## Нагрузка

Синтетический прогон с включённым keycap artwork: **60 секунд, 8000 Hz, 480 000 перемещений, 3600 кадров**, ошибок JS нет. Суммарная обработка ввода **77 мс**; средний JS frame/draw **0.086 мс**, максимум **0.3 мс**. Heap после GC: **6,808,904 → 7,196,788 байт**. PointRing ограничен 2048 точками на Trail.

Это developer renderer smoke test: время JS не включает всю стоимость CSS/GPU paint, USB polling, передачу до OBS и игровую нагрузку. Минутный heap check не доказывает отсутствие всех утечек.

## Артефакты

- `studio/artifacts/visual-results.json`, `browser-results.json`, `native-results.json`, `obs-results.json`, `performance-results.json`.
- `keycap-mask.png` — pixel-mask fixture; `keycap-editor.png` — редактор изображения; `painted-overlay.png` — overlay preview.
- `obs-keycaps.png`, `obs-1080.png`, `obs-1440.png`, `obs-updated.png`, `obs-reconnected.png` — настоящий OBS/CEF.
- Окружение: Windows 11, Node 24.19.0, Rust 1.99.1, Tauri 2.11.2, LLVM-MinGW 20261006, Chromium 156.

## Ограничения и следующий этап

- Поддерживаются встроенные PNG/JPEG/WebP. Upload ограничен 8 MB/24 MP, изображение оптимизируется максимум до 2048×2048; до 8 используемых assets и 1,8 MB компактного документа. Размеры и лимиты защищают storage и транспорт. Полноразмерный исходник после оптимизации не сохраняется.
- v1 мигрирует в v2. Исходный studio.v1.json сохраняется отдельно; v0.2 не читает v2. Миграция legacy girlglock остаётся отдельной задачей.
- Прямой drag отдельных клавиш на холсте, множественное выделение/группы, назначение клавиши нажатием, новые заводские композиции и renderer-based previews пресетов пока не включены. Координаты и размеры отдельных клавиш/кнопок редактируются полями.
- Общая картинка распространяется в пределах одного keyboard/mouse module. Между несколькими модулями нет общей сцены изображения. Наклон и колёсико по горизонтали не поддержаны.
- Полная Zod-валидация выполняется клиентом; Rust дополнительно проверяет envelope и bounded raster assets, но не все поля визуальной схемы.
- Контролируемые аппаратные проверки 1/2/4/8 kHz, analog устройств, unplug/replug, игры/античиты, запись/стрим OBS, длительные 120 FPS, Windows 10/Linux runtime и LAN остаются в ручной приёмке.
- Portable-сборка без установщика, цифровой подписи и auto-update. Требуется WebView2 Runtime. Сохраняются предупреждения dead_code отключённого upstream updater и Rollup-аннотаций Zod; ошибок сборки нет.

Инструкция: [CUSTOMIZATION.md](CUSTOMIZATION.md). Исторические отчёты: TEST_RESULTS_0.1.md и TEST_RESULTS_0.2.md.
