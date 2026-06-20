//! Proactive chains (Q16): weighted `next` paths between action nodes —
//! "after X you usually Y". Exercises the public `eri_graph::world` chain API.

use eri_graph::{Graph, world};

#[test]
fn repeated_transitions_strengthen_the_next_edge() {
    let g = Graph::open_in_memory().unwrap();
    // The user opens Safari, then usually clicks the address bar (twice), and
    // once opened Mail instead.
    world::link_next(&g, "open Safari", "click address bar").unwrap();
    world::link_next(&g, "open Safari", "click address bar").unwrap();
    world::link_next(&g, "open Safari", "open Mail").unwrap();

    let steps = world::next_steps(&g, "open Safari", 10).unwrap();
    assert_eq!(
        steps,
        vec![
            ("click address bar".to_string(), 2),
            ("open Mail".to_string(), 1),
        ],
        "the most-frequent successor ranks first, weighted by count"
    );
}

#[test]
fn a_self_transition_is_ignored_and_an_unknown_action_has_no_successors() {
    let g = Graph::open_in_memory().unwrap();
    // A→A is a no-op: a repeated action isn't a chain, and the graph has no
    // self-edges. The action node may exist, but it gains no successor.
    world::link_next(&g, "scroll down", "scroll down").unwrap();
    assert!(world::next_steps(&g, "scroll down", 10).unwrap().is_empty());
    // An action never seen has no successors (no fabrication).
    assert!(
        world::next_steps(&g, "never happened", 10)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn chains_extend_beyond_pairs() {
    let g = Graph::open_in_memory().unwrap();
    // A 3-step workflow seen twice: open editor → run tests → commit.
    for _ in 0..2 {
        world::link_next(&g, "open editor", "run tests").unwrap();
        world::link_next(&g, "run tests", "commit").unwrap();
    }
    assert_eq!(
        world::next_steps(&g, "open editor", 5).unwrap(),
        vec![("run tests".to_string(), 2)]
    );
    assert_eq!(
        world::next_steps(&g, "run tests", 5).unwrap(),
        vec![("commit".to_string(), 2)],
        "the chain continues a second hop — pairs compose into a path"
    );
}
