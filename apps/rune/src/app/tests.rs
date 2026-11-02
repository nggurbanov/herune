use super::*;

#[test]
fn bot_rows_open_the_canonical_chat_and_keep_owned_conversations_as_tabs() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    s.open_target(
        ConversationTarget::Bot {
            profile: "default".into(),
            profile_intent: crate::source::ProfileIntent::Backend,
        },
        true,
    );
    assert_eq!(s.selected_session.as_deref(), Some("bot-hermes"));
    assert!(s.active_tab().unwrap().bot);
    assert_eq!(s.tabs.len(), 2);
    assert!(s.messages[0].content.contains("Гермес"));
    s.open_target(
        ConversationTarget::Bot {
            profile: "research".into(),
            profile_intent: crate::source::ProfileIntent::Backend,
        },
        true,
    );
    assert_eq!(s.profile, "research");
    assert_eq!(s.selected_session.as_deref(), Some("bot-research"));
    assert!(s.messages[1].content.contains("Research"));
    assert_eq!(s.tabs.len(), 3);
    s.activate_tab(1);
    assert_eq!(s.profile, "default");
    assert_eq!(s.selected_session.as_deref(), Some("bot-hermes"));
    assert!(s.messages[0].content.contains("Гермес"));
    s.close_tab(1);
    assert_eq!(s.profile, "research");
    assert_eq!(s.selected_session.as_deref(), Some("bot-research"));
}

#[test]
fn a_bot_without_a_registry_chat_never_adopts_a_recent_session() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    s.open_bot("new-bot".into());
    assert!(s.bot_empty);
    assert_eq!(s.profile, "new-bot");
    assert!(s.selected_session.is_none());
    assert!(s.messages.is_empty());
    assert!(!s.history_loading);
    assert_eq!(s.tabs.len(), 1);
}

#[test]
fn plain_navigation_replaces_the_foreground_tab_and_explicit_new_tab_preserves_it() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    s.open_bot("default".into());
    assert_eq!(s.tabs.len(), 1);
    assert_eq!(s.tabs[0].session, "bot-hermes");
    s.open_bot("research".into());
    assert_eq!(s.tabs.len(), 1);
    assert_eq!(s.tabs[0].profile, "research");
    s.open_target(
        ConversationTarget::Bot {
            profile: "default".into(),
            profile_intent: crate::source::ProfileIntent::Backend,
        },
        true,
    );
    assert_eq!(s.tabs.len(), 2);
    s.open_bot("research".into());
    assert_eq!(s.tabs.len(), 2);
    assert_eq!(s.profile, "research");
}

#[test]
fn every_live_bot_open_refreshes_registry_and_hydrates_its_scoped_sessions() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    s.fixture = false;
    let (send, requests) = mpsc::channel();
    let (_, receive) = mpsc::channel();
    s.network = Some(Network { send, receive });
    for id in ["server-root", "fresh-server-root"] {
        s.open_bot("default".into());
        assert!(matches!(requests.recv().unwrap().command, Command::Bot(p) if p == "default"));
        if id == "server-root" {
            // Several clicks before the first reply still spend the original
            // foreground slot, rather than leaving it behind as an extra tab.
            s.open_bot("research".into());
            assert!(matches!(requests.recv().unwrap().command, Command::Bot(p) if p == "research"));
            s.open_bot("default".into());
            assert!(matches!(requests.recv().unwrap().command, Command::Bot(p) if p == "default"));
        }
        let mut profiles = s.profiles.clone();
        profiles[0].canonical_session = Some(CanonicalSession {
            id: id.into(),
            resolved_id: format!("{id}-tip"),
            preview: String::new(),
        });
        s.apply(Reply {
            intent: s.intent,
            result: Ok(Update::BotOpened {
                profiles,
                profile: "default".into(),
                sessions: vec![Session {
                    id: "ordinary".into(),
                    title: "Visible session".into(),
                    updated: String::new(),
                }],
                chat: Some((
                    id.into(),
                    History {
                        messages: vec![HistoryMessage {
                            role: "assistant".into(),
                            content: id.into(),
                            raw: serde_json::Value::Null,
                            ..Default::default()
                        }],
                        has_more: false,
                        cursor: 0,
                    },
                )),
            }),
        });
        assert_eq!(s.selected_session.as_deref(), Some(id));
        assert_eq!(s.messages[0].content, id);
        assert_eq!(s.sessions.len(), 1);
        assert_eq!(s.tabs.len(), 1);
    }
}

