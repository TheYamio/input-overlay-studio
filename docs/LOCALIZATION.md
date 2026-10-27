# Languages and labels

## Choose a language

Open **Settings → Languages & text** to select the Studio interface language.

Built-in languages: English, Russian, Simplified Chinese, Spanish, Brazilian Portuguese, German, French, Turkish, Polish, Japanese, Korean and Traditional Chinese.

The selected language is saved for the next launch. **Profiles → Overlay label language** selects the language of generated metric labels and number formatting. Custom captions, key legends, module names and preset descriptions keep their authored text.

## Import and export translations

1. Open **Settings → Languages & text**.
2. Select **Import language package** and choose a translation JSON file.
3. Choose the imported package in the language selector.

**Export selected translation** saves the selected package's text and metadata. Export the English template to start a new translation.

Each import creates a separate custom package. The selector shows its name, origin, author or locale, and a short ID. Use the cross beside a custom package to remove it, then confirm the deletion. If it was selected, Studio switches to the matching built-in language or English.

Overlay exports include the translation resources used by their profiles.

## Create a translation package

Edit an exported template using these fields:

| Field | Purpose |
| :--- | :--- |
| `version` | Package format version; use `1`. |
| `locale` | Language identifier, such as `en`, `pt-BR` or `zh-TW`. |
| `name` | Display name in the language selector. |
| `author` | Optional translator credit. |
| `translationVersion` | Optional version of the translation. |
| `direction` | Set to `rtl` for a right-to-left interface. |

Translate the strings inside the template's namespaces. Keep the existing keys and named placeholders, such as `{{parameter}}`; placeholders may move within the translated sentence. Place generated overlay captions in the `overlay` namespace. Strings are plain text.

A library holds up to eight custom packages. Package limits are 1 MB per file/library, 64 namespaces, 10,000 entries, 4,000 UTF-16 units per entry and 500,000 combined key/value units.

## Multilingual captions

Choose **Unicode** under **Font family** to use the bundled fonts. Noto coverage includes Latin, Greek, Cyrillic, CJK, Arabic, Hebrew, major Indic scripts, Thai, Khmer, Lao, Myanmar, Armenian, Georgian and emoji. Bundled Alcarin Tengwar supports custom Tengwar labels.

Enable **Fit text** to size captions to the key or module. Text fitting keeps combining characters and emoji sequences together. IME input is applied after composition is confirmed, and each caption uses its own text direction.

Captions support up to 100 UTF-16 units and descriptions up to 500. Fonts are bundled for offline use; sources and licenses are listed in `studio/public/fonts/`.
