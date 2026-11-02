//! Plugin-owned data files. The private `data` handle never grants access to user folders.
use serde_json::{Value, json};
use std::path::Path;

fn failure(code: &str, message: &str) -> Value {
    json!({"ok":false,"error":code,"message":message})
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn private_text_survives_reopen_and_rejects_other_plugins_and_escapes() {
        let root =
            std::env::temp_dir().join(format!("herune-plugin-data-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("plugin-storage")).unwrap();
        let storage = root.join("plugin-storage/owner.json");
        let request = |id: &str, op: &str, path: &str| json!({"pluginId":id,"folder":"data","op":op,"path":path});
        let mut write = request("alpha", "writeText", "notes.txt");
        write["text"] = json!("hello Привет");
        assert_eq!(run(&storage, &write)["ok"], true);
        assert_eq!(
            run(&storage, &request("alpha", "readText", "notes.txt"))["text"],
            "hello Привет"
        );
        assert_eq!(
            run(&storage, &request("beta", "stat", "notes.txt"))["exists"],
            false
        );
        assert_eq!(
            run(&storage, &request("alpha", "list", ""))["entries"][0]["name"],
            "notes.txt"
        );
        assert_eq!(
            run(&storage, &request("alpha", "readText", "../secret"))["error"],
            "invalid-path"
        );
        write["exclusive"] = json!(true);
        assert_eq!(run(&storage, &write)["error"], "exists");
        let data = root.join("plugin-files/data");
        let alpha = std::fs::read_dir(&data)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| p.join("notes.txt").exists())
            .unwrap();
        symlink(&root, alpha.join("escape")).unwrap();
        assert_ne!(
            run(
                &storage,
                &request("alpha", "readText", "escape/plugin-storage/owner.json")
            )["ok"],
            true
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub(super) fn run(storage: &Path, request: &Value) -> Value {
    #[cfg(unix)]
    {
        unix::run(storage, request).unwrap_or_else(|(code, message)| failure(code, message))
    }
    #[cfg(not(unix))]
    {
        let _ = (storage, request);
        failure(
            "unavailable",
            "Plugin data files are not yet available on this platform",
        )
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use rustix::fs::{Mode, OFlags, mkdirat, open, openat};
    use sha2::{Digest, Sha256};
    use std::{
        fs::File,
        io::{Read, Write},
        os::unix::fs::MetadataExt,
    };

    type Result<T> = std::result::Result<T, (&'static str, &'static str)>;
    const TEXT_LIMIT: usize = 4 * 1024 * 1024;
    const DIRECTORY: OFlags = OFlags::RDONLY
        .union(OFlags::DIRECTORY)
        .union(OFlags::NOFOLLOW)
        .union(OFlags::CLOEXEC);

    fn path_parts(path: &str) -> Result<Vec<&str>> {
        if path.len() > 4096 || path.contains(['\\', '\0', ':']) || path.starts_with('/') {
            return Err(("invalid-path", "A relative path is required"));
        }
        if path.is_empty() {
            return Ok(vec![]);
        }
        let parts: Vec<_> = path.split('/').collect();
        if parts
            .iter()
            .any(|p| p.is_empty() || *p == "." || *p == "..")
        {
            return Err(("invalid-path", "A relative path is required"));
        }
        Ok(parts)
    }

    fn io_error(error: rustix::io::Errno) -> (&'static str, &'static str) {
        match error {
            rustix::io::Errno::NOENT => ("not-found", "The file or folder was not found"),
            rustix::io::Errno::EXIST => ("exists", "The file already exists"),
            rustix::io::Errno::LOOP => ("outside-folder", "Symbolic links are not allowed"),
            _ => ("io-error", "The plugin data file could not be accessed"),
        }
    }

    fn metadata(file: &File) -> Result<std::fs::Metadata> {
        file.metadata()
            .map_err(|_| ("io-error", "The file could not be inspected"))
    }
    fn regular(file: &File) -> Result<std::fs::Metadata> {
        let meta = metadata(file)?;
        if !meta.is_file() {
            return Err(("not-a-file", "The path is not a regular file"));
        }
        if meta.nlink() != 1 {
            return Err(("protected", "Hard-linked files are not supported"));
        }
        Ok(meta)
    }
    fn modified(meta: &std::fs::Metadata) -> u128 {
        meta.modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis())
    }

    pub(super) fn run(storage: &Path, request: &Value) -> Result<Value> {
        let id = request["pluginId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
            .ok_or(("invalid-plugin", "Invalid plugin identity"))?;
        if request["folder"] != "data" {
            return Err(("not-granted", "This folder has not been granted"));
        }
        let path = request["path"].as_str().unwrap_or("");
        let parts = path_parts(path)?;
        let state = storage
            .parent()
            .and_then(Path::parent)
            .ok_or(("io-error", "Invalid plugin storage location"))?;
        std::fs::create_dir_all(state).map_err(|_| {
            (
                "io-error",
                "The client state directory could not be created",
            )
        })?;
        let mut dir = open(state, DIRECTORY, Mode::empty()).map_err(io_error)?;
        let key = format!("{:x}", Sha256::digest(id.as_bytes()));
        for component in ["plugin-files", "data", key.as_str()] {
            match mkdirat(&dir, component, Mode::RUSR | Mode::WUSR | Mode::XUSR) {
                Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                Err(error) => return Err(io_error(error)),
            }
            dir = openat(&dir, component, DIRECTORY, Mode::empty()).map_err(io_error)?;
        }
        let op = request["op"].as_str().unwrap_or("");
        let (parents, name) = if parts.is_empty() {
            (&parts[..], None)
        } else {
            (&parts[..parts.len() - 1], parts.last().copied())
        };
        for part in parents {
            dir = openat(&dir, *part, DIRECTORY, Mode::empty()).map_err(io_error)?;
        }
        if op == "list" {
            if let Some(name) = name {
                dir = openat(&dir, name, DIRECTORY, Mode::empty()).map_err(io_error)?;
            }
            let mut entries = Vec::new();
            let mut iterator = rustix::fs::Dir::read_from(&dir).map_err(io_error)?;
            let mut truncated = false;
            while let Some(entry) = iterator.read() {
                let entry = entry.map_err(io_error)?;
                let name = match entry.file_name().to_str() {
                    Ok(name) if name != "." && name != ".." => name,
                    _ => continue,
                };
                if entries.len() == 10_000 {
                    truncated = true;
                    break;
                }
                let directory = openat(&dir, name, DIRECTORY, Mode::empty()).is_ok();
                entries.push(json!({"name":name,"path":if path.is_empty() { name.to_owned() } else {format!("{path}/{name}")},"isDirectory":directory}));
            }
            return Ok(json!({"ok":true,"entries":entries,"truncated":truncated}));
        }
        if name.is_none() && op == "stat" {
            return Ok(json!({"ok":true,"exists":true,"isDirectory":true}));
        }
        let name = name.ok_or(("invalid-path", "A file path is required"))?;
        if op == "writeText" {
            let text = request["text"]
                .as_str()
                .ok_or(("invalid-op", "Text is required"))?;
            if text.len() > TEXT_LIMIT {
                return Err(("too-large", "Text exceeds the 4 MiB limit"));
            }
            let exclusive = request["exclusive"].as_bool().unwrap_or(false);
            let flags = OFlags::WRONLY
                | OFlags::CREATE
                | OFlags::NOFOLLOW
                | OFlags::NONBLOCK
                | OFlags::CLOEXEC
                | if exclusive {
                    OFlags::EXCL
                } else {
                    OFlags::empty()
                };
            let fd = openat(&dir, name, flags, Mode::RUSR | Mode::WUSR).map_err(io_error)?;
            let mut file = File::from(fd);
            regular(&file)?;
            file.set_len(0)
                .and_then(|_| file.write_all(text.as_bytes()))
                .map_err(|_| ("io-error", "The file could not be written"))?;
            let meta = regular(&file)?;
            return Ok(json!({"ok":true,"path":path,"size":meta.len(),"mtimeMs":modified(&meta)}));
        }
        let fd = match openat(
            &dir,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) if op == "stat" => {
                return Ok(json!({"ok":true,"exists":false}));
            }
            Err(error) => return Err(io_error(error)),
        };
        let file = File::from(fd);
        let meta = metadata(&file)?;
        if op == "stat" {
            return Ok(
                json!({"ok":true,"exists":true,"isDirectory":meta.is_dir(),"size":meta.len(),"mtimeMs":modified(&meta)}),
            );
        }
        if op != "readText" {
            return Err(("invalid-op", "Unsupported plugin data operation"));
        }
        regular(&file)?;
        let mut bytes = Vec::new();
        file.take((TEXT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| ("io-error", "The file could not be read"))?;
        if bytes.len() > TEXT_LIMIT {
            return Err(("too-large", "Text exceeds the 4 MiB limit"));
        }
        if bytes.contains(&0) {
            return Err(("binary", "The file is not UTF-8 text"));
        }
        let text =
            String::from_utf8(bytes).map_err(|_| ("binary", "The file is not UTF-8 text"))?;
        Ok(json!({"ok":true,"text":text,"size":meta.len(),"mtimeMs":modified(&meta)}))
    }
}