#[test]
fn simple_mode_rests_tooling_without_losing_tabs_or_advanced_visibility_choice() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    s.inspector.set_open(false);
    s.set_simple_mode(true);
    assert!(!s.inspector.is_open());
    assert_eq!(s.selected_session.as_deref(), Some("sample-week"));
    s.inspector.set_open(true);
    s.set_simple_mode(false);
    assert!(!s.inspector.is_open());
    assert_eq!(s.tabs.len(), 1);
}

#[test]
fn reopening_live_conversation_does_not_replace_stream_with_older_history() {
    let mut s = Viewer::empty();
    s.profile = "work".into();
    s.selected_session = Some("a".into());
    let scope = s.composer_scope();
    s.conversation.fixture(scope, &serde_json::json!({"running":true,"messages":[{"role":"assistant","content":"live progress"}]})).unwrap();
    s.apply(Reply {
        intent: s.intent,
        result: Ok(Update::Opened {
            profile: "work".into(),
            session: "a".into(),
            sessions: vec![],
            history: History {
                messages: vec![HistoryMessage::from_row(
                    &serde_json::json!({"role":"assistant","content":"older history"}),
                )],
                has_more: false,
                cursor: 0,
            },
        }),
    });
    assert_eq!(s.messages[0].content, "live progress");
}

#[test]
fn stale_history_cannot_replace_a_different_profile_or_session() {
    let mut s = Viewer::empty();
    s.intent = 4;
    s.profile = "work".into();
    s.selected_session = Some("new".into());
    s.apply(Reply {
        intent: 3,
        result: Ok(Update::Opened {
            sessions: vec![],
            profile: "default".into(),
            session: "old".into(),
            history: History {
                messages: vec![HistoryMessage {
                    role: "assistant".into(),
                    content: "stale".into(),
                    raw: serde_json::Value::Null,
                    ..Default::default()
                }],
                has_more: false,
                cursor: 0,
            },
        }),
    });
    assert!(s.messages.is_empty());
    s.apply(Reply {
        intent: 4,
        result: Ok(Update::Opened {
            sessions: vec![],
            profile: "default".into(),
            session: "new".into(),
            history: History {
                messages: vec![HistoryMessage {
                    role: "assistant".into(),
                    content: "wrong owner".into(),
                    raw: serde_json::Value::Null,
                    ..Default::default()
                }],
                has_more: false,
                cursor: 0,
            },
        }),
    });
    assert!(s.messages.is_empty());
}

#[test]
fn profile_change_clears_previous_history_before_any_network_reply() {
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    assert!(!s.messages.is_empty());
    s.select_profile("research".into());
    assert!(s.messages.is_empty());
    assert!(s.selected_session.is_none());
    assert!(s.sessions.is_empty());
}

#[test]
fn connection_form_never_accepts_credentials_inside_the_visible_url() {
    let mut s = Viewer::empty();
    s.connection_url
        .replace_text("https://user:private@example.com/?token=secret");
    s.apply_connection();
    assert!(s.connection.is_none());
    assert!(s.connection_form);
    assert!(!s.error.as_ref().unwrap().contains("private"));
    assert!(!s.error.as_ref().unwrap().contains("secret"));
}

