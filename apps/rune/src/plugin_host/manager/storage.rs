//! Merge plugin-owned key changes without replacing another window's snapshot.
use serde_json::{Map, Value};
use std::{collections::BTreeMap, path::Path};

const LIMIT: usize = 5 * 1024 * 1024;
const DECISIONS: &str = "hermes.desktop.pluginDecisions.v2";
const LEGACY: &str = "hermes.desktop.disabledPlugins.v1";
const DECISION_PREFIX: &str = "\0decision:";

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
    let (key, value) = if event["type"] == "plugin-decision-patch" {
        let id = event["pluginId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 4096 && !id.chars().any(char::is_control))
            .ok_or("Invalid plugin decision identity")?;
        let enabled = event["enabled"]
            .as_bool()
            .ok_or("Invalid plugin decision")?;
        (format!("{DECISION_PREFIX}{id}"), Some(enabled.to_string()))
    } else {
        let key = event["key"]
            .as_str()
            .filter(|key| allowed(key))
            .ok_or("Invalid plugin storage key")?;
        let value = match event.get("value") {
            Some(Value::Null) => None,
            Some(Value::String(value)) if value.len() <= LIMIT => Some(value.clone()),
            _ => return Err("Invalid plugin storage value".into()),
        };
        (key.to_owned(), value)
    };
    let total: usize = pending
        .iter()
        .filter(|(other, _)| other.as_str() != key.as_str())
        .map(|(key, value)| key.len() + value.as_ref().map_or(0, String::len))
        .sum();
    if total
        .saturating_add(key.len())
        .saturating_add(value.as_ref().map_or(0, String::len))
        > LIMIT
    {
        return Err("Pending plugin storage changes exceed the size limit".into());
    }
    pending.insert(key, value);
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
        for (key, value) in pending
            .iter()
            .filter(|(key, _)| !key.starts_with(DECISION_PREFIX))
        {
            if !allowed(key) {
                return Err("Invalid plugin storage key".into());
            }
            if let Some(value) = value {
                values.insert(key.clone(), Value::String(value.clone()));
            } else {
                values.remove(key);
            }
        }
        if pending.keys().any(|key| key.starts_with(DECISION_PREFIX)) {
            let mut decisions: Map<String, Value> = if let Some(raw) = values
                .get(DECISIONS)
                .and_then(Value::as_str)
                .filter(|raw| !raw.is_empty())
            {
                let parsed: Map<String, Value> = serde_json::from_str(raw)
                    .map_err(|_| "Saved plugin decisions are invalid; they were preserved")?;
                if parsed.values().any(|value| !value.is_boolean()) {
                    return Err("Saved plugin decisions are invalid; they were preserved".into());
                }
                parsed
            } else if let Some(raw) = values
                .get(LEGACY)
                .and_then(Value::as_str)
                .filter(|raw| !raw.is_empty())
            {
                let disabled: Vec<String> = serde_json::from_str(raw)
                    .map_err(|_| "Saved plugin decisions are invalid; they were preserved")?;
                disabled
                    .into_iter()
                    .map(|id| (id, Value::Bool(false)))
                    .collect()
            } else {
                Map::new()
            };
            for (key, value) in pending
                .iter()
                .filter(|(key, _)| key.starts_with(DECISION_PREFIX))
            {
                let id = key.strip_prefix(DECISION_PREFIX).unwrap();
                let enabled = match value.as_deref() {
                    Some("true") => true,
                    Some("false") => false,
                    _ => return Err("Invalid plugin decision".into()),
                };
                decisions.insert(id.into(), Value::Bool(enabled));
            }
            values.insert(
                DECISIONS.into(),
                Value::String(
                    serde_json::to_string(&decisions)
                        .map_err(|_| "Plugin decisions could not be encoded")?,
                ),
            );
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
    fn decisions_from_stale_windows_merge_and_preserve_legacy_disabled_plugins() {
        let dir =
            std::env::temp_dir().join(format!("herune-plugin-decisions-{}", uuid::Uuid::new_v4()));
        let path = dir.join("storage.json");
        let mut initial = BTreeMap::new();
        queue(&mut initial, &json!({"key":LEGACY,"value":"[\"old\"]"})).unwrap();
        queue(&mut initial, &json!({"key":DECISIONS,"value":""})).unwrap();
        apply(&path, &initial).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();
        for (id, enabled) in [("a", false), ("b", true)] {
            let barrier = barrier.clone();
            let path = path.clone();
            threads.push(std::thread::spawn(move || {
                let mut pending = BTreeMap::new();
                queue(
                    &mut pending,
                    &json!({"type":"plugin-decision-patch","pluginId":id,"enabled":enabled}),
                )
                .unwrap();
                barrier.wait();
                apply(&path, &pending).unwrap();
            }));
        }
        barrier.wait();
        for thread in threads {
            thread.join().unwrap();
        }
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let decisions: Value = serde_json::from_str(saved[DECISIONS].as_str().unwrap()).unwrap();
        assert_eq!(decisions, json!({"old":false,"a":false,"b":true}));
        assert_eq!(saved[LEGACY], "[\"old\"]");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_decisions_are_not_overwritten() {
        let dir = std::env::temp_dir().join(format!(
            "herune-plugin-bad-decisions-{}",
            uuid::Uuid::new_v4()
        ));
        let path = dir.join("storage.json");
        let mut initial = BTreeMap::new();
        queue(
            &mut initial,
            &json!({"key":DECISIONS,"value":"{\"a\":123}"}),
        )
        .unwrap();
        apply(&path, &initial).unwrap();
        let before = std::fs::read(&path).unwrap();
        let mut next = BTreeMap::new();
        assert!(
            queue(
                &mut next,
                &json!({"type":"plugin-decision-patch","pluginId":"","enabled":true})
            )
            .is_err()
        );
        queue(
            &mut next,
            &json!({"type":"plugin-decision-patch","pluginId":"b","enabled":false}),
        )
        .unwrap();
        assert!(apply(&path, &next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
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
