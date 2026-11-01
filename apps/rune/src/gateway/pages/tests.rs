use super::*;
use crate::{
    composer::DraftScope,
    gateway::prepared::{BackendTarget, ProfileProvenance, SelectedContext, WirePolicy},
    pages::{PageNetwork, PageRequest},
    source::ProfileIntent,
};
use std::{collections::BTreeMap, net::TcpListener, sync::Arc, thread};
use tungstenite::handshake::server::{Request, Response};

fn connection(listener: &TcpListener, target: BackendTarget) -> Connection {
    let policy = route::ProfilePolicy::new(
        "default",
        route::RouteOptions {
            primary_profile: Some("primary".into()),
            profile_remote_override: true,
            override_kind: route::OverrideKind::Url,
            ..Default::default()
        },
    )
    .unwrap();
    let policy = WirePolicy::token(
        policy,
        BTreeMap::from([("X-Access-Fixture".into(), "private-access".into())]),
    )
    .unwrap()
    .with_selected(SelectedContext::new("default", target).unwrap())
    .unwrap();
    Connection::Routed {
        actual: Box::new(Connection::Url {
            endpoint: format!("http://{}/hermes/", listener.local_addr().unwrap()),
            token: Some("private-session".into()),
        }),
        policy: Arc::new(policy),
        owner: Arc::new(crate::source::RouteOwner::legacy("projects-private-test").unwrap()),
    }
}

fn scope(epoch: u64) -> DraftScope {
    DraftScope {
        draft_origin: None,
        profile_intent: ProfileIntent::Backend,
        connection: epoch,
        profile: "work".into(),
        session: None,
    }
}

fn run(
    network: &mut PageNetwork,
    connection: Connection,
    epoch: u64,
    method: &str,
    body: Value,
    provenance: ProfileProvenance,
) -> Result<Value, String> {
    let scope = scope(epoch);
    network
        .request(
            &scope,
            connection,
            "projects",
            PageRequest::rpc(method, body)
                .profile("work")
                .provenance(provenance)
                .timeout_secs(3),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(reply) = network
            .poll(&scope)
            .into_iter()
            .find(|reply| !reply.progress)
        {
            return reply.result;
        }
        assert!(Instant::now() < deadline, "missing page reply");
        thread::sleep(Duration::from_millis(2));
    }
}

fn server(listener: TcpListener, expected: Vec<(Value, Value)>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for (params, result) in expected {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut socket =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    let url = Url::parse(&format!("http://private{}", request.uri())).unwrap();
                    assert_eq!(url.path(), "/hermes/api/ws");
                    assert!(
                        url.query_pairs()
                            .any(|(k, v)| k == "token" && v == "private-session")
                    );
                    assert_eq!(request.headers()["x-access-fixture"], "private-access");
                    Ok(response)
                })
                .unwrap();
            let request: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(request["method"], params["method"]);
            assert_eq!(request["params"], params["params"]);
            socket
                .send(Message::Text(
                    json!({"jsonrpc":"2.0", "id":request["id"], "result":result})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        }
    })
}

#[test]
fn projects_page_network_preserves_source_and_backend_profile() {
    let a = TcpListener::bind("127.0.0.1:0").unwrap();
    let b = TcpListener::bind("127.0.0.1:0").unwrap();
    let ca = connection(&a, BackendTarget::Named("selected".into()));
    let cb = connection(&b, BackendTarget::Named("selected".into()));
    let response = |path| json!({"projects":[{"id":"same","path":path}]});
    let sa = server(
        a,
        vec![
            (
                json!({"method":"projects.tree","params":{"profile":"work","preview_limit":3}}),
                response("/source-a"),
            ),
            (
                json!({"method":"projects.project_sessions","params":{"profile":"work","project_id":"same"}}),
                json!({"project":{"id":"same","path":"/source-a"}}),
            ),
        ],
    );
    let sb = server(
        b,
        vec![(
            json!({"method":"projects.tree","params":{"profile":"work","preview_limit":3}}),
            response("/source-b"),
        )],
    );
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let backend = || ProfileProvenance::Backend("work".into());
    let tree = || json!({"profile":"work","preview_limit":3});
    assert_eq!(
        run(
            &mut network,
            ca.clone(),
            1,
            "projects.tree",
            tree(),
            backend()
        )
        .unwrap()["projects"][0]["path"],
        "/source-a"
    );
    assert_eq!(
        run(
            &mut network,
            ca,
            1,
            "projects.project_sessions",
            json!({"profile":"work","project_id":"same"}),
            backend()
        )
        .unwrap()["project"]["path"],
        "/source-a"
    );
    assert_eq!(
        run(&mut network, cb, 2, "projects.tree", tree(), backend()).unwrap()["projects"][0]["path"],
        "/source-b"
    );
    sa.join().unwrap();
    sb.join().unwrap();
}