#[test]
fn tokenized_cli_urls_are_split_before_filling_the_visible_url_field() {
    let (connection, visible) = url_connection(
        "https://host.example/hermes/api/ws?token=private%20key",
        None,
    )
    .unwrap();
    assert_eq!(visible, "https://host.example/hermes/api/ws");
    assert!(!visible.contains("private"));
    match connection {
        Connection::Url { endpoint, token } => {
            assert_eq!(endpoint, visible);
            assert_eq!(token.as_deref(), Some("private key"));
        }
        _ => panic!("expected remote connection"),
    }
    assert!(url_connection("https://user:private@host.example/", None).is_err());
}

#[test]
fn queued_reads_coalesce_without_losing_the_last_connection_barrier() {
    let local = || Connection::Local {
        home: "/fixture".into(),
    };
    let queue = coalesce(
        Request {
            intent: 1,
            profile_intent: crate::source::ProfileIntent::Backend,
            command: Command::History("old".into(), "a".into()),
        },
        [
            Request {
                intent: 2,
                profile_intent: crate::source::ProfileIntent::Backend,
                command: Command::Connect(local(), "default".into()),
            },
            Request {
                intent: 3,
                profile_intent: crate::source::ProfileIntent::Backend,
                command: Command::Sessions("old".into()),
            },
            Request {
                intent: 4,
                profile_intent: crate::source::ProfileIntent::Backend,
                command: Command::Connect(local(), "work".into()),
            },
            Request {
                intent: 5,
                profile_intent: crate::source::ProfileIntent::Backend,
                command: Command::History("work".into(), "b".into()),
            },
            Request {
                intent: 6,
                profile_intent: crate::source::ProfileIntent::Backend,
                command: Command::History("work".into(), "c".into()),
            },
        ],
    );
    assert_eq!(
        queue.iter().map(|r| r.intent).collect::<Vec<_>>(),
        vec![4, 6]
    );
    assert!(matches!(&queue[0].command, Command::Connect(_, p) if p == "work"));
    assert!(matches!(&queue[1].command, Command::History(p, id) if p == "work" && id == "c"));
}

#[test]
fn reconnect_profile_fallback_does_not_adopt_an_old_session_id() {
    let mut s = Viewer::empty();
    s.intent = 1;
    s.profile = "removed-profile".into();
    s.selected_session = Some("shared".into());
    s.messages.push(HistoryMessage {
        role: "assistant".into(),
        content: "old owner".into(),
        raw: serde_json::Value::Null,
        ..Default::default()
    });
    s.apply(Reply {
        intent: 1,
        result: Ok(Update::Connected {
            profiles: vec![Profile {
                name: "default".into(),
                label: "Default".into(),
                description: String::new(),
                canonical_session: None,
            }],
            profile: "default".into(),
            sessions: vec![Session {
                id: "shared".into(),
                title: "Other owner".into(),
                updated: String::new(),
            }],
        }),
    });
    assert!(s.selected_session.is_none());
    assert!(s.messages.is_empty());
}

#[test]
fn synthetic_scenes_never_read_live_voice_or_models_from_preconfigured_routes() {
    let mut s = Viewer::empty();
    s.connection = Some(Connection::Url {
        endpoint: "http://127.0.0.1:1".into(),
        token: None,
    });
    reader_scene(&mut s);
    let scope = s.composer_scope();
    s.open_composer(Popup::VoiceEngine);
    assert!(!s.voice.loading(&scope));
    assert!(
        s.voice.error(&scope).is_none(),
        "fixture voice must not attempt a worker request"
    );
    s.reload_models();
    assert!(!s.composer.catalog_loading);
    assert!(
        s.composer.catalog_error.is_none(),
        "fixture models must not attempt a worker request"
    );
}

#[test]
fn reverting_device_preferences_disarms_a_failed_write_retry_without_erasing_other_errors() {
    let mut s = Viewer::empty();
    s.fixture = false;
    s.preferences = s.client_preferences_snapshot();
    s.preferences_retry_at = Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
    s.preferences_error = Some("Previous write failed".into());
    s.client_error = Some("Keep this independent connection error".into());
    assert!(s.save_client_preferences().is_ok());
    assert!(s.preferences_retry_at.is_none());
    assert!(s.preferences_error.is_none());
    assert_eq!(
        s.client_error.as_deref(),
        Some("Keep this independent connection error")
    );
    s.preferences_writable = false;
    assert!(s.save_client_preferences().is_err());
}

