use super::*;
fn connection(name: &str) -> Connection {
    Connection::Url {
        endpoint: format!("https://{name}.fixture.invalid/hermes"),
        token: Some(format!("private-{name}")),
    }
}
fn viewer() -> Viewer {
    let mut s = Viewer::empty();
    crate::app::reader_scene(&mut s);
    s.draft_storage_available = false;
    s.connection = Some(connection("a"));
    s.connection_epoch = windows::source_epoch();
    s.profile = "default".into();
    s.selected_session = None;
    s.tabs.clear();
    s.init_editors(std::sync::Arc::new(|| {}));
    assert!(s.ensure_editor());
    s
}
fn switch(s: &mut Viewer, source: &str) {
    assert!(s.use_connection_for_profile(connection(source), Some("default".into())));
    assert!(s.ensure_editor());
}
#[test]
fn same_names_keep_actual_editors_tabs_drafts_and_delayed_file_receipts_per_source() {
    let mut s = viewer();
    s.selected_session = Some("same".into());
    s.tabs.push(ConversationTab {
        profile_intent: crate::source::ProfileIntent::Backend,
        profile: "default".into(),
        session: "same".into(),
        title: "A conversation".into(),
        bot: false,
    });
    assert!(s.ensure_editor());
    let a = s.composer_scope();
    let a_editor = s.composer.editor_id().clone();
    s.composer
        .draft_mut(a.clone())
        .text
        .replace_text("A unsent");
    switch(&mut s, "b");
    assert!(s.tabs.is_empty());
    s.selected_session = Some("same".into());
    s.tabs.push(ConversationTab {
        profile_intent: crate::source::ProfileIntent::Backend,
        profile: "default".into(),
        session: "same".into(),
        title: "B conversation".into(),
        bot: false,
    });
    assert!(s.ensure_editor());
    let b = s.composer_scope();
    let b_editor = s.composer.editor_id().clone();
    assert_ne!(a.connection, b.connection);
    assert_ne!(a_editor, b_editor);
    s.composer
        .draft_mut(b.clone())
        .text
        .replace_text("B unsent");
    s.edit_editor_text(&a_editor, &a).insert(" stale UI event");
    s.finish_editor_attachment(
        a_editor.clone(),
        a.clone(),
        Err("private chooser failure".into()),
    );
    assert!(s.composer.attachment_error.is_none());
    assert_eq!(s.composer.draft(&b).unwrap().text.text, "B unsent");
    switch(&mut s, "a");
    assert_eq!(s.composer_scope(), a);
    assert_eq!(s.composer.editor_id(), &a_editor);
    assert_eq!(s.tabs.len(), 1);
    assert_eq!(s.tabs[0].title, "A conversation");
    assert_eq!(s.composer.draft(&a).unwrap().text.text, "A unsent");
    assert!(s.composer.attachment_error.is_some());
    switch(&mut s, "b");
    assert_eq!(s.composer_scope(), b);
    assert_eq!(s.composer.editor_id(), &b_editor);
    assert_eq!(s.tabs[0].title, "B conversation");
    assert_eq!(s.composer.draft(&b).unwrap().text.text, "B unsent");
}
#[test]
fn a_fresh_send_binding_while_parked_restores_its_actual_input_and_stored_tab_only() {
    let mut s = viewer();
    let origin = s.composer_scope();
    let editor = s.composer.editor_id().clone();
    s.composer
        .draft_mut(origin.clone())
        .text
        .replace_text("A follow-up");
    switch(&mut s, "b");
    let b = s.composer_scope();
    let b_editor = s.composer.editor_id().clone();
    s.composer
        .draft_mut(b.clone())
        .text
        .replace_text("B untouched");
    let stored = DraftScope {
        session: Some("created-on-a".into()),
        draft_origin: None,
        ..origin.clone()
    };
    s.rehome_editors(&origin, stored.clone());
    s.bind_source_conversation(&origin, "created-on-a", false);
    assert_eq!(s.composer_scope(), b);
    assert_eq!(s.composer.editor_id(), &b_editor);
    assert!(s.tabs.is_empty());
    assert_eq!(s.composer.draft(&b).unwrap().text.text, "B untouched");
    switch(&mut s, "a");
    assert_eq!(s.composer_scope(), stored);
    assert_eq!(s.composer.editor_id(), &editor);
    assert_eq!(s.composer.draft(&stored).unwrap().text.text, "A follow-up");
    assert_eq!(s.tabs.len(), 1);
    assert_eq!(s.tabs[0].session, "created-on-a");
    s.new_draft_on_current_source();
    assert!(s.composer_scope().session.is_none());
    assert_ne!(s.composer.editor_id(), &editor);
    assert!(s.composer.draft(&s.composer_scope()).is_none());
}

