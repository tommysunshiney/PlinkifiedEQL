# Contributing to Plinkified EQL Command Center

## Golden Rule

> **Never break `main`.**

The `main` branch must always represent a stable, working version of
Plinkified EQL Command Center.

All development, experimentation, bug fixes, and incomplete features must
be performed on the `popstaculardev` branch or on another development
branch created from it.

---

## Branches

### `main`

The stable release branch.

Code may be merged into `main` only when:

- The application launches successfully.
- Existing working features remain functional.
- The new or changed feature has been tested.
- No known release-blocking bugs remain.
- The project is in a state we would be comfortable distributing.

Direct development commits should not be made to `main`.

### `popstaculardev`

The primary development branch.

Use this branch for:

- New features
- Interface changes
- Parser development
- Experiments
- Bug fixes
- Documentation updates related to active development

Temporary breakage is acceptable here while work is in progress.

---

## Development Workflow

1. Confirm the active branch is `popstaculardev`.
2. Make one understandable change at a time.
3. Test the affected feature.
4. Commit the change with a clear description.
5. Push the development branch to GitHub.
6. Continue testing until the milestone is stable.
7. Merge into `main` only after the release checklist is satisfied.

---

## Pre-Merge Checklist

Before merging `popstaculardev` into `main`:

- [ ] The application launches without errors.
- [ ] Core navigation and controls work.
- [ ] Existing features still work.
- [ ] The new feature behaves as intended.
- [ ] Settings and saved data have been checked.
- [ ] No personal logs, screenshots, exports, or local data are included.
- [ ] Documentation and version information are current.
- [ ] We agree that the build is stable enough for release.

If any item is uncertain, do not merge yet.

---

## Project Principle

Working software comes before unfinished polish.

Ideas that are not ready for the current milestone should be recorded in
`Docs/feature_requests.md` rather than rushed into the stable branch.