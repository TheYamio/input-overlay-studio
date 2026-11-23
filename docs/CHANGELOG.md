# Changelog

## v0.8.0

- Refined Midnight Iris across Studio, Profiles, Presets, Settings, the setup guide and dialogs. Settings now has quick links to its main sections.
- Clarified the selected module, key or mouse button across the canvas, Layers and Properties. Grouped editing and view controls in the canvas toolbar and footer.
- Added light, dark and game screenshot backgrounds to the Studio preview, plus separate Press and Release controls for testing animations.
- Open **Paint your keycaps** from the selected keyboard and adjust the image in one editor. The preview fits short windows, and the artwork follows rounded corners and SVG cutouts.
- Unified built-in and saved presets with rendered previews, palettes and descriptions. Compare the current setup with the result before applying colors or a full layout.
- Moved **Copy OBS URL** into the matching setup step and clarified manual copying. Refined key terminology in the built-in translations.

**Update from 0.7.0.** Choose **Exit** in the system tray, extract the full Windows ZIP and launch Studio with the same data directory and capture settings. Studio reuses your profiles, presets and language. Existing OBS Browser Sources keep their URLs.

## v0.7.0

- Added a shared **Connect to OBS** panel in the editor and setup guide with Browser Source instructions, URL copying and separate capture, save and source statuses.
- Kept the source URL masked by default and added a reveal control for manual copying when clipboard access fails.
- Preserved input checks when going back in the guide. The final step now explains how to verify a key press in OBS and shows what to check while the source is disconnected.
- Localized the updated connection and verification controls in all 12 built-in languages.

**Update from 0.6.10.** Quit through **Exit** in the system tray, extract the new ZIP and run Studio with the same data and server settings. Existing OBS Browser Sources keep their URLs.

## v0.6.10 — November 20, 2026

- Fixed Studio and OBS Browser Source startup over LAN HTTP.
- Added a separate read-only OBS token. Browser Sources clear the overlay when Capture rejects an expired or revoked token.
- Kept offline drafts separate across tabs, with recovery in **Settings → Other local drafts**.
- Made module edits and gesture saves faster in large profile libraries while preserving Undo and Redo.
- Wrapped long settings hints in narrow inspector panels.
- Fixed the default Linux data directory and mouse path length calculation.
- Saved mouse distance only when the total changes and flushed pending input and distance on tray exit.

**Update:** Quit through **Exit** in the tray, extract the new ZIP, and use **Copy OBS URL** to replace the URL in each OBS Browser Source. If you shared an older URL, change the Capture server token as well.

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
