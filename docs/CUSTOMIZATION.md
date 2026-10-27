# Customization

## Canvas and Properties

Select a module in Layers or on the canvas. Drag it to move; pull an edge or corner to resize. **Proportions locked** keeps the aspect ratio, and **Free resize** allows independent width and height. Shift temporarily switches the resize mode; Alt temporarily disables snapping.

Arrow keys move the selection by 1 canvas unit, or 10 with Shift. When a resize handle has focus, arrows adjust its edge. Escape cancels the current gesture. **Lock position** protects the object's geometry. Each completed gesture is one Undo step.

The **Properties** panel sits on the right. Drag its left edge to change the width, or double-click to restore 360 px. With the divider focused, arrows adjust the width by 16 px, Shift changes the step to 32 px, and Home/End select the minimum/maximum. In narrow windows, Properties opens as a side panel over the canvas.

Use **Fit contents** to frame all modules, **Focus selection** to frame the selected module, and **100%** for actual size. Zoom is available up to 400%. Position values use the 1920 × 1080 canvas coordinate system.

Numeric fields accept a period or comma. Arrow keys adjust the value; Shift increases the step; Escape cancels the current edit. Sliders have exact numeric inputs, opacity uses percentages, and colors accept a picker or HEX value.

## Edit individual keys

1. Select **Keyboard** and open **Key Layout** in Properties.
2. Choose **Edit keys on canvas**, double-click the keyboard, or press Ctrl+E.
3. Select a key and drag it. Eight handles adjust its edges and corners. Shift keeps proportions; Alt temporarily disables snapping.
4. Use arrows for 1-unit movement, or Shift+arrows for 10 units. Holding an arrow groups the movement into one Undo step.
5. Choose **Finish editing keys on canvas** to return to the full composition.

Use **Duplicate key** to make a copy. **Key gap** adjusts the key surfaces and the corresponding artwork bounds. A keyboard supports up to 100 keys.

### Assign an input

Choose **Assign by pressing a key**, then press the physical key. Left and right Shift, Ctrl and Alt are recognized separately. Enable **Update label when assigning** to update the caption along with the binding.

Escape, **Cancel**, changing tools or losing window focus ends assignment. The capture also times out after 15 seconds. **Advanced key code** allows direct entry of a Windows VK code, including Escape. Physical key positions are used across keyboard layouts.

## SVG shapes and labels

Upload a contour under **Appearance → Borders & shape → Upload SVG shape**. The shape defines the background, artwork, border and press highlight. Cutouts remain transparent, and the vector shape travels with exported presets.

SVG files can be up to 128 KB with up to 64 contours. Supported geometry includes paths, transformed groups, rectangles, circles, ellipses, lines and polygons. Convert text, effects, references and clipping paths to outlines before import. Use `fill-rule="evenodd"` for cutouts. Define SVG corner rounding in the file; **Corner radius** adjusts standard rectangles.

Apply a shape to the entire module or enable **Customize this key/button** for an individual control. **Mouse body Shape** changes the body in **Mouse Diagram** mode. **Remove unused shapes** clears unreferenced library entries.

Use **Appearance → Text & typography → Show labels** to control captions for the module or an individual key/button. **Fit text inside key** adjusts the text to its key; **Fit text inside module** fits the Distance or Sensitivity display.

## Continuous keycap artwork

1. Select **Keyboard** or **Mouse Buttons**.
2. Open **Artwork → Keycap Image → Upload image** and choose a PNG, JPEG or WebP file.
3. Open **Position & scale image**. Drag to position the image and scroll to scale it. Numeric fields set exact position, scale and rotation.
4. Choose **Cover**, **Contain**, **Original** or **Tile**, then select **Apply image placement**. Cancel or Escape discards the draft; Undo restores the previous applied settings.
5. Adjust **Image opacity**, **Image blending**, brightness, contrast, saturation and tint. Applied changes sync to OBS automatically.

Each key shows its section of one continuous image. Gaps, rounded corners and cutouts in custom shapes remain untouched. To exclude a key, clear **Include this key in image** in Key Layout; mouse buttons have the equivalent option under **Individual Mouse Button**. Labels and borders appear above the image.

| Image on press | Effect |
| :--- | :--- |
| Tint | Overlays the active color; adjust its strength with **Pressed color overlay**. |
| Brighten | Increases image brightness and opacity while held. |
| Hide | Uses the key's active background color while held. |

**Background opacity** controls the surface, **Image opacity** controls the artwork, and module **Opacity** controls the entire module including text. For translucent artwork over gameplay, keep module opacity at 100% and adjust the surface and image separately.

Upload images up to 8 MB and 24 megapixels. Studio fits them within 2048 × 2048 and stores optimized WebP. A configuration supports up to eight used images within its 1.8 MB JSON limit.

For cross-module artwork and the full image editor, see [Visual features](VISUAL_FEATURES.md).

## Individual styles

