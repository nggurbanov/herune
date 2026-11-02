//! Durable, private staging for images pasted into a draft.
//!
//! Stage off the UI thread, retaining the captured editor and draft owner; verify
//! that owner again before attaching the result. The returned path has the same
//! lifetime requirements as any other persisted attachment:
//! it must remain available through draft recovery and pending send recovery.
use std::path::{Path, PathBuf};

#[allow(dead_code)] // The composer paste hook is coordinated with the Mac view owner.
pub(crate) fn save(image: &rune::ClipboardImage) -> Result<PathBuf, String> {
    save_at(&super::state_dir()?, image)
}

fn save_at(state: &Path, image: &rune::ClipboardImage) -> Result<PathBuf, String> {
    let png = image.png();
    if png.len() > crate::gateway::MAX_CHAT_ATTACHMENT_BYTES {
        return Err("The pasted image exceeds the 25 MiB attachment limit".into());
    }
    let path = state
        .join("pasted-images")
        .join(format!("Pasted-image-{}.png", uuid::Uuid::new_v4()));
    super::private_write(&path, png)
        .map_err(|_| "The pasted image could not be saved to the draft".to_owned())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("herune-paste-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn staged_images_remain_private_distinct_and_byte_exact() {
        let root = Scratch::new();
        let png = [
            &b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"[..],
            &[0, 0, 0, 2, 0, 0, 0, 3],
        ]
        .concat();
        let image = rune::ClipboardImage::from_png(png.clone()).unwrap();
        let a = save_at(&root.0, &image).unwrap();
        let b = save_at(&root.0, &image).unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&a).unwrap(), png);
        assert_eq!(std::fs::read(&b).unwrap(), png);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&a).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(a.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }

    #[test]
    fn oversized_image_is_rejected_without_writing_a_file() {
        let root = Scratch::new();
        let mut png = vec![0u8; crate::gateway::MAX_CHAT_ATTACHMENT_BYTES + 1];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[19] = 2;
        png[23] = 3;
        let image = rune::ClipboardImage::from_png(png).unwrap();
        assert!(save_at(&root.0, &image).is_err());
        assert!(!root.0.exists());
    }
}
