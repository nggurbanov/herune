//! Durable remote host shells: every dial keeps the captured gateway/profile,
//! every reconnect attaches the known terminal id, and close needs a receipt.
use super::*;
use crate::pages::PageRequest;
use tungstenite::client::IntoClientRequest;
const META: &str = "\0HERMES_TERMINAL_META:";
#[derive(Debug)]
pub enum Frame {
    Meta {
        terminal_id: Option<String>,
        shell: String,
        cwd: Option<String>,
        truncated: bool,
        closed: bool,
    },
    Data(Vec<u8>),
    Closed {
        code: u16,
        reason: String,
    },
}
pub struct HostTerminal {
    socket: WebSocket<MaybeTlsStream<DeadlineStream>>,
}
impl HostTerminal {
    pub fn connect(
        connection: &Connection,
        profile: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        attach: Option<&str>,
        close: bool,
    ) -> Result<Self, String> {
        Self::connect_scoped(
            connection,
            profile,
            crate::source::ProfileIntent::Backend,
            cwd,
            cols,
            rows,
            attach,
            close,
        )
    }
    pub(crate) fn connect_scoped(
        connection: &Connection,
        profile: &str,
        intent: crate::source::ProfileIntent,
        cwd: &str,
        cols: u16,
        rows: u16,
        attach: Option<&str>,
        close: bool,
    ) -> Result<Self, String> {
        let provenance = super::audio::provenance(connection, profile, intent)?;
        valid_scope(profile)?;
        if let Some(id) = attach {
            valid_scope(id)?;
        }
        let mut gateway = Gateway::connect(connection)?;
        #[cfg(target_os = "linux")]
        if matches!(gateway.auth, Auth::Native(_)) {
            gateway.profiles()?;
        }
        gateway.ensure_profile_scope(&provenance)?;
        let encoded: String = url::form_urlencoded::byte_serialize(profile.as_bytes()).collect();
        let path = format!("/api/host-terminal?profile={encoded}");
        let mut url = gateway.api_url_for(&provenance, "GET", &path)?;
        url.set_scheme(if gateway.base.scheme() == "https" {
            "wss"
        } else {
            "ws"
        })
        .map_err(|_| "Invalid host terminal scheme")?;
        url.query_pairs_mut()
            .append_pair("cols", &cols.to_string())
            .append_pair("rows", &rows.to_string());
        if !cwd.is_empty() {
            url.query_pairs_mut().append_pair("cwd", cwd);
        }
        if let Some(id) = attach {
            url.query_pairs_mut().append_pair("attach", id);
        }
        if close {
            if attach.is_none() {
                return Err("A remote close needs its durable shell identity".into());
            }
            url.query_pairs_mut().append_pair("action", "close");
        }
        #[cfg(target_os = "linux")]
        let home = if matches!(&gateway.auth, Auth::Native(_)) {
            match &provenance {
                super::prepared::ProfileProvenance::Backend(name) => Some(
                    gateway
                        .profile_homes
                        .get(name)
                        .ok_or("The terminal profile is not served by this gateway")?
                        .as_path(),
                ),
                super::prepared::ProfileProvenance::NativeSelf => match gateway
                    .prepared
                    .policy()
                    .and_then(|p| p.selected())
                    .map(|s| s.target())
                {
                    Some(super::prepared::BackendTarget::Named(name)) => Some(
                        gateway
                            .profile_homes
                            .get(name)
                            .ok_or("The selected terminal profile is not served by this gateway")?
                            .as_path(),
                    ),
                    Some(super::prepared::BackendTarget::Root(proof)) => {
                        Some(std::path::Path::new(&proof.profile_id))
                    }
                    None => return Err("The Desktop route has no selected backend context".into()),
                },
                super::prepared::ProfileProvenance::Ambient(_) => {
                    return Err("Terminal requires an explicit owner".into());
                }
            }
        } else {
            None
        };
        #[cfg(not(target_os = "linux"))]
        let home = None;
        let handshake = gateway.prepared.prepare_ws(
            url.clone(),
            home,
            super::prepared::WsPurpose::Interactive,
            Instant::now() + Duration::from_secs(5),
        )?;
        let stream = connect_tcp(&handshake.url)?;
        let headers = handshake.request.headers().clone();
        let private_protocol = handshake.private_protocol;
        let config = tungstenite::protocol::WebSocketConfig::default()
            .max_message_size(Some(2 * 1024 * 1024))
            .max_frame_size(Some(2 * 1024 * 1024));
        let failure = "The remote terminal connection failed (network, TLS or authentication)";
        let (socket, response) = match tungstenite::client_tls_with_config(
            handshake.request,
            stream,
            Some(config),
            None,
        ) {
            Ok(connected) => connected,
            // Recent Webapp gateways require a socket-specific one-use ticket.
            // A rejected upgrade did not start a shell, so it is safe to retry.
            Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(ref response)))
                if response.status().as_u16() == 403 && !private_protocol =>
            {
                let request = PageRequest::post("/api/webapp/socket-ticket", Value::Null)
                    .query("socket", "host-terminal")
                    .provenance(provenance.clone());
                let value = gateway.page_request(profile, &request).map_err(|_| {
                    "The gateway refused the remote terminal or could not issue a terminal ticket"
                })?;
                let ticket = value
                    .get("ticket")
                    .and_then(Value::as_str)
                    .filter(|ticket| {
                        !ticket.is_empty()
                            && ticket.len() <= 1024
                            && ticket
                                .bytes()
                                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
                    })
                    .ok_or("The gateway returned an invalid terminal ticket")?;
                let mut ticket_url = url;
                ticket_url.query_pairs_mut().append_pair("ticket", ticket);
                let mut request = ticket_url
                    .as_str()
                    .into_client_request()
                    .map_err(|_| "Invalid terminal ticket request")?;
                for (name, value) in &headers {
                    if !matches!(
                        name.as_str(),
                        "host"
                            | "connection"
                            | "upgrade"
                            | "sec-websocket-version"
                            | "sec-websocket-key"
                    ) {
                        request.headers_mut().append(name, value.clone());
                    }
                }
                let stream = connect_tcp(&ticket_url)?;
                tungstenite::client_tls_with_config(request, stream, Some(config), None)
                    .map_err(|_| failure)?
            }
            Err(_) => return Err(failure.into()),
        };
        if private_protocol
            && response
                .headers()
                .get("Sec-WebSocket-Protocol")
                .and_then(|h| h.to_str().ok())
                != Some("hermes-gateway-v1")
        {
            return Err("The remote terminal did not accept private gateway authentication".into());
        }
        Ok(Self { socket })
    }
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let frame = match std::str::from_utf8(data) {
            Ok(text) => Message::Text(text.to_owned().into()),
            Err(_) => Message::Binary(data.to_vec().into()),
        };
        socket_timeout(self.socket.get_mut(), Duration::from_secs(5))?;
        self.socket
            .send(frame)
            .map_err(|_| "The remote terminal did not accept input".into())
    }
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.write(format!("\x1b[RESIZE:{cols};{rows}]").as_bytes())
    }
    pub fn poll(&mut self) -> Result<Option<Frame>, String> {
        socket_timeout(self.socket.get_mut(), Duration::from_millis(35))?;
        match self.socket.read() {
            Ok(Message::Text(text)) => {
                if let Some(meta) = text.strip_prefix(META) {
                    let value: Value =
                        serde_json::from_str(meta).map_err(|_| "Invalid host terminal metadata")?;
                    Ok(Some(Frame::Meta {
                        terminal_id: value
                            .get("terminalId")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        shell: value
                            .get("shell")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .into(),
                        cwd: value.get("cwd").and_then(Value::as_str).map(str::to_owned),
                        truncated: value["truncated"] == true,
                        closed: value["closed"] == true,
                    }))
                } else {
                    Ok(Some(Frame::Data(text.as_bytes().to_vec())))
                }
            }
            Ok(Message::Binary(bytes)) => Ok(Some(Frame::Data(bytes.to_vec()))),
            Ok(Message::Close(frame)) => Ok(Some(Frame::Closed {
                code: frame.as_ref().map(|f| u16::from(f.code)).unwrap_or(1006),
                reason: frame.map(|f| f.reason.to_string()).unwrap_or_default(),
            })),
            Ok(Message::Ping(data)) => {
                self.socket
                    .send(Message::Pong(data))
                    .map_err(|_| "Remote terminal heartbeat failed")?;
                Ok(None)
            }
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            Err(_) => Err("The remote terminal connection was interrupted".into()),
        }
    }
    pub fn detach(&mut self) {
        let _ = self.socket.close(None);
    }
}
pub fn stage(
    connection: &Connection,
    profile: &str,
    path: &std::path::Path,
) -> Result<String, String> {
    stage_scoped(
        connection,
        profile,
        crate::source::ProfileIntent::Backend,
        path,
    )
}
pub(crate) fn stage_scoped(
    connection: &Connection,
    profile: &str,
    intent: crate::source::ProfileIntent,
    path: &std::path::Path,
) -> Result<String, String> {
    let provenance = super::audio::provenance(connection, profile, intent)?;
    let metadata = std::fs::metadata(path).map_err(|_| "The dropped file is unavailable")?;
    if !metadata.is_file() || metadata.len() > 25 * 1024 * 1024 {
        return Err("Terminal drops require regular files up to 25 MiB".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "The dropped file could not be read")?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("The dropped file has no supported name")?;
    let mut gateway = Gateway::connect(connection)?;
    let result = gateway.page_request(
        profile,
        &PageRequest::post("/api/chat/file-upload", Value::Null)
            .upload(name, "application/octet-stream", bytes)
            .timeout_secs(180)
            .provenance(provenance),
    )?;
    result
        .get("path")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.contains(['\0', '\r', '\n']))
        .map(str::to_owned)
        .ok_or("The remote upload returned no safe path".into())
}

