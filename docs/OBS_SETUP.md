# OBS setup

## Connect your overlay

1. Extract the Windows ZIP and run **Input Overlay Studio**. Follow the setup guide to choose a layout and check keyboard, mouse and wheel input.
2. In **Profiles**, set your game, DPI and sensitivity. For CS2, use your `m_yaw` value. For KovaaK's, choose the matching sensitivity scale, custom yaw or manual cm/360.
3. Customize the overlay on the Studio canvas. Add modules from the Layers panel, drag to position them, and pull the edges or corners to resize. The right-hand **Properties** panel controls the selected object.
4. Click **Copy OBS URL**.
5. In OBS, add a **Browser Source**, paste the URL, and set its width and height. Start with **1920 × 1080**; other sizes, such as 2560 × 1440, also work. The composition fits the source proportionally with a transparent background.
6. Select the Browser Source frame rate in OBS. Configure Studio's rendering target under **Settings → Rendering performance**.

Changes save and sync automatically. **Save profile** saves manually. Closing the Studio window leaves capture running in the system tray; choose **Exit** from the tray menu to stop the application.

**Live** uses your devices. **Demo** provides sample input for editing. **Copy OBS URL** creates a live overlay source.

## Profiles and presets

A profile holds the game, DPI, sensitivity, appearance and layout. The preset library lets you save, rename, duplicate, import and export compositions with their images.

Apply a color theme to your current layout or load a complete preset. Use Undo to restore the previous composition. See [Customization](CUSTOMIZATION.md).

Use **Settings → Export JSON** to transfer all profiles and saved presets. Recovery and backup options are covered in [Saving & sync](SAVING_AND_SYNC.md).

## Mouse distance and trail

Set the correct mouse DPI for estimated physical distance and **DPI Normalized Scale**. **Fixed Field** shifts the virtual field at its boundary; **Follow / Recenter** follows the cursor smoothly. Adjust the trail's motion scale and camera follow time in its properties.

Under **Settings → Distance**:

- **Reset total distance** resets the shared counter.
- **Keep total between launches** saves the total about every three seconds.
- **Reset when capture app starts** starts a new counter each time capture launches.

## Use two computers

1. On the gaming PC, open **Settings → Native capture server**. Set the bind host to an address reachable on your LAN, enable HTTP, and apply the settings.
2. Allow the configured HTTP and WebSocket ports through the firewall. The defaults are 4456 and 4455.
3. On the OBS PC, open `http://GAME_PC:4456/studio/index.html`. Set the connection URL to `ws://GAME_PC:4455` and enter the gaming PC's token.
4. Click **Copy OBS URL** and add it as an OBS Browser Source. If clipboard access is unavailable, copy the displayed URL manually from Settings.

## Connection checks

| What to check | Action |
| :--- | :--- |
| Capture connection | Check **Capture connected**, the WebSocket address and token in Settings. |
| Browser Source address | Use the URL produced by **Copy OBS URL**, which opens `/studio/overlay.html`. |
| Local HTTP service | Enable **Local HTTP server** and check that its port is available. Apply the server settings after editing. |
| Input filtering | Review **Use FPS privacy filter** or **Clear key filter**, then apply the server settings. |
| Input broadcast | Enable **Broadcast device input** and apply the server settings. |
| Analog input | Select **auto** or the matching brand under **Analog keyboard** for your supported HID keyboard. |

Studio reconnects automatically after a connection loss and restores held keys and buttons from the capture state.

Capture options for key filtering, mouse movement, movement threshold, CPU affinity, token and startup behavior are under **Settings → Native capture server → Advanced capture settings**.
