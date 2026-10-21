# Разработка

`studio/src/core`: схема Zod v2, профили, математика, input engine, reconnect client и хранение. `studio/src/renderer`: независимый DOM/Canvas renderer. `Scene` получает конфигурацию при её изменении; события идут прямо в `InputEngine`. React не обновляется на каждый mouse packet. rAF просыпается по вводу и останавливается после затухания. Кольцевой Float64Array — 2048 точек; бюджет — 128/384/1024 сегмента на кадр.

`main.tsx`: Studio, редактор свойств, калькулятор, история и автосохранение. `overlay.ts`: отдельный entry без React и редактора. `?diagnostics=1`: явный разработческий генератор/измерение Canvas.

`ws-server/src-tauri/src`: сохранённый backend. `motion.rs` интегрирует hypot каждого исходного события. Input channel — 4096 событий, broadcast — 1024 сообщения. Переполнение сбрасывает визуальные удержания; отставший WS-клиент отключается и переподключается. 8000 Hz относится к чтению устройства, а не отправке 8000 JSON в секунду: движения агрегируются примерно до 125 Hz. Длина пути передаётся отдельно.

## Протокол

Первое сообщение: `{"type":"auth","token":"..."}`. Ввод игнорируется до `auth_response: success`. Studio добавляет `protocol: 3` и `state_snapshot: true` в ответ, heartbeat каждые 3 секунды, auth/handshake timeout 10 секунд, ограничение WS-сообщения 2 MB.

Существующие key/mouse/analog события сохраняются. `mouse_moved` сохраняет dx/dy, добавляет `distance_counts` и общий `distance_cm`. `input_reset` снимает удержания. Wheel: отрицательное rotation — вверх, положительное — вниз.

`studio_get` возвращает `studio_config` с документом или null. `studio_set` (document, origin, request_id) сохраняет файл и рассылает конфигурацию авторизованным клиентам. Origin защищает локальные изменения от собственных запоздавших подтверждений. Ошибка записи не считается сохранением. Повреждённый studio.json вызывает `studio_recovery` с проверенной копией. Пользователь выбирает восстановление либо явное сохранение текущего документа. `distance_reset` сбрасывает общий счётчик.

Полная схема проверяется Zod; Rust проверяет envelope, версию, размеры коллекций и ключевые числовые параметры. Сервер предназначен для локального ПК и доверенной LAN.

## Хранение и миграция

Текущий формат — version=2. v1 мигрирует в памяти с нормализацией полей оформления; перед первой нативной записью v2 исходный v1 сохраняется отдельно в studio.v1.json и больше не заменяется обычными сохранениями. Браузер хранит original-v1. Неизвестная версия отклоняется. Старый формат girlglock не конвертируется автоматически: оригинальный редактор остаётся доступным.

Документ разделяет performance, distance policy, профили с темой/компоновкой и пользовательские presets. Backend connection/input settings хранятся отдельно. LocalStorage — автономная web-копия; `studio.json` — источник настроек OBS без открытого редактора. Undo ограничен 60 состояниями.

## Sensitivity

Формула: `914.4 / (DPI * sensitivity * yaw)`. 800 / 1.3 / .022 = 39.965034965… cm/360. Применяется к линейному горизонтальному повороту без ADS, ускорения и FOV-зависимых шкал.

