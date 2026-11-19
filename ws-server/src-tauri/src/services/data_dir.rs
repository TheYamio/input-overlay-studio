use std::{env, io, path::PathBuf};
#[cfg(any(target_os = "linux", test))]
use std::path::Path;

const APP_FOLDER: &str = "InputOverlayStudio";

pub fn resolve() -> io::Result<(PathBuf, Option<PathBuf>)> {
    let executable = env::current_exe()?;
    let portable = executable.parent().ok_or_else(|| io::Error::other("executable has no parent directory"))?;
    if let Some(path) = env::var_os("INPUT_OVERLAY_STUDIO_DATA_DIR").filter(|path| !path.is_empty()) {
        return Ok((PathBuf::from(path), None));
    }
    if portable.join("config.json").is_file() {
        return Ok((portable.to_path_buf(), None));
    }
    #[cfg(target_os = "linux")]
    {
        let data = linux_default(env::var_os("XDG_DATA_HOME").map(PathBuf::from), env::var_os("HOME").map(PathBuf::from))
            .ok_or_else(|| io::Error::other("set XDG_DATA_HOME, HOME or INPUT_OVERLAY_STUDIO_DATA_DIR"))?;
        Ok((data, Some(portable.join(APP_FOLDER))))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let base = env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| portable.to_path_buf());
        Ok((base.join(APP_FOLDER), None))
    }
}

#[cfg(any(target_os = "linux", test))]
fn linux_default(xdg: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    xdg.filter(|path| path.is_absolute())
        .or_else(|| home.filter(|path| path.is_absolute()).map(|path| path.join(".local").join("share")))
        .map(|path| path.join(APP_FOLDER))
}

#[cfg(any(target_os = "linux", test))]
pub fn migrate_linux_data(old: &Path, new: &Path) -> io::Result<()> {
    if !old.join("config.json").is_file() || new.join("config.json").exists() { return Ok(()); }
    // Write the config last. An incomplete copy can be retried on the next
    // startup without overwriting any profile or distance already in place.
    for name in ["studio.json", "studio.backup.json", "studio.invalid.json", "distance.json",
        "studio-activity.json", "config.backup.json", "config.invalid.json", "config.json"] {
        let source = old.join(name);
        let target = new.join(name);
        if !source.is_file() || target.exists() { continue; }
        let temporary = target.with_extension("migration.tmp");
        std::fs::copy(source, &temporary)?;
        std::fs::rename(temporary, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_default_uses_absolute_xdg_or_home() {
        let home = env::temp_dir().join("home");
        let xdg = env::temp_dir().join("custom-data");
        assert_eq!(linux_default(Some(xdg.clone()), None), Some(xdg.join(APP_FOLDER)));
        assert_eq!(linux_default(Some("relative".into()), Some(home.clone())), Some(home.join(".local").join("share").join(APP_FOLDER)));
        assert!(linux_default(Some(PathBuf::new()), None).is_none());
    }

    #[test]
    fn migrates_legacy_data_once_and_preserves_existing_destination_files() {
        let root = env::temp_dir().join(format!("ios-data-dir-{}", rand::random::<u64>()));
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("config.json"), "old config").unwrap();
        std::fs::write(old.join("studio.json"), "old profile").unwrap();
        std::fs::write(old.join("distance.json"), "42").unwrap();
        std::fs::write(new.join("studio.json"), "current profile").unwrap();
        migrate_linux_data(&old, &new).unwrap();
        assert_eq!(std::fs::read_to_string(new.join("config.json")).unwrap(), "old config");
        assert_eq!(std::fs::read_to_string(new.join("studio.json")).unwrap(), "current profile");
        assert_eq!(std::fs::read_to_string(old.join("distance.json")).unwrap(), "42");
        std::fs::write(new.join("distance.json"), "43").unwrap();
        migrate_linux_data(&old, &new).unwrap();
        assert_eq!(std::fs::read_to_string(new.join("distance.json")).unwrap(), "43");
        for dir in [old, new] {
            for name in ["config.json", "studio.json", "distance.json"] {
                std::fs::remove_file(dir.join(name)).unwrap();
            }
            std::fs::remove_dir(dir).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }
}