#[test]
fn model_picker_renders_empty_and_error_virtual_rows() {
    use rune::{Env, Runtime};
    let mut s = Viewer::empty();
    reader_scene(&mut s);
    let scope = s.composer_scope();
    s.composer
        .set_catalog_error(&scope, "Synthetic catalog error".into());
    s.open_composer(crate::composer::Popup::Models);
    s.composer.favorites_only = true;
    let mut rt = Runtime::new(s, crate::view::app, (1200., 800.), Env::new(true, 1.));
    rt.frame(0.);
    assert!(rt.find("model-results-empty").is_some());
    assert!(rt.find("model-results-error").is_some());
}

#[test]
fn recovered_stream_clears_only_its_own_connection_error() {
    let mut viewer = Viewer::empty();
    viewer.selected_session = Some("stored".into());
    let scope = viewer.composer_scope();
    viewer
        .conversation
        .fixture(scope.clone(), &serde_json::json!({}))
        .unwrap();
    viewer
        .conversation
        .fixture_queue_failure(scope.clone(), "connection lost", true, None);
    viewer.poll_conversations();
    assert_eq!(viewer.compose_error.as_deref(), Some("connection lost"));
    viewer.conversation.fixture_queue_recovered(scope.clone());
    viewer.poll_conversations();
    assert_eq!(viewer.compose_error, None);

    viewer
        .conversation
        .fixture_queue_failure(scope.clone(), "connection lost", true, None);
    viewer.poll_conversations();
    viewer.compose_error = Some("different error".into());
    viewer.conversation.fixture_queue_recovered(scope.clone());
    viewer.poll_conversations();
    assert_eq!(viewer.compose_error.as_deref(), Some("different error"));

    viewer.conversation.fixture_queue_failure(
        scope.clone(),
        "send uncertain",
        false,
        Some("send-id".into()),
    );
    viewer.poll_conversations();
    viewer
        .conversation
        .fixture_queue_failure(scope.clone(), "connection lost again", true, None);
    viewer.poll_conversations();
    assert_eq!(viewer.compose_error.as_deref(), Some("send uncertain"));
    viewer.conversation.fixture_queue_recovered(scope.clone());
    viewer.poll_conversations();
    assert_eq!(viewer.compose_error.as_deref(), Some("send uncertain"));
    assert_eq!(
        viewer
            .conversation
            .view(&scope)
            .unwrap()
            .uncertain
            .as_deref(),
        Some("send-id")
    );
}

#[test]
fn oversized_attachment_preserves_the_composer_before_a_send_is_prepared() {
    const CHILD: &str = "HERUNE_OVERSIZED_DRAFT_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let root =
            std::env::temp_dir().join(format!("herune-oversized-draft-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "app::tests::oversized_attachment_preserves_the_composer_before_a_send_is_prepared",
                "--nocapture",
            ])
            .env(CHILD, &root)
            .env("HOME", &root)
            .env("XDG_STATE_HOME", root.join("state"))
            .env("LOCALAPPDATA", root.join("state"))
            .env("TMPDIR", &root)
            .output()
            .unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            output.status.success(),
            "child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let path = std::path::PathBuf::from(std::env::var_os(CHILD).unwrap()).join("large.pdf");
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(crate::gateway::MAX_CHAT_ATTACHMENT_BYTES as u64 + 1)
        .unwrap();
    let mut s = Viewer::empty();
    s.connection = Some(Connection::Url {
        endpoint: "http://127.0.0.1:1".into(),
        token: None,
    });
    s.conversation.init(std::sync::Arc::new(|| {}));
    let scope = s.composer_scope();
    let draft = s.composer.draft_mut(scope.clone());
    draft.text.replace_text("Please read my detailed message");
    draft.attachments.push(crate::composer::DraftAttachment {
        path: path.clone(),
        name: "large.pdf".into(),
        preview: None,
    });
    assert!(s.can_send());
    s.send_draft();
    let draft = s.composer.draft(&scope).unwrap();
    assert_eq!(
        draft.text.text, "Please read my detailed message",
        "send must not clear the text"
    );
    assert_eq!(draft.attachments.len(), 1);
    assert_eq!(draft.attachments[0].path, path);
    assert!(
        s.compose_error
            .as_deref()
            .is_some_and(|e| e.contains("25 MiB")),
        "unexpected error: {:?}",
        s.compose_error
    );
    assert!(
        !crate::client::state_dir()
            .unwrap()
            .join("submissions")
            .exists(),
        "a rejected send must not create a journal"
    );
    assert!(s.composer.remove_attachment(&scope, 0));
    assert_eq!(
        s.composer.draft(&scope).unwrap().text.text,
        "Please read my detailed message"
    );
    assert!(s.can_send());
}