#[cfg(test)]
mod ticket_tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::TcpListener,
        thread,
    };

    #[test]
    fn webapp_terminal_uses_a_fresh_owner_authenticated_socket_ticket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let connection = Connection::Url {
            endpoint: format!("http://{}", listener.local_addr().unwrap()),
            token: Some("synthetic-token".into()),
        };
        let peer = thread::spawn(move || {
            let (gateway, _) = listener.accept().unwrap();
            let _gateway = tungstenite::accept(gateway).unwrap();
            let (mut rejected, _) = listener.accept().unwrap();
            rejected
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = BufReader::new(rejected.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            assert!(first.starts_with("GET /api/host-terminal?"));
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            rejected
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            drop(rejected);
            listener.set_nonblocking(true).unwrap();
            let deadline = Instant::now() + Duration::from_secs(4);
            let mut http = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(10))
                    }
                    _ => return false,
                }
            };
            http.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut reader = BufReader::new(http.try_clone().unwrap());
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                headers.push_str(&line);
            }
            assert!(headers.starts_with("POST /api/webapp/socket-ticket?"));
            assert!(headers.contains("socket=host-terminal"));
            assert!(headers.contains("profile=work"));
            assert!(
                headers
                    .to_ascii_lowercase()
                    .contains("x-hermes-session-token: synthetic-token\r\n")
            );
            let body = r#"{"ticket":"fresh-ticket-1","ttl_seconds":30}"#;
            write!(http,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            drop(http);
            let (socket, _) = loop {
                match listener.accept() {
                    Ok(pair) => break pair,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(10))
                    }
                    _ => return false,
                }
            };
            let _socket = tungstenite::accept_hdr(
                socket,
                |request: &tungstenite::handshake::server::Request, response| {
                    let url = url::Url::parse(&format!("http://fixture{}", request.uri())).unwrap();
                    assert_eq!(url.path(), "/api/host-terminal");
                    let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
                    assert_eq!(q.get("ticket").map(String::as_str), Some("fresh-ticket-1"));
                    assert!(!q.contains_key("token"));
                    assert_eq!(q.get("profile").map(String::as_str), Some("work"));
                    assert_eq!(q.get("cwd").map(String::as_str), Some("/srv/work"));
                    Ok(response)
                },
            )
            .unwrap();
            true
        });
        let result = HostTerminal::connect(&connection, "work", "/srv/work", 80, 24, None, false);
        let connected = result.is_ok();
        drop(result);
        let ticket_used = peer.join().unwrap();
        assert!(
            connected,
            "Webapp terminal did not connect with a scoped one-use ticket"
        );
        assert!(
            ticket_used,
            "the gateway never received a ticket-authenticated terminal request"
        );
    }
}
