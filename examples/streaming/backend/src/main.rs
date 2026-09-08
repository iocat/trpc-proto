use std::{
    net::SocketAddr,
    pin::Pin,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tokio::sync::mpsc;
use tokio_stream::{wrappers::ReceiverStream, Stream};
use tonic::{transport::Server, Request, Response, Status};

pub mod stream_v1 {
    tonic::include_proto!("stream.v1");
}

use stream_v1::{
    chat_service_server::{ChatService, ChatServiceServer},
    ChatEvent, ChatRespondRequest,
};

const ADDRESS: &str = "127.0.0.1:50054";

#[derive(Default)]
struct ChatBackend;

fn unix_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1_000.0)
}

fn response_tokens(prompt: &str, count: usize) -> Vec<String> {
    let prompt = prompt
        .trim()
        .trim_end_matches(|character: char| matches!(character, '.' | '!' | '?'));
    let response = format!(
        "Here is a practical answer to your request: {prompt}. I would begin by defining the \
         desired outcome and the constraints that cannot move. Next, I would divide the work \
         into small observable steps, keeping each interface explicit and each failure visible. \
         The implementation should favor simple data flow, bounded memory, and cancellation at \
         every asynchronous boundary. Once the core path works, I would measure the real behavior \
         rather than infer it from abstractions. That gives us a result that is understandable, \
         testable, and easy to change when the requirements evolve."
    );
    response
        .split_whitespace()
        .cycle()
        .take(count)
        .enumerate()
        .map(|(index, token)| {
            if index == 0 {
                token.to_owned()
            } else {
                format!(" {token}")
            }
        })
        .collect()
}

#[tonic::async_trait]
impl ChatService for ChatBackend {
    type RespondStream = Pin<Box<dyn Stream<Item = Result<ChatEvent, Status>> + Send>>;

    async fn respond(
        &self,
        request: Request<ChatRespondRequest>,
    ) -> Result<Response<Self::RespondStream>, Status> {
        let request = request.into_inner();
        let prompt = request.prompt.unwrap_or_default();
        let tokens_per_second = request.tokens_per_second.unwrap_or(80);
        let max_tokens = request.max_tokens.unwrap_or(260);

        if prompt.trim().is_empty() || prompt.len() > 2_000 {
            return Err(Status::invalid_argument(
                "prompt must contain between 1 and 2000 characters",
            ));
        }
        if !(1..=500).contains(&tokens_per_second) {
            return Err(Status::invalid_argument(
                "tokens_per_second must be between 1 and 500",
            ));
        }
        if !(16..=2_000).contains(&max_tokens) {
            return Err(Status::invalid_argument(
                "max_tokens must be between 16 and 2000",
            ));
        }

        let capacity = usize::try_from(tokens_per_second.clamp(32, 512)).unwrap_or(512);
        let (sender, receiver) = mpsc::channel(capacity);
        tokio::spawn(async move {
            let mut sequence = 1;
            let thinking = ChatEvent {
                sequence: Some(sequence),
                kind: Some("thinking".to_owned()),
                content: Some("Planning a concise response".to_owned()),
                sent_at_unix_ms: Some(unix_ms()),
                progress: Some(0.0),
            };
            if sender.send(Ok(thinking)).await.is_err() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(180)).await;

            let period = Duration::from_micros(1_000_000 / tokens_per_second as u64);
            let mut ticker = tokio::time::interval(period);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let tokens = response_tokens(&prompt, max_tokens as usize);

            for (index, token) in tokens.into_iter().enumerate() {
                ticker.tick().await;
                if index == max_tokens as usize / 3 {
                    sequence += 1;
                    let tool_event = ChatEvent {
                        sequence: Some(sequence),
                        kind: Some("tool".to_owned()),
                        content: Some("Checked the local project context".to_owned()),
                        sent_at_unix_ms: Some(unix_ms()),
                        progress: Some(index as f64 / max_tokens as f64),
                    };
                    if sender.send(Ok(tool_event)).await.is_err() {
                        return;
                    }
                }

                sequence += 1;
                let event = ChatEvent {
                    sequence: Some(sequence),
                    kind: Some("token".to_owned()),
                    content: Some(token),
                    sent_at_unix_ms: Some(unix_ms()),
                    progress: Some((index + 1) as f64 / max_tokens as f64),
                };
                if sender.send(Ok(event)).await.is_err() {
                    return;
                }
            }

            sequence += 1;
            let done = ChatEvent {
                sequence: Some(sequence),
                kind: Some("done".to_owned()),
                content: Some("stop".to_owned()),
                sent_at_unix_ms: Some(unix_ms()),
                progress: Some(1.0),
            };
            let _ = sender.send(Ok(done)).await;
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(receiver))))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = ADDRESS.parse()?;
    println!("Rust gRPC listening on {address}");
    Server::builder()
        .add_service(ChatServiceServer::new(ChatBackend))
        .serve_with_shutdown(address, async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
