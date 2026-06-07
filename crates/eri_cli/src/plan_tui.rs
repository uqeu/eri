//! Interactive plan-mode TUI — "build software *with* eri".
//!
//! Full-screen planner (ratatui + crossterm) that mirrors the reference
//! experience: streamed plan prose up top, arrow-navigable **multi-select
//! questions**, `n` to attach a free-text note, a code-preview pane, and a
//! task checklist. On approve, the agreed plan + the user's selections/notes
//! are returned to the caller to hand off to the build loop.
//!
//! The module splits cleanly in two:
//!   - [`PlanState`] — a PURE state machine (navigation, multi-select toggle,
//!     notes buffer, task checklist, approve/cancel). Fully unit-tested; holds
//!     no terminal handles, so it runs headless.
//!   - [`run`] — the crossterm raw-mode event loop + ratatui rendering, which
//!     drives a `PlanState`. Verified manually; skipped when stdout isn't a TTY
//!     so CI / piped usage falls back to the plain streaming planner.

use std::io::{self, IsTerminal};

use anyhow::Result;

/// One selectable option within a question.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanOption {
    pub label: String,
    pub selected: bool,
}

impl PlanOption {
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            selected: false,
        }
    }
}

/// A question with one or more options. `multi` decides whether toggling is
/// additive (checkbox) or exclusive (radio).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Question {
    pub prompt: String,
    pub options: Vec<PlanOption>,
    pub multi: bool,
}

impl Question {
    pub fn new(prompt: impl Into<String>, options: Vec<PlanOption>, multi: bool) -> Self {
        Self {
            prompt: prompt.into(),
            options,
            multi,
        }
    }
}

/// A checklist item shown at the bottom of the planner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Task {
    pub text: String,
    pub done: bool,
}

impl Task {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            done: false,
        }
    }
}

/// Which pane has focus / what keys mean right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    /// Navigating questions + options (the default).
    Questions,
    /// Navigating the task checklist.
    Tasks,
    /// Capturing free-text into the active question's note buffer.
    EditingNote,
}

/// Terminal status of the planning session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    Approved,
    Cancelled,
}

/// The pure planner state machine.
#[derive(Clone, Debug)]
pub struct PlanState {
    pub title: String,
    /// Streamed plan prose shown up top (read-only here).
    pub plan_text: String,
    /// Optional code-preview pane content (e.g. a snippet from the plan).
    pub preview: Option<String>,
    pub questions: Vec<Question>,
    pub tasks: Vec<Task>,
    /// Per-question free-text notes, parallel to `questions`.
    notes: Vec<String>,
    focus: Focus,
    q_cursor: usize,
    o_cursor: usize,
    t_cursor: usize,
    status: Status,
}

