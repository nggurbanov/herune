use super::*;
use crate::pages::capabilities::{Action, Mode, Selection};
use rune::{Cx, El, Env, Runtime};
use serde_json::json;
use std::{
    net::TcpListener,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

fn view(viewer: &Viewer, _: &mut Cx<Viewer>) -> El {
    let mut layers = Vec::new();
    let page = crate::view::pages::capabilities::page(
        viewer,
        &rune_theme_opencode::kit(true),
        &mut layers,
    );
    rune::col().size(1200., 800.).child(page).children(layers)
}

#[test]
fn mounted_plugin_row_opens_the_scoped_gateway_result() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let peer = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept_hdr(
            stream,
            |request: &tungstenite::handshake::server::Request,
             response: tungstenite::handshake::server::Response| {
                assert!(
                    request
                        .uri()
                        .query()
                        .unwrap_or_default()
                        .contains("token=private-fixture")
                );
                Ok(response)
            },
        )
        .unwrap();
        let frame: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(frame["method"], "plugins.manage");
        assert_eq!(frame["params"], json!({"action":"list","profile":"work"}));
        socket.send(tungstenite::Message::Text(json!({"jsonrpc":"2.0","id":frame["id"],"result":{"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled"}]}}).to_string().into())).unwrap();
    });
    let mut viewer = Viewer::empty();
    viewer.connection = Some(crate::gateway::Connection::Url {
        endpoint,
        token: Some("private-fixture".into()),
    });
    viewer.connection_epoch = 1;
    viewer.profile = "work".into();
    viewer.fixture = false;
    viewer.loading = false;
    viewer.page_network.init(Arc::new(|| {}));
    let owner = (1, viewer.profile.clone(), viewer.profile_intent);
    viewer.page_owner = Some(owner.clone());
    viewer.page_accepted_owner = Some(owner.clone());
    viewer.page_loaded_owner = Some(owner);
    viewer.capabilities.profile = Some("work".into());
    viewer.capabilities.mode = Mode::Plugins;
    let effects = viewer.capabilities.load();
    viewer.page_requests(effects);
    let deadline = Instant::now() + Duration::from_secs(5);
    while viewer.capabilities.plugins.is_empty() {
        for reply in viewer.page_network.poll(&viewer.composer_scope()) {
            viewer.apply_page_result(&reply.operation, reply.result);
        }
        assert!(Instant::now() < deadline, "missing plugin list");
        thread::sleep(Duration::from_millis(2));
    }
    let mut runtime = Runtime::new(viewer, view, (1200., 800.), Env::new(true, 1.));
    runtime.frame(0.);
    let (x, y) = runtime
        .find("capability-plugin-notes")
        .expect("mounted plugin row");
    runtime.pointer_down(x, y);
    runtime.pointer_up(x, y);
    runtime.frame(1.);
    assert_eq!(
        runtime.state.capabilities.selection,
        Some(Selection::Plugin("notes".into()))
    );
    assert_eq!(runtime.state.capabilities.detail["name"], "Notes");
    assert!(
        runtime
            .state
            .capabilities
            .act(Action::CloseDetail)
            .is_empty()
    );
    peer.join().unwrap();
}

fn press_label(runtime: &mut Runtime<Viewer>, label: &str) {
    runtime.invalidate();
    runtime.frame(1.);
    let control = runtime
        .elements()
        .into_iter()
        .find(|element| {
            element.role == "button" && element.label.as_deref() == Some(label) && !element.exiting
        })
        .unwrap_or_else(|| panic!("missing control {label}"));
    let (x, y) = (
        control.rect[0] + control.rect[2] / 2.,
        control.rect[1] + control.rect[3] / 2.,
    );
    runtime.pointer_down(x, y);
    runtime.pointer_up(x, y);
    runtime.frame(1.);
}
fn wait_for(runtime: &mut Runtime<Viewer>, predicate: impl Fn(&Viewer) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !predicate(&runtime.state) {
        let scope = runtime.state.composer_scope();
        for reply in runtime.state.page_network.poll(&scope) {
            runtime
                .state
                .apply_page_result(&reply.operation, reply.result);
        }
        assert!(
            Instant::now() < deadline,
            "missing mounted capability reply"
        );
        thread::sleep(Duration::from_millis(2));
    }
    runtime.invalidate();
    runtime.frame(1.);
}

