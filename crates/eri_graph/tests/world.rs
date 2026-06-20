//! World-model layer over the eri_graph property graph: entities (people,
//! projects, apps…), relations between them, bi-temporal validity, and
//! provenance back to the observations that evidenced them. These tests
//! exercise the public `eri_graph::world` API only — behavior, not storage.

use eri_graph::{Graph, world};

#[test]
fn relates_a_person_to_a_project_and_finds_what_they_work_on() {
    let g = Graph::open_in_memory().unwrap();

    let priya = world::record_entity(&g, world::entity_kind::PERSON, "Priya Nair").unwrap();
    let billing = world::record_entity(&g, world::entity_kind::PROJECT, "billing rewrite").unwrap();
    world::relate(&g, &priya, &billing, world::relation::COLLABORATES_ON).unwrap();

    // "what does Priya work on?"
    let projects = world::related(&g, &priya, world::relation::COLLABORATES_ON).unwrap();

    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].canonical_name(), "billing rewrite");
    assert_eq!(projects[0].kind(), world::entity_kind::PROJECT);
}

#[test]
fn an_ended_relation_is_hidden_now_but_answerable_as_of_the_past() {
    let g = Graph::open_in_memory().unwrap();
    let me = world::record_entity(&g, world::entity_kind::PERSON, "Khai").unwrap();
    let proj = world::record_entity(&g, world::entity_kind::PROJECT, "old project").unwrap();

    // The relation became true at t=100 and stopped being true at t=200.
    world::relate_at(&g, &me, &proj, world::relation::COLLABORATES_ON, 100).unwrap();
    world::end_relation(&g, &me, &proj, world::relation::COLLABORATES_ON, 200).unwrap();

    // As of "now" (far future), the ended relation is invisible.
    let now = world::related_as_of(&g, &me, world::relation::COLLABORATES_ON, 1_000).unwrap();
    assert!(
        now.is_empty(),
        "an ended relation must not surface as current"
    );

    // As of t=150 (while it held), it's answerable — bi-temporal recall.
    let past = world::related_as_of(&g, &me, world::relation::COLLABORATES_ON, 150).unwrap();
    assert_eq!(past.len(), 1);
    assert_eq!(past[0].canonical_name(), "old project");
}

#[test]
fn an_entitys_supporting_observations_are_retrievable_as_evidence() {
    let g = Graph::open_in_memory().unwrap();
    let priya = world::record_entity(&g, world::entity_kind::PERSON, "Priya Nair").unwrap();
    let obs = world::record_observation(&g, "Priya prefers a 7pm table").unwrap();

    // The observation is the evidence for what eri believes about Priya.
    world::evidences(&g, &obs, &priya).unwrap();

    let evidence = world::evidence_for(&g, &priya).unwrap();
    assert_eq!(evidence.len(), 1);
    assert!(evidence[0].text().contains("7pm"));
}

#[test]
fn upserting_the_same_entity_twice_resolves_to_one() {
    let g = Graph::open_in_memory().unwrap();

    // The reflection pass re-sees the same person under a casing variant.
    let a = world::upsert_entity(&g, world::entity_kind::PERSON, "Priya Nair").unwrap();
    let b = world::upsert_entity(&g, world::entity_kind::PERSON, "  priya nair ").unwrap();

    assert_eq!(
        a, b,
        "the same person must resolve to one entity (idempotent)"
    );
    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn upsert_keeps_distinct_names_and_kinds_separate() {
    let g = Graph::open_in_memory().unwrap();

    world::upsert_entity(&g, world::entity_kind::PERSON, "Priya").unwrap();
    world::upsert_entity(&g, world::entity_kind::PERSON, "Sam").unwrap();
    // Same text, different kind: a project named "Priya" is not the person.
    world::upsert_entity(&g, world::entity_kind::PROJECT, "Priya").unwrap();

    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PROJECT)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn evidence_from_many_observations_accumulates_on_one_resolved_entity() {
    let g = Graph::open_in_memory().unwrap();

    // The reflection pass sees Priya across two separate observations.
    let o1 = world::record_observation(&g, "Priya prefers a 7pm table").unwrap();
    let p1 = world::link_evidence(&g, &o1, world::entity_kind::PERSON, "Priya Nair").unwrap();

    let o2 = world::record_observation(&g, "priya leads the billing rewrite").unwrap();
    let p2 = world::link_evidence(&g, &o2, world::entity_kind::PERSON, "priya nair").unwrap();

    // One Priya, two pieces of evidence.
    assert_eq!(p1, p2, "both observations resolve to the same person");
    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(world::evidence_for(&g, &p1).unwrap().len(), 2);
}

#[test]
fn a_single_char_typo_in_a_long_name_resolves_to_the_same_entity() {
    let g = Graph::open_in_memory().unwrap();

    let a = world::upsert_entity(&g, world::entity_kind::PERSON, "Priya").unwrap();
    // "Pirya" — adjacent transposition, a one-edit typo of a 5-char name.
    let b = world::upsert_entity(&g, world::entity_kind::PERSON, "Pirya").unwrap();

    assert_eq!(
        a, b,
        "a one-char typo of a long name must resolve to one entity"
    );
    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .len(),
        1
    );
    // the variant is remembered as an alias, so it's an exact hit next time
    let c = world::upsert_entity(&g, world::entity_kind::PERSON, "pirya").unwrap();
    assert_eq!(a, c);
}

