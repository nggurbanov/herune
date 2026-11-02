//! Transient, profile-owned full-text search. Durable sidebar slices remain authoritative.
use super::*;

#[derive(Default)]
pub(super) struct Search {
    query: String,
    due: Option<f64>,
    issued: Option<String>,
    hits: Vec<SidebarSession>,
    base: Option<Vec<SidebarSession>>,
    warning: Option<String>,
}

impl Search {
    pub(super) fn clear_warning(&mut self, notice: &mut Option<String>) {
        if self.warning.is_some() && notice.as_ref() == self.warning.as_ref() {
            *notice = None;
        }
        self.warning = None;
    }

    pub(super) fn retry(&mut self, now: f64) {
        if !self.query.is_empty() {
            self.due = Some(now + 0.2);
            self.issued = None;
        }
    }
    pub(super) fn unproject(&mut self, recents: &mut Slice) {
        if let Some(base) = self.base.take() {
            recents.rows = base;
        }
    }

    pub(super) fn project(&mut self, recents: &mut Slice, messaging: &Slice, cron: &Slice) {
        self.unproject(recents);
        if self.query.is_empty() {
            return;
        }
        self.base = Some(recents.rows.clone());
        let mut seen: HashSet<_> = recents
            .rows
            .iter()
            .chain(&messaging.rows)
            .chain(&cron.rows)
            .map(SidebarSession::key)
            .collect();
        for hit in &self.hits {
            if seen.insert(hit.key()) {
                recents.rows.push(hit.clone());
            }
        }
    }

    pub(super) fn matches(&self, row: &SidebarSession, query: &str) -> bool {
        self.query.to_lowercase() == query.trim().to_lowercase()
            && self.hits.iter().any(|hit| hit.key() == row.key())
    }
}

impl SidebarState {
    /// Returns whether query state changed, a wake deadline, and any owned read.
    pub(crate) fn search_tick(
        &mut self,
        query: &str,
        now: f64,
        native_self: bool,
    ) -> (bool, Option<std::time::Duration>, Vec<PageEffect>) {
        let query = query.trim();
        let changed = self.search.query != query;
        if changed {
            self.search.clear_warning(&mut self.notice);
            self.search.unproject(&mut self.recents);
            self.search.query = query.to_owned();
            self.search.due = (!query.is_empty()).then_some(now + 0.2);
            self.search.issued = None;
            self.search.hits.clear();
            self.errors.remove("sidebar.search");
        }
        let Some(due) = self.search.due else {
            return (changed, None, vec![]);
        };
        if now < due {
            return (
                changed,
                Some(std::time::Duration::from_secs_f64((due - now).max(0.001))),
                vec![],
            );
        }
        self.search.due = None;
        self.search.issued = Some(self.search.query.clone());
        let mut request = PageRequest::get("/api/sessions/search")
            .query("q", &self.search.query)
            .query("limit", 100);
        if native_self {
            request = request.provenance(crate::gateway::prepared::ProfileProvenance::NativeSelf);
        } else {
            request = request.profile(&self.owner_profile);
        }
        self.pending.insert("sidebar.search".into());
        (true, None, vec![("sidebar.search".into(), request)])
    }

