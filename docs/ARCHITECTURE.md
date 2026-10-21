# Input Overlay Studio — architecture and initial audit

Audit baseline: girlglock/input-overlay, upstream main cloned 2026-10-20 (see Git history). License: GPL-3.0; original LICENSE and attribution are retained.

## Existing application

The repository is not a React monorepo. `ws-server/src-tauri` is a Tauri 2 tray application, with a vanilla settings UI in `ws-server/src`. `scripts` and the root HTML/CSS implement the original editor/OBS renderer. Windows capture uses a message-only window, `RIDEV_INPUTSINK`, `GetRawInputBuffer` and US virtual-key mapping (including sided modifiers). Mouse buttons 1–5 and signed wheel events are supported. AnalogSense-compatible HID readers in `services/analog.rs` emit normalized depths independently of digital capture. Linux uses evdev.

`ws_server.rs` authenticates the first JSON message with an existing token, then broadcasts JSON input messages. Mouse deltas pass through TWO 125 Hz aggregation stages; digital events are queued by a 1 ms polling distributor. This bounds visual frequency but loses physical distance when opposite deltas cancel. The raw flush thread also outlives capture shutdown, and its separate dx/dy locks can split samples. The channel is unbounded, lagging consumers can miss releases, and auth currently has no timeout. The input buffer is allocated on each drain. These are focused repair points, not grounds for replacing capture.

The built-in HTTP server serves compile-time embedded assets from `web-bundle`, staged by `build.rs`. Backend configuration is JSON beside the executable. HTTP is originally disabled; WebSocket defaults to localhost. There is no native device-presence stream, so an authenticated connection must not be presented as proof that a physical keyboard/mouse is connected. Analog reconnect retains original SDK behavior.

## Changes

- Keep RawInputBuffer, HID protocols, original settings UI, authentication, HTTP service and dual-PC host configuration.
- Add `studio/`: Vite + React + strict TypeScript editor; lightweight DOM/Canvas renderer uses the same configuration and input engine, outside React's input hot path.
- Keep bounded typed-array trail storage; event ingestion and physical distance happen before visual sampling. Extend mouse packets with `distance_counts`, maintaining the legacy event fields. Legacy servers remain readable but distance is explicitly approximate after their aggregation.
- Reuse the authenticated WebSocket for versioned profile/layout synchronization and persistence, so OBS needs no open editor. Tokens stay separate from exported documents and in OBS URL fragments rather than HTTP query strings.
- Build Studio into both Tauri assets and embedded HTTP assets. Original editor remains at `/`; Studio and isolated transparent OBS entry are `/studio/index.html` and `/studio/overlay.html`.
- Add schema validation, backup recovery, bounded undo, factory themes, editable layouts, profile math, and developer-only load tests. Runtime has no cloud dependency.
- Default new installs to loopback and local HTTP. Existing user host settings remain respected. Do not auto-download upstream binaries or silently replace the fork through the upstream updater.

## Verification boundaries

Synthetic 1–8 kHz input verifies processing/storage, not actual hardware polling or game latency. OBS rendering, physical devices (including analog boards), device removal and elevated/fullscreen games require the manual plan in TESTING.md. Windows executable compilation depends on Rust/MSVC/WebView2 availability; record exact performed checks separately.
