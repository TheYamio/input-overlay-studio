# Результаты проверки v0.2.0 — 20 октября 2026

## Автоматические проверки

| Проверка | Результат |
|---|---|
| TypeScript strict + Vite production build | Успешно; отдельные Studio и OBS entry |
| Vitest | **39/39**: математика, конфигурация, input engine, bounded storage, fit разных разрешений, align/snap, восстановление snapshot и валидация |
| Rust | **13/13**: motion/distance/storage/filters/channel, held-state reconcile, shallow analog, snapshot privacy, Windows API mapping правых Ctrl/Alt |
| Browser integration | **16/16**: базовый редактор/профили/presets, drag/resize/undo, alignment/lock/reset, сохранение DOM/Canvas и геометрии следа при редактировании, 1440p и не-16:9, восстановление удержаний, отсечение старых событий, distance update без сброса, работа без редактора |
| Native smoke | **7/7**: release exe, настоящий HTTP/WS, неверный token, ordered current-state snapshots, disk persistence/restart, прозрачный production entry, старт Tauri и автоматическая авторизация |
| Настоящий OBS/CEF | **5/5**: production Browser Source и auth, alpha-прозрачность/видимые модули, пропорции 2560×1440, обновление sensitivity без reload, reconnect после рестарта сервера без редактора |
| Windows release | Успешно: v0.2.0 x64 GNU LLVM/UCRT, exe + WebView2Loader.dll + libunwind.dll |
| Portable package smoke | Повторно **7/7** из готовой папки поставки: exe и runtime DLL запускаются вместе |
| Git whitespace | Без ошибок |

Всего **80 проверок**, плюс отдельный минутный нагрузочный прогон. Проверки не используют генерацию demo в production OBS URL.

Среда: Windows 11 (kernel32 10.0.26100.9549), Node 24.19.0, Rust 1.99.1, Tauri 2.11.2, LLVM-MinGW 20261006, Playwright Chromium 156. Конфигурация JSON остаётся v1; изменение layout или профиля не требует миграции для этой версии.

SHA-256 release exe: `CF10AB71484E24954481330D89E2E335F5130853C52ECD9513F7EE211CE0A970`.

## Реальный OBS

Использована отдельная portable OBS 32.2.2 из официального релиза; архив проверен SHA-256. Настройки пользователя и существующие сцены не использовались. Создан только Browser Source с локальным production overlay.html; редактор, захват экрана/игры, аудио, запись и трансляция не запускались.

CEF отобразил графику и прозрачный alpha-фон. При переходе 1920×1080 → 2560×1440 границы содержимого изменились в отношении 4/3 с допуском меньше 4 логических пикселей. Изменение sensitivity на сервере изменило соответствующую область источника без reload. После остановки сервера и появления нового log-файла подтверждено новое OBS-подключение, источник продолжил отображаться. На коротком прогоне OBS сообщил около 60 active FPS; это не тест производительности в игре и не обещание 120 FPS.

Артефакты: `studio/artifacts/obs-results.json`, `obs-1080.png`, `obs-1440.png`, `obs-updated.png`, `obs-reconnected.png`.

## Синтетическая нагрузка

60 секунд при 8000 Hz: **480 000 перемещений**, **3600 кадров**, ошибок JS нет. Суммарное время обработки ввода **90,8 мс**; средний Canvas draw **0,089 мс**, максимум **0,4 мс**. Heap после GC: **6 356 012 → 6 783 000 байт**. Storage: 2048 точек на trail, число сегментов ограничено качеством.

Это конкретный синтетический smoke test, не измерение USB polling или end-to-end latency. Минутный heap check не доказывает отсутствие всех утечек. Developer diagnostics позволяют прогон до часа.

Остальные отчёты: `studio/artifacts/{browser-results,native-results,performance-results}.json`; снимок Studio: `studio/artifacts/studio.png`.

## Ещё не проверено

- Физические клавиатуры/мыши под контролируемой нагрузкой: все кнопки, sided modifiers, analog depth, реальные 1/2/4/8 kHz и USB unplug/replug.
- CS2, KovaaK’s, Aim Lab, elevated/fullscreen games и античит-системы.
- Запись/стрим OBS, 120 FPS и длительная одновременная работа с игрой.
- Windows 10, Linux runtime и двухкомпьютерная LAN-конфигурация.

Эти сценарии остаются в TESTING.md и не отмечены как пройденные. ОС-снимок и packet ordering проверены API/unit/integration тестами; поведение конкретной физической периферии требует ручной приёмки.

## Известные ограничения и оставшийся объём

- На backend v0.2 Windows удержания восстанавливаются через snapshot. Старые серверы без этой возможности требуют повторного нажатия; Linux после полного рестарта зависит от новых событий устройства. Потеря/отключение соединения по-прежнему сразу очищает визуальные удержания.
- DPI-normalized trail и Windows distance интегрируют исходные данные до визуальной агрегации. Отправка movement packets примерно 125 Hz. Linux сохраняет старый агрегатор.
- Distance persist выполняется примерно раз в 3 секунды; при аварийном завершении возможна потеря последнего интервала.
- Windows device enumeration включает виртуальные HID/RDP. Наличие в списке не является проверкой исправности устройства.
- Индивидуальные размеры/позиции/цвета/эффекты каждой кнопки мыши, расширенные рамки, отдельный экспорт пресета, миграции legacy и будущих схем, полная Rust-валидация всех полей JSON и optional Input History в этот этап не входили.
- Доступна portable-сборка; установщик и цифровая подпись отсутствуют. WebView2 Runtime устанавливается отдельно. Фонового auto-update нет.
- Сохранились предупреждения dead_code в upstream updater и Rollup-аннотаций Zod; ошибок компиляции нет.

Исторический отчёт v0.1: TEST_RESULTS_0.1.md.