#[test]
fn attachment_send_keeps_draft_until_gateway_limits_are_checked() {
    const CHILD: &str = "HERUNE_ATTACHMENT_PREFLIGHT_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let root = std::env::temp_dir().join(format!(
            "herune-attachment-preflight-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "app::tests::attachment_send_keeps_draft_until_gateway_limits_are_checked",
                "--nocapture",
            ])
            .env(CHILD, &root)
            .env("HOME", &root)
            .env("XDG_STATE_HOME", root.join("state"))
            .env("LOCALAPPDATA", root.join("state"))
            .env("TMPDIR", &root)
            .output()
            .unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            output.status.success(),
            "child failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let path = std::path::PathBuf::from(std::env::var_os(CHILD).unwrap()).join("file.pdf");
    std::fs::write(&path, b"private fixture").unwrap();
    let mut viewer = Viewer::empty();
    viewer.connection = Some(Connection::Url {
        endpoint: "http://127.0.0.1:1".into(),
        token: None,
    });
    viewer.conversation.init(std::sync::Arc::new(|| {}));
    let scope = viewer.composer_scope();
    let draft = viewer.composer.draft_mut(scope.clone());
    draft.text.replace_text("Keep this message");
    draft.attachments.push(crate::composer::DraftAttachment {
        path: path.clone(),
        name: "file.pdf".into(),
        preview: None,
    });
    viewer.send_draft();
    let draft = viewer.composer.draft(&scope).unwrap();
    assert_eq!(draft.text.text, "Keep this message");
    assert_eq!(draft.attachments.len(), 1);
    assert_eq!(draft.attachments[0].path, path);
}

#[test]
fn attachment_completion_clears_only_the_unedited_originating_draft() {
    let mut viewer = Viewer::empty();
    viewer.fixture = true;
    let scope = viewer.composer_scope();
    let attachment = crate::composer::DraftAttachment {
        path: "/private/fixture.pdf".into(),
        name: "fixture.pdf".into(),
        preview: None,
    };
    {
        let draft = viewer.composer.draft_mut(scope.clone());
        draft.text.replace_text("Original");
        draft.attachments.push(attachment.clone());
    }
    let sent = viewer.composer.draft(&scope).unwrap().clone();
    viewer.policy_sends.insert("first".into(), sent.clone());
    viewer
        .conversation
        .fixture_attachments_ready(scope.clone(), "first");
    viewer.poll_conversations();
    let draft = viewer.composer.draft(&scope).unwrap();
    assert!(draft.text.text.is_empty() && draft.attachments.is_empty());

    {
        let draft = viewer.composer.draft_mut(scope.clone());
        draft.text.replace_text("Original");
        draft.attachments.push(attachment);
    }
    viewer.policy_sends.insert("second".into(), sent);
    viewer
        .composer
        .draft_mut(scope.clone())
        .text
        .replace_text("Newer user edit");
    viewer
        .conversation
        .fixture_attachments_ready(scope.clone(), "second");
    viewer.poll_conversations();
    let draft = viewer.composer.draft(&scope).unwrap();
    assert_eq!(draft.text.text, "Newer user edit");
    assert_eq!(draft.attachments.len(), 1);
}

