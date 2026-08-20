# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body-file <path>`
- Read: `gh issue view <number> --comments --json number,title,body,labels,comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body "..."`
- Add or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Run commands inside this checkout so `gh` infers `designmatty/chromashift` from the Git remote.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Set this flag to `yes` if the repo later treats external pull requests as requests for triage.

When enabled:

- Read a pull request with `gh pr view <number> --comments` and `gh pr diff <number>`.
- List external pull requests with `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`.
- Keep authors whose association is `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`.
- Exclude `OWNER`, `MEMBER`, and `COLLABORATOR`.
- Use `gh pr comment`, `gh pr edit`, and `gh pr close` for changes.

GitHub shares one number space across issues and pull requests. For a bare reference such as `#42`, try `gh pr view 42`, then fall back to `gh issue view 42`.

## Skill operations

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," run:

```text
gh issue view <number> --comments --json number,title,body,labels,comments
```

## Wayfinding operations

A wayfinding map is one issue with child issues as tickets.

- Map: label one issue `wayfinder:map`. Its body holds Notes, Decisions so far, and Fog.
- Child: link an issue as a GitHub sub-issue. If sub-issues are unavailable, add it to the map's task list and begin its body with `Part of #<map>`.
- Type: label each child `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use GitHub issue dependencies. If unavailable, begin the child body with `Blocked by: #<number>`.
- Frontier: choose the first open, unassigned child in map order with no open blockers.
- Claim: run `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the result, close the child, then add its context link to the map's Decisions so far.
