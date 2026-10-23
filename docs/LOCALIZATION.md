# Languages and multilingual labels

Studio language is selected in Settings → Languages & text. The selector is marked **Experimental**: translations may contain inaccuracies, and missing strings use English. Built-in interface languages: English, Russian, Simplified Chinese, Spanish, Brazilian Portuguese, German, French, Turkish, Polish, Japanese, Korean and Traditional Chinese. Standard catalogs contain draft translations with manually reviewed common terminology; they are not a claim of professional linguistic review.

**Sindarin · Tengwar (partial)** is a small artistic glossary, not a complete or certified Tolkien translation. It uses the Beleriand writing mode with English hints and technical English fallback. Alcarin Tengwar is bundled for its glyphs; authored labels are never automatically transliterated.

Standard catalogs are separate local chunks loaded on demand and cached after success. A failed load preserves the previous selection and can be retried. A saved locale is loaded before the initial Studio view. OBS imports only its small generated-label catalog, without interface translations or any translation engine. No remote translation service is used by the application.

The product name **Input Overlay Studio**, logo wordmark, window title and tray tooltip stay unchanged across locales. Branding is not part of the exported translation template, and imported packages cannot replace the displayed product name. Navigation and other interface controls are translated.

Each overlay has its own **Overlay label language** in Profiles. This affects generated metric labels and number formatting. User captions, key legends, module names, profile names and saved preset descriptions are preserved exactly. Changing Studio language never rewrites them. Runtime language packages travel with exported overlays; removing a Studio package does not delete those resources.

## Adding a language

Export the language template from Settings. Change `locale` to a BCP-47-style identifier, set a display `name`, and translate strings in the existing namespaces. Set `direction` to `rtl` for a right-to-left interface. Keep stable keys and `{{parameter}}` placeholders. Put generated OBS captions in the `overlay` namespace; module-specific keys can use the stable module ID as a prefix. The JSON format is version 1. Import the file in Settings; no React changes are required. Missing entries fall back through parent locales to English. The import UI rejects duplicate bundled locales; use a distinct locale for a custom variant. Previously installed packages and document translations retain priority if their locale later becomes built in. Removing an override restores the bundled values. Remove an imported package before installing its replacement.

Packages contain plain text only. Markup is displayed literally. Code, unknown root fields, prototype keys, malformed Unicode and duplicate locales are rejected. Limits: eight installed packages, 1 MB per library, 64 namespaces per package, 10,000 entries, 4,000 UTF-16 units per entry, 500,000 key/value units per package. Studio preferences use Settings Service; only overlay namespaces are copied into the document when an overlay language is selected.

## Text rendering

Choose **Unicode** in Font family for the bundled Noto stack. Existing font choices also have the same offline fallbacks. The application embeds Noto fonts for Latin, Greek, Cyrillic, CJK, Arabic, Hebrew, major Indic scripts, Thai, Khmer, Lao, Myanmar, Armenian, Georgian and emoji. Font sources, checksums and OFL licenses are under `studio/public/fonts/`; no CDN is used. Fonts are requested only when their covered characters are used.

Text is segmented into grapheme clusters for measurement and truncation. Combining marks, surrogate pairs, emoji modifiers and ZWJ sequences are kept together. IME composition stays a local draft until confirmation. Complex scripts use zero letter spacing to preserve natural joining. Each authored label determines its own direction; the overlay canvas keeps physical left-to-right coordinates. Loaded fonts trigger text fitting again and the listener is removed when a scene is disposed.

Short captions remain limited to 100 UTF-16 units, descriptions to 500; the editor stops at the last complete grapheme inside the limit. Text is never silently transliterated or Unicode-normalized. Manual font size can intentionally exceed a key; enable Fit text for automatic sizing. Fonts do not guarantee every historical or specialist Unicode character, and not every possible emoji sequence has a dedicated glyph.

## Configuration contract

Settings failures cross UI boundaries as `SettingsError(code, diagnostic, params)`. Translate them with `trError`; packages can override stable `errors:settings.<code>` keys and retain `{{id}}` where appropriate. Diagnostic text remains the fallback for an unknown extension code. Parameters contain setting identifiers, never rejected values or credentials, and interpolation does not evaluate inserted text a second time. Other application-owned messages still use the English catalogue adapter.

Current document generation remains v4. `profiles[].locale` defaults to `en`; document `languagePacks` defaults to an empty array. The `visual.localization` capability is required for writers so an older editor cannot discard language resources. Capture validates language packages and text before atomic persistence, using the same limits as Studio. Runtime input samples never enter the language or settings stores.