#[test]
fn parked_selected_route_restores_only_its_captured_profile_intent() {
    use crate::source::ProfileIntent;
    let mut s = viewer();
    s.profile_intent = ProfileIntent::NativeSelf;
    s.selected_session = Some("same".into());
    let selected = s.composer_scope();
    assert!(s.ensure_editor());
    s.composer
        .draft_mut(selected.clone())
        .text
        .replace_text("selected input");
    switch(&mut s, "b");
    assert_eq!(s.profile_intent, ProfileIntent::Backend);
    assert!(s.use_connection_for_profile_intent(
        connection("a"),
        Some("default".into()),
        ProfileIntent::NativeSelf
    ));
    assert_eq!(s.composer_scope(), selected);
    assert!(s.ensure_editor());
    assert_eq!(
        s.composer.draft(&selected).unwrap().text.text,
        "selected input"
    );
}

#[test]
fn parked_running_status_is_shown_only_on_its_retained_source_and_profile() {
    use crate::{sidebar::Status, sidebar::fleet::SourceSidebar};
    let root = std::env::temp_dir().join(format!("herune-parked-status-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let mut s = viewer();
    s.selected_session = Some("same".into());
    let a_scope = s.composer_scope();
    s.conversation
        .fixture(a_scope.clone(), &serde_json::json!({"running":true}))
        .unwrap();
    let a_binding = s.current_source_binding().unwrap();
    let a_key = a_binding.stamp().key();
    let mut a = SourceSidebar::new_at(
        a_binding,
        windows::source_epoch(),
        "default".into(),
        std::sync::Arc::new(|| {}),
        root.join("a"),
    )
    .unwrap();
    a.state_mut().apply("sidebar.recents", Ok(serde_json::json!({"sessions":[{"id":"same","profile":"default","message_count":1},{"id":"same","profile":"other","message_count":1}]})));
    let a_default = a.state().recents.rows[0].clone();
    let a_other = a.state().recents.rows[1].clone();
    s.fleet_state.partitions.insert(a_key.clone(), a);
    switch(&mut s, "b");
    let b_binding = s.current_source_binding().unwrap();
    let b_key = b_binding.stamp().key();
    let mut b = SourceSidebar::new_at(
        b_binding,
        windows::source_epoch(),
        "default".into(),
        std::sync::Arc::new(|| {}),
        root.join("b"),
    )
    .unwrap();
    b.state_mut().apply(
        "sidebar.recents",
        Ok(serde_json::json!({"sessions":[{"id":"same","profile":"default","message_count":1}]})),
    );
    let b_default = b.state().recents.rows[0].clone();
    s.fleet_state.partitions.insert(b_key.clone(), b);
    s.poll_conversations();
    let a = s.fleet_state.partitions.get(&a_key).unwrap().state();
    assert!(a.status(&a_default) == Status::Working);
    assert!(a.status(&a_other) == Status::Idle);
    assert!(
        s.fleet_state
            .partitions
            .get(&b_key)
            .unwrap()
            .state()
            .status(&b_default)
            == Status::Idle
    );
    s.conversation
        .fixture(a_scope.clone(), &serde_json::json!({"running":false}))
        .unwrap();
    s.poll_conversations();
    assert!(
        s.fleet_state
            .partitions
            .get(&a_key)
            .unwrap()
            .state()
            .status(&a_default)
            == Status::Idle
    );
    s.conversation
        .fixture(a_scope.clone(), &serde_json::json!({"running":true}))
        .unwrap();
    s.poll_conversations();
    assert!(
        s.fleet_state
            .partitions
            .get(&a_key)
            .unwrap()
            .state()
            .status(&a_default)
            == Status::Working
    );
    s.conversation
        .fixture_queue_failure(a_scope.clone(), "stream disconnected", true, None);
    s.poll_conversations();
    assert!(
        s.fleet_state
            .partitions
            .get(&a_key)
            .unwrap()
            .state()
            .status(&a_default)
            == Status::Idle
    );
    s.conversation
        .fixture(a_scope, &serde_json::json!({"running":true}))
        .unwrap();
    s.poll_conversations();
    assert!(
        s.fleet_state
            .partitions
            .get(&a_key)
            .unwrap()
            .state()
            .status(&a_default)
            == Status::Working
    );
    s.fleet_state.workspaces.remove(&a_key);
    s.poll_conversations();
    assert!(
        s.fleet_state
            .partitions
            .get(&a_key)
            .unwrap()
            .state()
            .status(&a_default)
            == Status::Idle
    );
    drop(s);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn parked_approval_binding_requires_live_exact_source_and_runtime() {
    let mut s = viewer();
    s.selected_session = Some("same".into());
    let scope = s.composer_scope();
    s.conversation
        .fixture(scope.clone(), &serde_json::json!({"running":true}))
        .unwrap();
    let source = s.current_source_binding().unwrap().stamp().clone();
    switch(&mut s, "b");
    assert_eq!(
        s.parked_notice_binding(&scope, "same").unwrap().stamp(),
        &source
    );
    assert!(s.parked_notice_binding(&scope, "wrong-runtime").is_none());
    let mut wrong = scope.clone();
    wrong.connection += 1000;
    assert!(s.parked_notice_binding(&wrong, "same").is_none());
    let mut native = scope.clone();
    native.profile_intent = crate::source::ProfileIntent::NativeSelf;
    assert!(s.parked_notice_binding(&native, "same").is_none());
    s.conversation
        .fixture_queue_failure(scope.clone(), "stream lost", true, None);
    s.poll_conversations();
    assert!(s.parked_notice_binding(&scope, "same").is_none());
    s.conversation
        .fixture(scope.clone(), &serde_json::json!({"running":true}))
        .unwrap();
    s.retired_profiles
        .insert((scope.connection, scope.profile.clone()));
    assert!(s.parked_notice_binding(&scope, "same").is_none());
}

#[test]
fn server_search_hit_renders_in_existing_sidebar() {
    use rune::{Env, Runtime};
    let mut s = viewer();
    s.sidebar_state.bind_connection_at(
        s.connection.as_ref().unwrap(),
        s.connection_epoch,
        std::env::temp_dir(),
    );
    s.sidebar_state.prefs.grouping = crate::sidebar::Grouping::None;
    s.sidebar_state.prefs.collapsed.clear();
    s.search.replace_text("needle");
    s.sidebar_state.search_tick("needle", 1.0, false);
    s.sidebar_state.search_tick("needle", 1.3, false);
    s.sidebar_state.apply("sidebar.search", Ok(serde_json::json!({"results":[{"id":"old","session_id":"old","profile":"default","title":"Older conversation","started_at":1,"last_active":1,"message_count":3}]})));
    let row = s
        .sidebar_state
        .recents
        .rows
        .iter()
        .find(|row| row.id == "old")
        .unwrap();
    let key = format!("session-{}", row.key());
    let mut runtime = Runtime::new(s, crate::view::app, (1200., 800.), Env::new(true, 1.));
    runtime.frame(1.0);
    assert!(
        runtime.find(&key).is_some(),
        "server hit should be visible in the existing sidebar"
    );
}

#[test]
fn root_owned_search_result_opens_with_root_intent_and_does_not_mutate_a_named_profile() {
    use crate::gateway::{
        BackendRootProof,
        prepared::{BackendTarget, SelectedContext, WirePolicy},
        route,
    };
    use crate::source::ProfileIntent;
    let policy = route::ProfilePolicy::new("default", route::RouteOptions::default()).unwrap();
    let policy = WirePolicy::token(policy, Default::default())
        .unwrap()
        .with_selected(
            SelectedContext::new(
                "default",
                BackendTarget::Root(BackendRootProof {
                    profile: None,
                    profile_id: "/private/root".into(),
                    instance_id: "fixture-instance".into(),
                    authority_epoch: 7,
                }),
            )
            .unwrap(),
        )
        .unwrap();
    let connection = Connection::Routed {
        actual: Box::new(connection("root")),
        policy: std::sync::Arc::new(policy),
        owner: std::sync::Arc::new(crate::source::RouteOwner::legacy("search-root-test").unwrap()),
    };
    let actor = crate::connections::TestLegacyRig::new();
    let lease = crate::connections::TestRoutedLease::new(connection.clone());
    let mut s = viewer();
    s.connection = Some(connection);
    s.retain_window_route(actor.resolver(), lease.lease.clone());
    let binding = s.current_source_binding().unwrap();
    s.sidebar_state
        .bind_source_at(&binding, s.connection_epoch, std::env::temp_dir())
        .unwrap();
    s.profile_intent = ProfileIntent::NativeSelf;
    let targets = vec![("default".to_owned(), true)];
    s.sidebar_state
        .search_profiles_tick("needle", 1.0, targets.clone());
    let (_, _, effects) = s.sidebar_state.search_profiles_tick("needle", 1.3, targets);
    s.sidebar_state.apply(&effects[0].0, Ok(serde_json::json!({"results":[{"id":"root-result","session_id":"root-result","profile":"default","title":"Root result","started_at":1,"last_active":1,"message_count":3}]})));
    let row = s
        .sidebar_state
        .recents
        .rows
        .iter()
        .find(|row| row.id == "root-result")
        .unwrap();
    let owner = row.owner().unwrap();
    assert_eq!(owner.profile_intent, ProfileIntent::NativeSelf);
    s.sidebar_action_owned(
        owner.clone(),
        crate::sidebar::Action::Pin("default".into(), "root-result".into(), true),
    );
    assert!(s.sidebar_state.mutation.is_none());
    assert!(
        s.sidebar_state
            .notice
            .as_deref()
            .unwrap()
            .contains("Open this local conversation")
    );
    s.sidebar_action_owned(
        owner,
        crate::sidebar::Action::Open("default".into(), "root-result".into()),
    );
    assert_eq!(s.selected_session.as_deref(), Some("root-result"));
    assert_eq!(s.profile_intent, ProfileIntent::NativeSelf);
}
