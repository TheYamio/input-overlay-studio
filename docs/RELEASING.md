# Выпуск Input Overlay Studio

1. Обновить версию frontend, Cargo и Tauri, README и CHANGELOG.
2. Собрать frontend и выполнить [проверки](TESTING.md), включая рабочее пространство, синхронизацию и изображения.
3. Собрать Rust с `--locked`, проверить нативное окно, настоящий захват и OBS.
4. Проверить ProductVersion/FileVersion и собственную иконку. Зафиксировать исходники релиза; упаковщик требует чистого рабочего дерева.
5. Выполнить `pwsh -File scripts/build-studio.ps1 -SkipBuild`. Без `-SkipBuild` скрипт также собирает приложение. Для LLVM-MinGW можно передать `-Toolchain stable-x86_64-pc-windows-gnullvm`.
6. Проверить Windows ZIP: только exe и необходимые DLL. README, документация, тестовые результаты, пользовательские данные и настройки в него не входят. Исходники, лицензии и attribution находятся в отдельном Source ZIP из HEAD. Контрольные суммы — в SHA256SUMS.
7. Опубликовать проверенный commit и тег, создать draft GitHub Release, загрузить архивы и SHA256SUMS, сверить содержимое и хеши, затем опубликовать.

CI проверяет исходники; автоматической публикации через старый server-only workflow нет. Установленный Microsoft Edge WebView2 Runtime — внешнее требование. Подпись кода и автообновление пока не предусмотрены.

Собственная иконка начинается с `studio/public/logo.svg`. При её изменении обновить экспорты в `ws-server/src-tauri/icons/` (PNG, ICO, ICNS).