#[test]
fn related_in_finds_who_collaborates_on_a_project() {
    let g = Graph::open_in_memory().unwrap();
    let alice = world::record_entity(&g, world::entity_kind::PERSON, "Alice").unwrap();
    let bob = world::record_entity(&g, world::entity_kind::PERSON, "Bob").unwrap();
    let eri = world::record_entity(&g, world::entity_kind::PROJECT, "eri").unwrap();
    world::relate(&g, &alice, &eri, world::relation::COLLABORATES_ON).unwrap();
    world::relate(&g, &bob, &eri, world::relation::COLLABORATES_ON).unwrap();

    // "who do I work with on eri?" — the inverse of `related`.
    let collaborators = world::related_in(&g, &eri, world::relation::COLLABORATES_ON).unwrap();
    let names: Vec<&str> = collaborators.iter().map(|e| e.canonical_name()).collect();
    assert_eq!(collaborators.len(), 2);
    assert!(names.contains(&"Alice") && names.contains(&"Bob"));
}

#[test]
fn related_in_excludes_a_collaboration_that_has_since_ended() {
    let g = Graph::open_in_memory().unwrap();
    let alice = world::record_entity(&g, world::entity_kind::PERSON, "Alice").unwrap();
    let carol = world::record_entity(&g, world::entity_kind::PERSON, "Carol").unwrap();
    let eri = world::record_entity(&g, world::entity_kind::PROJECT, "eri").unwrap();

    // Carol's collaboration lived entirely in the past [100, 200); Alice's is
    // open-ended from "now". A current "who works on eri" must list only Alice.
    world::relate_at(&g, &carol, &eri, world::relation::COLLABORATES_ON, 100).unwrap();
    world::end_relation(&g, &carol, &eri, world::relation::COLLABORATES_ON, 200).unwrap();
    world::relate(&g, &alice, &eri, world::relation::COLLABORATES_ON).unwrap();

    let now = world::related_in(&g, &eri, world::relation::COLLABORATES_ON).unwrap();
    let names: Vec<&str> = now.iter().map(|e| e.canonical_name()).collect();
    assert_eq!(
        names,
        vec!["Alice"],
        "an ended collaboration is no longer current"
    );
}

#[test]
fn open_at_persists_to_an_explicit_path_and_reopens() {
    // The world model opens at an explicit file (not the workspace convention);
    // entities written through one handle survive a reopen of the same file.
    let path =
        std::env::temp_dir().join(format!("eri-world-open-at-{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&path);

    {
        let g = Graph::open_at(&path).unwrap();
        world::record_entity(&g, world::entity_kind::PROJECT, "eri").unwrap();
    }
    let reopened = Graph::open_at(&path).unwrap();
    assert!(
        world::entities_of_kind(&reopened, world::entity_kind::PROJECT)
            .unwrap()
            .iter()
            .any(|e| e.canonical_name() == "eri"),
        "an entity written to an explicit-path graph survives a reopen"
    );

    drop(reopened);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn find_entity_resolves_by_name_without_creating() {
    let g = Graph::open_in_memory().unwrap();
    world::record_entity(&g, world::entity_kind::PROJECT, "eri").unwrap();

    // Resolves on a trimmed, case-insensitive match.
    let found = world::find_entity(&g, world::entity_kind::PROJECT, "  ERI ").unwrap();
    assert_eq!(
        found.map(|e| e.canonical_name().to_string()),
        Some("eri".into())
    );

    // A miss returns None and creates nothing (unlike upsert_entity).
    assert!(
        world::find_entity(&g, world::entity_kind::PROJECT, "nope")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PROJECT)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn fuzzy_matching_does_not_merge_distinct_short_names() {
    let g = Graph::open_in_memory().unwrap();

    // "Sam" vs "Pam": one substitution apart, but short + different first
    // letter — merging them would corrupt the world model. Must stay separate.
    world::upsert_entity(&g, world::entity_kind::PERSON, "Sam").unwrap();
    world::upsert_entity(&g, world::entity_kind::PERSON, "Pam").unwrap();

    assert_eq!(
        world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .len(),
        2
    );
}
