# Domain docs

Engineering skills use a single domain context for this repository.

## Before exploring

Read these files when they exist and relate to the task:

- `CONTEXT.md` at the repository root
- Relevant architecture decision records under `docs/adr/`

Proceed without comment when either location does not exist. The domain-modeling workflow creates these files when the project resolves terminology or architecture decisions.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── apps/
└── packages/
```

`CONTEXT.md` defines the shared domain language for the Electron application, TypeScript packages, and native display service. `docs/adr/` holds repository-wide architecture decisions.

## Use the glossary

Use the terms defined in `CONTEXT.md` in issue titles, specifications, refactor proposals, hypotheses, and test names. Avoid synonyms that its glossary rejects.

If a required concept is missing, reconsider whether the term belongs to the project. Record genuine gaps for the domain-modeling workflow.

## Flag conflicts

Call out any proposal that contradicts an existing architecture decision record. Name the record and explain why the decision may need to be reopened.
