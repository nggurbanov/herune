//! Merge plugin-owned key changes without replacing another window's snapshot.
use serde_json::{Map, Value};
use std::{collections::BTreeMap, path::Path};

const LIMIT: usize = 5 * 1024 * 1024;

fn allowed(key: &str) -> bool {
    key.len() <= 16 * 1024
        && (key.starts_with("hermes.plugin.")
            || matches!(
                key,
                "hermes.desktop.pluginDecisions.v2" | "hermes.desktop.disabledPlugins.v1"
            ))
}

pub(super) fn queue(
    pending: &mut BTreeMap<String, Option<String>>,
    event: &Value,
) -> Result<(), String> {
    let key = event["key"]
        .as_str()
        .filter(|key| allowed(key))
        .ok_or("Invalid plugin storage key")?;
    let value = match event.get("value") {
        Some(Value::Null) => None,
        Some(Value::String(value)) if value.len() <= LIMIT => Some(value.clone()),
        _ => return Err("Invalid plugin storage value".into()),
    };
    let total: usize = pending
        .iter()
        .filter(|(other, _)| other.as_str() != key)
        .map(|(key, value)| key.len() + value.as_ref().map_or(0, String::len))
        .sum();
    if total
        .saturating_add(key.len())
        .saturating_add(value.as_ref().map_or(0, String::len))
        > LIMIT
    {
        return Err("Pending plugin storage changes exceed the size limit".into());
    }
    pending.insert(key.to_owned(), value);
    Ok(())
}

pub(super) fn apply(path: &Path, pending: &BTreeMap<String, Option<String>>) -> Result<(), String> {
    super::journal::locked(path, |path| {
        let mut values: Map<String, Value> = match std::fs::read(path) {
            Ok(bytes) if bytes.len() <= LIMIT => serde_json::from_slice(&bytes)
                .map_err(|_| "Saved plugin storage is invalid; it was preserved")?,
            Ok(_) => {
                return Err("Saved plugin storage exceeds the size limit; it was preserved".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(_) => return Err("Saved plugin storage could not be read".into()),
        };
        if !super::valid_storage(&Value::Object(values.clone())) {
            return Err("Saved plugin storage is invalid; it was preserved".into());
        }
        for (key, value) in pending {
            if !allowed(key) {
                return Err("Invalid plugin storage key".into());
            }
            if let Some(value) = value {
                values.insert(key.clone(), Value::String(value.clone()));
            } else {
                values.remove(key);
            }
        }
        let value = Value::Object(values);
        if !super::valid_storage(&value) {
            return Err("Plugin storage exceeds the size limit".into());
        }
        let bytes =
            serde_json::to_vec(&value).map_err(|_| "Plugin storage could not be encoded")?;
        crate::client::private_write(path, &bytes)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};

    #[test]
    fn independent_windows_merge_distinct_keys_and_deletions_without_losing_updates() {
        let dir =
            std::env::temp_dir().join(format!("herune-plugin-patches-{}", uuid::Uuid::new_v4()));
        let path = dir.join("storage.json");
        let mut seed = BTreeMap::new();
        queue(
            &mut seed,
            &json!({"key":"hermes.plugin.old.flag","value":"before"}),
        )
        .unwrap();
        apply(&path, &seed).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = vec![];
        for (key, value) in [
            ("hermes.plugin.first.setting", "one"),
            ("hermes.plugin.second.setting", "two"),
        ] {
            let path = path.clone();
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                let mut patch = BTreeMap::new();
                queue(&mut patch, &json!({"key":key,"value":value})).unwrap();
                barrier.wait();
                apply(&path, &patch).unwrap();
            }));
        }
        barrier.wait();
        for thread in threads {
            thread.join().unwrap();
        }
        let mut removal = BTreeMap::new();
        queue(
            &mut removal,
            &json!({"key":"hermes.plugin.old.flag","value":null}),
        )
        .unwrap();
        apply(&path, &removal).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            saved,
            json!({"hermes.plugin.first.setting":"one","hermes.plugin.second.setting":"two"})
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_patch_and_corrupt_storage_do_not_overwrite_existing_file() {
        let dir = std::env::temp_dir().join(format!(
            "herune-plugin-bad-storage-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("storage.json");
        std::fs::write(&path, b"not json").unwrap();
        let mut patch = BTreeMap::new();
        assert!(queue(&mut patch, &json!({"key":"unrelated","value":"x"})).is_err());
        assert!(queue(&mut patch, &json!({"key":"hermes.plugin.ok","value":3})).is_err());
        queue(&mut patch, &json!({"key":"hermes.plugin.ok","value":"x"})).unwrap();
        assert!(apply(&path, &patch).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not json");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
