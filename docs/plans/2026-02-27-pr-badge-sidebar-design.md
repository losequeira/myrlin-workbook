# PR Badge in Workspace Sidebar

**Date:** 2026-02-27
**Status:** Approved

## Goal

Show a clickable PR badge next to the branch name in each session item in the workspace sidebar, when an open GitHub pull request exists for that branch.

## Approach

Option A: piggyback on the existing async git-status patch pattern. After the branch row is filled in, fire a second async pass to fetch PR info per unique working dir.

## Server

### New endpoint: `GET /api/git/pr-status?dir=<path>`

- Runs: `gh pr view --json number,url,state,title` in the given directory
- Uses the existing `ghExec` helper
- Cached server-side in a `prStatusCache` Map with a 30s TTL per dir
- Returns `{ pr: { number, url, state, title } }` if an open PR exists
- Returns `{ pr: null }` if no PR, `gh` not installed, or any error

## Client

### `fetchPRStatus(dir)` method

- Mirrors `fetchGitStatus` pattern
- Caches in `this.state.prStatusCache[dir]` with a TTL
- Calls `GET /api/git/pr-status?dir=<dir>`

### Async second pass in `renderWorkspaces()`

After the existing git-status async patch loop, add a second loop:
- Collect all unique `data-git-dir` values from `.ws-session-git-row` elements that have a branch span rendered
- For each dir, call `fetchPRStatus(dir)`
- On result, find `.ws-session-git-row[data-git-dir="..."]` and append a `<a class="ws-pr-badge">` element if `pr` is non-null

### DOM change to `ws-session-git-row`

Add `data-branch="<branch>"` attribute to the git row element to enable branch-aware cache keying if needed in the future.

## UI

Badge renders inline after the branch span:

```
⎇ SUNNY-651-fix-bulk-contact-failures*  #42
```

- Element: `<a class="ws-pr-badge" href="<pr-url>" target="_blank">#<number></a>`
- `stopPropagation()` on click so it doesn't trigger session selection
- Styled as a small muted chip (similar to existing session-badge style)

## Out of Scope

- Live PR status polling
- Draft vs open PR distinction
- PR creation from the badge
