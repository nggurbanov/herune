//! Scope routing contracts against a private loopback gateway.
use super::*;
use crate::gateway::{
    prepared::{BackendTarget, SelectedContext, WirePolicy},
    route::{OverrideKind, ProfilePolicy, RouteOptions},
};
use crate::source::ProfileIntent;
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
};
use tungstenite::{Message, WebSocket};

fn routed(listener: &TcpListener) -> Connection {
    let policy = ProfilePolicy::new(
        "default",
        RouteOptions {
            primary_profile: Some("primary".into()),
            profile_remote_override: true,
            backend_profile: Some("dixie".into()),
            override_kind: OverrideKind::Url,
            ..Default::default()
        },
    )
    .unwrap();
    let policy = WirePolicy::token(policy, BTreeMap::new())
        .unwrap()
        .with_selected(
            SelectedContext::new("default", BackendTarget::Named("dixie".into())).unwrap(),
        )
        .unwrap();
    Connection::Routed {
        actual: Box::new(Connection::Url {
            endpoint: format!("http://{}", listener.local_addr().unwrap()),
            token: Some("fixture".into()),
        }),
        policy: Arc::new(policy),
        owner: Arc::new(crate::source::RouteOwner::legacy("conversation-test").unwrap()),
    }
}
fn rpc(ws: &mut WebSocket<TcpStream>, method: &str, profile: &str, result: Value) {
    let request: Value = serde_json::from_str(&ws.read().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(request["method"], method);
    assert_eq!(request["params"]["profile"], profile);
    assert_eq!(request["params"]["session_id"], "stored");
    ws.send(Message::Text(
        json!({"jsonrpc":"2.0","id":request["id"],"result":result})
            .to_string()
            .into(),
    ))
    .unwrap();
}
fn snapshot(profile: &str) -> Value {
    json!({"session_id":"stored","stored_session_id":"stored","running":true,"messages":[],"info":{"profile_name":profile}})
}
fn history(listener: &TcpListener, profile: &str) {
    let (mut stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut request = String::new();
    let mut reader = BufReader::new(&mut stream);
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line == "\r\n" || line.is_empty() {
            break;
        }
        request.push_str(&line);
    }
    assert!(request.starts_with("GET /api/sessions/stored/messages?"));
    assert!(request.contains(&format!("profile={profile}")), "{request}");
    let body = json!({"profile":profile,"session_id":"stored","messages":[]}).to_string();
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
}
fn socket(listener: &TcpListener) -> WebSocket<TcpStream> {
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    tungstenite::accept(stream).unwrap()
}
#[test]
fn worker_and_control_keep_selected_and_raw_default_separate() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = routed(&listener);
    let server = thread::spawn(move || {
        for profile in ["dixie", "default"] {
            let mut ws = socket(&listener);
            rpc(&mut ws, "session.resume", profile, snapshot(profile));
            history(&listener, profile);
            rpc(&mut ws, "session.resume", profile, snapshot(profile));
            history(&listener, profile);
            rpc(
                &mut ws,
                "prompt.submit",
                profile,
                json!({"status":"streaming"}),
            );
            drop(ws);
            let mut ws = socket(&listener);
            rpc(&mut ws, "session.resume", profile, snapshot(profile));
            history(&listener, profile);
            let mut control = socket(&listener);
            rpc(&mut control, "session.resume", profile, snapshot(profile));
            rpc(&mut control, "session.interrupt", profile, json!({}));
        }
    });
    let root = std::env::temp_dir().join(format!("rune-owner-{}", uuid::Uuid::new_v4()));
    let journal = Journal::new(root.clone()).unwrap();
    for intent in [ProfileIntent::NativeSelf, ProfileIntent::Backend] {
        let scope = DraftScope {
            draft_origin: None,
            connection: 7,
            profile: "default".into(),
            profile_intent: intent,
            session: Some("stored".into()),
        };
        let (replies, receive) = mpsc::channel();
        let mut worker = Worker {
            connection: connection.clone(),
            scope: scope.clone(),
            replies: replies.clone(),
            waker: Arc::new(|| {}),
            transport: None,
            stored: scope.session.clone(),
            epoch: String::new(),
            last: 0,
            reconnect_at: Instant::now(),
            reconnect_attempts: 0,
            want_reconnect: false,
        };
        worker.attach().unwrap();
        let entry = Prepared::new(
            &connection,
            &scope,
            SendInput {
                text: "hello".into(),
                ..Default::default()
            },
        )
        .unwrap();
        journal.save(&entry).unwrap();
        worker.submit(entry, &journal).unwrap();
        worker.transport = None;
        worker.attach().unwrap();
        control(
            connection.clone(),
            scope.clone(),
            Control::Stop {
                stored: "stored".into(),
                runtime: "stored".into(),
                generation: 0,
                authority: 0,
            },
            replies,
            Arc::new(|| {}),
        );
        loop {
            match receive.recv_timeout(Duration::from_secs(5)).unwrap() {
                Reply::ControlSettled { origin } => {
                    assert_eq!(origin, scope);
                    break;
                }
                Reply::Failed { message, .. } => panic!("{message}"),
                Reply::Snapshot { origin, .. }
                | Reply::Admitted { origin, .. }
                | Reply::StreamOpened { origin } => assert_eq!(origin, scope),
                _ => {}
            }
        }
    }
    server.join().unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn native_self_rejects_unproved_and_wrong_alias_before_connecting() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let scope = DraftScope {
        draft_origin: None,
        connection: 1,
        profile: "wrong".into(),
        profile_intent: ProfileIntent::NativeSelf,
        session: None,
    };
    assert!(connect_scope(&routed(&listener), &scope).is_err());
    let plain = Connection::Url {
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        token: None,
    };
    assert!(connect_scope(&plain, &scope).is_err());
    assert!(matches!(listener.accept(), Err(e) if e.kind() == std::io::ErrorKind::WouldBlock));
}
#[test]
fn deferred_reply_after_draft_binding_stays_on_original_intent() {
    let draft = DraftScope {
        draft_origin: None,
        connection: 1,
        profile: "default".into(),
        profile_intent: ProfileIntent::NativeSelf,
        session: None,
    };
    let selected = DraftScope {
        session: Some("stored".into()),
        draft_origin: None,
        ..draft.clone()
    };
    let raw = DraftScope {
        profile_intent: ProfileIntent::Backend,
        ..selected.clone()
    };
    let mut manager = Conversation::new();
    manager
        .fixture(raw.clone(), &json!({"session_id":"stored"}))
        .unwrap();
    let snapshot = Snapshot {
        metadata: json!({}),
        runtime: "stored".into(),
        stored: "stored".into(),
        canonical: false,
        revision: 0,
        generation: 0,
        authority: 0,
        running: false,
        epoch: String::new(),
        sequence: 0,
        prompts: vec![],
        pending: vec![],
        info: json!({}),
        messages: vec![],
    };
    manager
        .replies
        .send(Reply::Snapshot {
            origin: draft.clone(),
            snapshot,
            history: History {
                messages: vec![],
                has_more: false,
                cursor: 0,
            },
        })
        .unwrap();
    manager
        .replies
        .send(Reply::PolicySetting {
            origin: draft.clone(),
            key: "approvals.mode".into(),
            value: "smart".into(),
        })
        .unwrap();
    manager.poll();
    assert_eq!(
        manager
            .view(&draft)
            .unwrap()
            .policy
            .approval_mode
            .as_deref(),
        Some("smart")
    );
    assert_eq!(
        manager
            .view(&selected)
            .unwrap()
            .policy
            .approval_mode
            .as_deref(),
        Some("smart")
    );
    assert_ne!(
        manager.view(&raw).unwrap().policy.approval_mode.as_deref(),
        Some("smart")
    );
}

