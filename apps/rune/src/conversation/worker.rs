use super::journal::Mutation;
mod replay;
mod rewrite;
use super::*;
use crate::gateway::{
    History,
    conversation::{CallError, Event, SessionTransport, Snapshot},
};
use base64::Engine;
use serde_json::json;
use std::time::{Duration, Instant};

pub(crate) enum Command {
    Older { stored: String, cursor: usize },
    Workspace(super::workspace::Intent),
    Attach,
    Send(Prepared, Journal),
    Discard(Prepared, Journal),
    Control(Control),
}
pub(crate) enum Control {
    Stop {
        runtime: String,
        stored: String,
        generation: u64,
        authority: u64,
    },
    Respond {
        runtime: String,
        stored: String,
        generation: u64,
        authority: u64,
        prompt_id: String,
        kind: String,
        answer: String,
    },
    LockClarify {
        runtime: String,
        stored: String,
        generation: u64,
        authority: u64,
        id: String,
        qid: Option<String>,
        answer: Option<String>,
        answers: Option<std::collections::BTreeMap<String, Option<String>>>,
    },
    Admission {
        runtime: String,
        stored: String,
        id: String,
        resolve: bool,
        steer: bool,
        generation: u64,
    },
}
pub(crate) enum Reply {
    StreamOpened {
        origin: DraftScope,
    },
    PolicyReceipt {
        origin: DraftScope,
        receipt: Value,
        payload: Value,
        stamp: Option<PolicyStamp>,
    },
    PolicySetting {
        origin: DraftScope,
        key: String,
        value: String,
    },
    Older {
        origin: DraftScope,
        cursor: usize,
        result: Result<History, CallError>,
    },
    Workspace {
        origin: DraftScope,
        result: Result<String, CallError>,
    },
    Snapshot {
        origin: DraftScope,
        snapshot: Snapshot,
        history: History,
    },
    Admitted {
        origin: DraftScope,
        id: String,
        text: String,
        status: String,
        generation: Option<u64>,
        admission: Option<String>,
        replayed: bool,
        user_row: Option<u64>,
        restored_replay: Option<ReplayBundle>,
        policy_stamp: Option<PolicyStamp>,
        policy_fields: PolicyFields,
    },
    Discarded {
        origin: DraftScope,
        id: String,
        result: Result<(), CallError>,
    },
    AttachmentsReady {
        origin: DraftScope,
        id: String,
    },
    InputRejected {
        origin: DraftScope,
        id: String,
        message: String,
    },
    Event {
        origin: DraftScope,
        event: Event,
        replay: bool,
    },
    Failed {
        origin: DraftScope,
        id: Option<String>,
        message: String,
        uncertain: bool,
        stream_loss: bool,
    },
    ClarifyLocked {
        origin: DraftScope,
        id: String,
        qid: String,
        answer: Option<String>,
        remaining: Vec<String>,
    },
    Recovered {
        origin: DraftScope,
        snapshot: Snapshot,
    },
    ModelConfirmation {
        origin: DraftScope,
        id: String,
        message: String,
        journal_revision: u64,
    },
    ControlSettled {
        origin: DraftScope,
    },
}
struct Worker {
    connection: Connection,
    scope: DraftScope,
    replies: Sender<Reply>,
    waker: Waker,
    transport: Option<SessionTransport>,
    stored: Option<String>,
    epoch: String,
    last: u64,
    reconnect_at: Instant,
    reconnect_attempts: u8,
    want_reconnect: bool,
}
fn connect_scope(connection: &Connection, scope: &DraftScope) -> Result<SessionTransport, String> {
    match scope.profile_intent {
        crate::source::ProfileIntent::Backend => {
            SessionTransport::connect(connection, &scope.profile)
        }
        crate::source::ProfileIntent::NativeSelf => {
            SessionTransport::connect_native_self(connection, &scope.profile)
        }
    }
}
impl Worker {
    fn notify(&self, reply: Reply) {
        if self.replies.send(reply).is_ok() {
            (self.waker)();
        }
    }
    fn transport(&mut self) -> Result<&mut SessionTransport, CallError> {
        if self.transport.is_none() {
            self.transport = Some(connect_scope(&self.connection, &self.scope)?);
            self.notify(Reply::StreamOpened {
                origin: self.scope.clone(),
            });
        }
        Ok(self.transport.as_mut().unwrap())
    }
    fn attached(&mut self, snapshot: Snapshot) -> Result<(), CallError> {
        if snapshot.canonical
            && snapshot.running
            && !self.epoch.is_empty()
            && snapshot.epoch == self.epoch
            && self.stored.as_deref() == Some(snapshot.stored.as_str())
        {
            let epoch = self.epoch.clone();
            let last = self.last;
            if let Some(mut events) = self.transport()?.replay(&snapshot.runtime, &epoch, last)? {
                events.extend(self.transport()?.take_queued());
                events.retain(|e| {
                    e.session == snapshot.runtime
                        && e.epoch.as_deref() == Some(epoch.as_str())
                        && e.sequence.is_some_and(|n| n > last)
                });
                events.sort_by_key(|e| e.sequence);
                events.dedup_by_key(|e| e.sequence);
                let contiguous = events
                    .iter()
                    .enumerate()
                    .all(|(index, e)| e.sequence == Some(last + index as u64 + 1));
                let latest = events.last().and_then(|e| e.sequence).unwrap_or(last);
                if contiguous && latest >= snapshot.sequence {
                    self.want_reconnect = false;
                    self.reconnect_attempts = 0;
                    self.notify(Reply::Recovered {
                        origin: self.scope.clone(),
                        snapshot,
                    });
                    for event in events {
                        self.last = event.sequence.unwrap();
                        self.notify(Reply::Event {
                            origin: self.scope.clone(),
                            event,
                            replay: true,
                        });
                    }
                    return Ok(());
                }
            }
        }
        let history = self.transport()?.history(&snapshot.stored)?;
        self.publish_snapshot(snapshot, history)
    }
    fn publish_snapshot(&mut self, snapshot: Snapshot, history: History) -> Result<(), CallError> {
        self.stored = Some(snapshot.stored.clone());
        self.want_reconnect = false;
        self.reconnect_attempts = 0;
        self.epoch = snapshot.epoch.clone();
        self.last = snapshot.sequence;
        let stored = snapshot.stored.clone();
        self.notify(Reply::Snapshot {
            origin: self.scope.clone(),
            snapshot,
            history,
        });
        self.scope.session = Some(stored);
        self.scope.draft_origin = None;
        Ok(())
    }
    fn attach(&mut self) -> Result<(), CallError> {
        let stored = self
            .stored
            .clone()
            .or(self.scope.session.clone())
            .ok_or("Choose a stored conversation first")?;
        let snapshot = self.transport()?.resume(&stored)?;
        self.attached(snapshot)
    }
    fn attach_failed(&mut self, error: CallError) {
        // Retry transport failures, but do not repeatedly resume a session the
        // gateway has explicitly refused (for example, a deleted session).
        let retry = self.stored.is_some() && error.code.is_none();
        self.failure(None, error, retry);
    }
    fn failure(&mut self, id: Option<String>, error: CallError, retry_stream: bool) {
        self.reconnect_attempts = self.reconnect_attempts.saturating_add(1);
        self.want_reconnect = retry_stream;
        let uncertain = error.uncertain;
        self.notify(Reply::Failed {
            origin: self.scope.clone(),
            id,
            message: error.message,
            uncertain,
            stream_loss: retry_stream,
        });
        // A timed-out response is never consumed by another request. Reattach
        // on a new socket; no mutation or input is replayed by reconnection.
        self.transport = None;
        let delay = (2_u64 << self.reconnect_attempts.saturating_sub(1).min(4)).min(30);
        self.reconnect_at = Instant::now() + Duration::from_secs(delay);
    }
    fn submit(
        &mut self,
        mut entry: Prepared,
        journal: &Journal,
    ) -> Result<Option<String>, CallError> {
        let claim = journal.claim(&entry.submission_id)?;
        let journal = &claim;
        journal.check_current(&entry)?;
        entry.verify_owner(&self.connection, &self.scope)?;
        if entry.legacy_attempted {
            return Err("The legacy gateway cannot prove whether this turn was sent. Read the transcript before discarding the saved send; retrying could duplicate it".into());
        }
        // Resuming an existing chat receives the gateway greeting. A fresh
        // chat needs a read-only probe before choosing its create format.
        let stored = entry.stored.clone().or(entry.session.clone());
        let resumed = if let Some(stored) = &stored {
            Some(self.transport()?.resume(stored)?)
        } else {
            self.transport()?.negotiate_protocol()?;
            None
        };
        let canonical = self.transport()?.canonical;
        if entry.canonical.is_some_and(|saved| saved != canonical) {
            return Err(
                "The gateway protocol changed; review the saved send before retrying".into(),
            );
        }
        entry.canonical = Some(canonical);
        journal.save(&entry)?;
        // A stored session is resumed by its durable id. Failure never creates
        // an unrelated conversation and never changes the GUI surface to CLI.
        let (snapshot, created) = if let Some(snapshot) = resumed {
            (snapshot, false)
        } else if entry.input.canonical_bot {
            if let Some(winner) = self.bot_registry()? {
                (self.transport()?.resume(&winner)?, false)
            } else {
                let params = create_params(&entry, canonical);
                match self.transport()?.create(params) {
                    Ok(snapshot) => {
                        if canonical {
                            (snapshot, true)
                        } else {
                            match self.transport()?.call(
                                "session.title",
                                json!({"session_id":snapshot.runtime,"title":"Bot Chat"}),
                            ) {
                                Ok(_) => (snapshot, true),
                                Err(error) => {
                                    // A concurrent creator may win the exact title. Consult
                                    // that registry; never guess from recent sessions.
                                    if let Some(winner) = self.bot_registry()? {
                                        (self.transport()?.resume(&winner)?, false)
                                    } else {
                                        return Err(error);
                                    }
                                }
                            }
                        }
                    }
                    Err(error) => {
                        if !error.uncertain {
                            if let Some(winner) = self.bot_registry()? {
                                (self.transport()?.resume(&winner)?, false)
                            } else {
                                return Err(error);
                            }
                        } else {
                            return Err(error);
                        }
                    }
                }
            }
        } else {
            let params = create_params(&entry, canonical);
            (self.transport()?.create(params)?, true)
        };
        // A fresh legacy send has not produced a turn, so its minted stored
        // identity cannot legitimately advance to a compression continuation.
        // Check before replacing the journal's original owner or staging files.
        if !canonical
            && entry.session.is_none()
            && !entry.attempted
            && !entry.legacy_attempted
            && entry
                .stored
                .as_deref()
                .is_some_and(|id| id != snapshot.stored)
        {
            return Err("The new conversation returned a different stored session; the saved message was retained".into());
        }
        entry.runtime = Some(snapshot.runtime.clone());
        entry.stored = Some(snapshot.stored.clone());
        journal.save(&entry)?;
        // Validate before rewinds, policy changes, or uploads. A clean local
        // rejection keeps the intent until the editor confirms it is durable.
        let untouched = !entry.attempted
            && !entry.legacy_attempted
            && entry.mutations.is_empty()
            && !entry.policy_done
            && entry.attached == 0
            && entry.replay_attached == 0;
        if untouched {
            if let Err(message) = validate_transfer_limits(
                &entry.input.attachments,
                snapshot
                    .info
                    .get("desktop_contract")
                    .and_then(Value::as_u64)
                    .is_some_and(|version| version >= 5),
                canonical,
            ) {
                return Ok(Some(message));
            }
        }
        let retrying_empty_legacy = !created
            && !canonical
            && stored.as_deref() == Some(snapshot.stored.as_str())
            && !entry.attempted
            && !entry.legacy_attempted
            && entry.input.rewind.is_none()
            && entry.input.replay.is_none()
            && snapshot.info.get("lazy").and_then(Value::as_bool) == Some(true)
            && snapshot.info.get("profile_name").and_then(Value::as_str)
                == Some(self.scope.profile.as_str())
            && snapshot
                .metadata
                .get("message_count")
                .and_then(Value::as_u64)
                == Some(0)
            && snapshot.messages.is_empty()
            && !snapshot.running
            && snapshot.metadata.get("queued").is_none()
            && snapshot.metadata.get("inflight").is_none();
        let empty_live = if retrying_empty_legacy {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                match self.transport()?.call("session.active_list", json!({})) {
                    Ok(value)
                        if exact_legacy_status(
                            &snapshot.runtime,
                            &snapshot.stored,
                            &value,
                            "idle",
                        ) =>
                    {
                        break true;
                    }
                    Ok(value)
                        if Instant::now() < deadline
                            && exact_legacy_status(
                                &snapshot.runtime,
                                &snapshot.stored,
                                &value,
                                "starting",
                            ) =>
                    {
                        std::thread::sleep(Duration::from_millis(250));
                    }
                    Ok(_) => break false,
                    // An unsupported proof keeps the normal history path; an uncertain failure stops.
                    Err(error) if error.code.is_some() && !error.uncertain => break false,
                    Err(error) => return Err(error),
                }
            }
        } else {
            false
        };
        if (created && !canonical) || empty_live {
            // Legacy create is lazy: the first real user prompt materializes
            // its row. An explicitly verified idle retry is still that empty row.
            self.publish_snapshot(
                snapshot.clone(),
                History {
                    messages: snapshot.messages.clone(),
                    has_more: false,
                    cursor: 0,
                },
            )?;
        } else {
            self.attached(snapshot.clone())?;
        }
        self.prepare_replay(&mut entry, journal, &snapshot)?;
        let snapshot = self.prepare_rewind(&mut entry, journal, snapshot)?;
        if entry.input.rewind.as_ref().is_some_and(|r| r.restore_only) {
            journal.retire(&entry)?;
            self.notify(Reply::Admitted {
                origin: self.scope.clone(),
                id: entry.submission_id.clone(),
                text: String::new(),
                status: "restored".into(),
                generation: Some(snapshot.generation),
                admission: None,
                replayed: false,
                user_row: None,
                restored_replay: entry.input.replay.clone(),
                policy_stamp: None,
                policy_fields: PolicyFields::default(),
            });
            return Ok(None);
        }
        let existing = !created || entry.input.canonical_bot && canonical;
        self.prepare_policy(&mut entry, journal, snapshot, existing)?;
        self.prepare_files(&mut entry, journal)?;
        if !entry.input.attachments.is_empty() {
            self.notify(Reply::AttachmentsReady {
                origin: self.scope.clone(),
                id: entry.submission_id.clone(),
            });
        }
        let runtime = entry
            .runtime
            .as_deref()
            .ok_or("The prepared send has no session binding")?;
        let text = entry
            .text
            .as_deref()
            .unwrap_or(&entry.input.text)
            .to_owned();
        let mut params = json!({"session_id":runtime,"text":text,"submission_id":entry.submission_id,"queued":true});
        if let Some(surface) = entry.input.surface.as_deref() {
            params["surface"] = json!(surface);
        } else if !canonical {
            params["surface"] = json!("desktop");
        }
        if let Some(replay) = &entry.input.replay {
            let visible = [entry.replay_refs.join("\n"), replay.visible.clone()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            params["text"] = json!(visible);
            if visible != text {
                params["api_text"] = json!(text);
            }
        }
        if entry.input.voice_turn {
            params["voice_turn"] = json!(true);
        }
        if entry.input.interrupted {
            params["interrupted"] = json!(true);
        }
        if let Some(context) = &entry.input.voice_context {
            params["voice_context"] = json!(context);
        }
        if canonical && !entry.images.is_empty() {
            params["attachments"] = json!(entry.images);
        }
        let replayed = entry.attempted;
        entry.attempted = true;
        journal.save(&entry)?;
        let receipt = match self.transport()?.call("prompt.submit", params.clone()) {
            Ok(value) => value,
            // Only a proven pre-admission rejection permits the legacy wire.
            // The downgrade itself is journaled before its undeduplicated send.
            Err(error)
                if !canonical
                    && matches!(error.code, Some(4000 | 4094))
                    && !entry.legacy_attempted =>
            {
                entry.legacy_attempted = true;
                journal.save(&entry)?;
                params.as_object_mut().unwrap().remove("submission_id");
                self.transport()?.call("prompt.submit", params)?
            }
            Err(error) => return Err(error),
        };
        let status = admission_status(&receipt, runtime, canonical)?;
        let cleanup = journal.retire(&entry);
        self.notify(Reply::Admitted {
            origin: self.scope.clone(),
            id: entry.submission_id.clone(),
            text: entry
                .input
                .display_text
                .clone()
                .unwrap_or_else(|| entry.input.text.clone()),
            status: status.clone(),
            replayed,
            user_row: receipt.get("user_row_id").and_then(Value::as_u64),
            restored_replay: None,
            policy_stamp: entry.input.policy_stamp.clone(),
            policy_fields: PolicyFields {
                model: entry.input.model_changed,
                reasoning: entry.input.reasoning_changed,
                tier: entry.input.service_tier_changed,
                approval: entry.input.approval_changed,
            },
            generation: receipt.get("execution_generation").and_then(Value::as_u64),
            admission: receipt
                .get("admission_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
        if entry.input.mode == super::AdmissionMode::Steer && status == "queued" {
            let result = if canonical {
                let id = receipt
                    .get("admission_id")
                    .and_then(Value::as_str)
                    .ok_or("The queued admission has no identity")?;
                self.transport()?.call(
                    "prompt.steer_queued",
                    json!({"session_id":runtime,"admission_id":id}),
                )
            } else {
                Err(CallError::from(
                    "This legacy gateway does not expose a durable queued-steer operation",
                ))
            };
            if let Err(error) = result {
                self.notify(Reply::Failed {
                    origin: self.scope.clone(),
                    id: None,
                    message: format!(
                        "The message was queued, but steering was refused: {}",
                        error.message
                    ),
                    uncertain: error.uncertain,
                    stream_loss: false,
                });
            }
        }
        if let Err(error) = cleanup {
            self.notify(Reply::Failed {
                origin: self.scope.clone(),
                id: None,
                message: error,
                uncertain: false,
                stream_loss: false,
            });
        }
        Ok(None)
    }
    fn bot_registry(&mut self) -> Result<Option<String>, CallError> {
        let canonical = self.transport()?.canonical;
        // Canonical gateways resolve a title as an exact durable identity;
        // combining it with a list scope is explicitly rejected.
        let params = if canonical {
            json!({"title":"Bot Chat","include_hidden":true,"limit":200})
        } else {
            json!({"scope":"stored","title":"Bot Chat","include_hidden":true,"limit":200})
        };
        let result = self.transport()?.call("session.list", params);
        let value = match result {
            // Older Hermes versions perform an exact, durable title lookup but
            // reject the newer scope parameter. Never retry an uncertain call.
            Err(error)
                if !canonical
                    && !error.uncertain
                    && error.code == Some(4000)
                    && error
                        .message
                        .contains("scope: Extra inputs are not permitted") =>
            {
                self.transport()?.call(
                    "session.list",
                    json!({"title":"Bot Chat","include_hidden":true,"limit":200}),
                )?
            }
            other => other?,
        };
        let rows = value
            .get("sessions")
            .and_then(Value::as_array)
            .ok_or("The Bot Chat registry lookup was invalid; no new chat was created")?;
        let mut matches = rows.iter().filter(|row| {
            let root = row
                .get("root_title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty());
            root.or_else(|| row.get("title").and_then(Value::as_str).map(str::trim))
                == Some("Bot Chat")
        });
        let Some(row) = matches.next() else {
            return Ok(None);
        };
        if matches.next().is_some() {
            return Err(
                "The Bot Chat registry returned multiple title owners; no new chat was created"
                    .into(),
            );
        }
        let id = row
            .get("resolved_id")
            .or_else(|| row.get("session_id"))
            .or_else(|| row.get("id"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .ok_or("The Bot Chat registry owner has no stored identity")?;
        Ok(Some(id.into()))
    }
    fn prepare_policy(
        &mut self,
        entry: &mut Prepared,
        journal: &Journal,
        mut snapshot: Snapshot,
        existing: bool,
    ) -> Result<(), CallError> {
        if entry.policy_done {
            for mutation in entry.mutations.iter().filter(|m| m.complete) {
                if let Some(receipt) = &mutation.receipt {
                    self.notify(Reply::PolicyReceipt {
                        origin: self.scope.clone(),
                        receipt: receipt.clone(),
                        payload: mutation.params["payload"].clone(),
                        stamp: entry.input.policy_stamp.clone(),
                    });
                }
            }
            // A setting has no durable revision receipt. Observe its current
            // owner value on recovery instead of asserting an old write still wins.
            for (changed, key) in [
                (entry.input.service_tier_changed, "fast"),
                (entry.input.approval_changed, "approvals.mode"),
            ] {
                if changed {
                    let read = self.transport()?.call(
                        "config.get",
                        json!({"session_id":snapshot.runtime,"key":key}),
                    )?;
                    if let Some(value) = read["value"].as_str() {
                        self.notify(Reply::PolicySetting {
                            origin: self.scope.clone(),
                            key: key.into(),
                            value: value.into(),
                        });
                    }
                }
            }
            return Ok(());
        }
        if existing {
            if entry.input.model_changed {
                let (provider, model) = if let Some(model) = entry.input.model.clone() {
                    model
                } else {
                    self.transport()?.profile_model()?
                };
                let mut payload = json!({"model":model,"provider":provider});
                if entry.input.reasoning_changed && entry.input.reasoning.is_some() {
                    payload["reasoning"] = json!(entry.input.reasoning);
                }
                snapshot = self.mutate(entry, journal, snapshot, "model", payload)?;
            }
            if entry.input.reasoning_changed
                && (!entry.input.model_changed
                    || entry.input.reasoning.is_none()
                    || !snapshot.canonical)
            {
                snapshot = self.mutate(
                    entry,
                    journal,
                    snapshot,
                    "reasoning",
                    json!({"effort":entry.input.reasoning}),
                )?;
            }
            if entry.input.service_tier_changed {
                let tier=entry.input.service_tier.as_deref().ok_or("The gateway cannot restore inherited speed on an existing conversation. Choose Standard, Fast or Ultra fast")?;
                self.setting(
                    &snapshot.runtime,
                    "fast",
                    tier,
                    match tier {
                        "priority" => "fast",
                        other => other,
                    },
                )?;
            }
        }
        if entry.input.approval_changed {
            if let Some(mode) = entry.input.approval_mode.as_deref() {
                self.setting(&snapshot.runtime, "approvals.mode", mode, mode)?;
            }
        }
        entry.policy_done = true;
        journal.save(entry)?;
        Ok(())
    }
    fn mutate(
        &mut self,
        entry: &mut Prepared,
        journal: &Journal,
        mut snapshot: Snapshot,
        operation: &str,
        payload: Value,
    ) -> Result<Snapshot, CallError> {
        let index = if let Some(index) = entry
            .mutations
            .iter()
            .position(|m| m.operation == operation)
        {
            index
        } else {
            let params = json!({"session_id":snapshot.runtime,"request_id":uuid::Uuid::new_v4().to_string(),"expected_revision":snapshot.revision,"expected_generation":snapshot.generation,"operation":operation,"payload":payload});
            entry.mutations.push(Mutation {
                receipt: None,
                operation: operation.into(),
                params,
                complete: false,
                confirmation: None,
                refused: false,
            });
            entry.mutations.len() - 1
        };
        if entry.mutations[index].complete {
            if let Some(receipt) = &entry.mutations[index].receipt {
                if let Some(revision) = receipt["revision"].as_u64() {
                    snapshot.revision = snapshot.revision.max(revision);
                }
                self.notify(Reply::PolicyReceipt {
                    origin: self.scope.clone(),
                    receipt: receipt.clone(),
                    payload: entry.mutations[index].params["payload"].clone(),
                    stamp: entry.input.policy_stamp.clone(),
                });
            }
            return Ok(snapshot);
        }
        if entry.mutations[index].refused {
            let mutation = &mut entry.mutations[index];
            mutation.params["request_id"] = json!(uuid::Uuid::new_v4().to_string());
            mutation.params["expected_revision"] = json!(snapshot.revision);
            mutation.params["expected_generation"] = json!(snapshot.generation);
            mutation.refused = false;
        }
        journal.save(entry)?;
        let params = entry.mutations[index].params.clone();
        let value = if snapshot.canonical {
            self.mutate_canonical(entry, journal, index, &mut snapshot)?
        } else {
            // Legacy producers use the actual legacy per-session setting API.
            let payload = &params["payload"];
            if operation == "model" {
                let model = payload
                    .get("model")
                    .and_then(Value::as_str)
                    .ok_or("A model selection has no model")?;
                let provider = payload
                    .get("provider")
                    .and_then(Value::as_str)
                    .ok_or("A model selection has no provider")?;
                if model.chars().any(char::is_whitespace)
                    || provider.chars().any(char::is_whitespace)
                {
                    return Err(
                        "This legacy gateway cannot represent the selected model/provider".into(),
                    );
                }
                self.transport()?.call("config.set",json!({"session_id":snapshot.runtime,"key":"model","value":format!("{model} --provider {provider} --session"),"confirm_expensive_model":payload.get("confirm").is_some()}))?
            } else {
                self.transport()?.call("config.set",json!({"session_id":snapshot.runtime,"key":"reasoning","value":payload.get("effort").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!("reset"))}))?
            }
        };
        if snapshot.canonical
            && value.get("session_id").and_then(Value::as_str) != Some(snapshot.runtime.as_str())
        {
            return Err(CallError {
                message: "Session mutation acknowledgement owner mismatch; the outcome is unknown"
                    .into(),
                code: None,
                data: None,
                uncertain: true,
            });
        }

        if value.get("status").and_then(Value::as_str) == Some("confirmation_required")
            || value.get("confirm_required") == Some(&Value::Bool(true))
        {
            let message = value
                .get("confirm_message")
                .and_then(Value::as_str)
                .unwrap_or("This model selection needs confirmation in the agent");
            let token = if snapshot.canonical {
                value
                    .get("confirm")
                    .and_then(Value::as_str)
                    .ok_or("The guarded model selection returned no confirmation token")?
                    .to_owned()
            } else {
                "legacy-confirm".into()
            };
            entry.mutations[index].confirmation = Some(token);
            journal.save(entry)?;
            self.notify(Reply::ModelConfirmation {
                origin: self.scope.clone(),
                id: entry.submission_id.clone(),
                message: message.into(),
                journal_revision: entry.revision(),
            });
            return Err(format!("{message}. Confirm the model selection before sending").into());
        }
        if snapshot.canonical {
            snapshot.revision = value
                .get("revision")
                .and_then(Value::as_u64)
                .ok_or("The session mutation has no revision receipt")?;
        }
        if value.get("ok") == Some(&Value::Bool(false)) {
            return Err("The agent refused this conversation setting".into());
        }
        self.notify(Reply::PolicyReceipt {
            origin: self.scope.clone(),
            receipt: value.clone(),
            payload: entry.mutations[index].params["payload"].clone(),
            stamp: entry.input.policy_stamp.clone(),
        });
        entry.mutations[index].receipt = Some(value);
        entry.mutations[index].complete = true;
        journal.save(entry)?;
        Ok(snapshot)
    }
    fn mutate_canonical(
        &mut self,
        entry: &mut Prepared,
        journal: &Journal,
        index: usize,
        snapshot: &mut Snapshot,
    ) -> Result<Value, CallError> {
        for attempt in 0..2 {
            let params = entry.mutations[index].params.clone();
            match self.transport()?.call("session.mutate", params) {
                Ok(value) => return Ok(value),
                Err(error) => {
                    let data = error.data.as_ref();
                    let reason = data.and_then(|d| d["reason"].as_str());
                    let fresh = data.and_then(|d| d["revision"].as_u64());
                    // A typed fence refusal wrote nothing. A lost reply keeps
                    // the exact journaled identity and must never refresh CAS.
                    let fence = !error.uncertain
                        && matches!(reason, Some("revision_conflict" | "stale_generation"));
                    if !fence {
                        return Err(error);
                    }
                    let mutation = &mut entry.mutations[index];
                    mutation.refused = true;
                    mutation.confirmation = None;
                    if let Some(payload) = mutation.params["payload"].as_object_mut() {
                        payload.remove("confirm");
                    }
                    if let Some(revision) = fresh {
                        snapshot.revision = snapshot.revision.max(revision);
                    }
                    if let Some(generation) = data.and_then(|d| d["execution_generation"].as_u64())
                    {
                        snapshot.generation = snapshot.generation.max(generation);
                    }
                    journal.save(entry)?;
                    if attempt != 0 || fresh.is_none() {
                        return Err(error);
                    }
                    let mutation = &mut entry.mutations[index];
                    mutation.params["request_id"] = json!(uuid::Uuid::new_v4().to_string());
                    mutation.params["expected_revision"] = json!(snapshot.revision);
                    mutation.params["expected_generation"] = json!(snapshot.generation);
                    mutation.refused = false;
                    journal.save(entry)?;
                }
            }
        }
        unreachable!("The bounded mutation attempt always returns")
    }
    fn setting(
        &mut self,
        runtime: &str,
        key: &str,
        value: &str,
        expected: &str,
    ) -> Result<(), CallError> {
        self.transport()?.call(
            "config.set",
            json!({"session_id":runtime,"key":key,"value":value}),
        )?;
        let read = self
            .transport()?
            .call("config.get", json!({"session_id":runtime,"key":key}))?;
        if read.get("value").and_then(Value::as_str) != Some(expected) {
            return Err(
                format!("The agent did not confirm {key}; the message has not been sent").into(),
            );
        }
        self.notify(Reply::PolicySetting {
            origin: self.scope.clone(),
            key: key.into(),
            value: expected.into(),
        });
        Ok(())
    }
    fn discard(&mut self, entry: &Prepared, journal: &Journal) -> Result<(), CallError> {
        journal.check_current(entry)?;
        entry.verify_owner(&self.connection, &self.scope)?;
        if entry.legacy_image_paths.iter().any(Option::is_some) {
            let stored = entry
                .stored
                .as_deref()
                .ok_or("The saved image has no session owner")?;
            let snapshot = self.transport()?.resume(stored)?;
            if Some(snapshot.runtime.as_str()) != entry.runtime.as_deref() {
                return Err("The image belongs to a different session runtime; reconnect before discarding the saved send".into());
            }
            for path in entry.legacy_image_paths.iter().flatten() {
                let result = self.transport()?.call(
                    "image.detach",
                    json!({"session_id":snapshot.runtime,"path":path}),
                )?;
                if !result.get("detached").is_some_and(Value::is_boolean) {
                    return Err(
                        "The gateway did not confirm image cleanup; the saved send was retained"
                            .into(),
                    );
                }
            }
        }
        journal.retire(entry)?;
        Ok(())
    }
    fn prepare_files(&mut self, entry: &mut Prepared, journal: &Journal) -> Result<(), CallError> {
        use std::io::Read;
        if entry.text.is_none() {
            entry.text = Some(entry.input.text.trim().into());
            journal.save(entry)?;
        }
        let runtime = entry
            .runtime
            .clone()
            .ok_or("Attach a conversation before uploading files")?;
        for index in entry.attached..entry.input.attachments.len() {
            let file = entry.input.attachments[index].clone();
            let selected = std::fs::metadata(&file.path)
                .map_err(|_| format!("Could not read {}; select the file again", file.name))?;
            if !selected.is_file() {
                return Err(format!("Could not read {}; select a file", file.name).into());
            }
            let mut input = std::fs::File::open(&file.path)
                .map_err(|_| format!("Could not read {}; select the file again", file.name))?;
            let metadata = input
                .metadata()
                .map_err(|_| format!("Could not read {}; select the file again", file.name))?;
            if !metadata.is_file() {
                return Err(format!("Could not read {}; select a file", file.name).into());
            }
            let mut bytes = Vec::new();
            (&mut input)
                .take(12)
                .read_to_end(&mut bytes)
                .map_err(|_| format!("Could not read {}", file.name))?;
            let mime = image_mime(&bytes);
            // Canonical images use HTTP. Contract v5 explicitly supports large
            // WebSocket frames; older or unknown peers retain the smaller limit.
            let supports_large_frames = self
                .transport
                .as_ref()
                .and_then(|transport| transport.snapshot.as_ref())
                .and_then(|snapshot| snapshot.info.get("desktop_contract"))
                .and_then(Value::as_u64)
                .is_some_and(|version| version >= 5);
            let limit =
                if supports_large_frames || (mime.is_some() && entry.canonical == Some(true)) {
                    crate::gateway::MAX_CHAT_ATTACHMENT_BYTES
                } else {
                    5 * 1024 * 1024
                };
            if metadata.len() > limit as u64 {
                return Err(format!(
                    "{} exceeds the {} MiB attachment limit",
                    file.name,
                    limit / (1024 * 1024)
                )
                .into());
            }
            input
                .take((limit + 1 - bytes.len()) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| format!("Could not read {}", file.name))?;
            if bytes.len() > limit {
                return Err(format!(
                    "{} exceeds the {} MiB attachment limit",
                    file.name,
                    limit / (1024 * 1024)
                )
                .into());
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            if let Some(mime) = mime {
                if entry.canonical == Some(true) {
                    let image = self
                        .transport()?
                        .upload_image(format!("data:{mime};base64,{encoded}"), &file.name)?;
                    entry.images.push(image);
                } else if self
                    .transport
                    .as_ref()
                    .and_then(|transport| transport.snapshot.as_ref())
                    .and_then(|snapshot| snapshot.info.get("desktop_contract"))
                    .and_then(Value::as_u64)
                    .is_some_and(|version| version >= 2)
                {
                    // Stage bytes as an ordinary file first: unlike image.attach_bytes,
                    // losing its acknowledgement cannot leave a queued image behind.
                    if entry.legacy_image_paths.len() <= index {
                        entry.legacy_image_paths.resize(index + 1, None);
                    }
                    if entry.legacy_image_paths[index].is_none() {
                        let ext = match mime {
                            "image/png" => "png",
                            "image/jpeg" => "jpg",
                            "image/gif" => "gif",
                            "image/webp" => "webp",
                            _ => unreachable!(),
                        };
                        let name = format!("herune-{}-{index}.{ext}", entry.submission_id);
                        let result = self.transport()?.call(
                            "file.attach",
                            json!({
                                "session_id":runtime,"name":name,
                                "data_url":format!("data:{mime};base64,{encoded}")
                            }),
                        )?;
                        let path = result
                            .get("path")
                            .and_then(Value::as_str)
                            .filter(|path| {
                                !path.is_empty()
                                    && result.get("attached") == Some(&Value::Bool(true))
                            })
                            .ok_or("The gateway did not confirm the staged image path")?;
                        entry.legacy_image_paths[index] = Some(path.to_owned());
                        journal.save(entry)?;
                    }
                } else {
                    let result = self.transport()?.call(
                        "image.attach_bytes",
                        json!({"session_id":runtime,"content_base64":encoded,"filename":file.name}),
                    )?;
                    if result.get("attached") != Some(&Value::Bool(true)) {
                        return Err(format!("The gateway could not attach {}", file.name).into());
                    }
                }
            } else {
                let result=self.transport()?.call("file.attach",json!({"session_id":runtime,"name":file.name,"data_url":format!("data:application/octet-stream;base64,{encoded}")}))?;
                if result.get("attached") != Some(&Value::Bool(true)) {
                    return Err(format!("The gateway could not attach {}", file.name).into());
                }
                let reference = result
                    .get("ref_text")
                    .and_then(Value::as_str)
                    .filter(|r| !r.is_empty())
                    .ok_or("The gateway did not return an attachment reference")?;
                let text = entry.text.as_deref().unwrap_or("");
                entry.text = Some(if text.is_empty() {
                    reference.into()
                } else {
                    format!("{reference}\n\n{text}")
                });
            }
            entry.attached = index + 1;
            journal.save(entry)?;
        }
        // A known path can be detached idempotently even when a prior attach
        // acknowledgement was lost. Restage all images after reconnecting.
        for path in entry.legacy_image_paths.iter().flatten() {
            let detached = self
                .transport()?
                .call("image.detach", json!({"session_id":runtime,"path":path}))?;
            if !detached.get("detached").is_some_and(Value::is_boolean) {
                return Err("The gateway did not confirm image cleanup".into());
            }
            let attached = self
                .transport()?
                .call("image.attach", json!({"session_id":runtime,"path":path}))?;
            if attached.get("attached") != Some(&Value::Bool(true)) {
                return Err("The gateway could not attach the staged image".into());
            }
        }
        if entry.text.as_deref() == Some("") && !entry.input.attachments.is_empty() {
            entry.text = Some("What do you see in this image?".into());
            journal.save(entry)?;
        }
        Ok(())
    }
    fn change_cwd(&mut self, intent: super::workspace::Intent) -> Result<String, CallError> {
        let snapshot = self.transport()?.resume(&intent.stored)?;
        self.attached(snapshot.clone())?;
        if snapshot.runtime != intent.runtime || snapshot.authority != intent.authority {
            return Err("The session owner changed; review the refreshed conversation before changing its folder".into());
        }
        if snapshot.running {
            return Err("The conversation is busy; its working directory was not changed".into());
        }
        let value = if snapshot.canonical {
            self.transport()?.call("session.mutate",json!({"session_id":intent.runtime,"request_id":intent.request_id,"expected_revision":intent.revision,"expected_generation":intent.generation,"operation":"workspace","payload":{"cwd":intent.path}}))?
        } else {
            self.transport()?.call(
                "session.cwd.set",
                json!({"session_id":intent.runtime,"cwd":intent.path}),
            )?
        };
        if snapshot.canonical
            && value.get("session_id").and_then(Value::as_str) != Some(intent.runtime.as_str())
        {
            return Err(CallError{message:"The folder-change receipt has a different session owner; its outcome is unknown".into(),code:None,data:None,uncertain:true});
        }
        if value.get("ok") == Some(&Value::Bool(false)) {
            return Err("The agent refused the folder change".into());
        }
        let normalized = value
            .get("cwd")
            .or_else(|| value.pointer("/payload/cwd"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let readback = self.transport()?.resume(&intent.stored).map_err(|mut error|{error.uncertain=true;error.message="The folder-change receipt arrived, but readback failed; retry its retained identity or reconnect".into();error})?;
        let cwd = readback.info.get("cwd").and_then(Value::as_str).filter(|cwd| !cwd.is_empty()).ok_or_else(||CallError{message:"The folder change has no authoritative cwd readback; reconnect before continuing".into(),code:None,data:None,uncertain:true})?.to_owned();
        if normalized.as_ref().is_some_and(|expected| expected != &cwd) {
            return Err("The agent's folder-change readback differs from its receipt; review the session before continuing".into());
        }
        self.attached(readback)?;
        Ok(cwd)
    }
    fn event(&mut self, event: Event) -> Result<(), CallError> {
        let snapshot = self
            .transport()?
            .snapshot
            .clone()
            .ok_or("Conversation is not attached")?;
        if event.session != snapshot.runtime {
            return Ok(());
        }
        if event.kind == "session.replay_gap"
            || event
                .epoch
                .as_deref()
                .is_some_and(|epoch| !self.epoch.is_empty() && epoch != self.epoch)
        {
            return self.attach();
        }
        if let Some(seq) = event.sequence {
            if seq <= self.last {
                return Ok(());
            }
            if seq > self.last + 1 && snapshot.canonical {
                let epoch = self.epoch.clone();
                let last = self.last;
                let mut completed_in_replay = false;
                match self.transport()?.replay(&snapshot.runtime, &epoch, last)? {
                    Some(mut events) => {
                        // Do not publish a prefix until the entire replay proves
                        // it bridges the missing range for this stream epoch.
                        if events.iter().any(|event| {
                            event.epoch.as_deref() != Some(epoch.as_str())
                                || event.sequence.is_none()
                        }) {
                            return self.attach();
                        }
                        events.retain(|event| event.sequence.is_some_and(|n| n > last));
                        events.sort_by_key(|event| event.sequence);
                        events.dedup_by_key(|event| event.sequence);
                        let mut next = last;
                        for event in &events {
                            let Some(expected) = next.checked_add(1) else {
                                return self.attach();
                            };
                            if event.sequence != Some(expected) {
                                return self.attach();
                            }
                            next = expected;
                        }
                        if next < seq - 1 {
                            return self.attach();
                        }
                        for replay in events {
                            self.last = replay.sequence.unwrap();
                            completed_in_replay |= replay.kind == "message.complete";
                            let live = replay.sequence == Some(seq);
                            self.notify(Reply::Event {
                                origin: self.scope.clone(),
                                event: if live { event.clone() } else { replay },
                                replay: !live,
                            });
                        }
                    }
                    None => return self.attach(),
                }
                if seq <= self.last {
                    if completed_in_replay || event.kind == "message.complete" {
                        self.attach()?;
                    }
                    return Ok(());
                }
            }
            self.last = seq;
        }
        let complete = event.kind == "message.complete";
        self.notify(Reply::Event {
            origin: self.scope.clone(),
            event,
            replay: false,
        });
        if complete {
            self.attach()?;
        }
        Ok(())
    }
}

pub(crate) fn spawn(
    connection: Connection,
    scope: DraftScope,
    replies: Sender<Reply>,
    waker: Waker,
) -> Sender<Command> {
    let (send, requests) = mpsc::channel();
    std::thread::spawn(move || {
        let mut worker = Worker {
            stored: scope.session.clone(),
            connection,
            scope,
            replies,
            waker,
            transport: None,
            epoch: String::new(),
            last: 0,
            reconnect_at: Instant::now(),
            reconnect_attempts: 0,
            want_reconnect: false,
        };
        loop {
            match requests.recv_timeout(Duration::from_millis(20)) {
                Ok(Command::Older { stored, cursor }) => {
                    let result = worker
                        .transport()
                        .and_then(|t| t.older_history(&stored, cursor));
                    worker.notify(Reply::Older {
                        origin: worker.scope.clone(),
                        cursor,
                        result,
                    });
                }
                Ok(Command::Workspace(intent)) => {
                    let result = worker.change_cwd(intent);
                    if result.as_ref().err().is_some_and(|error| error.uncertain) {
                        worker.transport = None;
                        worker.want_reconnect = false;
                    }
                    worker.notify(Reply::Workspace {
                        origin: worker.scope.clone(),
                        result,
                    });
                }
                Ok(Command::Attach) => {
                    worker.reconnect_attempts = 0;
                    if let Err(error) = worker.attach() {
                        worker.attach_failed(error);
                    }
                }
                Ok(Command::Send(entry, journal)) => {
                    let id = entry.submission_id.clone();
                    let result = worker.submit(entry, &journal);
                    // The UI may safely inspect and retire the retained intent
                    // only after this worker releases its claim.
                    drop(journal);
                    match result {
                        Ok(Some(message)) => worker.notify(Reply::InputRejected {
                            origin: worker.scope.clone(),
                            id,
                            message,
                        }),
                        Ok(None) => {}
                        Err(error) => worker.failure(Some(id), error, false),
                    }
                }
                Ok(Command::Discard(entry, journal)) => {
                    let id = entry.submission_id.clone();
                    let result = worker.discard(&entry, &journal);
                    if result.as_ref().err().is_some_and(|error| error.uncertain) {
                        worker.transport = None;
                    }
                    drop(journal);
                    worker.notify(Reply::Discarded {
                        origin: worker.scope.clone(),
                        id,
                        result,
                    });
                }
                Ok(Command::Control(Control::Respond {
                    prompt_id,
                    kind,
                    answer,
                    ..
                })) => {
                    let result = worker
                        .transport()
                        .and_then(|t| t.respond_legacy(&prompt_id, &kind, &answer));
                    if let Err(error) = result {
                        worker.failure(None, error, false);
                    }
                }
                Ok(Command::Control(_)) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if worker.transport.is_none() {
                if worker.want_reconnect
                    && worker.stored.is_some()
                    && Instant::now() >= worker.reconnect_at
                {
                    if let Err(error) = worker.attach() {
                        worker.attach_failed(error);
                    }
                }
                continue;
            }
            match worker.transport.as_mut().unwrap().read_event() {
                Ok(Some(event)) => {
                    if let Err(error) = worker.event(event) {
                        worker.failure(None, error, true);
                    }
                }
                Ok(None) => {}
                Err(error) => worker.failure(None, error, true),
            }
        }
    });
    send
}

pub(crate) fn control(
    connection: Connection,
    scope: DraftScope,
    control: Control,
    replies: Sender<Reply>,
    waker: Waker,
) {
    std::thread::spawn(move || {
        let result = (|| -> Result<(), CallError> {
            let (stored, runtime) = match &control {
                Control::Stop {
                    stored, runtime, ..
                }
                | Control::Respond {
                    stored, runtime, ..
                }
                | Control::Admission {
                    stored, runtime, ..
                }
                | Control::LockClarify {
                    stored, runtime, ..
                } => (stored.clone(), runtime.clone()),
            };
            let mut transport = connect_scope(&connection, &scope)?;
            let snapshot = transport.resume(&stored)?;
            if snapshot.runtime != runtime {
                return Err(
                    "The conversation binding changed; refresh before controlling it".into(),
                );
            }
            match control {
                Control::Stop {
                    generation,
                    authority,
                    ..
                } => {
                    if snapshot.canonical
                        && (snapshot.generation != generation || snapshot.authority != authority)
                    {
                        return Err("The running turn changed; refresh before stopping it".into());
                    }
                    let params = if snapshot.canonical {
                        json!({"session_id":runtime,"execution_generation":generation})
                    } else {
                        json!({"session_id":runtime})
                    };
                    transport.call("session.interrupt", params)?;
                }
                Control::Respond {
                    generation,
                    authority,
                    prompt_id,
                    kind,
                    answer,
                    ..
                } => {
                    if !snapshot.canonical {
                        return Err("Legacy prompts must be answered on their owning conversation connection".into());
                    }
                    if snapshot.generation != generation
                        || snapshot.authority != authority
                        || !snapshot.prompts.iter().any(|p| {
                            p.prompt_id == prompt_id && p.execution_generation == generation
                        })
                    {
                        return Err("The prompt has expired; refresh before responding".into());
                    }
                    let mut params = json!({"session_id":runtime,"execution_generation":generation,"prompt_id":prompt_id});
                    params[if kind == "approval" {
                        "choice"
                    } else {
                        "answer"
                    }] = json!(answer);
                    transport.call(
                        if kind == "approval" {
                            "approval.respond"
                        } else {
                            "clarify.respond"
                        },
                        params,
                    )?;
                }
                Control::LockClarify {
                    generation,
                    authority,
                    id,
                    qid,
                    answer,
                    answers,
                    ..
                } => {
                    if snapshot.generation != generation || snapshot.authority != authority {
                        return Err("The clarification belongs to an earlier turn; refresh it before answering".into());
                    }
                    let prompt = snapshot
                        .prompts
                        .iter()
                        .find(|p| p.prompt_id == id && p.server_request)
                        .ok_or("The clarification is no longer waiting for an answer")?;
                    let result = if let Some(qid) = &qid {
                        if !prompt.questions.iter().any(|q| &q.qid == qid) {
                            return Err(
                                "This question does not belong to the current clarification".into(),
                            );
                        }
                        transport.call(
                            "clarify.lock",
                            json!({"request_id":id,"question_id":qid,"answer":answer}),
                        )?
                    } else {
                        let result = answers
                            .map(|answers| json!({"answers":answers,"outcome":"submitted"}))
                            .unwrap_or_else(|| json!({}));
                        transport.call("request.answer", json!({"id":id,"result":result}))?
                    };
                    let expired = result.get("status").and_then(Value::as_str) == Some("expired");
                    let remaining = if expired || qid.is_none() {
                        vec![]
                    } else {
                        result
                            .get("remaining")
                            .and_then(Value::as_array)
                            .ok_or(
                                "The agent did not confirm the remaining clarification questions",
                            )?
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    };
                    if replies
                        .send(Reply::ClarifyLocked {
                            origin: scope.clone(),
                            id,
                            qid: qid.unwrap_or_default(),
                            answer,
                            remaining,
                        })
                        .is_ok()
                    {
                        waker();
                    }
                }
                Control::Admission {
                    id,
                    resolve,
                    steer,
                    generation,
                    ..
                } => {
                    let mut params = json!({"session_id":runtime,"admission_id":id});
                    if resolve {
                        params["execution_generation"] = json!(generation);
                    }
                    transport.call(
                        if steer {
                            "prompt.steer_queued"
                        } else if resolve {
                            "prompt.resolve_unknown"
                        } else {
                            "prompt.cancel"
                        },
                        params,
                    )?;
                }
            };
            Ok(())
        })();
        let reply = match result {
            Ok(()) => Reply::ControlSettled { origin: scope },
            Err(error) => Reply::Failed {
                origin: scope,
                id: None,
                message: error.message,
                uncertain: error.uncertain,
                stream_loss: false,
            },
        };
        if replies.send(reply).is_ok() {
            waker();
        }
    });
}
fn create_params(entry: &Prepared, canonical: bool) -> Value {
    let mut params = json!({"source":"gui"});
    if entry.input.canonical_bot {
        params["title"] = json!("Bot Chat");
        params["hidden"] = json!(true);
        params["follow_profile_config"] = json!(true);
    }
    params[if canonical {
        "request_id"
    } else {
        "idempotency_key"
    }] = json!(entry.create_id);
    if let Some(cwd) = &entry.input.cwd {
        params["cwd"] = json!(cwd);
        params["cwd_explicit"] = json!(entry.input.cwd_explicit);
    }
    if entry.input.model_changed {
        if let Some((provider, model)) = &entry.input.model {
            params["model"] = json!(model);
            params["provider"] = json!(provider);
        }
    }
    if entry.input.reasoning_changed {
        if let Some(effort) = &entry.input.reasoning {
            params[if canonical {
                "reasoning"
            } else {
                "reasoning_effort"
            }] = json!(effort);
        }
    }
    if entry.input.service_tier_changed {
        if let Some(tier) = &entry.input.service_tier {
            params["service_tier"] = json!(tier);
        }
    }
    params
}
fn admission_status(value: &Value, runtime: &str, canonical: bool) -> Result<String, CallError> {
    if value.get("voice_stopped") == Some(&Value::Bool(true)) {
        return Ok("voice_stopped".into());
    }
    let status = value.get("status").and_then(Value::as_str);
    if canonical {
        if value.pointer("/ref/session_id").and_then(Value::as_str) != Some(runtime)
            || value
                .get("admission_id")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            || !matches!(status, Some("queued" | "started" | "unknown" | "terminal"))
        {
            return Err(CallError {
                message:
                    "The admission acknowledgement destination is invalid; the outcome is unknown"
                        .into(),
                code: None,
                data: None,
                uncertain: true,
            });
        }
    } else if !matches!(
        status,
        Some("streaming" | "queued" | "steered" | "redirected")
    ) {
        return Err(CallError {
            message: "The legacy admission acknowledgement is invalid; the outcome is unknown"
                .into(),
            code: None,
            data: None,
            uncertain: true,
        });
    }
    Ok(if status == Some("streaming") {
        "started"
    } else {
        status.unwrap()
    }
    .into())
}
fn exact_legacy_status(runtime: &str, stored: &str, value: &Value, status: &str) -> bool {
    let Some(rows) = value.get("sessions").and_then(Value::as_array) else {
        return false;
    };
    let mut matches = rows
        .iter()
        .filter(|row| row.get("id").and_then(Value::as_str) == Some(runtime));
    let Some(row) = matches.next() else {
        return false;
    };
    matches.next().is_none()
        && row.get("session_key").and_then(Value::as_str) == Some(stored)
        && row.get("status").and_then(Value::as_str) == Some(status)
        && row.get("message_count").and_then(Value::as_u64) == Some(0)
        && (status != "starting" || row.get("preview").and_then(Value::as_str) == Some(""))
}

fn validate_transfer_limits(
    attachments: &[AttachmentInput],
    large_frames: bool,
    canonical: bool,
) -> Result<(), String> {
    use std::io::Read;
    for file in attachments {
        let mut input = std::fs::File::open(&file.path)
            .map_err(|_| format!("Could not read {}; select the file again", file.name))?;
        let metadata = input
            .metadata()
            .map_err(|_| format!("Could not read {}; select the file again", file.name))?;
        if !metadata.is_file() {
            return Err(format!("Could not read {}; select a file", file.name));
        }
        let mut header = Vec::new();
        (&mut input)
            .take(12)
            .read_to_end(&mut header)
            .map_err(|_| format!("Could not read {}", file.name))?;
        let limit = if large_frames || (canonical && image_mime(&header).is_some()) {
            crate::gateway::MAX_CHAT_ATTACHMENT_BYTES
        } else {
            5 * 1024 * 1024
        };
        if metadata.len() > limit as u64 {
            return Err(format!(
                "{} exceeds the {} MiB attachment limit",
                file.name,
                limit / (1024 * 1024)
            ));
        }
    }
    Ok(())
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gui_create_keeps_provider_reasoning_tier_and_same_create_identity() {
        let connection = Connection::Url {
            endpoint: "https://fixture.invalid".into(),
            token: None,
        };
        let scope = DraftScope {
            draft_origin: None,
            profile_intent: crate::source::ProfileIntent::Backend,
            connection: 1,
            profile: "named".into(),
            session: None,
        };
        let entry = Prepared::new(
            &connection,
            &scope,
            SendInput {
                text: "hello".into(),
                model: Some(ModelKey {
                    provider: "codex".into(),
                    id: "gpt-test".into(),
                }),
                model_changed: true,
                reasoning: Some("ultra".into()),
                reasoning_changed: true,
                service_tier: Some("priority".into()),
                service_tier_changed: true,
                ..Default::default()
            },
        )
        .unwrap();
        let params = create_params(&entry, true);
        assert_eq!(params["source"], "gui");
        assert_eq!(params["provider"], "codex");
        assert_eq!(params["reasoning"], "ultra");
        assert_eq!(params["service_tier"], "priority");
        assert_eq!(params["request_id"], entry.create_id);
        assert_eq!(create_params(&entry, true), params);
        let legacy = create_params(&entry, false);
        assert_eq!(legacy["source"], "gui");
        assert_eq!(legacy["reasoning_effort"], "ultra");
        assert!(legacy.get("request_id").is_none());
    }
    #[test]
    fn admission_receipt_is_distinct_from_submission_identity_and_never_accepts_wrong_session() {
        let value = json!({"admission_id":"owner-admission","ref":{"profile_id":"owner","session_id":"live"},"status":"started"});
        assert_eq!(admission_status(&value, "live", true).unwrap(), "started");
        assert!(
            admission_status(&value, "other", true)
                .unwrap_err()
                .uncertain
        );
        assert!(admission_status(&json!({"status":"streaming"}), "live", true).is_err());
        assert_eq!(
            admission_status(&json!({"voice_stopped":true}), "live", true).unwrap(),
            "voice_stopped"
        );
    }
}

#[cfg(test)]
mod claim_tests;
#[cfg(test)]
mod contract_tests;

#[cfg(test)]
mod ownership_tests;