#[test]
fn projects_page_network_validates_native_root_before_project_rpc() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let proof = BackendRootProof {
        profile: None,
        profile_id: "/private/root".into(),
        instance_id: "fixture-instance".into(),
        authority_epoch: 7,
    };
    let connection = connection(&listener, BackendTarget::Root(proof));
    let server = thread::spawn(move || {
        for valid in [true, false] {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut socket =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    assert_eq!(request.headers()["x-access-fixture"], "private-access");
                    let url = Url::parse(&format!("http://private{}", request.uri())).unwrap();
                    assert!(
                        url.query_pairs()
                            .any(|(k, v)| k == "token" && v == "private-session")
                    );
                    Ok(response)
                })
                .unwrap();
            let describe: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(describe["method"], "runtime.describe");
            let epoch = if valid { 7 } else { 8 };
            socket.send(Message::Text(json!({"jsonrpc":"2.0","id":describe["id"],"result":{"profile_id":"/private/root","instance_id":"fixture-instance","authority_epoch":epoch}}).to_string().into())).unwrap();
            if valid {
                let request: Value =
                    serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
                assert_eq!(request["method"], "projects.tree");
                assert_eq!(request["params"], json!({"preview_limit":3}));
                socket
                    .send(Message::Text(
                        json!({"jsonrpc":"2.0","id":request["id"],"result":{"projects":[]}})
                            .to_string()
                            .into(),
                    ))
                    .unwrap();
            } else {
                assert!(socket.read().is_err());
            }
        }
    });
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let body = || json!({"profile":"work","preview_limit":3});
    assert!(
        run(
            &mut network,
            connection.clone(),
            1,
            "projects.tree",
            body(),
            ProfileProvenance::NativeSelf
        )
        .is_ok()
    );
    assert!(
        run(
            &mut network,
            connection,
            1,
            "projects.tree",
            body(),
            ProfileProvenance::NativeSelf
        )
        .unwrap_err()
        .contains("authority changed")
    );
    server.join().unwrap();
}

#[test]
fn unsupported_project_rpc_is_rejected_before_rpc_io() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = connection(&listener, BackendTarget::Named("selected".into()));
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        assert!(socket.read().is_err());
    });
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let error = run(
        &mut network,
        connection,
        1,
        "projects.arbitrary",
        json!({"profile":"work"}),
        ProfileProvenance::Backend("work".into()),
    )
    .unwrap_err();
    assert!(error.contains("not part of the native workspace API"));
    server.join().unwrap();
}

