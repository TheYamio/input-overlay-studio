# Changelog

## v0.6.9 — October 27, 2026

- First-run setup guide with language selection, real input checks and step-by-step OBS connection. Opening connection settings keeps the current step and progress.
- Clearer capture, save and OBS source status, with improved reconnecting and recovery after a restart.
- Faster saving for large compositions and continuous edits. Save failures show an explicit status and keep the local draft available.
- Improved translations, language settings and layouts in small windows. Removed the incomplete built-in Sindarin option while preserving custom packages and captions.
- Voluntary development support through Boosty and Ko-fi, with all features available for free.
- Copyable diagnostics for the application and connection.
- Better stability with slow OBS sources, device reconnects and capture shutdown.

**Update:** Export a copy of your profiles, choose **Exit** from the system tray, extract the new ZIP, run Studio and refresh the OBS Browser Source.

## v0.6.3 — October 24, 2026

- Independent custom translations: each import creates its own package alongside the built-in languages.
- Export the selected translation with its metadata. Removing the active package selects the matching built-in language or English.
- Language selection and the package library save together, with backups during migration.
- Translation placeholder validation and consistent product branding across languages.
- Improved editor, image, shortcut and preset translations.
- Fixed inspector focus return, translated command names in tooltips, and conflict messages after changing languages.
- Improved preset dialog scrolling in short windows and spacing around language import/export buttons.
- Custom OBS label translations travel with exported profiles.

**Update:** Export your settings, replace the application files, restart capture and refresh the OBS Browser Source.

## v0.6.2 — October 23, 2026

- Midnight Iris interface with Layers on the left, resizable Properties on the right and more canvas space.
- Eight resize handles for modules and keys, arrow-key positioning, aspect-ratio controls and direct key editing on the canvas.
- Copy, cut, paste, duplicate and delete for selected modules, keys and mouse buttons, with configurable shortcuts and conflict resolution.
- SVG contours and cutouts for keys, mouse buttons and mouse bodies. Artwork and lighting follow the selected shapes; labels can be hidden.
- Redesigned built-in compositions and Yamio preset. Presets include descriptions and palettes, with separate color and full-layout actions.
- Independent motion and lighting controls, gradients, intensity, easing, timing, delays, previews and per-button inheritance.
- Explicit game/overlay profile links, backups, configuration version checks and preservation of inactive module data.
- Twelve standard interface languages, translation package import/export and localized OBS metrics. Added an artistic Sindarin glossary with Tengwar.
- Consistent Input Overlay Studio branding across languages.
- Bundled offline fonts, Unicode and IME support, text direction and grapheme-aware caption fitting.
- Faster scene updates, cached metrics and on-demand language catalogs.
- Single-instance application behavior: launching again opens the running editor.

**Update:** Export a copy of your settings before replacing the application files. The Windows ZIP contains the executable and required DLLs; source and licenses are available at the release tag.

## v0.4.0 — October 21, 2026

- Direct key editing on the canvas, assignment by physical input, style copying, bulk style application and one Undo step per gesture.
- Shared artwork across keyboards and mouse buttons, image mirroring and a dedicated placement editor.
- Idle, pressed, analog and scroll previews, seven built-in compositions and live preset thumbnails.
- Faster large-layout rendering with cached keycaps, DOM indexes and distance values.
- Custom Input Overlay Studio icons for the application, window, tray, editor and favicon.
- Portable Windows x64 ZIP with the executable and required DLLs. Source and licenses are available at the release tag.
