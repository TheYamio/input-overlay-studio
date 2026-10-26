# Attribution and third-party software

Input Overlay Studio modifies the capture backend from **girlglock/input-overlay**, upstream commit `d31469bd4c7e2295888fad78174ae821db966961`, https://github.com/girlglock/input-overlay. The GPL-3.0 LICENSE is retained unchanged. Raw Input capture, AnalogSense-compatible HID readers and platform services retain their original attribution. The original browser editor, settings frontend, demo media and upstream updater have been removed. Studio modifications: October 2026.

React / React DOM (MIT), TypeScript (Apache-2.0), Vite (MIT), Zod (MIT), Lucide (ISC), Tauri (MIT/Apache-2.0), Tokio (MIT), tungstenite (MIT), windows-rs (MIT/Apache-2.0), hidapi and other dependencies retain their original licenses. Lockfiles record resolved packages; inspect the LICENSE files supplied with their dependency distributions. Original bundled resources retain their upstream notices. Raster validation uses image 0.25 (MIT/Apache-2.0) with PNG/JPEG/WebP decoders and base64 0.22 (MIT/Apache-2.0); their resolved transitive dependencies are recorded in Cargo.lock.

Microsoft WebView2 Runtime and WebView2Loader retain Microsoft's distribution terms. The loader comes from `webview2-com-sys`. See https://www.nuget.org/packages/Microsoft.Web.WebView2 and the Microsoft terms supplied with the SDK. They are not relicensed under GPL. Include the applicable SDK notice/license when distributing the loader. Runtime is an external prerequisite and is not downloaded by this app.

The GNU LLVM Windows package also includes LLVM libunwind.dll, licensed under Apache-2.0 with LLVM exceptions. Its full license is included in docs/LLVM-RUNTIME-LICENSE.txt. Rust, the rest of LLVM-MinGW and pnpm are build tools. GPL distributions must provide the corresponding modified source and build scripts.

## Noto offline fonts

Noto Sans and script families, Noto Sans CJK and Noto Emoji by the Noto Project contributors. Distributed under the SIL Open Font License 1.1. Sources and SHA-256 hashes: `studio/public/fonts/manifest.json`. Each font’s license is included alongside its WOFF2 asset and embedded in the application HTTP assets. Fonts are loaded locally, without a CDN.

## Tengwar offline font

Alcarin Tengwar by Toshi Omagari, SIL Open Font License 1.1. Source and SHA-256: `studio/public/fonts/manifest.json`; full license: `studio/public/fonts/alcarintengwar-OFL.txt`. The font is embedded and loaded locally. The font remains available for custom labels and language packages; the incomplete built-in artistic Sindarin glossary is no longer distributed.

## Experimental translation drafts

Standard language catalogs include locally generated drafts from Meta AI’s M2M100 418M (MIT), with manual terminology edits. Model: https://huggingface.co/facebook/m2m100_418M (revision 55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636). Translation tooling and model weights are not distributed with the application.