#[test]
fn retained_projects_requests_hydrate_tree_and_entered_sessions_through_page_network() {
    use crate::projects::{LoadKind, Owner, Scope, State};
    use crate::source::{Binding, SessionOwner};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = Connection::Url {
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        token: Some("private-session".into()),
    };
    let binding = Binding::new(connection.clone(), None).unwrap();
    let server = thread::spawn(move || {
        for (method, params, result) in [
            (
                "projects.tree",
                json!({"profile":"work","preview_limit":3}),
                json!({"projects":[{"id":"same","label":"Fixture","path":"/private/project"}]}),
            ),
            (
                "projects.project_sessions",
                json!({"profile":"work","project_id":"same"}),
                json!({"project":{"id":"same","label":"Fixture","path":"/private/project","sessions":[]}}),
            ),
        ] {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut socket =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    let url = Url::parse(&format!("http://private{}", request.uri())).unwrap();
                    assert_eq!(url.path(), "/api/ws");
                    assert!(
                        url.query_pairs()
                            .any(|(k, v)| k == "token" && v == "private-session")
                    );
                    Ok(response)
                })
                .unwrap();
            let request: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(request["method"], method);
            assert_eq!(request["params"], params);
            socket
                .send(Message::Text(
                    json!({"jsonrpc":"2.0","id":request["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        }
    });
    let mut state = State::default();
    state.bind(Owner {
        session: SessionOwner::new(binding.stamp().clone(), "work"),
        epoch: 1,
    });
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let scope = scope(1);
    for kind in [LoadKind::Tree, LoadKind::Entered("same".into())] {
        if matches!(kind, LoadKind::Entered(_)) {
            state.select(Scope::Project("same".into()));
        }
        let (ticket, request) = state.begin(kind, &binding).unwrap();
        network
            .request(&scope, connection.clone(), "projects", request)
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
            assert!(Instant::now() < deadline, "missing retained project reply");
            thread::sleep(Duration::from_millis(2));
        };
        assert!(state.finish(ticket, &binding, result));
        assert!(state.error.is_none());
    }
    assert!(state.tree.is_some());
    assert!(state.entered.is_some());
    server.join().unwrap();
}

#[test]
fn native_root_create_requires_matching_authority_before_rpc() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = connection(
        &listener,
        BackendTarget::Root(BackendRootProof {
            profile: None,
            profile_id: "/private/root".into(),
            instance_id: "fixture-instance".into(),
            authority_epoch: 7,
        }),
    );
    let server = thread::spawn(move || {
        for valid in [true, false] {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            let mut socket =
                tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                    assert_eq!(request.headers()["x-access-fixture"], "private-access");
                    let url = Url::parse(&format!("http://private{}", request.uri())).unwrap();
                    assert!(
                        url.query_pairs()
                            .any(|(k, v)| k == "token" && v == "private-session")
                    );
                    Ok(response)
                })
                .unwrap();
            let describe: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(describe["method"], "runtime.describe");
            let epoch = if valid { 7 } else { 8 };
            socket.send(Message::Text(json!({"jsonrpc":"2.0","id":describe["id"],"result":{"profile_id":"/private/root","instance_id":"fixture-instance","authority_epoch":epoch}}).to_string().into())).unwrap();
            if valid {
                let request: Value =
                    serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
                assert_eq!(request["method"], "projects.create");
                assert_eq!(
                    request["params"],
                    json!({"name":"First","folders":["/fixture/project"],"use":true})
                );
                socket.send(Message::Text(json!({"jsonrpc":"2.0","id":request["id"],"result":{"project":{"id":"same"}}}).to_string().into())).unwrap();
            } else {
                assert!(socket.read().is_err());
            }
        }
    });
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let body =
        || json!({"profile":"work","name":"First","folders":["/fixture/project"],"use":true});
    assert!(
        run(
            &mut network,
            connection.clone(),
            1,
            "projects.create",
            body(),
            ProfileProvenance::NativeSelf
        )
        .is_ok()
    );
    assert!(
        run(
            &mut network,
            connection,
            1,
            "projects.create",
            body(),
            ProfileProvenance::NativeSelf
        )
        .unwrap_err()
        .contains("authority changed")
    );
    server.join().unwrap();
}

