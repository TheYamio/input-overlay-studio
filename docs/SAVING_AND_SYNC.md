# Saving & sync

Accepted edits are saved locally. Studio sends changes to the capture server after a 350 ms delay, and connected OBS sources receive the saved configuration.

## Save status

| Status | Meaning |
| :--- | :--- |
| **Saved locally** | The draft is stored on this device. |
| **Saving…** | Studio is waiting for the server to confirm the save. |
| **Synced to OBS** | The server has saved this version and distributed it to connected OBS sources. |
| **Conflict · local draft kept** | Another editor saved a different version. Choose which version to use. |
| **Local save failed / Save failed · draft kept** | Export the draft, then check storage or the connection before closing Studio. |

## Resolve changes from another editor

When two editors change the same document, Studio offers three actions:

1. **Export local draft** saves your current version as a separate JSON file.
2. **Publish local version** replaces the server document with your draft after checking its revision again.
3. **Use server version** loads the server document. Your previous local version remains available through Undo during the current session.

Each choice applies to the complete document. After reconnecting or restarting, Studio resumes publishing the local draft when the server revision matches the one it was based on. Matching content is recognized as already saved. A different server revision opens the version choice above.

## Back up and transfer

- **Settings → Export JSON** exports all profiles, presets and their resources.
- **Export preset** transfers one saved composition with its images.
- **Import JSON** and **Import preset** load the corresponding exports.

Connection credentials are stored separately from profile exports.

## Restore your work

Studio keeps the previous working configuration as a backup. If the main configuration file is damaged, the application offers recovery. **Restore last local backup** loads the previous browser copy; native `.backup.json` files are kept in the application data directory.

When a save fails, use **Export local draft** before closing the editor. Keep an exported copy when moving to another computer or updating the application.

## Update the application

1. Export a copy of your profiles.
2. Choose **Exit** from the system tray menu.
3. Extract the new ZIP and run Studio.
4. Refresh the Browser Source in OBS.
