//! Agent teams -- the coordination substrate for multiple agents working
//! together (Claude Code's `TeamCreate` / `SendMessage`). A [`TeamBoard`] is a
//! shared task board plus an inter-agent message log: agents post tasks, claim
//! the next open one, complete it, and message each other (direct or broadcast).
//!
//! This is the pure data structure; the orchestrator (CLI / SDK driver) owns the
//! agents and decides who does what. Deterministic + fully unit-tested -- no
//! clock or randomness (ids come from a monotonic counter).

/// Lifecycle of a team task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskStatus {
    /// Unclaimed -- any agent may take it.
    Open,
    /// Claimed by the named agent.
    Claimed(String),
    /// Finished.
    Done,
}

/// One unit of work on the board.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub description: String,
    pub status: TaskStatus,
}

/// A message between agents. `to: None` is a broadcast.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub from: String,
    pub to: Option<String>,
    pub body: String,
}

/// Shared board: tasks + messages. Cheap to clone.
#[derive(Debug, Clone, Default)]
pub struct TeamBoard {
    tasks: Vec<Task>,
    messages: Vec<Message>,
    seq: u64,
}

impl TeamBoard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Post a new open task; returns its id.
    pub fn post_task(&mut self, description: impl Into<String>) -> String {
        let id = format!("task_{}", self.seq);
        self.seq += 1;
        self.tasks.push(Task {
            id: id.clone(),
            description: description.into(),
            status: TaskStatus::Open,
        });
        id
    }

    /// Claim an OPEN task for `agent`. Returns false if the id is unknown or the
    /// task isn't open (already claimed/done) -- the safe concurrency guard.
    pub fn claim_task(&mut self, id: &str, agent: impl Into<String>) -> bool {
        match self.tasks.iter_mut().find(|t| t.id == id) {
            Some(t) if t.status == TaskStatus::Open => {
                t.status = TaskStatus::Claimed(agent.into());
                true
            }
            _ => false,
        }
    }

    /// Mark a task Done (from any non-Done state). False if the id is unknown.
    pub fn complete_task(&mut self, id: &str) -> bool {
        match self.tasks.iter_mut().find(|t| t.id == id) {
            Some(t) => {
                t.status = TaskStatus::Done;
                true
            }
            None => false,
        }
    }

    /// All currently-open tasks, in post order.
    pub fn open_tasks(&self) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Open)
            .collect()
    }

    /// The next open task a worker should grab (first open), if any.
    pub fn next_open(&self) -> Option<&Task> {
        self.tasks.iter().find(|t| t.status == TaskStatus::Open)
    }

    /// Atomically claim the next open task for `agent` (post-order). Returns the
    /// claimed task id, or None if the board has no open tasks.
    pub fn take_next(&mut self, agent: impl Into<String>) -> Option<String> {
        let id = self.next_open()?.id.clone();
        self.claim_task(&id, agent);
        Some(id)
    }

    /// Send a message. `to: None` broadcasts to every agent.
    pub fn send(&mut self, from: impl Into<String>, to: Option<&str>, body: impl Into<String>) {
        self.messages.push(Message {
            from: from.into(),
            to: to.map(str::to_string),
            body: body.into(),
        });
    }

    /// Messages visible to `agent`: those addressed to it + broadcasts.
    pub fn inbox(&self, agent: &str) -> Vec<&Message> {
        self.messages
            .iter()
            .filter(|m| m.to.as_deref() == Some(agent) || m.to.is_none())
            .collect()
    }

    /// Are all tasks Done (and at least one exists)? The team's stop condition.
    pub fn all_done(&self) -> bool {
        !self.tasks.is_empty() && self.tasks.iter().all(|t| t.status == TaskStatus::Done)
    }

    /// A one-line-per-task status summary.
    pub fn summary(&self) -> String {
        if self.tasks.is_empty() {
            return "no tasks".to_string();
        }
        self.tasks
            .iter()
            .map(|t| {
                let st = match &t.status {
                    TaskStatus::Open => "open".to_string(),
                    TaskStatus::Claimed(a) => format!("claimed:{a}"),
                    TaskStatus::Done => "done".to_string(),
                };
                format!("{} [{st}] {}", t.id, t.description)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_lifecycle_and_claim_guard() {
        let mut board = TeamBoard::new();
        let a = board.post_task("research auth");
        let b = board.post_task("implement auth");
        assert_eq!(board.open_tasks().len(), 2);

        // Claim a; a second claim of the same task fails (already claimed).
        assert!(board.claim_task(&a, "alice"));
        assert!(!board.claim_task(&a, "bob"), "can't claim a claimed task");
        assert_eq!(board.open_tasks().len(), 1);
        assert_eq!(board.next_open().unwrap().id, b);

        // Complete + stop condition.
        assert!(board.complete_task(&a));
        assert!(!board.all_done(), "b still open");
        board.take_next("bob"); // claims b
        assert!(board.complete_task(&b));
        assert!(board.all_done());

        // Unknown ids are graceful falses.
        assert!(!board.claim_task("task_99", "x"));
        assert!(!board.complete_task("task_99"));
    }

    #[test]
    fn take_next_claims_in_order() {
        let mut board = TeamBoard::new();
        let a = board.post_task("first");
        let _b = board.post_task("second");
        assert_eq!(board.take_next("w1").as_deref(), Some(a.as_str()));
        // a is now claimed -> next take grabs second.
        assert_eq!(board.take_next("w2").unwrap(), "task_1");
        // Nothing open now.
        assert!(board.take_next("w3").is_none());
    }

    #[test]
    fn inbox_filters_direct_and_broadcast() {
        let mut board = TeamBoard::new();
        board.send("alice", Some("bob"), "for bob only");
        board.send("alice", None, "everyone hears this");
        board.send("carol", Some("dave"), "for dave");

        let bob = board.inbox("bob");
        assert_eq!(bob.len(), 2); // direct + broadcast
        assert!(bob.iter().any(|m| m.body == "for bob only"));
        assert!(bob.iter().any(|m| m.body == "everyone hears this"));

        let dave = board.inbox("dave");
        assert_eq!(dave.len(), 2); // his direct + the broadcast
        assert!(dave.iter().all(|m| m.body != "for bob only"));
    }

    #[test]
    fn summary_renders_states() {
        let mut board = TeamBoard::new();
        assert_eq!(board.summary(), "no tasks");
        let a = board.post_task("x");
        board.claim_task(&a, "alice");
        assert!(board.summary().contains("claimed:alice"));
    }
}