#[test]
fn retiring_raw_profile_does_not_retire_selected_route_with_same_alias() {
    let raw = DraftScope {
        draft_origin: None,
        connection: 1,
        profile: "default".into(),
        profile_intent: ProfileIntent::Backend,
        session: Some("stored".into()),
    };
    let selected = DraftScope {
        profile_intent: ProfileIntent::NativeSelf,
        ..raw.clone()
    };
    let mut manager = Conversation::new();
    manager
        .fixture(raw.clone(), &json!({"preparing":true}))
        .unwrap();
    manager
        .fixture(selected.clone(), &json!({"preparing":true}))
        .unwrap();
    manager.close_profile(1, "default");
    assert!(manager.view(&raw).is_none());
    assert!(manager.view(&selected).unwrap().preparing);
    assert!(!manager.blocks_profile_retirement(1, Some("default")));
    assert!(manager.blocks_profile_retirement(1, None));
}

#[test]
fn stream_reconnects_after_multiple_socket_failures_without_resending_prompt() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = routed(&listener);
    let server = thread::spawn(move || {
        let mut first = socket(&listener);
        rpc(&mut first, "session.resume", "dixie", snapshot("dixie"));
        history(&listener, "dixie");
        drop(first);
        // Two failed handshakes exhaust the old three-failure retry limit.
        for _ in 0..2 {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        }
        let mut recovered = socket(&listener);
        rpc(&mut recovered, "session.resume", "dixie", snapshot("dixie"));
        history(&listener, "dixie");
        recovered
            .get_mut()
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        match recovered.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            other => panic!("unexpected request after reconnect: {other:?}"),
        }
    });
    let scope = DraftScope {
        draft_origin: None,
        connection: 7,
        profile: "default".into(),
        profile_intent: ProfileIntent::NativeSelf,
        session: Some("stored".into()),
    };
    let (replies, receive) = mpsc::channel();
    let send = spawn(connection, scope.clone(), replies, Arc::new(|| {}));
    send.send(Command::Attach).unwrap();
    let deadline = Instant::now() + Duration::from_secs(25);
    let mut snapshots = 0;
    let mut failures = 0;
    while Instant::now() < deadline && snapshots < 2 {
        match receive.recv_timeout(Duration::from_secs(1)) {
            Ok(Reply::Snapshot { origin, .. }) => {
                assert_eq!(origin, scope);
                snapshots += 1;
            }
            Ok(Reply::Failed { origin, id, .. }) => {
                assert_eq!(origin, scope);
                assert!(id.is_none());
                failures += 1;
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(error) => panic!("worker exited: {error}"),
        }
    }
    assert_eq!(snapshots, 2, "the stored conversation was not reattached");
    assert!(
        failures >= 3,
        "expected the disconnect and two failed handshakes"
    );
    server.join().unwrap();
    drop(send);
}

