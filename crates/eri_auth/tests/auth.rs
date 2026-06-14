//! Integration tests for the `eri_auth` HTTP client and keychain abstraction.
//!
//! These tests stand up an in-process HTTP server on a loopback port so the
//! ureq-based client exercises the real wire format without depending on the
//! eri.dev backend, and they swap the real keychain for an in-memory store
//! gated behind the `test-support` feature.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use eri_auth::{
    AuthClient, AuthError, MemoryStore, RefreshTokenStore, SubscriptionTier, endpoints,
};

#[derive(Clone, Debug)]
struct CapturedRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

struct ServerHandle {
    addr: SocketAddr,
    captures: Arc<Mutex<Vec<CapturedRequest>>>,
    shutdown: Arc<Mutex<bool>>,
    thread: Option<JoinHandle<()>>,
}

impl ServerHandle {
    fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    fn captures(&self) -> Vec<CapturedRequest> {
        self.captures.lock().expect("captures mutex").clone()
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        *self.shutdown.lock().expect("shutdown mutex") = true;
        // Kick the accept loop by issuing a self-connect so it observes the
        // shutdown flag instead of blocking forever.
        if let Ok(stream) = TcpStream::connect(self.addr) {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

type Responder = Box<dyn Fn(&CapturedRequest) -> (u16, &'static str, String) + Send + Sync>;

fn start_server(responder: Responder) -> ServerHandle {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    listener.set_nonblocking(false).expect("blocking listener");
    let addr = listener.local_addr().expect("local addr");
    let captures: Arc<Mutex<Vec<CapturedRequest>>> = Arc::new(Mutex::new(Vec::new()));
    let shutdown = Arc::new(Mutex::new(false));

    let captures_for_thread = Arc::clone(&captures);
    let shutdown_for_thread = Arc::clone(&shutdown);

    let thread = thread::spawn(move || {
        for incoming in listener.incoming() {
            if *shutdown_for_thread.lock().expect("shutdown lock") {
                break;
            }
            let stream = match incoming {
                Ok(stream) => stream,
                Err(_) => continue,
            };
            stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
            stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
            let captured = match parse_request(&stream) {
                Some(request) => request,
                None => continue,
            };
            captures_for_thread
                .lock()
                .expect("captures lock")
                .push(captured.clone());
            let (status, status_text, body) = responder(&captured);
            write_response(stream, status, status_text, &body);
        }
    });

    ServerHandle {
        addr,
        captures,
        shutdown,
        thread: Some(thread),
    }
}

fn parse_request(stream: &TcpStream) -> Option<CapturedRequest> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).ok()? == 0 {
        return None;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut content_length: usize = 0;
    loop {
        let mut header_line = String::new();
        let n = reader.read_line(&mut header_line).ok()?;
        if n == 0 {
            break;
        }
        let trimmed = header_line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            let name = name.trim().to_string();
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }
    let mut body_buf = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body_buf).ok()?;
    }
    let body = String::from_utf8(body_buf).unwrap_or_default();
    Some(CapturedRequest {
        method,
        path,
        headers,
        body,
    })
}

fn write_response(mut stream: TcpStream, status: u16, status_text: &str, body: &str) {
    let payload = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        status = status,
        status_text = status_text,
        len = body.len(),
        body = body,
    );
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn sample_user_json() -> String {
    String::from(
        r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "alice@example.com",
            "display_name": "Alice",
            "tier": "free",
            "created_at": 1700000000
        }"#,
    )
}

fn sample_tokens_json(expires_at: i64) -> String {
    format!(
        r#"{{
            "access_token": "access-abc",
            "refresh_token": "refresh-xyz",
            "expires_at": {expires_at},
            "user": {user}
        }}"#,
        expires_at = expires_at,
        user = sample_user_json(),
    )
}

#[test]
fn signup_request_body_has_email_and_password() {
    let server = start_server(Box::new(|_req| {
        (200, "OK", sample_tokens_json(now_unix() + 3600))
    }));
    let client = AuthClient::with_api_base(server.base_url());

    let tokens = client
        .signup("alice@example.com", "hunter2-very-secure")
        .expect("signup succeeds");
    assert_eq!(tokens.user.email, "alice@example.com");

    let captures = server.captures();
    assert_eq!(captures.len(), 1, "exactly one HTTP call");
    let request = &captures[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, endpoints::SIGNUP);

    let body: serde_json::Value = serde_json::from_str(&request.body).expect("body parses as json");
    assert_eq!(
        body.get("email").and_then(|v| v.as_str()),
        Some("alice@example.com")
    );
    assert_eq!(
        body.get("password").and_then(|v| v.as_str()),
        Some("hunter2-very-secure"),
    );
}