    pub(super) fn apply_search(&mut self, result: Result<Value, String>) {
        self.pending.remove("sidebar.search");
        if self.search.issued.as_deref() != Some(self.search.query.as_str())
            || self.search.query.is_empty()
        {
            return;
        }
        self.search.issued = None;
        let result = result.and_then(|value| {
            let source = self
                .source
                .as_ref()
                .ok_or("The search source is unavailable")?;
            let rows = value
                .get("results")
                .and_then(Value::as_array)
                .ok_or("The agent returned invalid session search results")?;
            let mut out = Vec::new();
            for value in rows {
                let mut row = value.clone();
                let object = row
                    .as_object_mut()
                    .ok_or("The agent returned an invalid session search result")?;
                if object
                    .get("profile")
                    .and_then(Value::as_str)
                    .is_some_and(|p| p != self.owner_profile)
                {
                    return Err("Session search returned a different profile".into());
                }
                object.insert("profile".into(), json!(self.owner_profile));
                if let Some(session_id) = object.remove("session_id") {
                    if object
                        .get("id")
                        .is_some_and(|id| !id.is_null() && *id != session_id)
                    {
                        return Err(
                            "Session search returned conflicting conversation identities".into(),
                        );
                    }
                    if object.get("id").is_none_or(Value::is_null) {
                        object.insert("id".into(), session_id);
                    }
                }
                if object.get("preview").is_none_or(Value::is_null) {
                    if let Some(snippet) = object.get("snippet").cloned() {
                        object.insert("preview".into(), snippet);
                    }
                }
                if object.get("started_at").is_none_or(Value::is_null) {
                    if let Some(started) = object
                        .get("session_started")
                        .filter(|v| v.is_number())
                        .cloned()
                    {
                        object.insert("started_at".into(), started);
                    }
                }
                for key in ["started_at", "last_active"] {
                    if object.get(key).is_none_or(Value::is_null) {
                        object.insert(key.into(), json!(0));
                    }
                }
                if object.get("_lineage_root_id").is_none() && object.get("lineage_root").is_some()
                {
                    object.insert("_lineage_root_id".into(), object["lineage_root"].clone());
                }
                let mut parsed = parse_sessions_owned(&json!([row]), &self.owner_profile, source)?;
                out.append(&mut parsed);
            }
            Ok(out)
        });
        match result {
            Ok(hits) => {
                self.search.clear_warning(&mut self.notice);
                self.search.hits = hits;
                self.errors.remove("sidebar.search");
            }
            Err(error) => {
                self.search.hits.clear();
                let warning = format!(
                    "Full-history search unavailable; showing loaded conversations only: {error}"
                );
                self.notice = Some(warning.clone());
                self.search.warning = Some(warning.clone());
                self.errors.insert("sidebar.search".into(), warning);
            }
        }
        self.search
            .project(&mut self.recents, &self.messaging, &self.cron_sessions);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::Connection;

    fn sidebar() -> SidebarState {
        let mut state = SidebarState::new();
        state.source = Some(
            SourceStamp::from_connection(&Connection::Url {
                endpoint: "https://search-fixture.invalid".into(),
                token: None,
            })
            .unwrap(),
        );
        state.owner_connection = 7;
        state.owner_profile = "work".into();
        state.apply("sidebar.recents", Ok(json!({"sessions":[{"id":"recent","profile":"work","title":"Recent","message_count":1}]})));
        state
    }
    fn result(id: &str, profile: &str) -> Value {
        json!({"results":[{"id":id,"session_id":id,"profile":profile,"title":"Older conversation","snippet":"needle in an old message","started_at":null,"last_active":null,"message_count":3}]})
    }
    #[test]
    fn older_content_matches_are_temporary_and_survive_a_sidebar_refresh() {
        let mut state = sidebar();
        assert!(state.search_tick("needle", 1.0, false).2.is_empty());
        let (_, _, effects) = state.search_tick("needle", 1.3, false);
        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0].1.path, "/api/sessions/search");
        assert_eq!(effects[0].1.profile.as_deref(), Some("work"));
        state.apply("sidebar.search", Ok(result("old", "work")));
        let hit = state.recents.rows.iter().find(|r| r.id == "old").unwrap();
        assert!(state.matches(hit, "needle"));
        assert!(!state.matches(hit, "other"));
        state.apply(
            "sidebar.recents",
            Ok(json!({"sessions":[{"id":"new","profile":"work","title":"New","message_count":1}]})),
        );
        assert!(state.recents.rows.iter().any(|r| r.id == "old"));
        state.search_tick("", 2.0, false);
        assert_eq!(
            state
                .recents
                .rows
                .iter()
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>(),
            ["new"]
        );
    }
    #[test]
    fn clearing_or_changing_query_discards_old_results_and_foreign_profiles() {
        let mut state = sidebar();
        state.search_tick("first", 1.0, false);
        state.search_tick("first", 1.3, false);
        state.search_tick("second", 1.4, false);
        state.apply("sidebar.search", Ok(result("stale", "work")));
        assert!(state.recents.rows.iter().all(|r| r.id != "stale"));
        state.search_tick("second", 1.7, false);
        state.apply("sidebar.search", Ok(result("foreign", "other")));
        assert!(state.recents.rows.iter().all(|r| r.id != "foreign"));
        assert!(state.errors["sidebar.search"].contains("different profile"));
        assert!(
            state
                .notice
                .as_deref()
                .unwrap()
                .contains("loaded conversations only")
        );
        state.search_tick("", 2.0, false);
        assert!(!state.errors.contains_key("sidebar.search"));
        assert!(state.notice.is_none());
    }

    #[test]
    fn existing_row_matches_message_text_without_becoming_a_duplicate() {
        let mut state = sidebar();
        state.search_tick("needle", 1.0, false);
        state.search_tick("needle", 1.3, false);
        state.apply("sidebar.search", Ok(result("recent", "work")));
        assert_eq!(state.recents.rows.len(), 1);
        assert!(state.matches(&state.recents.rows[0], "needle"));
        state.search_tick("", 2.0, false);
        assert_eq!(state.recents.rows.len(), 1);
    }
    #[test]
    fn root_profile_search_keeps_native_provenance_and_rejects_foreign_source() {
        let mut state = sidebar();
        state.search_tick("needle", 1.0, true);
        let (_, _, effects) = state.search_tick("needle", 1.3, true);
        assert!(matches!(
            effects[0].1.provenance,
            Some(crate::gateway::prepared::ProfileProvenance::NativeSelf)
        ));
        assert!(effects[0].1.profile.is_none());
        let mut foreign = result("old", "work");
        foreign["results"][0]["connection_id"] = json!("another-source");
        state.apply("sidebar.search", Ok(foreign));
        assert!(state.recents.rows.iter().all(|row| row.id != "old"));
        assert!(state.errors.contains_key("sidebar.search"));
    }
    #[test]
    fn authenticated_search_request_returns_old_session_for_the_selected_profile() {
        use std::{
            io::{BufRead, BufReader, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let connection = Connection::Url {
            endpoint: format!("http://{}", listener.local_addr().unwrap()),
            token: Some("synthetic-token".into()),
        };
        let server = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let _ws = tungstenite::accept(socket).unwrap();
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let path = first.split_whitespace().nth(1).unwrap();
            let url = url::Url::parse(&format!("http://fixture{path}")).unwrap();
            assert_eq!(url.path(), "/api/sessions/search");
            let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(query.get("q").map(String::as_str), Some("старая фраза"));
            assert_eq!(query.get("profile").map(String::as_str), Some("work"));
            assert!(!query.contains_key("token"));
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                headers.push_str(&line.to_lowercase());
            }
            assert!(headers.contains("x-hermes-session-token: synthetic-token\r\n"));
            let body = result("old", "work").to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let mut state = SidebarState::new();
        state.source = Some(SourceStamp::from_connection(&connection).unwrap());
        state.owner_connection = 11;
        state.owner_profile = "work".into();
        state.search_tick("старая фраза", 1.0, false);
        let (_, _, mut effects) = state.search_tick("старая фраза", 1.3, false);
        let (operation, request) = effects.pop().unwrap();
        let mut gateway = crate::gateway::Gateway::connect(&connection).unwrap();
        let value = gateway.page_request("work", &request).unwrap();
        state.apply(&operation, Ok(value));
        let old = state
            .recents
            .rows
            .iter()
            .find(|row| row.id == "old")
            .unwrap();
        assert!(state.matches(old, "старая фраза"));
        assert_eq!(old.profile(), "work");
        assert!(old.provenance.is_some());
        server.join().unwrap();
    }
}