#[test]
fn initial_attach_recovers_when_gateway_becomes_available() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = routed(&listener);
    let server = thread::spawn(move || {
        for _ in 0..2 {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        }
        let mut ws = socket(&listener);
        rpc(&mut ws, "session.resume", "dixie", snapshot("dixie"));
        history(&listener, "dixie");
        ws.get_mut()
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        match ws.read() {
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            other => panic!("unexpected request after initial attach: {other:?}"),
        }
    });
    let scope = DraftScope {
        draft_origin: None,
        connection: 7,
        profile: "default".into(),
        profile_intent: ProfileIntent::NativeSelf,
        session: Some("stored".into()),
    };
    let (replies, receive) = mpsc::channel();
    let send = spawn(connection, scope.clone(), replies, Arc::new(|| {}));
    send.send(Command::Attach).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut failures = 0;
    let mut attached = false;
    while Instant::now() < deadline && !attached {
        match receive.recv_timeout(Duration::from_secs(1)) {
            Ok(Reply::Snapshot { origin, .. }) => {
                assert_eq!(origin, scope);
                attached = true;
            }
            Ok(Reply::Failed { origin, id, .. }) => {
                assert_eq!(origin, scope);
                assert!(id.is_none());
                failures += 1;
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(error) => panic!("worker exited: {error}"),
        }
    }
    assert!(
        attached,
        "initial attach did not recover after the gateway returned"
    );
    assert!(failures >= 2);
    server.join().unwrap();
    drop(send);
}

#[test]
fn explicit_resume_refusal_stops_automatic_attach_retries() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = routed(&listener);
    let server = thread::spawn(move || {
        let (failed, _) = listener.accept().unwrap();
        drop(failed);
        let mut ws = socket(&listener);
        let request: Value =
            serde_json::from_str(&ws.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(request["method"], "session.resume");
        assert_eq!(request["params"]["profile"], "dixie");
        ws.send(Message::Text(json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":4007,"message":"session not found"}}).to_string().into())).unwrap();
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        while Instant::now() < deadline {
            match listener.accept() {
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20))
                }
                other => panic!("unexpected connection after explicit refusal: {other:?}"),
            }
        }
    });
    let scope = DraftScope {
        draft_origin: None,
        connection: 7,
        profile: "default".into(),
        profile_intent: ProfileIntent::NativeSelf,
        session: Some("stored".into()),
    };
    let (replies, receive) = mpsc::channel();
    let send = spawn(connection, scope.clone(), replies, Arc::new(|| {}));
    send.send(Command::Attach).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut refused = false;
    while Instant::now() < deadline && !refused {
        match receive.recv_timeout(Duration::from_secs(1)) {
            Ok(Reply::Failed {
                origin, message, ..
            }) => {
                assert_eq!(origin, scope);
                refused = message.contains("session not found");
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(error) => panic!("worker exited: {error}"),
        }
    }
    assert!(refused, "explicit refusal must be surfaced to the user");
    server.join().unwrap();
    drop(send);
}