Источники: [KovaaK Sensitivity Matcher](https://www.kovaak.com/sensitivity-matcher/) (Source .022, Overwatch .0066, FOV), [официальный KovaaK converter](https://kovaaks.com/kovaaks/sens-converter) (CS/Valorant и игровые шкалы), [исходники Valve](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/inputw32.cpp) (m_yaw). Valorant .07 и Apex .022 — стандартные профили, не измерение каждого игрового режима. Yaw редактируется. Неизвестная KovaaK scale возвращает null.

## Нативная сборка в этой среде

Изолированные Rust/LLVM-MinGW находятся в игнорируемой `.tools`, системный PATH не меняется. Задайте RUSTUP_HOME, CARGO_HOME и добавьте LLVM-MinGW/bin в PATH; используйте `cargo +stable-x86_64-pc-windows-gnullvm ...`. На стандартной системе с MSVC — обычный stable MSVC. Не смешивайте GNU CRT и LLVM UCRT.

Exe не требует Node/pnpm/Rust. GNU LLVM build использует поставляемую WebView2Loader.dll; packaging script её включает. WebView2 Runtime устанавливается отдельно. Автообновление оригинала отключено, чтобы не заменять Studio чужой сборкой.


## Изменения v0.2

`core/layout.ts` хранит логический размер 1920×1080, fit с единым масштабом, выравнивание и edge/center snapping. OBS entry пересчитывает scale и прозрачные поля при resize. Изменения размера источника не изменяют пользовательские координаты и JSON-схему v1.

Scene обновляет существующие DOM-узлы по module ID. Canvas, кольцевой буфер, виртуальная позиция и камера trail сохраняются при изменении цвета, геометрии, качества и параметров того же профиля. При удалении модуля очищаются только его ссылки; при переключении профиля сцена начинает новый след. Цифровые нажатия не воспроизводятся заново при обычной смене оформления.

`input_snapshot` запрашивается после auth, перед studio_get. Запрос проходит через ту же ограниченную input queue как барьер. Distributor присваивает монотонный sequence снимку и входным событиям; клиент игнорирует события старше применённого снимка. Windows сверяет цифровые удержания с GetAsyncKeyState, учитывая раскладку foreground window и фильтр разрешённых клавиш. Неполные аналоговые нажатия сохраняются из HID-состояния. Linux использует текущий кэш событий. Snapshot не создаёт mouse_pressed и не запускает фиктивный click ripple.

Обновление distance_total пробуждает renderer, сохраняя клавиши и trail; оно больше не вызывает input_reset. WS-пакеты закрытого предыдущего socket игнорируются. Для E0 scancode применяется 0xE000; отдельный Windows API test проверяет различение Ctrl/Alt слева и справа.

Реальная OBS/CEF-проверка: `cd studio; node scripts/obs-test.mjs`. Требуются Node 24+, собранный native exe, Playwright Chromium и отдельная portable OBS в `.tools/obs-portable`. Тест создаёт только Browser Source, использует изолированную конфигурацию и локальные тестовые credentials; записи, стримы, захват экрана/игры и микрофона не запускаются. Протокол: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md, portable CLI: https://obsproject.com/kb/launch-parameters.

## Изменения v0.3

`core/visual.ts`: ограниченные схемы оформления и встроенных растровых assets. `core/skins.ts`: общая геометрия keycaps, постоянные mouse slots, вычисление Cover/Contain/Original/Tile и оптимизация пользовательской картинки. `core/presets.ts`: отдельный переносимый preset bundle; идентификаторы изображений переназначаются при импорте.

Документ v2 содержит assets, а модуль ссылается на assetId и хранит ImageSettings. Полезная нагрузка документа ограничена 1,8 MB, отдельный data URL — 420 KB, число используемых assets — 8. HTTP/WS лимит остаётся 2 MB. Raw capture input протокол не меняется.

Renderer создаёт один Blob URL на используемый asset в Scene. Каждый keycap имеет clipped surface и локальную image plane с координатами, обратными положению keycap в общей раскладке. Таким образом непрерывность не зависит от DOM-порядка клавиш, а прозрачные промежутки не содержат фона. Подпись, рамка и active overlay — отдельные слои. Изменения стиля и картинки сохраняют DOM клавиш; удалённые assets освобождают Blob URL; dispose удаляет resize listener и все ресурсы Scene.

Canvas Trail получает ограниченное (до 2×) разрешение с учётом фактического масштаба сцены/DPR. Физика остаётся в логических координатах. Короткий digital tap имеет transient flash 65 ms отдельно от класса pressed; snapshot не порождает flash или click markers. Разные mouse-модули имеют независимую длительность wheel highlight.

`studio.pending` хранит факт неподтверждённого локального изменения; после reload оно публикуется при первом соединении. При повреждении локальной конфигурации pending не разрешает публикацию defaults. Обычные server updates не создают локальную историю Undo.

`visual-controls.tsx`: common/element style forms, растровый importer и dialog с отдельным черновиком положения изображения. До Apply изменения положения остаются только в этом dialog; Cancel/Escape не затрагивают конфигурацию. Изображения и стили проходят общий Zod validator до локальной записи и отправки.

## Сохранение 0.3.1

Протокол 4 вводит обязательный base_revision, подтверждения и явные конфликты. Контракт native-валидации генерируется из Zod. См. [SAVING_AND_SYNC.md](SAVING_AND_SYNC.md).
