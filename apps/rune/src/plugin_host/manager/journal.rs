//! Durable prepared submissions serialized across native host processes.
use serde_json::{Map, Value, json};
use std::{fs::OpenOptions, path::Path};

pub(super) fn path_for_storage(storage: &Path) -> Result<std::path::PathBuf, String> {
    Ok(storage
        .parent()
        .ok_or("Invalid plugin storage path")?
        .join("prepared-submissions.json"))
}
pub(super) fn locked<T>(
    path: &Path,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let parent = path.parent().ok_or("Invalid journal path")?;
    std::fs::create_dir_all(parent).map_err(|_| "Journal directory unavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Journal directory privacy failed")?;
    }
    let lock_path = path.with_extension("lock");
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(lock_path)
        .map_err(|_| "Journal lock unavailable")?;
    file.lock().map_err(|_| "Journal lock failed")?;
    let _guard = crate::client::FileLock::from_locked(file);
    operation(path)
}
fn load(path: &Path) -> Result<Map<String, Value>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Map<String, Value>>(&bytes)
            .map_err(|_| "Prepared journal is invalid; preserved for recovery".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(_) => Err("Prepared journal could not be read".into()),
    }
}
pub(super) fn read(path: &Path) -> Result<Value, String> {
    locked(path, |path| {
        serde_json::to_string(&load(path)?)
            .map(Value::String)
            .map_err(|_| "Prepared journal could not be encoded".into())
    })
}
pub(super) fn compare_and_set(path: &Path, payload: &Value) -> Result<Value, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty() && key.len() <= 16384)
        .ok_or("Invalid prepared journal key")?;
    let parse = |field: &str| -> Result<Option<Value>, String> {
        match payload.get(field) {
            Some(Value::Null) => Ok(None),
            Some(Value::String(raw)) if raw.len() <= 4 * 1024 * 1024 => {
                serde_json::from_str::<Value>(raw)
                    .map_err(|_| "Invalid prepared journal entry".to_owned())
                    .and_then(|value| {
                        if value.is_null() {
                            Err("Invalid prepared journal entry".into())
                        } else {
                            Ok(Some(value))
                        }
                    })
            }
            _ => Err("Invalid prepared journal entry".into()),
        }
    };
    let expected = parse("expected")?;
    let entry = parse("entry")?;
    locked(path, |path| {
        let mut journal = load(path)?;
        let current = journal.get(key).cloned();
        if current != expected {
            return Ok(json!({"applied":false,"current":current.map(|v| v.to_string())}));
        }
        if let Some(value) = &entry {
            journal.insert(key.to_owned(), value.clone());
        } else {
            journal.remove(key);
        }
        let bytes =
            serde_json::to_vec(&journal).map_err(|_| "Prepared journal could not be encoded")?;
        crate::client::private_write(path, &bytes)?;
        Ok(json!({"applied":true,"current":entry.map(|v| v.to_string())}))
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn journal_origin_survives_source_switch() {
        assert_eq!(
            path_for_storage(Path::new("/private/plugin-storage/source-a.json")).unwrap(),
            path_for_storage(Path::new("/private/plugin-storage/source-b.json")).unwrap()
        );
    }
    #[test]
    fn compares_and_preserves_uncertain_entries() {
        let dir = std::env::temp_dir().join(format!("herune-journal-{}", uuid::Uuid::new_v4()));
        let path = dir.join("journal.json");
        let cas = |expected: Value, entry: Value| {
            compare_and_set(&path, &json!({"key":"k","expected":expected,"entry":entry})).unwrap()
        };
        assert_eq!(cas(Value::Null, json!("{\"id\":1}"))["applied"], true);
        assert_eq!(cas(Value::Null, json!("{\"id\":2}"))["applied"], false);
        assert_eq!(cas(json!("{\"id\":2}"), Value::Null)["applied"], false);
        assert_eq!(
            serde_json::from_str::<Value>(read(&path).unwrap().as_str().unwrap()).unwrap()["k"]["id"],
            1
        );
        assert_eq!(cas(json!("{\"id\":1}"), Value::Null)["applied"], true);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn competing_writers_choose_one_entry() {
        let dir =
            std::env::temp_dir().join(format!("herune-journal-race-{}", uuid::Uuid::new_v4()));
        let path = std::sync::Arc::new(dir.join("journal.json"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|id| {
                let (path, barrier) = (path.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    compare_and_set(
                        &path,
                        &json!({"key":"k", "expected":null, "entry":format!("{{\"id\":{id}}}")}),
                    )
                    .unwrap()["applied"]
                        .as_bool()
                        .unwrap()
                })
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .filter(|applied| *applied)
                .count(),
            1
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