**Appearance** defines the module style. Enable **Customize this key** or **Customize this button** to override individual values. **Inherited** follows the module, **Reset ↶** restores one inherited value, and **Use module style** restores the complete module style.

Adjust normal and pressed colors, surface opacity, borders, rounding, fonts, text size and weight, letter spacing, outlines and shadows.

**Copy style** captures the effective style; **Paste style** applies it to another key or button. **Paste style to all keys** and **Paste style to shown buttons** apply the style in one Undo step.

In **Mouse Diagram**, use **Individual Mouse Button** to adjust each button's local position and size. **Reset button position & size** restores its geometry. **Scroll highlight** controls wheel-direction highlight duration.

Distance and Sensitivity have text, surface and border settings. Sensitivity supports horizontal and vertical arrangements.

## Animation and lighting

Open **Appearance → Press & release** to configure motion and lighting.

| Setting | Options |
| :--- | :--- |
| Button motion | None, Press, Scale, Lift, Bounce, Pulse |
| Lighting mode | Fill, Outline, Glow, Fill + glow, Gradient, Ripple, Analog Fill, Off |
| Timing | Press/release duration and delay, in milliseconds |

Gradient uses **Accent color**, **Secondary light color** and the gradient angle. Adjust lighting intensity and glow strength separately. Set a nonzero **Border width** for Outline.

Short presses are shown with the configured delay, and another press cancels a pending release. **Play animation** previews the effect. Individual keys and mouse buttons support inherited values, per-value reset and style copying. **Reduced motion** disables motion and ripple animation. Glow quality follows the Performance setting.

## Mouse trail

Choose a style: Clean Line, Fade Trail, Neon Trail, Speed Gradient or Segmented Trail. **Trail Appearance** controls the grid, center, marker, slow/fast colors and click effects, including their size and duration.

**Camera follow** controls smoothing in **Follow / Recenter**. **DPI Normalized Scale** uses the profile DPI for movement scale. Adjust the background opacity for a transparent trail surface.

## Preset library

Choose a standard layout or a creator-made preset. **Full layouts** loads the shown buttons, shapes, artwork and positions while retaining the profile's game, DPI and sensitivity. **Colors on my layout** previews your composition in each palette and applies colors and surface transparency.

**Save current setup** captures a complete layout or reusable palette. Add a name and a description of up to 500 characters. Saved presets include color swatches and support search, export and import. **Edit details** changes the metadata; **Update from current setup** refreshes the saved composition.

**Yamio preset → Use full layout** loads an 81-key violet-and-lime keyboard, a graphite cutout mouse with pink accents, and a light-to-pink mouse trail. Undo returns to the previous composition.

## Commands and keyboard shortcuts

The toolbar below the canvas shows the command target: **Module**, **Key** or **Mouse button**. Enter key editing with **Edit keys on canvas**, a double-click or Ctrl+E. Use **Edit individual mouse buttons** or **Edit mouse button** to select a mouse control. Escape exits individual editing, then clears the selection.

| Default shortcut | Action |
| :--- | :--- |
| Ctrl+C / Ctrl+V | Copy / paste the selected object |
| Ctrl+X | Cut the selected object |
| Ctrl+D | Duplicate the selected object |
| Delete / Backspace | Delete a module or key; hide a mouse button |
| Ctrl+Z | Undo an action or cancel the current gesture |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+S | Save the profile |
| Ctrl+E | Toggle key / mouse-button editing |
| Ctrl+Shift+G | Toggle snapping |
| Ctrl+Shift+I / Ctrl+Shift+L | Toggle Properties / Layers |
| Shift+1 / Shift+0 | Fit the full canvas / show 100% |
| Ctrl+= / Ctrl+− | Zoom in / out |

Open **Settings → Keyboard shortcuts** or select **Shortcuts** in the canvas toolbar. Search for a command, assign up to three shortcuts, disable a binding or restore defaults. For a conflict, choose **Reassign shortcut** or keep the existing binding. Escape cancels recording; recording times out after 20 seconds. Shortcuts follow physical key positions across keyboard layouts.

The object clipboard works between profiles in the current Studio window and carries required images and SVGs. Pasted modules receive an independent artwork group. A copied key carries its visible style; a duplicated key retains inheritance. Pasting a mouse button applies the style, label and geometry to the selected physical input. Duplicating uses the first hidden mouse input from 1–7. A profile supports up to 32 modules.

Text fields use their normal editing shortcuts. **Lock position** protects the object's geometry and composition. Shortcut preferences are saved on this device.

## Undo, save and transfer

A completed move, resize or held-arrow movement forms one Undo step. Slider drags and continuous text, number and color edits are grouped until focus changes. Edits continue saving locally and syncing as you work.

Use **Presets → Save current setup** to keep a composition. **Export preset** carries its images; **Settings → Export JSON** exports all profiles and saved presets. See [Saving & sync](SAVING_AND_SYNC.md) for backups and recovery.
