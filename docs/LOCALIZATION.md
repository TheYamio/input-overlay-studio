# Languages and multilingual labels

Studio language is selected in Settings → Languages & text. The selector is marked **Experimental**: translations may contain inaccuracies, and missing strings use English. Built-in interface languages: English, Russian, Simplified Chinese, Spanish, Brazilian Portuguese, German, French, Turkish, Polish, Japanese, Korean and Traditional Chinese. Standard catalogs contain draft translations with manually reviewed common terminology; they are not a claim of professional linguistic review.

Every standard locale must cover all current English keys, including schema-generated controls, help, errors, accessibility labels and runtime captions. The catalog contract checks this coverage and interpolation parameters automatically. Technical names such as DPI, SVG and VK can intentionally remain unchanged. Key coverage measures completeness, not linguistic correctness; the experimental notice remains until independent language review.

The incomplete artistic Sindarin option has been removed from the built-in language list. A saved built-in selection now opens Studio in English; imported custom packages remain available. Existing overlay profiles keep their authored data and use English fallback where a built-in translation is unavailable. The bundled Tengwar font remains available for user-authored labels and custom language packages.

Standard catalogs are separate local chunks loaded on demand and cached after success. A failed load preserves the previous selection and can be retried. A saved locale is loaded before the initial Studio view. OBS imports only its small generated-label catalog, without interface translations or any translation engine. No remote translation service is used by the application.

The product name **Input Overlay Studio**, logo wordmark, window title and tray tooltip stay unchanged across locales. Branding is not part of the exported translation template, and imported packages cannot replace the displayed product name. Navigation and other interface controls are translated.

Each overlay has its own **Overlay label language** in Profiles. This affects generated metric labels and number formatting. User captions, key legends, module names, profile names and saved preset descriptions are preserved exactly. Changing Studio language never rewrites them. Runtime language packages travel with exported overlays; removing a Studio package does not delete those resources.

## Adding a language

Export the English template or the selected translation from Settings. Change `locale` to a BCP-47-style identifier, set a display `name`, and translate strings in the existing namespaces. Optional `author` and `translationVersion` describe the translation; `version: 1` describes the JSON schema. Set `direction` to `rtl` for a right-to-left interface. Keep stable keys and the same named `{{parameter}}` placeholders; their order and repetitions may change. Put generated OBS captions in the `overlay` namespace. No React changes are required.

Every import creates a new custom package with a fresh internal UUID, even when the file, name or locale is identical to an existing package. Built-in languages remain separate and cannot be removed or replaced by imports. The selector distinguishes custom packages by origin, author or locale and a short ID; the original display name is preserved. Resolution uses only the selected package, then built-in translations for its locale and parent locales, then English. Other custom packages never supply fallback strings.

Use the cross beside a custom package to open its deletion confirmation. Cancel or Escape keeps it. Deleting an active package selects the built-in language with the same code, or English when none exists. Other packages and resources already embedded in overlays are kept. Exporting a custom package includes its text and metadata, without its installation UUID, connection settings, tokens or filesystem paths. Reimporting an export creates a separate installation.

Packages contain plain text only. Markup is displayed literally. Code, unknown root fields, prototype keys, malformed Unicode, duplicate internal IDs and mismatched placeholders for known English keys are rejected. Unknown module namespaces remain available for future modules, with structural and placeholder-syntax checks. Limits: eight custom packages (built-ins do not count), 1 MB per library/file, 64 namespaces per package, 10,000 entries, 4,000 UTF-16 units per entry, 500,000 key/value units per package.

Studio stores the locale, selected UUID and custom library in one versioned `studio.localization` record through PreferenceSettings and LanguageLibrary. Failed writes change neither the active in-memory state nor the persisted record. Existing installed packages are backed up to `studio.localization.backup` before moving from separate preference records. Unsupported future or corrupt localization records are preserved and cannot be overwritten through the language UI. Existing v4 document resources receive stable package IDs during pure decoding; v1–v3 documents remain unsupported.

Overlay profiles store their language code and optional `localePackageId` independently of Studio. Only runtime namespaces and package metadata needed by overlay profiles are embedded; UI catalogs stay out of the OBS document. Selecting a UI-only package for an overlay uses the built-in runtime label fallback for its locale.

## Text rendering

Choose **Unicode** in Font family for the bundled Noto stack. Existing font choices also have the same offline fallbacks. The application embeds Noto fonts for Latin, Greek, Cyrillic, CJK, Arabic, Hebrew, major Indic scripts, Thai, Khmer, Lao, Myanmar, Armenian, Georgian and emoji. Font sources, checksums and OFL licenses are under `studio/public/fonts/`; no CDN is used. Fonts are requested only when their covered characters are used.

Text is segmented into grapheme clusters for measurement and truncation. Combining marks, surrogate pairs, emoji modifiers and ZWJ sequences are kept together. IME composition stays a local draft until confirmation. Complex scripts use zero letter spacing to preserve natural joining. Each authored label determines its own direction; the overlay canvas keeps physical left-to-right coordinates. Loaded fonts trigger text fitting again and the listener is removed when a scene is disposed.

Short captions remain limited to 100 UTF-16 units, descriptions to 500; the editor stops at the last complete grapheme inside the limit. Text is never silently transliterated or Unicode-normalized. Manual font size can intentionally exceed a key; enable Fit text for automatic sizing. Fonts do not guarantee every historical or specialist Unicode character, and not every possible emoji sequence has a dedicated glyph.

## Configuration contract

Settings failures cross UI boundaries as `SettingsError(code, diagnostic, params)`. Translate them with `trError`; packages can override stable `errors:settings.<code>` keys and retain `{{id}}` where appropriate. Diagnostic text remains the fallback for an unknown extension code. Parameters contain setting identifiers, never rejected values or credentials, and interpolation does not evaluate inserted text a second time. Other application-owned messages still use the English catalogue adapter.

Current document generation remains v4 and protocol remains v5. `profiles[].locale` defaults to `en`; `localePackageId` is optional and must reference a package with the matching locale. Document `languagePacks` defaults to an empty array. Writers require `visual.localization: 2`; older locale-only clients are blocked from overwriting package selections. Capture validates package identities, origins, selected references, metadata and text before atomic persistence, using the same structural limits as Studio. Runtime input samples never enter the language or settings stores.
