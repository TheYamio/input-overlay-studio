# Release presentation standard / Стандарт релизов

Input Overlay Studio publishes **versioned, bilingual GitHub Releases**. GitHub Releases are a user-facing product page; `docs/CHANGELOG.md` remains the chronological technical source of truth.

## 1. Naming

**Release title:** `Input Overlay Studio vX.Y.Z — TYPE: Short descriptive name`

**Tag:** `vX.Y.Z`, or `vX.Y.Z-beta.N` / `vX.Y.Z-rc.N` for pre-releases. Never add marketing labels to tags.

| Type | When to use | Example |
| --- | --- | --- |
| Major Update | Large product milestone or extensive redesign, regardless of SemVer major number | `Input Overlay Studio v0.6.2 — Major Update: Studio Redesign` |
| Feature Update | User-facing features or focused improvements | `Input Overlay Studio v0.4.0 — Feature Update: Visual Customization` |
| Hotfix | Urgent/small bug fixes after a release | `Input Overlay Studio v0.6.3 — Hotfix: Localization & Settings` |
| Maintenance | Reliability, performance, dependencies, or polish with no major user-visible features | `Input Overlay Studio v0.6.4 — Maintenance: Stability Improvements` |
| Beta / Release Candidate | Pre-release testing, marked **Pre-release** on GitHub | `Input Overlay Studio v0.7.0-beta.1 — Beta: Feature Preview` |

**Important:** `Major Update` is a communication label, **not** SemVer's MAJOR component. Do not claim a SemVer major release unless the version really changes accordingly. While at `0.x`, document incompatible settings/protocol changes explicitly; never imply backward compatibility solely from version numbers. Do not call routine fixes "major", avoid `HotFix#1`, all-caps sensationalism or ambiguous names like `Update`.

## 2. Standard visual layout

Use clean GitHub-flavored Markdown and light, dependable HTML already used in the README. Do **not** use custom CSS, tracking pixels, moving GIFs everywhere, external badge generators or decorative stock photos.

For **Major Update** and **Feature Update**, include the existing product hero (pinned to a valid revision when possible), a small uppercase release-type eyebrow, the download/navigation links, and at most one screenshot or gameplay clip when useful. For **Hotfix** and **Maintenance**, the same consistent branded header is allowed, but keep the content short.

Every release body should follow this order:

1. **Header & primary download:** brand + one-line value statement + exact Windows archive link.
2. **Highlights / Summary:** 1–3 sentences explaining who benefits and why.
3. **What's new / Fixed:** 3–8 concrete, verified bullet points; group by features or fixes.
4. **Before updating:** relevant compatibility changes, config schema, backups, known limitations (state "none reported" only when verified).
5. **Installation:** portable ZIP procedure and WebView2 prerequisite. Link to OBS setup.
6. **Downloads & integrity:** list **only assets actually attached**; checksums, source and license when provided. Never promise an unavailable archive.
7. **Russian translation:** an expandable `<details>` block containing the materially complete Russian version of the summary, changes, compatibility, and installation.
8. **Footer:** documentation, issues, compare link (only if valid), acknowledgement/attribution as appropriate.

English is the primary public release body, followed by Russian inside `<details>`. Both must be understandable without opening the changelog. Don't copy entire changelog verbatim; link it for long lists.

## 3. Visual conventions and links

- Keep one H2/H3 hierarchy, avoid giant headings for every bullet. Prefer bold lead-ins and concise explanations.
- GitHub Release Markdown does not support arbitrary site styling. Brand with the existing SVG assets, whitespace, concise headers, tables and collapsible details.
- Use **absolute version-specific URLs** for download links. Never use `/releases/latest/download/...` in historical notes.
- When embedding a banner, reference an image verified to exist at a stable tag or commit. Relative image paths from README are not reliable in Release descriptions.
- Do not change previously published tags, ZIP names or release asset checksums when rewriting descriptions.
- Any example image must be a real screenshot of that release, not a later mockup presented as historical behavior.
- Include direct access to bug reports and release-specific docs; never include the OBS URL with a user token.
- Avoid repeated "donate" messages in release notes; add a subtle support link only when the actual destination is configured.

## 4. Download policy

**Current portable releases:** Windows x64 ZIP with the EXE and required DLL files alongside it; requires Microsoft Edge WebView2 Runtime. The runtime is not an installer. A build may be shipped without signing; never claim it is signed unless verified.

When assets exist, link:
- `Input-Overlay-Studio-VERSION-Windows-x64.zip` — portable binary.
- `Input-Overlay-Studio-VERSION-Source.zip` — corresponding source, notices and build documentation.
- `SHA256SUMS-VERSION.txt` — checksums of release archives.

Some historical releases (notably v0.4.0) **do not include** an uploaded source ZIP or a checksums file. Instead link the tagged source archive and never present missing assets as downloadable.

For GPL-3.0 releases, retain matching source availability, license information and attribution; follow legal and release documentation for distribution obligations. For every update, verify bundled source corresponds to the binary before publication.

## 5. Required release metadata & verification

- Tag, title, body, commit SHA, published date, pre-release/Latest status.
- Summary confirmed against `docs/CHANGELOG.md` and the tagged code.
- App version, document/schema version, protocol version **when relevant and verified**.
- Breaking changes and migration/backup instructions, not hidden below the fold.
- Exact downloadable assets and SHA-256 matches, where attached.
- At least a smoke test for launch, input capture, OBS Browser Source, local save/restart, and update from a supported version; do not invent test results.
- For feature updates, add one in-app screenshot/gif or game footage only when it materially clarifies the feature.

## 6. Publishing workflow

1. Finalize and test release, sync versions and `docs/CHANGELOG.md`.
2. Consult `docs/RELEASING.md`. Copy `docs/RELEASE_TEMPLATE.md` into a new release draft and replace **all** placeholders.
3. Verify exact source/binary/checksum assets, update notes, and links before publishing. Include compatibility warnings near the top when needed.
4. Keep the Release as **Draft** until assets and descriptions are independently checked. Set **Pre-release** for beta/RC; set **Latest** only for the intended stable release.
5. Publish only when compiled assets match the intended tag.
6. After publishing, check render on desktop/mobile and test links. Editing text is okay to fix clarity or incorrect links; disclose any changes that affect a user-facing fact. Never silently replace attached binaries under the same tag.
7. Existing release notes drafted in `docs/releases/` can be pasted into GitHub Releases manually; these Markdown documents are **not** automatically applied by GitHub.

## 7. Historical normalization mapping

| Tag | Standard title |
| --- | --- |
| `v0.4.0` | `Input Overlay Studio v0.4.0 — Feature Update: Visual Customization` |
| `v0.6.2` | `Input Overlay Studio v0.6.2 — Major Update: Studio Redesign` |
| `v0.6.3` | `Input Overlay Studio v0.6.3 — Hotfix: Localization & Settings` |

The prepared copy in `docs/releases/` is ready for review/paste into existing GitHub release descriptions; it deliberately leaves tags, dates and assets unchanged.
