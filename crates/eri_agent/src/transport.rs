//! Transport abstraction -- the seam between the agent loop and however the
//! model is reached (a metered HTTP proxy, a direct provider call, a local
//! engine). The loop reads SSE bytes through a [`ByteStream`]; a [`Transport`]
//! opens one for a request body. Keeping this behind a trait lets the same loop
//! drive the CLI's `reqwest` client, the IDE sidecar, or a mock in tests.

use async_trait::async_trait;
use serde_json::Value;

/// A byte source for one streamed response (raw SSE chunks). The host adapts its
/// HTTP client to this; tests supply canned bytes.
#[async_trait]
pub trait ByteStream: Send {
    /// The next chunk of bytes, or `None` at end of stream. `Err` on a transport
    /// read failure (the loop turns it into a graceful halt / error).
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String>;
}

/// Opens a streamed Messages response for a request body.
#[async_trait]
pub trait Transport: Send + Sync {
    async fn open(&self, body: Value) -> Result<Box<dyn ByteStream>, String>;
}

/// Read an SSE byte stream to completion: split `data:` frames across chunk
/// boundaries, feed the protocol accumulator, narrate text fragments via
/// `on_text`, and return the finished [`Turn`](crate::stream::Turn).
///
/// This is the host-agnostic core of `consume_turn` -- the only host-specific
/// bit (writing narration to a terminal) is the `on_text` callback.
pub async fn run_turn(
    stream: &mut dyn ByteStream,
    mut on_text: impl FnMut(&str),
) -> Result<crate::stream::Turn, String> {
    let mut buffer = String::new();
    let mut acc = crate::stream::TurnAccumulator::new();
    while let Some(chunk) = stream.next_chunk().await? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer.drain(..=idx);
            let Some(payload) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if payload.is_empty() {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<Value>(payload) else {
                continue;
            };
            if let Some(text) = acc.push_event(&ev) {
                on_text(&text);
            }
        }
    }
    Ok(acc.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ByteStream that hands back pre-set chunks (to exercise frame splitting
    /// across arbitrary chunk boundaries).
    struct MockStream {
        chunks: Vec<Vec<u8>>,
        pos: usize,
    }
    #[async_trait]
    impl ByteStream for MockStream {
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
            if self.pos < self.chunks.len() {
                let c = self.chunks[self.pos].clone();
                self.pos += 1;
                Ok(Some(c))
            } else {
                Ok(None)
            }
        }
    }

    #[tokio::test]
    async fn run_turn_parses_frames_split_across_chunks() {
        // A full text+tool turn, with SSE frames deliberately split mid-line
        // across chunk boundaries to prove the buffering works.
        let sse = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":3}}}\n\
                   data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\
                   data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\
                   data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n";
        let bytes = sse.as_bytes();
        // Split into 5-byte chunks.
        let chunks: Vec<Vec<u8>> = bytes.chunks(5).map(|c| c.to_vec()).collect();
        let mut stream = MockStream { chunks, pos: 0 };

        let mut narrated = String::new();
        let turn = run_turn(&mut stream, |t| narrated.push_str(t))
            .await
            .unwrap();

        assert_eq!(narrated, "hi");
        assert_eq!(turn.usage_in, 3);
        assert_eq!(turn.usage_out, 7);
        assert_eq!(turn.stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(crate::stream::assistant_text(&turn.content), "hi");
    }

    #[tokio::test]
    async fn run_turn_propagates_transport_error() {
        struct Failing;
        #[async_trait]
        impl ByteStream for Failing {
            async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
                Err("boom".to_string())
            }
        }
        let err = run_turn(&mut Failing, |_| {}).await.unwrap_err();
        assert_eq!(err, "boom");
    }
}
