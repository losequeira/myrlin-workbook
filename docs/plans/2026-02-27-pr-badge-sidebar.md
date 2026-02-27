# PR Badge in Workspace Sidebar — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a clickable `#42` PR badge next to the branch name in each session item in the workspace sidebar when an open GitHub PR exists for that branch.

**Architecture:** Add a new server endpoint `GET /api/git/pr-status?dir=` that calls `gh pr view` and caches results. On the client, after the existing git-status async patch fills branch names into sidebar rows, fire a second async pass that fetches PR status and appends a badge `<a>` element to each row.

**Tech Stack:** Node.js/Express (server), vanilla JS (client), `gh` CLI (GitHub PR lookup), existing `session-badge` CSS classes.

---

### Task 1: Server — add `prStatusCache` and `GET /api/git/pr-status` endpoint

**Files:**
- Modify: `src/web/server.js` (after line 4599, alongside `gitStatusCache`)

**Step 1: Add the cache and endpoint**

In `src/web/server.js`, directly after the `gitStatusCache` eviction interval (after line ~4599), add:

```js
const PR_STATUS_CACHE_TTL = 30000; // 30 seconds
const prStatusCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of prStatusCache) {
    if (now - entry.ts > PR_STATUS_CACHE_TTL * 2) prStatusCache.delete(key);
  }
}, 60000).unref();

app.get('/api/git/pr-status', requireAuth, async (req, res) => {
  const dir = req.query.dir;
  if (!dir) return res.status(400).json({ error: 'dir query parameter required' });

  const cached = prStatusCache.get(dir);
  if (cached && Date.now() - cached.ts < PR_STATUS_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const out = await ghExec(['pr', 'view', '--json', 'number,url,state,title'], dir);
    const pr = JSON.parse(out);
    const result = { pr: { number: pr.number, url: pr.url, state: pr.state, title: pr.title } };
    prStatusCache.set(dir, { data: result, ts: Date.now() });
    return res.json(result);
  } catch {
    // No PR, gh not installed, or not a GitHub repo — all non-fatal
    const result = { pr: null };
    prStatusCache.set(dir, { data: result, ts: Date.now() });
    return res.json(result);
  }
});
```

**Step 2: Manual smoke test**

With the server running, open a terminal in a repo that has an open PR and run:
```bash
curl -s "http://localhost:3456/api/git/pr-status?dir=/path/to/repo" \
  -H "Cookie: <your-auth-cookie>"
```
Expected: `{"pr":{"number":42,"url":"https://github.com/...","state":"OPEN","title":"..."}}` or `{"pr":null}`.

**Step 3: Commit**

```bash
git add src/web/server.js
git commit -m "feat(server): add GET /api/git/pr-status endpoint with caching"
```

---

### Task 2: Client — add `fetchPRStatus` method and `prStatusCache` state

**Files:**
- Modify: `src/web/public/app.js`

**Step 1: Add `prStatusCache` to initial state**

Find the `state` object initializer (around line 100 where `gitStatusCache: {}` lives) and add:
```js
prStatusCache: {},
```

**Step 2: Add `fetchPRStatus(dir)` method**

After `fetchGitStatus` (around line 12751), add:

```js
async fetchPRStatus(dir) {
  if (!dir) return null;
  const cached = this.state.prStatusCache[dir];
  if (cached && Date.now() - cached.timestamp < 30000) return cached.data;
  try {
    const data = await this.api('GET', '/api/git/pr-status?dir=' + encodeURIComponent(dir));
    this.state.prStatusCache[dir] = { data, timestamp: Date.now() };
    return data;
  } catch {
    return null;
  }
}
```

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(client): add fetchPRStatus method and prStatusCache state"
```

---

### Task 3: Client — async PR patch in `renderWorkspaces`

**Files:**
- Modify: `src/web/public/app.js` (around line 7445, after the git-status async patch block)

**Step 1: Add the async PR badge patch**

After the closing `});` of the existing `gitDirs.forEach(...)` block (line ~7445), and before the cost-fetch block, add:

```js
// Async patch: fetch PR status for dirs that have a branch rendered
gitDirs.forEach(dir => {
  this.fetchPRStatus(dir).then(prInfo => {
    if (!prInfo || !prInfo.pr) return;
    const pr = prInfo.pr;
    list.querySelectorAll(`.ws-session-git-row[data-git-dir="${CSS.escape(dir)}"]`).forEach(el => {
      // Don't add duplicate badge
      if (el.querySelector('.ws-pr-badge')) return;
      // Only add badge if a branch span is present (git status already resolved)
      if (!el.querySelector('.ws-session-git-branch')) return;
      const a = document.createElement('a');
      a.className = 'ws-pr-badge session-badge session-badge-pr';
      a.href = pr.url;
      a.target = '_blank';
      a.title = `PR #${pr.number}: ${pr.title} (${pr.state})`;
      a.textContent = `#${pr.number}`;
      a.style.cssText = 'background:color-mix(in srgb, var(--green) 15%, transparent);color:var(--green);text-decoration:none;cursor:pointer;margin-left:6px;';
      a.addEventListener('click', e => e.stopPropagation());
      el.appendChild(a);
    });
  });
});
```

**Step 2: Verify in the browser**

1. Run the server: `node src/web/server.js` (or however you start it)
2. Open the app in the browser
3. Navigate to a workspace whose session's working dir has an open GitHub PR
4. Expand the workspace — the branch row should show `⎇ my-branch*  #42`
5. Click the `#42` badge — it should open the PR URL in a new tab
6. Clicking the session item itself (not the badge) should still select the session normally

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(ui): show clickable PR badge next to branch name in sidebar"
```

---

### Task 4: Edge cases — verify correct behavior

**Manual checks (no code changes needed unless a bug is found):**

1. **No `gh` installed or not a GitHub remote** — badge should simply not appear (server returns `{ pr: null }`, client skips)
2. **Multiple sessions in the same working dir** — both should get the badge (the `querySelectorAll` handles this)
3. **Switching workspaces** — `renderWorkspaces` re-runs, async patches re-fire; stale cache (30s TTL) is acceptable
4. **Badge not duplicated on re-render** — the `if (el.querySelector('.ws-pr-badge')) return;` guard handles this
5. **Git status not yet resolved when PR patch fires** — the `if (!el.querySelector('.ws-session-git-branch')) return;` guard means no badge until branch is shown; both fetches run concurrently so in practice branch is usually present first (git status is faster than a GH API call)

If any edge case fails, fix and commit with `fix(ui): <description>`.