#[test]
fn retained_stream_status_stays_with_its_source_and_profile() {
    let mut viewer = Viewer::empty();
    viewer.fixture = true;
    let connection = Connection::Url {
        endpoint: "https://private-status.invalid".into(),
        token: None,
    };
    viewer.connection = Some(connection.clone());
    viewer.connection_epoch = 7;
    viewer.sidebar_state.demo = true;
    viewer
        .sidebar_state
        .bind_connection_at(&connection, 7, std::env::temp_dir());
    viewer.sidebar_state.apply("sidebar.recents", Ok(serde_json::json!({"sessions":[{"id":"same","profile":"default","message_count":1},{"id":"same","profile":"other","message_count":1}]})));
    let default = viewer.sidebar_state.recents.rows[0].clone();
    let other = viewer.sidebar_state.recents.rows[1].clone();
    let scope = crate::composer::DraftScope {
        draft_origin: None,
        connection: 7,
        profile: "default".into(),
        profile_intent: crate::source::ProfileIntent::Backend,
        session: Some("same".into()),
    };
    viewer
        .conversation
        .fixture(
            scope.clone(),
            &serde_json::json!({"running":true,"execution_generation":2}),
        )
        .unwrap();
    viewer.conversation.fixture_queue_event(
        scope.clone(),
        crate::gateway::conversation::Event {
            session: "same".into(),
            kind: "message.delta".into(),
            payload: serde_json::json!({"text":"working","turn_id":"t","segment":0,"offset":0}),
            epoch: None,
            sequence: Some(1),
            generation: Some(2),
            authority: None,
            admission: None,
        },
    );
    viewer.poll_conversations();
    assert!(viewer.sidebar_state.status(&default) == crate::sidebar::Status::Working);
    assert!(viewer.sidebar_state.status(&other) == crate::sidebar::Status::Idle);
    viewer.connection = Some(Connection::Url {
        endpoint: "https://other-status.invalid".into(),
        token: None,
    });
    viewer.poll_conversations();
    assert!(
        viewer.sidebar_state.status(&default) == crate::sidebar::Status::Idle,
        "a different source must not inherit an old status"
    );
    viewer.connection = Some(connection);
    viewer.poll_conversations();
    assert!(viewer.sidebar_state.status(&default) == crate::sidebar::Status::Working);
    let foreign = crate::composer::DraftScope {
        connection: 8,
        ..scope.clone()
    };
    viewer
        .conversation
        .fixture_queue_failure(foreign, "other source disconnected", true, None);
    viewer.poll_conversations();
    assert!(
        viewer.sidebar_state.status(&default) == crate::sidebar::Status::Working,
        "another source must not retire the observed stream"
    );
    viewer.conversation.fixture_queue_failure(
        scope.clone(),
        "pending acknowledgement",
        false,
        Some("send-id".into()),
    );
    viewer.poll_conversations();
    assert!(viewer.sidebar_state.status(&default) == crate::sidebar::Status::Working);
    viewer
        .conversation
        .fixture_queue_failure(scope.clone(), "disconnected", true, None);
    viewer.poll_conversations();
    assert!(
        viewer.sidebar_state.status(&default) == crate::sidebar::Status::Idle,
        "a lost stream must not be reported as confirmed running"
    );
    viewer
        .conversation
        .fixture(scope, &serde_json::json!({"running":true}))
        .unwrap();
    viewer.poll_conversations();
    assert!(viewer.sidebar_state.status(&default) == crate::sidebar::Status::Working);
    viewer.conversation.close_connection(7);
    viewer.poll_conversations();
    assert!(
        viewer.sidebar_state.status(&default) == crate::sidebar::Status::Idle,
        "retiring the connection must clear observed activity"
    );
}