#[test]
fn auth_error_maps_401_to_bad_credentials() {
    let server = start_server(Box::new(|_req| {
        (
            401,
            "Unauthorized",
            String::from(r#"{"error":"bad creds"}"#),
        )
    }));
    let client = AuthClient::with_api_base(server.base_url());

    let result = client.login("alice@example.com", "wrong-password");
    match result {
        Err(AuthError::BadCredentials) => {}
        other => panic!("expected BadCredentials, got {other:?}"),
    }
}

#[test]
fn auth_error_maps_409_to_user_exists() {
    let server = start_server(Box::new(|_req| {
        (409, "Conflict", String::from(r#"{"error":"taken"}"#))
    }));
    let client = AuthClient::with_api_base(server.base_url());

    let result = client.signup("alice@example.com", "hunter2-very-secure");
    match result {
        Err(AuthError::UserExists) => {}
        other => panic!("expected UserExists, got {other:?}"),
    }
}

#[test]
fn refresh_token_roundtrips_through_keychain_mock() {
    let store = MemoryStore::new();
    assert!(store.load().expect("load empty").is_none());

    store.save("refresh-xyz").expect("save");
    assert_eq!(
        store.load().expect("load saved").as_deref(),
        Some("refresh-xyz"),
    );

    store.clear().expect("clear");
    assert!(store.load().expect("load cleared").is_none());

    // Idempotent: clearing again must not error even when the slot is empty —
    // production users hit this when "log out" is voiced twice in a row.
    store.clear().expect("double clear");
}

#[test]
fn me_request_sends_bearer_token_in_authorization_header() {
    let server = start_server(Box::new(|_req| (200, "OK", sample_user_json())));
    let client = AuthClient::with_api_base(server.base_url());

    let profile = client.me("access-abc").expect("me succeeds");
    assert_eq!(profile.email, "alice@example.com");
    assert_eq!(profile.tier, SubscriptionTier::Free);

    let captures = server.captures();
    assert_eq!(captures.len(), 1);
    let request = &captures[0];
    assert_eq!(request.method, "GET");
    assert_eq!(request.path, endpoints::ME);

    let authorization = request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("authorization"))
        .map(|(_, value)| value.as_str());
    assert_eq!(authorization, Some("Bearer access-abc"));
}

#[test]
fn subscription_tier_serializes_pro_plus_as_snake_case() {
    // pro_plus and teams must serialize with snake_case so the wire format
    // agrees with the website (which writes tier strings to TEXT columns).
    let pro_plus = serde_json::to_string(&SubscriptionTier::ProPlus).expect("serialize pro_plus");
    assert_eq!(pro_plus, "\"pro_plus\"");
    let teams = serde_json::to_string(&SubscriptionTier::Teams).expect("serialize teams");
    assert_eq!(teams, "\"teams\"");

    // Existing tiers stay stable.
    assert_eq!(
        serde_json::to_string(&SubscriptionTier::Free).expect("serialize free"),
        "\"free\"",
    );
    assert_eq!(
        serde_json::to_string(&SubscriptionTier::Enterprise).expect("serialize enterprise"),
        "\"enterprise\"",
    );

    // Deserialization round-trips.
    let parsed: SubscriptionTier =
        serde_json::from_str("\"pro_plus\"").expect("deserialize pro_plus");
    assert_eq!(parsed, SubscriptionTier::ProPlus);
    let parsed: SubscriptionTier = serde_json::from_str("\"teams\"").expect("deserialize teams");
    assert_eq!(parsed, SubscriptionTier::Teams);
}

#[test]
fn expires_at_is_in_the_future_after_successful_login() {
    let issued_at = now_unix();
    let expires_at = issued_at + 3600;
    let server = start_server(Box::new(move |_req| {
        (200, "OK", sample_tokens_json(expires_at))
    }));
    let client = AuthClient::with_api_base(server.base_url());

    let tokens = client
        .login("alice@example.com", "hunter2-very-secure")
        .expect("login succeeds");
    assert!(
        tokens.expires_at > now_unix(),
        "expires_at must be in the future (got {} vs now {})",
        tokens.expires_at,
        now_unix(),
    );
    assert_eq!(tokens.refresh_token, "refresh-xyz");
    assert_eq!(tokens.access_token, "access-abc");
}