#[test]
fn agent_plugin_lifecycle_uses_scoped_page_rpc_and_authoritative_lists() {
    use crate::pages::capabilities::{Action, Capabilities, Mode, Selection};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = connection(&listener, BackendTarget::Named("selected".into()));
    let sha = "a".repeat(40);
    let row = |status: &str| json!({"key":"notes","name":"Notes","source":"user","status":status,"settings_schema":[{"key":"limit","type":"number","value":6}]});
    let params = |body: Value| {
        let mut body = body.as_object().unwrap().clone();
        body.insert("profile".into(), json!("work"));
        json!({"method":"plugins.manage","params":body})
    };
    let list = || params(json!({"action":"list"}));
    let installed = |status| json!({"plugins":[row(status)]});
    let peer = server(
        listener,
        vec![
            (list(), json!({"plugins":[]})),
            (
                params(json!({"action":"inspect","identifier":"fixture:notes"})),
                json!({"ok":true,"agent":true,"sha":sha}),
            ),
            (
                params(
                    json!({"action":"install","identifier":"fixture:notes","inspected_sha":sha,"enable":true,"force":false}),
                ),
                json!({"ok":true,"restart_required":true}),
            ),
            (
                list(),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":5}]}]}),
            ),
            (
                params(json!({"action":"settings","key":"notes","values":{"limit":6.0}})),
                json!({"ok":true}),
            ),
            (
                list(),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":6}]}]}),
            ),
            (
                params(json!({"action":"toggle","key":"notes","enable":false})),
                json!({"ok":true}),
            ),
            (list(), installed("disabled")),
            (list(), installed("disabled")),
            (
                params(json!({"action":"toggle","key":"notes","enable":true})),
                json!({"ok":true}),
            ),
            (list(), installed("enabled")),
            (
                params(
                    json!({"action":"update","name":"Notes","accept_capabilities":false,"force":false}),
                ),
                json!({"ok":true}),
            ),
            (list(), installed("enabled")),
            (
                params(json!({"action":"remove","name":"Notes"})),
                json!({"ok":true}),
            ),
            (list(), json!({"plugins":[]})),
        ],
    );
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let dispatch = |state: &mut Capabilities,
                    network: &mut PageNetwork,
                    effects: Vec<crate::pages::PageEffect>| {
        let mut queue = std::collections::VecDeque::from(effects);
        while let Some((operation, request)) = queue.pop_front() {
            let result = run(
                network,
                connection.clone(),
                1,
                &request.path,
                request.body,
                ProfileProvenance::Backend("work".into()),
            );
            queue.extend(state.apply(&operation, result));
        }
    };
    let fresh = || {
        let mut state = Capabilities::new();
        state.profile = Some("work".into());
        state.mode = Mode::Plugins;
        state
    };
    let mut state = fresh();
    let effects = state.load();
    dispatch(&mut state, &mut network, effects);
    state.act(Action::Select(Selection::InstallPlugin));
    state.source.replace_text("fixture:notes");
    let effects = state.act(Action::InspectPlugin);
    dispatch(&mut state, &mut network, effects);
    let effects = state.act(Action::InstallPlugin);
    dispatch(&mut state, &mut network, effects);
    assert!(state.message.as_deref().unwrap().contains("restart"));
    assert_eq!(state.plugins[0]["status"], "enabled");
    state.act(Action::Select(Selection::Plugin("notes".into())));
    state.fields[0].input.replace_text("6");
    let effects = state.act(Action::SavePluginSettings);
    dispatch(&mut state, &mut network, effects);
    assert_eq!(state.fields[0].input.text, "6");
    let effects = state.act(Action::TogglePlugin("notes".into(), false));
    dispatch(&mut state, &mut network, effects);
    assert_eq!(state.plugins[0]["status"], "disabled");
    let mut recreated = fresh();
    let effects = recreated.load();
    dispatch(&mut recreated, &mut network, effects);
    assert_eq!(recreated.plugins[0]["status"], "disabled");
    assert_eq!(recreated.plugins[0]["settings_schema"][0]["value"], 6);
    let effects = recreated.act(Action::TogglePlugin("notes".into(), true));
    dispatch(&mut recreated, &mut network, effects);
    recreated.act(Action::Select(Selection::Plugin("notes".into())));
    let effects = recreated.act(Action::UpdatePlugin("Notes".into(), false, false));
    dispatch(&mut recreated, &mut network, effects);
    let effects = recreated.act(Action::RemovePlugin("Notes".into()));
    dispatch(&mut recreated, &mut network, effects);
    assert!(recreated.plugins.is_empty());
    assert!(recreated.selection.is_none());
    peer.join().unwrap();
}

