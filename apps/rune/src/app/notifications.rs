//! Notification callbacks retain their source; a body click cannot execute an action.
use super::*;
use crate::notifications::{Action, Activation};
impl Viewer {
    pub fn notification_action(&mut self, action: Action) {
        self.notifications.act(action, !self.fixture);
    }
    pub(super) fn bind_notifications(&mut self, connection: &Connection) {
        match crate::client::connection_key(connection) {
            Ok(principal) => self.notifications.bind_connection(principal),
            Err(error) => {
                self.notifications.bind_connection(String::new());
                self.client_error = Some(error);
            }
        }
    }
    pub(super) fn notification_event(
        &mut self,
        scope: &DraftScope,
        kind: &str,
        payload: &serde_json::Value,
        runtime: &str,
        replay: bool,
    ) {
        if self.fixture
            || self
                .retired_profiles
                .contains(&(scope.connection, scope.profile.clone()))
        {
            return;
        }
        if scope.connection != self.connection_epoch {
            if !matches!(
                kind,
                "approval.request" | "clarify.request" | "input.request"
            ) {
                return;
            }
            let Some(binding) = self.parked_notice_binding(scope, runtime) else {
                return;
            };
            self.notifications.set_active(self.composer_scope());
            let title = self
                .conversation
                .view(scope)
                .map(|view| view.title.as_str())
                .filter(|title| !title.is_empty())
                .unwrap_or(&scope.profile)
                .to_owned();
            // The parked card is the authority for actions; the banner only opens it.
            self.notifications.event_from_source(
                binding.stamp().principal(),
                scope,
                kind,
                payload,
                runtime,
                replay,
                &title,
                false,
            );
            return;
        }
        if !replay && kind == "message.complete" {
            self.sounds.complete(scope, runtime);
        }
        self.notifications.set_active(self.composer_scope());
        let title = self
            .conversation
            .view(scope)
            .map(|v| v.title.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                self.profiles
                    .iter()
                    .find(|p| p.name == scope.profile)
                    .map(|p| p.label.clone())
                    .unwrap_or_else(|| "Hermes".into())
            });
        self.notifications
            .event(scope, kind, payload, runtime, replay, &title);
    }
    pub(in crate::app) fn parked_notice_binding(
        &self,
        scope: &DraftScope,
        runtime: &str,
    ) -> Option<crate::source::Binding> {
        if scope.connection == self.connection_epoch
            || !scope.profile_intent.is_backend()
            || scope.session.is_none()
            || self
                .retired_profiles
                .contains(&(scope.connection, scope.profile.clone()))
        {
            return None;
        }
        let binding = self.binding_for_source_epoch(scope.connection)?;
        let view = self.conversation.view(scope)?;
        if runtime.is_empty() || view.runtime != runtime || !view.stream_observed() {
            return None;
        }
        Some(binding)
    }
    pub(super) fn poll_notifications(&mut self) -> bool {
        self.notifications.set_active(self.composer_scope());
        if let Some(window) = &self.native_window {
            self.notifications.set_visible(window.is_visible());
        }
        let before = self.notifications.revision;
        let activations = self.notifications.poll();
        let changed = before != self.notifications.revision || !activations.is_empty();
        for activation in activations {
            self.activate_notification(activation);
        }
        changed
    }
    fn activate_notification(&mut self, activation: Activation) {
        self.activate_notification_with(activation, |s, plugin, token| {
            s.activate_plugin_notification(plugin, token)
        });
    }
    fn activate_notification_with(
        &mut self,
        activation: Activation,
        mut plugin_activate: impl FnMut(
            &mut Self,
            &crate::notifications::PluginActivation,
            Option<&str>,
        ) -> bool,
    ) {
        if let Some(plugin) = activation.plugin.as_ref() {
            if activation.principal != plugin.target.lifecycle_key {
                return;
            }
            if plugin_activate(self, plugin, activation.token.as_deref()) {
                return;
            }
            if plugin.action_id.is_none() {
                if let Some(window) = &self.native_window {
                    window.activate(activation.token.unwrap_or_default());
                }
            }
            return;
        }
        if activation.scope.connection != self.connection_epoch {
            if let Some(binding) =
                self.parked_notice_binding(&activation.scope, &activation.runtime)
            {
                if activation.action.is_some()
                    || binding.stamp().principal() != activation.principal
                {
                    return;
                }
                let Some(current) = self.fleet.binding(binding.stamp().version()) else {
                    return;
                };
                if current.stamp() != binding.stamp() {
                    return;
                }
                let Some(id) = activation.scope.session.clone() else {
                    return;
                };
                let title = self
                    .conversation
                    .view(&activation.scope)
                    .map(|view| view.title.clone())
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| "Conversation".into());
                self.begin_fleet_navigation(
                    binding.stamp().version().clone(),
                    activation.scope.profile,
                    super::fleet::Destination::Session {
                        id,
                        title,
                        read_only: None,
                    },
                );
                if let Some(window) = &self.native_window {
                    window.activate(activation.token.unwrap_or_default());
                }
                return;
            }
        }
        let Some(connection) = self.connection.clone() else {
            return;
        };
        if crate::client::connection_key(&connection).as_deref()
            != Ok(activation.principal.as_str())
        {
            return;
        }
        let mut scope = activation.scope;
        if activation.action.is_none() {
            scope.connection = self.connection_epoch;
        }
        if scope.connection != self.connection_epoch
            || self
                .retired_profiles
                .contains(&(scope.connection, scope.profile.clone()))
        {
            return;
        }
        let Some(profile) = self
            .profiles
            .iter()
            .find(|p| p.name == scope.profile)
            .cloned()
        else {
            return;
        };
        if let Some(action) = activation.action {
            let valid = self.conversation.view(&scope).is_some_and(|view| {
                view.runtime == activation.runtime
                    && view.prompts.iter().any(|p| {
                        p.kind == "approval"
                            && p.prompt_id == action.prompt_id
                            && p.execution_generation == action.execution_generation
                            && p.execution_generation == view.generation
                            && p.choices.contains(&action.answer)
                    })
            });
            if !self.fixture && valid {
                if let Err(error) =
                    self.conversation
                        .respond(connection, &scope, &action.prompt_id, &action.answer)
                {
                    self.client_error = Some(error);
                }
            }
        }
        if let Some(id) = scope.session {
            let bot = profile
                .canonical_session
                .as_ref()
                .is_some_and(|chat| chat.id == id);
            let title = self
                .tabs
                .iter()
                .find(|t| t.profile == scope.profile && t.session == id)
                .map(|t| t.title.clone())
                .or_else(|| {
                    self.sidebar_state
                        .find(&scope.profile, &id)
                        .and_then(|r| r.title.clone())
                })
                .unwrap_or(profile.label);
            self.open_conversation(scope.profile, id, title, bot, true);
            self.reveal_pane("workspace");
            self.open_route(crate::pages::Route::Chat);
        }
        if let Some(window) = &self.native_window {
            window.activate(activation.token.unwrap_or_default());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn viewer() -> Viewer {
        let mut s = Viewer::empty();
        s.fixture = true;
        s.connection_epoch = 9;
        s.connection = Some(Connection::Url {
            endpoint: "http://127.0.0.1:49191".into(),
            token: None,
        });
        s.profile = "default".into();
        s.profiles = vec![Profile {
            name: "default".into(),
            label: "Bot identity".into(),
            description: String::new(),
            canonical_session: Some(CanonicalSession {
                id: "bot-chat".into(),
                resolved_id: "bot-chat".into(),
                preview: String::new(),
            }),
        }];
        s.selected_session = Some("foreground".into());
        s.tabs = vec![ConversationTab {
            profile_intent: crate::source::ProfileIntent::Backend,
            profile: "default".into(),
            session: "foreground".into(),
            title: "Keep this tab".into(),
            bot: false,
        }];
        s
    }
    fn body(s: &Viewer) -> Activation {
        Activation {
            plugin: None,
            principal: crate::client::connection_key(s.connection.as_ref().unwrap()).unwrap(),
            scope: DraftScope {
                draft_origin: None,
                profile_intent: crate::source::ProfileIntent::Backend,
                connection: 123,
                profile: "default".into(),
                session: Some("bot-chat".into()),
            },
            runtime: "retired-runtime".into(),
            action: None,
            token: None,
        }
    }
    #[test]
    fn a_body_click_reveals_the_durable_bot_chat_without_replacing_an_unrelated_tab() {
        let mut s = viewer();
        s.activate_notification(body(&s));
        assert_eq!(s.selected_session.as_deref(), Some("bot-chat"));
        assert!(s.tabs.iter().any(|t| t.session == "foreground" && !t.bot));
        assert!(s.tabs.iter().any(|t| t.session == "bot-chat" && t.bot));
        assert_eq!(s.tabs.len(), 2);
    }
    #[test]
    fn a_live_secondary_plugin_uses_its_captured_source_without_main_profile_navigation() {
        let mut s = viewer();
        let primary = crate::client::connection_key(s.connection.as_ref().unwrap()).unwrap();
        let mut activation = body(&s);
        let retained_principal = "retained-plugin-parent".to_string();
        assert_ne!(primary, retained_principal);
        activation.principal = retained_principal.clone();
        activation.scope.profile = "secondary-only".into();
        activation.plugin = Some(crate::notifications::PluginActivation {
            target: crate::notifications::PluginTarget {
                lease: None,
                window_token: "live-child".into(),
                lifecycle_key: retained_principal,
                source_id: "secondary-source".into(),
                source_principal: "secondary-verified-principal".into(),
                profile: "secondary-only".into(),
                request_id: "ask".into(),
                notify_id: Some("closure".into()),
                tag: "plugin".into(),
                activate: Some("/plugin/item".into()),
                actions: vec![],
                icon: None,
                background: true,
            },
            action_id: None,
        });
        let mut received = vec![];
        // The production host performs the exact live token/source/lease check;
        // this transport seam proves the main foreground cannot preempt it.
        s.activate_notification_with(activation.clone(), |_, plugin, _| {
            received.push((
                plugin.target.source_id.clone(),
                plugin.target.profile.clone(),
            ));
            true
        });
        assert_eq!(
            received,
            vec![("secondary-source".into(), "secondary-only".into())]
        );
        assert_eq!(s.selected_session.as_deref(), Some("foreground"));
        assert_eq!(s.tabs.len(), 1);
        activation.principal = "wrong-envelope".into();
        s.activate_notification_with(activation, |_, _, _| {
            panic!("foreign envelope reached the host")
        });
    }
    #[test]
    fn retired_plugin_body_or_button_cannot_execute_a_chat_action_or_navigation() {
        let mut s = viewer();
        for action_id in [None, Some("run".to_string())] {
            let mut activation = body(&s);
            activation.plugin = Some(crate::notifications::PluginActivation {
                target: crate::notifications::PluginTarget {
                    lease: None,
                    window_token: "retired-window".into(),
                    lifecycle_key: activation.principal.clone(),
                    source_id: "retired-source".into(),
                    source_principal: activation.principal.clone(),
                    profile: "default".into(),
                    request_id: "old-request".into(),
                    notify_id: Some("old-callback".into()),
                    tag: "plugin".into(),
                    activate: Some("/plugin/home".into()),
                    actions: vec![],
                    icon: None,
                    background: true,
                },
                action_id,
            });
            s.activate_notification(activation);
            assert_eq!(s.selected_session.as_deref(), Some("foreground"));
            assert_eq!(s.tabs.len(), 1);
        }
    }
    #[test]
    fn a_notification_cannot_cross_a_new_connection_principal_or_retired_profile() {
        let mut s = viewer();
        let mut foreign = body(&s);
        foreign.principal = "another-principal".into();
        s.activate_notification(foreign);
        assert_eq!(s.selected_session.as_deref(), Some("foreground"));
        let retired = body(&s);
        s.retired_profiles.insert((9, "default".into()));
        s.activate_notification(retired);
        assert_eq!(s.selected_session.as_deref(), Some("foreground"));
        assert_eq!(s.tabs.len(), 1);
    }
    #[test]
    fn parked_approval_click_routes_only_to_its_retained_gateway() {
        use std::{
            net::TcpListener,
            thread,
            time::{Duration, Instant},
        };
        use tungstenite::{
            Message,
            handshake::server::{Request as WsRequest, Response},
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let (stream, _) = loop {
                match listener.accept() {
                    Ok(pair) => break pair,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => {
                        panic!("private peer did not receive the captured route: {error}")
                    }
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut ws =
                tungstenite::accept_hdr(stream, |request: &WsRequest, response: Response| {
                    let uri = url::Url::parse(&format!("http://fixture{}", request.uri())).unwrap();
                    assert_eq!(uri.path(), "/api/ws");
                    assert_eq!(
                        uri.query_pairs().find(|(k, _)| k == "token").unwrap().1,
                        "private-source-a"
                    );
                    Ok(response)
                })
                .unwrap();
            let request: serde_json::Value =
                serde_json::from_str(&ws.read().unwrap().into_text().unwrap()).unwrap();
            assert_eq!(request["method"], "profiles.list");
            ws.send(Message::Text(serde_json::json!({"jsonrpc":"2.0","id":request["id"],"result":{"profiles":[{"name":"default"}]}}).to_string().into())).unwrap();
        });
        let mut s = Viewer::empty();
        s.draft_storage_available = false;
        s.connection = Some(Connection::Url {
            endpoint: endpoint.clone(),
            token: Some("private-source-a".into()),
        });
        s.connection_epoch = 101;
        s.profile = "default".into();
        s.selected_session = Some("same".into());
        s.init_editors(std::sync::Arc::new(|| {}));
        assert!(s.ensure_editor());
        let scope = s.composer_scope();
        s.conversation
            .fixture(scope.clone(), &serde_json::json!({"running":true}))
            .unwrap();
        let binding = s.current_source_binding().unwrap();
        let principal = binding.stamp().principal().to_owned();
        s.fleet
            .seed_current(
                binding,
                &[Profile {
                    name: "default".into(),
                    label: "Default".into(),
                    description: String::new(),
                    canonical_session: None,
                }],
            )
            .unwrap();
        assert!(s.park_source_workspace().unwrap());
        s.connection = Some(Connection::Url {
            endpoint: "https://other-source.invalid".into(),
            token: None,
        });
        s.connection_epoch = 102;
        let (send, requests) = mpsc::channel();
        let (_, receive) = mpsc::channel();
        s.network = Some(Network { send, receive });
        let activation = Activation {
            plugin: None,
            principal,
            scope,
            runtime: "same".into(),
            action: None,
            token: None,
        };
        let mut wrong = activation.clone();
        wrong.principal = "foreign".into();
        s.activate_notification(wrong);
        assert!(!s.device_route_pending());
        let mut action = activation.clone();
        action.action = Some(crate::notifications::PromptAction {
            prompt_id: "not-offered".into(),
            execution_generation: 1,
            answer: "once".into(),
        });
        s.activate_notification(action);
        assert!(!s.device_route_pending());
        s.activate_notification(activation);
        assert!(s.device_route_pending());
        let deadline = Instant::now() + Duration::from_secs(5);
        while s.device_route_pending() && Instant::now() < deadline {
            s.poll_device_routes(&mut Tx::default());
            thread::sleep(Duration::from_millis(5));
        }
        let accepted = requests.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(
            matches!(accepted.command, Command::ConnectExact(Connection::Url {endpoint: ref actual,token:Some(ref token)}, ref profile) if actual == &endpoint && token == "private-source-a" && profile == "default")
        );
        assert!(s.fleet_navigation_waiting());
        server.join().unwrap();
    }
}
