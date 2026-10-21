# Attribution and third-party software

Input Overlay Studio modifies **girlglock/input-overlay**, upstream commit `d31469bd4c7e2295888fad78174ae821db966961`, https://github.com/girlglock/input-overlay. The GPL-3.0 LICENSE is retained unchanged. Original code, resources, AnalogSense-compatible HID readers and the original README remain. Studio modifications: October 2026.

React / React DOM (MIT), TypeScript (Apache-2.0), Vite (MIT), Zod (MIT), Lucide (ISC), Tauri (MIT/Apache-2.0), Tokio (MIT), tungstenite (MIT), windows-rs (MIT/Apache-2.0), hidapi and other dependencies retain their original licenses. Lockfiles record resolved packages; inspect the LICENSE files supplied with their dependency distributions. Original bundled resources retain their upstream notices.

Microsoft WebView2 Runtime and WebView2Loader retain Microsoft's distribution terms. The loader comes from `webview2-com-sys`. See https://www.nuget.org/packages/Microsoft.Web.WebView2 and the Microsoft terms supplied with the SDK. They are not relicensed under GPL. Include the applicable SDK notice/license when distributing the loader. Runtime is an external prerequisite and is not downloaded by this app.

The GNU LLVM Windows package also includes LLVM libunwind.dll, licensed under Apache-2.0 with LLVM exceptions. Its full license is included in docs/LLVM-RUNTIME-LICENSE.txt. Rust, the rest of LLVM-MinGW and pnpm are build tools. GPL distributions must provide the corresponding modified source and build scripts.