fn press_switch(runtime: &mut Runtime<Viewer>, label: &str) {
    runtime.invalidate();
    runtime.frame(1.);
    let control = runtime
        .elements()
        .into_iter()
        .find(|element| {
            element.role == "switch" && element.label.as_deref() == Some(label) && !element.exiting
        })
        .unwrap_or_else(|| panic!("missing switch {label}"));
    let (x, y) = (
        control.rect[0] + control.rect[2] / 2.,
        control.rect[1] + control.rect[3] / 2.,
    );
    runtime.pointer_down(x, y);
    runtime.pointer_up(x, y);
    runtime.frame(1.);
}

#[test]
fn mounted_plugin_controls_inspect_and_install_the_reviewed_commit() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let restart_endpoint = endpoint.clone();
    let peer = thread::spawn(move || {
        let sha = "a".repeat(40);
        let mut installed = false;
        let mut enabled = false;
        let mut limit = 2;
        let mut version = "1";
        for (params, result) in [
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[]}),
            ),
            (
                json!({"action":"inspect","identifier":"fixture:notes","profile":"work"}),
                json!({"ok":true,"agent":true,"sha":sha}),
            ),
            (
                json!({"action":"install","identifier":"fixture:notes","inspected_sha":sha,"enable":true,"force":false,"profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":2}]}]}),
            ),
            (
                json!({"action":"settings","key":"notes","values":{"limit":8.0},"profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":8}]}]}),
            ),
            (
                json!({"action":"toggle","key":"notes","enable":false,"profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"disabled","settings_schema":[{"key":"limit","type":"number","value":8}]}]}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"disabled","settings_schema":[{"key":"limit","type":"number","value":8}]}]}),
            ),
            (
                json!({"action":"toggle","key":"notes","enable":true,"profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":8}]}]}),
            ),
            (
                json!({"action":"update","name":"Notes","accept_capabilities":false,"force":false,"profile":"work"}),
                json!({"consent_required":true,"delta_lines":["new capability"]}),
            ),
            (
                json!({"action":"update","name":"Notes","accept_capabilities":true,"force":false,"profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[{"key":"notes","name":"Notes","source":"user","status":"enabled","settings_schema":[{"key":"limit","type":"number","value":8}]}]}),
            ),
            (
                json!({"action":"remove","name":"Notes","profile":"work"}),
                json!({"ok":true}),
            ),
            (
                json!({"action":"list","profile":"work"}),
                json!({"plugins":[]}),
            ),
        ] {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut socket = tungstenite::accept_hdr(
                stream,
                |request: &tungstenite::handshake::server::Request,
                 response: tungstenite::handshake::server::Response| {
                    assert!(
                        request
                            .uri()
                            .query()
                            .unwrap_or_default()
                            .contains("token=private-fixture")
                    );
                    Ok(response)
                },
            )
            .unwrap();
            let frame: Value =
                serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(frame["method"], "plugins.manage");
            assert_eq!(frame["params"], params);
            let result = match frame["params"]["action"].as_str().unwrap() {
                "install" => {
                    installed = true;
                    enabled = true;
                    result
                }
                "settings" => {
                    limit = frame["params"]["values"]["limit"].as_f64().unwrap() as i64;
                    result
                }
                "toggle" => {
                    enabled = frame["params"]["enable"].as_bool().unwrap();
                    result
                }
                "remove" => {
                    installed = false;
                    result
                }
                "update" => {
                    if frame["params"]["accept_capabilities"] == true {
                        version = "2";
                    }
                    result
                }
                "list" => {
                    let plugins = if installed {
                        vec![
                            json!({"key":"notes","name":"Notes","source":"user","status":if enabled { "enabled" } else { "disabled" },"version":version,"settings_schema":[{"key":"limit","type":"number","value":limit}]}),
                        ]
                    } else {
                        vec![]
                    };
                    json!({"plugins":plugins})
                }
                _ => result,
            };
            socket
                .send(tungstenite::Message::Text(
                    json!({"jsonrpc":"2.0","id":frame["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        }
    });
    let mut viewer = Viewer::empty();
    viewer.connection = Some(crate::gateway::Connection::Url {
        endpoint,
        token: Some("private-fixture".into()),
    });
    viewer.connection_epoch = 1;
    viewer.profile = "work".into();
    viewer.fixture = false;
    viewer.loading = false;
    viewer.page_network.init(Arc::new(|| {}));
    let owner = (1, viewer.profile.clone(), viewer.profile_intent);
    viewer.page_owner = Some(owner.clone());
    viewer.page_accepted_owner = Some(owner.clone());
    viewer.page_loaded_owner = Some(owner);
    viewer.capabilities.profile = Some("work".into());
    viewer.capabilities.mode = Mode::Plugins;
    let effects = viewer.capabilities.load();
    viewer.page_requests(effects);
    let mut runtime = Runtime::new(viewer, view, (1200., 800.), Env::new(true, 1.));
    wait_for(&mut runtime, |v| {
        !v.capabilities.pending.contains("capabilities.plugins")
    });
    press_label(&mut runtime, "Install from source");
    runtime.update(|v, _| v.capabilities.source.replace_text("fixture:notes"));
    press_label(&mut runtime, "Inspect source");
    wait_for(&mut runtime, |v| !v.capabilities.inspection.is_null());
    press_label(&mut runtime, "Install reviewed commit");
    press_label(&mut runtime, "Confirm");
    wait_for(&mut runtime, |v| !v.capabilities.plugins.is_empty());
    assert_eq!(runtime.state.capabilities.plugins[0]["key"], "notes");
    let (x, y) = runtime.find("capability-plugin-notes").unwrap();
    runtime.pointer_down(x, y);
    runtime.pointer_up(x, y);
    runtime.frame(1.);
    runtime.update(|v, _| v.capabilities.fields[0].input.replace_text("8"));
    press_label(&mut runtime, "Save plugin settings");
    wait_for(&mut runtime, |v| {
        v.capabilities
            .fields
            .first()
            .is_some_and(|f| f.initial == "8")
    });
    press_switch(&mut runtime, "Enable Notes");
    wait_for(&mut runtime, |v| {
        v.capabilities.plugins[0]["status"] == "disabled"
    });
    drop(runtime);
    let mut recreated = Viewer::empty();
    recreated.connection = Some(crate::gateway::Connection::Url {
        endpoint: restart_endpoint,
        token: Some("private-fixture".into()),
    });
    recreated.connection_epoch = 1;
    recreated.profile = "work".into();
    recreated.fixture = false;
    recreated.loading = false;
    recreated.page_network.init(Arc::new(|| {}));
    let owner = (1, recreated.profile.clone(), recreated.profile_intent);
    recreated.page_owner = Some(owner.clone());
    recreated.page_accepted_owner = Some(owner.clone());
    recreated.page_loaded_owner = Some(owner);
    recreated.capabilities.profile = Some("work".into());
    recreated.capabilities.mode = Mode::Plugins;
    let effects = recreated.capabilities.load();
    recreated.page_requests(effects);
    let mut runtime = Runtime::new(recreated, view, (1200., 800.), Env::new(true, 1.));
    wait_for(&mut runtime, |v| !v.capabilities.plugins.is_empty());
    assert_eq!(runtime.state.capabilities.plugins[0]["status"], "disabled");
    assert_eq!(
        runtime.state.capabilities.plugins[0]["settings_schema"][0]["value"],
        8
    );
    press_switch(&mut runtime, "Enable Notes");
    wait_for(&mut runtime, |v| {
        v.capabilities.plugins[0]["status"] == "enabled"
    });
    let (x, y) = runtime.find("capability-plugin-notes").unwrap();
    runtime.pointer_down(x, y);
    runtime.pointer_up(x, y);
    runtime.frame(1.);
    press_label(&mut runtime, "Update");
    wait_for(&mut runtime, |v| v.capabilities.confirm.is_some());
    press_label(&mut runtime, "Confirm");
    wait_for(&mut runtime, |v| {
        !v.capabilities.busy() && !v.capabilities.pending.contains("capabilities.plugins")
    });
    assert_eq!(runtime.state.capabilities.plugins[0]["version"], "2");
    press_label(&mut runtime, "Remove");
    press_label(&mut runtime, "Confirm");
    wait_for(&mut runtime, |v| v.capabilities.plugins.is_empty());
    assert!(runtime.state.capabilities.selection.is_none());
    peer.join().unwrap();
}
