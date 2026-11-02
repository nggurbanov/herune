use super::*;
use crate::pages::{
    PageNetwork,
    capabilities::{Action, Capabilities, Mode, Selection},
};

#[test]
fn configured_agent_plugin_result_reaches_the_same_profile_chat_stream() {
    let root = std::env::temp_dir().join(format!("herune-plugin-chat-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = Connection::Url {
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        token: Some("synthetic-token".into()),
    };
    let peer = thread::spawn(move || {
        let mut limit = 0;
        for action in ["settings", "list"] {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let frame = request(&mut ws, "plugins.manage");
            assert_eq!(frame["params"]["action"], action);
            let result = if action == "settings" {
                limit = frame["params"]["values"]["limit"].as_f64().unwrap() as i64;
                json!({"ok":true})
            } else {
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","settings_schema":[{"key":"limit","type":"number","value":limit}]}]})
            };
            answer(&mut ws, &frame, result);
        }
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ws = tungstenite::accept(stream).unwrap();
        let create = request(&mut ws, "session.create");
        answer(&mut ws, &create, snapshot(false, 0));
        history(&listener, json!([]));
        let submit = request(&mut ws, "prompt.submit");
        assert_eq!(submit["params"]["text"], "Use notes");
        answer(
            &mut ws,
            &submit,
            json!({"admission_id":"owner-admission","ref":{"profile_id":"fixture-profile","session_id":"live"},"status":"started","sequence":0,"execution_generation":1,"authority_epoch":7}),
        );
        event(&mut ws, 1, "message.start", json!({}));
        event(
            &mut ws,
            2,
            "tool.start",
            json!({"tool_call_id":"notes-1","name":"notes"}),
        );
        event(
            &mut ws,
            3,
            "tool.complete",
            json!({"tool_call_id":"notes-1","name":"notes","summary":format!("limit={limit}")}),
        );
        event(
            &mut ws,
            4,
            "message.complete",
            json!({"text":"Notes complete","status":"complete"}),
        );
        let resume = request(&mut ws, "session.resume");
        assert_eq!(resume["params"]["session_id"], "stored");
        answer(&mut ws, &resume, snapshot(false, 4));
        history(
            &listener,
            json!([{"role":"user","content":"Use notes"},{"role":"assistant","content":"Notes complete"}]),
        );
    });
    let scope = DraftScope {
        draft_origin: Some(crate::composer::DraftOrigin::new()),
        profile_intent: crate::source::ProfileIntent::Backend,
        connection: 1,
        profile: "work".into(),
        session: None,
    };
    let mut page = Capabilities::new();
    page.profile = Some("work".into());
    page.mode = Mode::Plugins;
    page.plugins = vec![
        json!({"key":"notes","name":"Notes","source":"user","settings_schema":[{"key":"limit","type":"number","value":2}]}),
    ];
    page.act(Action::Select(Selection::Plugin("notes".into())));
    page.fields[0].input.replace_text("8");
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let mut effects = std::collections::VecDeque::from(page.act(Action::SavePluginSettings));
    while let Some((operation, request)) = effects.pop_front() {
        network
            .request(&scope, connection.clone(), &operation, request)
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let result = loop {
            if let Some(reply) = network
                .poll(&scope)
                .into_iter()
                .find(|reply| !reply.progress)
            {
                break reply.result;
            }
            assert!(Instant::now() < deadline, "missing plugin settings reply");
            thread::sleep(Duration::from_millis(2));
        };
        effects.extend(page.apply(&operation, result));
    }
    assert_eq!(page.fields[0].input.text, "8");
    let prepared = Prepared::new(
        &connection,
        &scope,
        SendInput {
            text: "Use notes".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let journal = Journal::new(root.join("journal")).unwrap();
    journal.save(&prepared).unwrap();
    let (mut worker, replies) = worker(connection, scope.clone());
    worker.submit(prepared, &journal).unwrap();
    let mut manager = Conversation::new();
    for reply in replies.try_iter() {
        manager.replies.send(reply).unwrap();
    }
    manager.poll();
    for _ in 0..3 {
        let event = worker
            .transport
            .as_mut()
            .unwrap()
            .read_event()
            .unwrap()
            .unwrap();
        worker.event(event).unwrap();
    }
    for reply in replies.try_iter() {
        manager.replies.send(reply).unwrap();
    }
    manager.poll();
    let stored_scope = DraftScope {
        session: Some("stored".into()),
        draft_origin: None,
        ..scope
    };
    assert!(
        manager
            .view(&stored_scope)
            .unwrap()
            .tools
            .iter()
            .any(|line| line.contains("limit=8"))
    );
    let event = worker
        .transport
        .as_mut()
        .unwrap()
        .read_event()
        .unwrap()
        .unwrap();
    worker.event(event).unwrap();
    for reply in replies.try_iter() {
        manager.replies.send(reply).unwrap();
    }
    manager.poll();
    assert_eq!(
        manager
            .view(&stored_scope)
            .unwrap()
            .completed_text
            .as_deref(),
        Some("Notes complete")
    );
    peer.join().unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
