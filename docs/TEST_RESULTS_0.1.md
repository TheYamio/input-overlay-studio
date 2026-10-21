# Результаты проверки — 20 октября 2026

## Пройдено

| Проверка | Результат |
|---|---|
| TypeScript strict + Vite production build | Успешно, два entry: Studio и OBS |
| Vitest | **29/29**: cm/360, числа/запятая, неизвестная KovaaK scale, схема/импорт, темы, simultaneous inputs, analog/wheel, дистанция при смене DPI, malformed messages, ring buffer и синтетические 1/2/4/8 kHz |
| Rust unit tests | **9/9**: исходная длина пути, порог движения, privacy/whitelist, совместимые packets, bounded channel, disk persistence и смена DPI |
| Browser integration | **12/12**: авторизация, кнопки/модификаторы/wheel, калькулятор, drag/resize/snap/undo/redo, свойства, reload persistence, presets, прозрачный источник, изоляция demo, reconnect и работа без окна редактора |
| Native smoke | **6/6**: release exe запускает Raw Input/HTTP/WS; production frontend работает с реальным Rust server; неверный token отвергается; disk profile восстанавливается после рестарта; OBS entry прозрачен; Tauri открывает окно и самостоятельно авторизует Studio |
| Windows release | Успешно, x64 GNU LLVM/UCRT, exe + WebView2Loader.dll + libunwind.dll |
| Упакованный portable exe | Повторно прошёл все 6 native smoke checks с DLL из release-каталога |
| Git diff whitespace | Без ошибок |

Среда: Windows 11, kernel32 10.0.26100.9549; Node 24.19.0; Rust 1.99.1; Tauri 2.11.2; LLVM-MinGW 20261006; Playwright Chromium 156. Тестовая нативная конфигурация изолирована в `.tools/native-smoke`, порты 4465/4466. Промежуточная попытка смешать GNU Rust с LLVM UCRT была отклонена проверкой запуска; финальная сборка использует согласованный gnullvm toolchain.

SHA-256 release exe: `D783B645C7A7EA96C75225B6E282CE9F645F283714497C855847681D2C2855C5`.

## Синтетическая нагрузка

60 секунд при 8000 Hz: **480 000 перемещений**, **3598 кадров**, ошибок JavaScript нет. Суммарное измеренное время обработки ввода 112,2 мс; среднее Canvas draw 0,122 мс, максимум 0,5 мс. JS heap после принудительного GC: 6 320 404 → 6 746 392 байт. Storage точек фиксирован: 2048 на trail, отрисовка ограничена бюджетом качества.

Это результаты конкретного синтетического прогона, не обещание FPS в OBS и не проверка latency устройства. Минутный heap smoke не доказывает отсутствие всех утечек; для длительного теста есть developer diagnostics до 3600 секунд.

Машиночитаемые отчёты находятся в `studio/artifacts/{browser-results,native-results,performance-results}.json`; фактический снимок работающего React UI — `studio/artifacts/studio.png`. Они не заменяют исходники или исполняемое приложение.

## Не проверено в этом окружении

- Реальный OBS Browser Source и запись/стрим, в том числе 120 FPS.
- Физические клавиатуры/мыши, HID analog depth, реальные 1000/2000/4000/8000 Hz устройства и USB unplug/replug.
- CS2, KovaaK’s, Aim Lab, fullscreen/elevated games и их античит-системы.
- Двухкомпьютерная LAN-конфигурация.
- Windows 10 и Linux runtime, MSI/подписанный installer.

Эти сценарии перечислены в [TESTING.md](TESTING.md). Синтетические WS-события применялись только в тестах/явном Demo, реальный OBS renderer не генерирует их автоматически.

## Известные ограничения

- Повторное подключение сбрасывает удержания. Клавишу, удерживаемую через reconnect, может потребоваться нажать повторно; snapshot состояния устройств отсутствует в upstream protocol.
- Путь mouse trail визуально сэмплируется примерно до 125 Hz backend / выбранного render FPS. Физическая дистанция Windows рассчитывается до этого сэмплирования. Linux сохраняет старый агрегатор и требует отдельной проверки точности дистанции.
- Сохранённый distance total обновляется примерно раз в 3 секунды; аварийный выход может потерять последний интервал.
- Native device enumeration включает виртуальные HID/RDP; наличие устройства в списке не подтверждает его исправность. В web Studio доступен только статус соединения.
- Импорт legacy girlglock layouts автоматически не выполняется; оригинальный редактор сохранён. Неизвестные будущие версии Studio-конфига отклоняются без молчаливой миграции.
- Runtime не скачивает обновления или WebView2. Требуется заранее установленный Microsoft WebView2 Runtime.
- Есть предупреждения Rust dead_code в сохранённых модулях upstream updater и предупреждения Rollup о комментариях аннотаций Zod. Ошибок компиляции нет; фоновая проверка upstream обновлений отключена.
