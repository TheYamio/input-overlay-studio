# Visual features

## Shared artwork across modules

1. Select **Keyboard** or **Mouse Buttons** and upload an image in **Keycap Image**.
2. Open **Shared artwork across modules** and select the other keyboard or mouse modules. The selected modules share the image and its settings.
3. Adjust the image in **Position & scale image**. The preview shows the entire group.
4. Editing the image settings of any participant updates the group in one Undo step.

The group bounds follow the keycap surfaces and module scales. **Cover** and **Contain** fit the image to these bounds. Moving or adding a participant can change the fitted scale. Shared groups use scene coordinates for **Original**, **Tile** and X/Y placement; individual modules use local layout coordinates.

## Image editor

The preview sits on the left, with separately scrolling **Placement** and **Image & color** panels on the right.

- Drag to move the image; scroll to scale it. Arrow keys move it by 1 unit, or 10 with Shift.
- **Center image** resets the offset. **Flip horizontally** and **Flip vertically** mirror the image.
- **Preview zoom** offers 150% and 200% views. Use the scrollbars to move around the preview.
- **Source guide** shows a translucent view of the original image.
- **Compare original** shows the settings from when the editor opened.
- Adjust opacity, blending, brightness, contrast, saturation, tint and the image response to a press. **Reset placement** and **Reset image adjustments** reset their respective groups.
- **Apply image placement** commits the draft in one Undo step. **Cancel** and Escape discard it.

## State preview

In **Properties → Key/button preview**, choose **Input**, **Idle**, **Pressed**, **Analog**, **Scroll up** or **Scroll down**. Analog depth ranges from 0 to 1. **Input** returns to the selected Live or Demo mode.

The image editor has the same preview controls for tuning pressed text, glow, Analog Fill and the image response to a press.

## Layout presets

| Preset | Layout |
| :--- | :--- |
| Essential | Compact FPS controls |
| Competitive | Extended keyboard with a separate mouse trail |
| Obsidian | General-purpose composition |
| Neon | Large streaming layout |
| Glass | Vertical layout on the right |
| Clean Recording | Minimal horizontal layout |
| Classic Input | Vertical layout on the left |

Choose **Colors on my layout → Apply colors** to apply a palette to the current composition, or **Full layouts → Use full layout** to load the preset's buttons, shapes, artwork and positions. Both actions support Undo and retain the profile's DPI and sensitivity.

## Save and share

Save the composition in the preset library or export it with its images. Use **Export JSON** to transfer all profiles. See [Saving & sync](SAVING_AND_SYNC.md).
