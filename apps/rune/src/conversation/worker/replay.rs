use super::*;
const FILE_LIMIT: usize = 5 * 1024 * 1024;
const FROZEN_LIMIT: usize = 64 * 1024 * 1024;
fn data_url(value: &Value, image: bool) -> Result<std::sync::Arc<str>, CallError> {
    // Images use the HTTP image-upload endpoint; other files still use the
    // gateway's bounded WebSocket file.attach payload.
    let limit = if image {
        crate::gateway::MAX_CHAT_ATTACHMENT_BYTES
    } else {
        FILE_LIMIT
    };
    let data = value
        .as_str()
        .or(value["data_url"].as_str())
        .or(value["dataUrl"].as_str())
        .ok_or("The stored attachment returned no bytes")?;
    let (head, encoded) = data
        .split_once(',')
        .ok_or("The stored attachment returned invalid data")?;
    if !head.starts_with("data:") || !head.ends_with(";base64") || data.len() > limit * 2 {
        return Err(
            "The stored attachment has an unsupported encoding or exceeds the safe replay limit"
                .into(),
        );
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "The stored attachment encoding is invalid")?;
    if bytes.len() > limit {
        return Err(format!(
            "This stored attachment exceeds the {} MiB replay limit. History has not been changed",
            limit / (1024 * 1024)
        )
        .into());
    }
    Ok(data.into())
}
impl Worker {
    pub(super) fn prepare_replay(
        &mut self,
        entry: &mut Prepared,
        journal: &Journal,
        snapshot: &Snapshot,
    ) -> Result<(), CallError> {
        let Some(bundle) = entry.input.replay.clone() else {
            return Ok(());
        };
        bundle.verify(&self.connection, &self.scope)?;
        if !snapshot.canonical {
            return Err("This gateway does not support safe canonical multimodal replay. History has not been changed".into());
        }
        if bundle.attachments.len() > 16 {
            return Err("This turn has too many attachments to safely replay at once".into());
        }
        if entry.text.is_none() {
            entry.text = Some(bundle.transport.clone());
            journal.save(entry)?;
        }
        let mut total: usize = bundle
            .attachments
            .iter()
            .filter_map(|attachment| attachment.frozen.as_ref())
            .map(|value| value.len())
            .sum();
        if total > FROZEN_LIMIT {
            return Err("This turn exceeds the 64 MiB frozen replay budget. Its history has not been changed".into());
        }
        // Freeze every byte before a rewind. A failed fetch/size/version check
        // cannot destroy a turn and leave its attachments unrecoverable.
        for index in 0..bundle.attachments.len() {
            if entry.input.replay.as_ref().unwrap().attachments[index]
                .frozen
                .is_none()
            {
                let attachment = &bundle.attachments[index];
                let value = if attachment.source.starts_with("data:") {
                    json!(attachment.source)
                } else {
                    self.transport()?.replay_media(
                        &attachment.source,
                        &snapshot.stored,
                        attachment.image,
                    )?
                };
                let frozen = data_url(&value, attachment.image)?;
                if attachment.image && !frozen.starts_with("data:image/") {
                    return Err("A stored image no longer contains image bytes. History has not been changed".into());
                }
                total = total.checked_add(frozen.len()).ok_or("This turn exceeds the 64 MiB frozen replay budget. Its history has not been changed")?;
                if total > FROZEN_LIMIT {
                    return Err("This turn exceeds the 64 MiB frozen replay budget. Its history has not been changed".into());
                }
                entry.input.replay.as_mut().unwrap().attachments[index].frozen = Some(frozen);
                journal.save(entry)?;
            }
        }
        if entry.input.rewind.as_ref().is_some_and(|r| r.restore_only) {
            return Ok(());
        }
        for index in entry.replay_attached..bundle.attachments.len() {
            let attachment = entry.input.replay.as_ref().unwrap().attachments[index].clone();
            let bytes = attachment
                .frozen
                .as_ref()
                .ok_or("A restored attachment has no frozen bytes")?
                .clone();
            if attachment.image {
                let value = self
                    .transport()?
                    .upload_image(bytes.to_string(), &attachment.name)?;
                entry.images.push(value);
            } else {
                let value = self.transport()?.call(
                    "file.attach",
                    json!({"session_id":snapshot.runtime,"name":attachment.name,"data_url":bytes}),
                )?;
                if value["attached"] != true {
                    return Err(
                        "The agent refused the restored file. History has not been changed".into(),
                    );
                }
                let reference = value["ref_text"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("The restored file has no acknowledged reference")?
                    .to_owned();
                let text = entry.text.as_deref().unwrap_or("");
                entry.text = Some(format!(
                    "{reference}{}{}",
                    if text.is_empty() { "" } else { "\n\n" },
                    text
                ));
                entry.replay_refs.push(reference);
            }
            entry.replay_attached = index + 1;
            journal.save(entry)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_image_limit_matches_upload_without_raising_file_limit() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(vec![1; FILE_LIMIT + 1]);
        let image = json!(format!("data:image/png;base64,{encoded}"));
        assert!(data_url(&image, true).is_ok());
        assert!(data_url(&image, false).is_err());

        let oversized = base64::engine::general_purpose::STANDARD.encode(vec![
            1;
            crate::gateway::MAX_CHAT_ATTACHMENT_BYTES
                + 1
        ]);
        assert!(data_url(&json!(format!("data:image/png;base64,{oversized}")), true).is_err());
    }
}