impl PlanState {
    pub fn new(title: impl Into<String>, plan_text: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            plan_text: plan_text.into(),
            preview: None,
            questions: Vec::new(),
            tasks: Vec::new(),
            notes: Vec::new(),
            focus: Focus::Questions,
            q_cursor: 0,
            o_cursor: 0,
            t_cursor: 0,
            status: Status::Active,
        }
    }

    pub fn with_questions(mut self, questions: Vec<Question>) -> Self {
        self.notes = vec![String::new(); questions.len()];
        self.questions = questions;
        self
    }

    pub fn with_tasks(mut self, tasks: Vec<Task>) -> Self {
        self.tasks = tasks;
        self
    }

    pub fn with_preview(mut self, preview: impl Into<String>) -> Self {
        self.preview = Some(preview.into());
        self
    }

    // --- accessors (for rendering + tests) ---

    pub fn focus(&self) -> Focus {
        self.focus
    }
    pub fn status(&self) -> Status {
        self.status
    }
    pub fn question_cursor(&self) -> usize {
        self.q_cursor
    }
    pub fn option_cursor(&self) -> usize {
        self.o_cursor
    }
    pub fn task_cursor(&self) -> usize {
        self.t_cursor
    }
    pub fn note_for(&self, q: usize) -> &str {
        self.notes.get(q).map(String::as_str).unwrap_or("")
    }
    pub fn active_note(&self) -> &str {
        self.note_for(self.q_cursor)
    }
    pub fn is_done(&self) -> bool {
        self.status != Status::Active
    }

    // --- navigation ---

    /// Move the selection down within the focused pane. In note-editing mode
    /// this is a no-op (arrows don't move the text cursor in this simple model).
    pub fn move_down(&mut self) {
        match self.focus {
            Focus::Questions => {
                if let Some(q) = self.questions.get(self.q_cursor)
                    && !q.options.is_empty()
                {
                    self.o_cursor = (self.o_cursor + 1) % q.options.len();
                }
            }
            Focus::Tasks => {
                if !self.tasks.is_empty() {
                    self.t_cursor = (self.t_cursor + 1) % self.tasks.len();
                }
            }
            Focus::EditingNote => {}
        }
    }

    pub fn move_up(&mut self) {
        match self.focus {
            Focus::Questions => {
                if let Some(q) = self.questions.get(self.q_cursor)
                    && !q.options.is_empty()
                {
                    self.o_cursor = (self.o_cursor + q.options.len() - 1) % q.options.len();
                }
            }
            Focus::Tasks => {
                if !self.tasks.is_empty() {
                    self.t_cursor = (self.t_cursor + self.tasks.len() - 1) % self.tasks.len();
                }
            }
            Focus::EditingNote => {}
        }
    }

    /// Tab — advance to the next question (wraps), resetting the option cursor.
    pub fn next_question(&mut self) {
        if self.questions.is_empty() {
            return;
        }
        self.q_cursor = (self.q_cursor + 1) % self.questions.len();
        self.o_cursor = 0;
    }

    pub fn prev_question(&mut self) {
        if self.questions.is_empty() {
            return;
        }
        self.q_cursor = (self.q_cursor + self.questions.len() - 1) % self.questions.len();
        self.o_cursor = 0;
    }

    /// Cycle focus Questions -> Tasks -> Questions (note mode is entered/left
    /// explicitly, not via this toggle).
    pub fn toggle_pane(&mut self) {
        self.focus = match self.focus {
            Focus::Questions => Focus::Tasks,
            Focus::Tasks => Focus::Questions,
            Focus::EditingNote => Focus::EditingNote,
        };
    }

    // --- selection ---

    /// Space — toggle the focused option (multi: additive; single: exclusive),
    /// or toggle the focused task when the checklist has focus.
    pub fn toggle(&mut self) {
        match self.focus {
            Focus::Questions => self.toggle_option(),
            Focus::Tasks => {
                if let Some(t) = self.tasks.get_mut(self.t_cursor) {
                    t.done = !t.done;
                }
            }
            Focus::EditingNote => {}
        }
    }

    fn toggle_option(&mut self) {
        let Some(q) = self.questions.get_mut(self.q_cursor) else {
            return;
        };
        let idx = self.o_cursor;
        let Some(cur) = q.options.get(idx) else {
            return;
        };
        let next = !cur.selected;
        if q.multi {
            q.options[idx].selected = next;
        } else {
            // Radio: exclusive — selecting one clears the rest; re-toggling the
            // selected one clears it.
            for (i, opt) in q.options.iter_mut().enumerate() {
                opt.selected = next && i == idx;
            }
        }
    }

    // --- notes ---

    pub fn begin_note(&mut self) {
        if !self.questions.is_empty() {
            self.focus = Focus::EditingNote;
        }
    }

    pub fn end_note(&mut self) {
        if self.focus == Focus::EditingNote {
            self.focus = Focus::Questions;
        }
    }

    pub fn note_push(&mut self, c: char) {
        if self.focus == Focus::EditingNote
            && let Some(n) = self.notes.get_mut(self.q_cursor)
        {
            n.push(c);
        }
    }

    pub fn note_backspace(&mut self) {
        if self.focus == Focus::EditingNote
            && let Some(n) = self.notes.get_mut(self.q_cursor)
        {
            n.pop();
        }
    }

    // --- terminal actions ---

    pub fn approve(&mut self) {
        self.status = Status::Approved;
    }
    pub fn cancel(&mut self) {
        self.status = Status::Cancelled;
    }

    /// Selected option labels for question `q`.
    pub fn selected_labels(&self, q: usize) -> Vec<&str> {
        self.questions
            .get(q)
            .map(|qq| {
                qq.options
                    .iter()
                    .filter(|o| o.selected)
                    .map(|o| o.label.as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Render the user's decisions as a plain-text block to append to the build
    /// prompt on approval. Empty when nothing was selected or noted.
    pub fn decisions_summary(&self) -> String {
        let mut out = String::new();
        for (i, q) in self.questions.iter().enumerate() {
            let picks = self.selected_labels(i);
            let note = self.note_for(i).trim();
            if picks.is_empty() && note.is_empty() {
                continue;
            }
            out.push_str(&format!("- {}\n", q.prompt));
            if !picks.is_empty() {
                out.push_str(&format!("  choice: {}\n", picks.join(", ")));
            }
            if !note.is_empty() {
                out.push_str(&format!("  note: {note}\n"));
            }
        }
        let checked: Vec<&str> = self
            .tasks
            .iter()
            .filter(|t| t.done)
            .map(|t| t.text.as_str())
            .collect();
        if !checked.is_empty() {
            out.push_str(&format!("- confirmed tasks: {}\n", checked.join("; ")));
        }
        out
    }
}

/// Outcome handed back to the caller after the TUI exits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanOutcome {
    pub approved: bool,
    /// The decisions block to append to the build prompt (empty if none).
    pub decisions: String,
}

/// Launch the interactive planner, blocking until the user approves or cancels.
/// Falls back to a non-interactive auto-approve when stdout isn't a TTY so CI /
/// piped invocations never hang on raw-mode input.
pub fn run(state: PlanState) -> Result<PlanOutcome> {
    if !io::stdout().is_terminal() {
        return Ok(PlanOutcome {
            approved: true,
            decisions: state.decisions_summary(),
        });
    }
    event_loop::run(state)
}

/// The crossterm/ratatui layer. Kept in a submodule so the pure state machine
/// above stays free of terminal types and trivially testable.
mod event_loop {
    use super::{Focus, PlanOutcome, PlanState, Status};
    use anyhow::Result;
    use crossterm::event::{self, Event, KeyCode, KeyEventKind};
    use crossterm::terminal::{
        EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
    };
    use crossterm::{ExecutableCommand, cursor};
    use ratatui::Terminal;
    use ratatui::backend::CrosstermBackend;
    use ratatui::layout::{Constraint, Direction, Layout, Rect};
    use ratatui::style::{Color, Modifier, Style};
    use ratatui::text::{Line, Span};
    use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
    use std::io::{self, Stdout};

    pub fn run(mut state: PlanState) -> Result<PlanOutcome> {
        let mut term = setup()?;
        let res = drive(&mut term, &mut state);
        teardown(&mut term)?;
        res?;
        Ok(PlanOutcome {
            approved: state.status() == Status::Approved,
            decisions: state.decisions_summary(),
        })
    }

    fn setup() -> Result<Terminal<CrosstermBackend<Stdout>>> {
        enable_raw_mode()?;
        let mut out = io::stdout();
        out.execute(EnterAlternateScreen)?;
        out.execute(cursor::Hide)?;
        Ok(Terminal::new(CrosstermBackend::new(out))?)
    }

    fn teardown(term: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
        disable_raw_mode()?;
        let mut out = io::stdout();
        out.execute(LeaveAlternateScreen)?;
        out.execute(cursor::Show)?;
        let _ = term.show_cursor();
        Ok(())
    }

    fn drive(term: &mut Terminal<CrosstermBackend<Stdout>>, state: &mut PlanState) -> Result<()> {
        loop {
            term.draw(|f| render(f, state))?;
            if state.is_done() {
                return Ok(());
            }
            let Event::Key(key) = event::read()? else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }
            if state.focus() == Focus::EditingNote {
                match key.code {
                    KeyCode::Esc | KeyCode::Enter => state.end_note(),
                    KeyCode::Backspace => state.note_backspace(),
                    KeyCode::Char(c) => state.note_push(c),
                    _ => {}
                }
                continue;
            }
            match key.code {
                KeyCode::Up => state.move_up(),
                KeyCode::Down => state.move_down(),
                KeyCode::Tab => state.next_question(),
                KeyCode::BackTab => state.prev_question(),
                KeyCode::Char(' ') => state.toggle(),
                KeyCode::Char('n') => state.begin_note(),
                KeyCode::Char('t') => state.toggle_pane(),
                KeyCode::Char('a') | KeyCode::Enter => state.approve(),
                KeyCode::Esc | KeyCode::Char('q') => state.cancel(),
                _ => {}
            }
        }
    }

    fn render(f: &mut ratatui::Frame, state: &PlanState) {
        let areas = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // title
                Constraint::Min(6),    // plan + questions
                Constraint::Length(7), // tasks
                Constraint::Length(1), // help
            ])
            .split(f.area());

        let title = Paragraph::new(Line::from(vec![
            Span::styled(
                format!(" {} ", state.title),
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  plan with eri"),
        ]))
        .block(Block::default().borders(Borders::ALL));
        f.render_widget(title, areas[0]);

        render_body(f, state, areas[1]);
        render_tasks(f, state, areas[2]);

        let help = Paragraph::new(Span::styled(
            " ↑/↓ move · space select · Tab next question · n note · t tasks · a approve · q cancel ",
            Style::default().fg(Color::DarkGray),
        ));
        f.render_widget(help, areas[3]);
    }

    fn render_body(f: &mut ratatui::Frame, state: &PlanState, area: Rect) {
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(area);

        // Left: plan prose (+ optional preview pane beneath it).
        let left = if state.preview.is_some() {
            Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
                .split(cols[0])
        } else {
            Layout::default()
                .constraints([Constraint::Percentage(100)])
                .split(cols[0])
        };
        let plan = Paragraph::new(state.plan_text.as_str())
            .wrap(Wrap { trim: false })
            .block(Block::default().borders(Borders::ALL).title(" plan "));
        f.render_widget(plan, left[0]);
        if let Some(preview) = state.preview.as_deref() {
            let code = Paragraph::new(preview)
                .wrap(Wrap { trim: false })
                .style(Style::default().fg(Color::Cyan))
                .block(Block::default().borders(Borders::ALL).title(" preview "));
            f.render_widget(code, left[1]);
        }

        // Right: the active question with selectable options + its note.
        render_questions(f, state, cols[1]);
    }

    fn render_questions(f: &mut ratatui::Frame, state: &PlanState, area: Rect) {
        let q = state.questions.get(state.question_cursor());
        let title = match q {
            Some(_) => format!(
                " question {}/{} ",
                state.question_cursor() + 1,
                state.questions.len()
            ),
            None => " questions ".to_string(),
        };
        let block = Block::default().borders(Borders::ALL).title(title);
        let Some(q) = q else {
            f.render_widget(Paragraph::new("(no questions)").block(block), area);
            return;
        };

        let focused_q = state.focus() != Focus::Tasks;
        let mut items: Vec<ListItem> = Vec::new();
        items.push(ListItem::new(Line::from(Span::styled(
            q.prompt.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ))));
        let marker = if q.multi { ('[', ']') } else { ('(', ')') };
        for (i, opt) in q.options.iter().enumerate() {
            let check = if opt.selected { 'x' } else { ' ' };
            let cursor_here = focused_q && i == state.option_cursor();
            let prefix = if cursor_here { "›" } else { " " };
            let style = if cursor_here {
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD)
            } else if opt.selected {
                Style::default().fg(Color::Green)
            } else {
                Style::default()
            };
            items.push(ListItem::new(Line::from(Span::styled(
                format!("{prefix} {}{check}{} {}", marker.0, marker.1, opt.label),
                style,
            ))));
        }
        let note = state.active_note();
        if !note.is_empty() || state.focus() == Focus::EditingNote {
            let editing = state.focus() == Focus::EditingNote;
            let caret = if editing { "_" } else { "" };
            items.push(ListItem::new(Line::from(Span::styled(
                format!("note: {note}{caret}"),
                Style::default().fg(if editing {
                    Color::Yellow
                } else {
                    Color::DarkGray
                }),
            ))));
        }
        f.render_widget(List::new(items).block(block), area);
    }

    fn render_tasks(f: &mut ratatui::Frame, state: &PlanState, area: Rect) {
        let focused = state.focus() == Focus::Tasks;
        let title = if focused { " tasks ◂ " } else { " tasks " };
        let items: Vec<ListItem> = state
            .tasks
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let check = if t.done { 'x' } else { ' ' };
                let here = focused && i == state.task_cursor();
                let prefix = if here { "›" } else { " " };
                let style = if here {
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD)
                } else if t.done {
                    Style::default()
                        .fg(Color::DarkGray)
                        .add_modifier(Modifier::CROSSED_OUT)
                } else {
                    Style::default()
                };
                ListItem::new(Line::from(Span::styled(
                    format!("{prefix} [{check}] {}", t.text),
                    style,
                )))
            })
            .collect();
        f.render_widget(
            List::new(items).block(Block::default().borders(Borders::ALL).title(title)),
            area,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PlanState {
        PlanState::new("Build feature Y", "Step 1...\nStep 2...")
            .with_questions(vec![
                Question::new(
                    "Which surfaces?",
                    vec![
                        PlanOption::new("CLI"),
                        PlanOption::new("IDE"),
                        PlanOption::new("Web"),
                    ],
                    true,
                ),
                Question::new(
                    "Test strategy?",
                    vec![PlanOption::new("TDD"), PlanOption::new("After")],
                    false,
                ),
            ])
            .with_tasks(vec![
                Task::new("scaffold"),
                Task::new("wire"),
                Task::new("test"),
            ])
    }

    #[test]
    fn option_cursor_wraps_within_question() {
        let mut s = sample();
        assert_eq!(s.option_cursor(), 0);
        s.move_down();
        s.move_down();
        assert_eq!(s.option_cursor(), 2);
        s.move_down(); // wraps
        assert_eq!(s.option_cursor(), 0);
        s.move_up(); // wraps back to last
        assert_eq!(s.option_cursor(), 2);
    }

    #[test]
    fn tab_advances_question_and_resets_option_cursor() {
        let mut s = sample();
        s.move_down();
        assert_eq!(s.option_cursor(), 1);
        s.next_question();
        assert_eq!(s.question_cursor(), 1);
        assert_eq!(s.option_cursor(), 0);
        s.next_question(); // wraps to 0
        assert_eq!(s.question_cursor(), 0);
    }

    #[test]
    fn multi_select_is_additive() {
        let mut s = sample(); // q0 is multi
        s.toggle(); // select CLI
        s.move_down();
        s.move_down();
        s.toggle(); // select Web
        assert_eq!(s.selected_labels(0), vec!["CLI", "Web"]);
    }

    #[test]
    fn single_select_is_exclusive() {
        let mut s = sample();
        s.next_question(); // q1 is single (radio)
        s.toggle(); // TDD
        assert_eq!(s.selected_labels(1), vec!["TDD"]);
        s.move_down();
        s.toggle(); // After -> clears TDD
        assert_eq!(s.selected_labels(1), vec!["After"]);
        s.toggle(); // re-toggle clears it
        assert!(s.selected_labels(1).is_empty());
    }

    #[test]
    fn notes_capture_into_active_question() {
        let mut s = sample();
        s.begin_note();
        assert_eq!(s.focus(), Focus::EditingNote);
        for c in "use axum".chars() {
            s.note_push(c);
        }
        s.note_backspace();
        s.end_note();
        assert_eq!(s.focus(), Focus::Questions);
        assert_eq!(s.active_note(), "use axu");
        // The note is bound to q0; switching questions shows a different buffer.
        s.next_question();
        assert_eq!(s.active_note(), "");
    }

    #[test]
    fn tasks_pane_toggles_checklist() {
        let mut s = sample();
        s.toggle_pane();
        assert_eq!(s.focus(), Focus::Tasks);
        s.toggle(); // check 'scaffold'
        s.move_down();
        s.move_down();
        s.toggle(); // check 'test'
        assert!(s.tasks[0].done);
        assert!(s.tasks[2].done);
        assert!(!s.tasks[1].done);
    }

    #[test]
    fn approve_and_cancel_set_status() {
        let mut s = sample();
        assert_eq!(s.status(), Status::Active);
        assert!(!s.is_done());
        s.approve();
        assert_eq!(s.status(), Status::Approved);
        assert!(s.is_done());

        let mut c = sample();
        c.cancel();
        assert_eq!(c.status(), Status::Cancelled);
    }

    #[test]
    fn decisions_summary_reflects_picks_notes_and_tasks() {
        let mut s = sample();
        s.toggle(); // q0: CLI
        s.begin_note();
        for c in "ship cli first".chars() {
            s.note_push(c);
        }
        s.end_note();
        s.next_question();
        s.toggle(); // q1: TDD
        s.toggle_pane();
        s.toggle(); // task: scaffold

        let summary = s.decisions_summary();
        assert!(summary.contains("Which surfaces?"));
        assert!(summary.contains("choice: CLI"));
        assert!(summary.contains("note: ship cli first"));
        assert!(summary.contains("choice: TDD"));
        assert!(summary.contains("confirmed tasks: scaffold"));
    }

    #[test]
    fn empty_planner_is_safe() {
        let mut s = PlanState::new("Empty", "nothing here");
        // No questions/tasks: navigation + toggles must not panic.
        s.move_down();
        s.move_up();
        s.next_question();
        s.toggle();
        s.begin_note(); // no questions -> stays in Questions focus
        assert_eq!(s.focus(), Focus::Questions);
        assert_eq!(s.decisions_summary(), "");
    }
}
