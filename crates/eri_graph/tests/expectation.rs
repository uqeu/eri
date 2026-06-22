//! The world model's **anticipation** of an action about to run (predict step,
//! ADR-0007 §4): joins the proactive chain ("after X you usually Y") with the
//! entity model ("who/what is X"), both read from the one graph. The eri_cli
//! predict step blends this into the confirmation envelope's confidence.

use eri_graph::{Graph, world};

#[test]
fn an_established_next_step_is_expected() {
    let g = Graph::open_in_memory().unwrap();
    // "open editor → run tests" seen twice = an established pattern.
    world::link_next(&g, "open editor", "run tests").unwrap();
    world::link_next(&g, "open editor", "run tests").unwrap();

    let e = world::expectation(&g, Some("open editor"), "run tests", None).unwrap();
    assert!(
        e.expected,
        "a successor seen at the established threshold is anticipated"
    );
}

#[test]
fn a_one_off_or_novel_transition_is_not_expected() {
    let g = Graph::open_in_memory().unwrap();
    world::link_next(&g, "open editor", "run tests").unwrap(); // seen once only

    assert!(
        !world::expectation(&g, Some("open editor"), "run tests", None)
            .unwrap()
            .expected,
        "a single occurrence is below the established threshold"
    );
    // A transition never seen is never expected (no fabrication).
    assert!(
        !world::expectation(&g, Some("open editor"), "delete everything", None)
            .unwrap()
            .expected
    );
    // No prior action → nothing to anticipate from.
    assert!(
        !world::expectation(&g, None, "run tests", None)
            .unwrap()
            .expected
    );
}

#[test]
fn an_action_naming_a_known_entity_is_grounded() {
    let g = Graph::open_in_memory().unwrap();
    world::record_entity(&g, world::entity_kind::PERSON, "Priya").unwrap();
    world::record_entity(&g, world::entity_kind::PROJECT, "billing rewrite").unwrap();

    // The action text mentions a known person — eri recognizes who it touches.
    let e = world::expectation(&g, None, "send the draft to Priya", None).unwrap();
    assert!(e.grounded, "a known entity named in the action grounds it");

    // A known multi-word project, supplied as the target, also grounds.
    let e = world::expectation(&g, None, "open the file", Some("billing rewrite")).unwrap();
    assert!(
        e.grounded,
        "a multi-word entity name grounds as a whole phrase"
    );
}

#[test]
fn an_action_naming_nothing_known_is_not_grounded() {
    let g = Graph::open_in_memory().unwrap();
    world::record_entity(&g, world::entity_kind::PERSON, "Priya").unwrap();

    assert!(
        !world::expectation(&g, None, "click the Save button", None)
            .unwrap()
            .grounded,
        "an action that names no known entity is not grounded"
    );
}

#[test]
fn mentions_matches_whole_words_case_insensitively() {
    let g = Graph::open_in_memory().unwrap();
    world::record_entity(&g, world::entity_kind::APP, "Slack").unwrap();

    assert!(world::mentions_known_entity(&g, "open SLACK and post").unwrap());
    // Whole-word only: "Slack" must not match inside "Slackers".
    assert!(!world::mentions_known_entity(&g, "the slackers left").unwrap());
    assert!(!world::mentions_known_entity(&g, "nothing known here").unwrap());
}

#[test]
fn a_too_short_entity_name_does_not_ground() {
    let g = Graph::open_in_memory().unwrap();
    // A 2-char name is below the grounding floor — too noisy to act on.
    world::record_entity(&g, world::entity_kind::TOPIC, "ai").unwrap();
    assert!(!world::mentions_known_entity(&g, "ai winter is coming").unwrap());

    // A 3-char name clears the floor and grounds on a whole word.
    world::record_entity(&g, world::entity_kind::PROJECT, "eri").unwrap();
    assert!(world::mentions_known_entity(&g, "ship eri today").unwrap());
}