#[test]
fn delayed_plugin_write_keeps_its_source_and_cannot_repaint_replacement_owner() {
    let a = TcpListener::bind("127.0.0.1:0").unwrap();
    let b = TcpListener::bind("127.0.0.1:0").unwrap();
    let ca = connection(&a, BackendTarget::Named("selected".into()));
    let cb = connection(&b, BackendTarget::Named("selected".into()));
    let (seen_tx, seen_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let old = thread::spawn(move || {
        let (stream, _) = a.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let frame: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(frame["method"], "plugins.manage");
        assert_eq!(
            frame["params"],
            json!({"profile":"work","action":"toggle","key":"notes","enable":false})
        );
        seen_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        socket
            .send(Message::Text(
                json!({"jsonrpc":"2.0","id":frame["id"],"result":{"ok":true}})
                    .to_string()
                    .into(),
            ))
            .unwrap();
    });
    let new = server(
        b,
        vec![(
            json!({"method":"plugins.manage","params":{"profile":"work","action":"list"}}),
            json!({"plugins":[{"key":"notes","status":"enabled","source":"user"}]}),
        )],
    );
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    network
        .request(
            &scope(1),
            ca,
            "capabilities.write",
            PageRequest::rpc(
                "plugins.manage",
                json!({"action":"toggle","key":"notes","enable":false}),
            )
            .profile("work")
            .provenance(ProfileProvenance::Backend("work".into())),
        )
        .unwrap();
    seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let current = run(
        &mut network,
        cb,
        2,
        "plugins.manage",
        json!({"action":"list"}),
        ProfileProvenance::Backend("work".into()),
    )
    .unwrap();
    assert_eq!(current["plugins"][0]["status"], "enabled");
    release_tx.send(()).unwrap();
    old.join().unwrap();
    new.join().unwrap();
    // The old completion is drained under the replacement owner and never delivered to it.
    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        assert!(network.poll(&scope(2)).is_empty());
        thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn plugin_settings_secret_and_values_use_real_scoped_save_transaction() {
    use crate::pages::capabilities::{Action, Capabilities, Mode, Selection};
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = Connection::Url {
        endpoint: format!("http://{}", listener.local_addr().unwrap()),
        token: Some("fixture-token".into()),
    };
    let peer = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let _socket = tungstenite::accept(stream).unwrap();
        let (mut http, _) = listener.accept().unwrap();
        http.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut reader = BufReader::new(&mut http);
        let mut first = String::new();
        reader.read_line(&mut first).unwrap();
        let target = first.split_whitespace().nth(1).unwrap();
        let url = Url::parse(&format!("http://fixture{target}")).unwrap();
        assert_eq!(url.path(), "/api/env");
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "profile" && value == "work")
        );
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "token" && value == "fixture-token")
        );
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse::<usize>().unwrap();
            }
        }
        let mut bytes = vec![0; length];
        reader.read_exact(&mut bytes).unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["key"], "NOTES_TOKEN");
        assert!(body["value"] == "disposable-fixture-secret");
        write!(http, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{{\"ok\":true}}").unwrap();
        for (action, result) in [
            ("settings", json!({"ok":true})),
            (
                "list",
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","settings_schema":[{"key":"token","type":"secret","env":"NOTES_TOKEN","has_value":true},{"key":"limit","type":"number","value":8}]}]}),
            ),
        ] {
            let (stream, _) = listener.accept().unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let frame: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(frame["method"], "plugins.manage");
            assert_eq!(frame["params"]["profile"], "work");
            assert_eq!(frame["params"]["action"], action);
            if action == "settings" {
                assert_eq!(frame["params"]["values"], json!({"limit":8.0}));
            }
            socket
                .send(Message::Text(
                    json!({"jsonrpc":"2.0","id":frame["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        }
    });
    let mut state = Capabilities::new();
    state.profile = Some("work".into());
    state.mode = Mode::Plugins;
    state.plugins = vec![
        json!({"key":"notes","name":"Notes","source":"user","settings_schema":[{"key":"token","type":"secret","env":"NOTES_TOKEN"},{"key":"limit","type":"number","value":2}]}),
    ];
    state.act(Action::Select(Selection::Plugin("notes".into())));
    state.fields[0]
        .input
        .replace_text("disposable-fixture-secret");
    state.fields[1].input.replace_text("8");
    let mut queue = std::collections::VecDeque::from(state.act(Action::SavePluginSettings));
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let scope = scope(1);
    while let Some((operation, request)) = queue.pop_front() {
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
            assert!(Instant::now() < deadline, "missing transaction reply");
            thread::sleep(Duration::from_millis(2));
        };
        queue.extend(state.apply(&operation, result));
    }
    assert!(state.fields[0].input.text.is_empty());
    assert!(state.fields[0].has_value);
    assert_eq!(state.fields[1].input.text, "8");
    peer.join().unwrap();
}

#[test]
fn plugin_lost_install_reply_is_reported_without_automatic_duplicate_install() {
    use crate::pages::capabilities::{Action, Capabilities, Mode};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let connection = connection(&listener, BackendTarget::Named("selected".into()));
    let peer = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let frame: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(frame["params"]["action"], "install");
        drop(socket);
        listener.set_nonblocking(true).unwrap();
        let until = Instant::now() + Duration::from_millis(300);
        while Instant::now() < until {
            match listener.accept() {
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2))
                }
                Ok(_) => panic!("install was automatically repeated"),
                Err(error) => panic!("fixture listener failed: {error}"),
            }
        }
    });
    let mut state = Capabilities::new();
    state.mode = Mode::Plugins;
    state.profile = Some("work".into());
    state.source.replace_text("fixture:notes");
    state.inspected_source = state.source.text.clone();
    state.inspection = json!({"ok":true,"agent":true,"sha":"a".repeat(40)});
    let (operation, request) = state.act(Action::InstallPlugin).pop().unwrap();
    let mut network = PageNetwork::default();
    network.init(Arc::new(|| {}));
    let result = run(
        &mut network,
        connection,
        1,
        &request.path,
        request.body,
        ProfileProvenance::Backend("work".into()),
    );
    assert!(result.is_err());
    assert!(state.apply(&operation, result).is_empty());
    assert!(!state.busy());
    assert!(state.errors.contains_key("capabilities.write"));
    peer.join().unwrap();
}
