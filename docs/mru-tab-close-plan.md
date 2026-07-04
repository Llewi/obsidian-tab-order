# Plan: activate most-recently-used tab on tab close

## 1. Desired behavior

Today, closing a tab in Obsidian activates a sibling tab chosen by position (typically
the tab to the right, or the leftmost/last remaining tab if there is no tab to the
right). This plugin should instead activate whichever *other* tab in the same tab
group was active most recently, before the closed tab. This mirrors the "most
recently used" tab switching found in browsers like Firefox/Arc rather than the
positional switching in Chrome.

Scope of "tab group": Obsidian can split the workspace into several tab groups
(side-by-side panes), plus sidebars and popout windows. The MRU replacement must be
computed **within the tab group the closed tab belonged to** — closing a tab in the
left split must never activate a tab from the right split or a sidebar.

## 2. Confirmed API surface (as of Obsidian's current public docs)

Sources: [Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace),
[WorkspaceLeaf](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf),
[getMostRecentLeaf](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/getMostRecentLeaf).

- `workspace.on('active-leaf-change', (leaf) => …)` — fires whenever the active leaf
  changes (including opening files, switching tabs, closing a tab and Obsidian
  auto-selecting a replacement). This is the only reliable hook for building an MRU
  order ourselves.
- `workspace.on('layout-change', …)` — fires on broader layout mutations (split
  added/removed, tab added/removed, etc.). No payload identifying what changed.
- `WorkspaceLeaf.detach()` — the method that closes/removes a leaf. **There is no
  documented `before-close` or `leaf-closed` event.** Detach just happens, and
  Obsidian's internal tab-group code picks the next active leaf synchronously as
  part of that call.
- `WorkspaceLeaf.parent` — "the direct parent of the leaf." On desktop this is
  always a `WorkspaceTabs` instance; on mobile it can be a `WorkspaceMobileDrawer`.
  Public typings only expose this as `WorkspaceParent`, not the internal
  `WorkspaceTabs` shape (children array, current tab index, etc.) — that's private.
- `workspace.getMostRecentLeaf(root?)` — returns Obsidian's own idea of "the most
  recently active leaf," scoped to a `WorkspaceParent` root if given. This tracks a
  single most-recent leaf per root internally, but it is **not exposed as a stack**
  and is not what drives close-time tab selection today (confirmed by the reported
  bug behavior: closing a tab activates a positional sibling, not the MRU one).
  It's useful as a possible fallback/cross-check, not as the primary mechanism.
- Documented `WorkspaceLeaf` events are limited to `'pinned-change'` and
  `'group-change'` — nothing about closing.

**Conclusion**: there is no public, documented hook that runs *before* Obsidian
selects the replacement active tab. To override the selection, the plugin must
either (a) correct the active leaf *after* the fact (reactive), or (b) monkey-patch
`WorkspaceLeaf.prototype.detach` to intervene at the right moment (proactive).
Approach (b) is what the Obsidian plugin ecosystem does for this class of problem.

## 3. Prior art

- `monkey-around` (npm) is the de-facto standard library the Obsidian plugin
  ecosystem uses to patch internal/undocumented methods safely: it wraps a method,
  returns an "uninstall" function (call in `onunload`), and provides a `dedupe()`
  helper so two plugins patching the same method don't stack conflicting wrappers.
- `obsidian-typings` (community project, github.com/Fevol/obsidian-typings) publishes
  TypeScript typings for the undocumented internals (`WorkspaceTabs`, its `children`
  array, `currentTab`, etc.). Using it as a `devDependency` gives type safety for the
  internal casts this plugin needs, without vendoring guesses.
- No existing community plugin implements exactly this (checked "Auto Close Oldest
  Tabs", "Advanced Close Tab", tab-history/reopen plugins, and forum feature
  requests — e.g. ["Option to cycle through tabs in recently used
  order"](https://forum.obsidian.md/t/option-to-cycle-through-tabs-in-recently-used-order/47891)
  is an open/archived request, not shipped). This plugin would fill a real gap, but
  also means there's no reference implementation to copy — the design below is novel
  and needs empirical verification in a real vault (see §6).

## 4. Chosen design

### 4.1 MRU tracking

- Maintain a `Map<WorkspaceTabs, WorkspaceLeaf[]>` (most-recent-first array) built
  entirely from `active-leaf-change`:
  - On event, find `leaf.parent` (cast to the internal tab-group type). Remove the
    leaf from that group's array if already present, then unshift it to the front.
  - Lazily create the array for a group on first sight; drop empty arrays.
- Prune stale entries opportunistically: before reading a group's stack, filter out
  leaves whose `.parent` no longer equals that group (they were moved/closed).
- Scope per window implicitly falls out of scoping per `WorkspaceTabs` — a tab
  group object is unique to its window, so popout windows need no special-casing
  here.

### 4.2 Intercepting close

- Use `monkey-around`'s `around()` to wrap `WorkspaceLeaf.prototype.detach`:
  1. Before calling the original: read `leaf.parent` (the tab group) and whether
     `leaf` is currently the group's active/visible tab.
  2. Call the original `detach()` — Obsidian removes the tab and (if it was active)
     synchronously assigns some other leaf as active per its default positional
     rule.
  3. If the closed leaf *was* active and the group still has remaining children,
     look up that group's MRU stack (built in §4.1, excluding the now-detached
     leaf), take the first entry that is still a live child of the group, and call
     `this.app.workspace.setActiveLeaf(mruLeaf, { focus: true })` to override
     Obsidian's choice.
  4. If no MRU entry exists (e.g. plugin just loaded, or the only other tabs were
     never focused this session), do nothing — fall back to Obsidian's default
     positional pick silently.
- Register the patch with `around`'s `dedupe(key, prototype, patches)` form so a
  second copy of the plugin (or another plugin patching `detach`) doesn't double-wrap
  it; store the returned uninstall function and call it in `onunload`.
- Because both the original `detach()` and the corrective `setActiveLeaf()` run
  synchronously in the same JS turn, there should be no visible flicker of the
  "wrong" tab before the correction lands. **Confirmed by spike** (§5.1): the new
  `activeLeaf` is already committed by the time the original `detach()` returns,
  while the `'active-leaf-change'` event notifying listeners fires afterward
  (deferred). Calling `setActiveLeaf()` immediately after `next.call(this)` lands
  before that event is dispatched, so downstream listeners (tab-bar highlighting,
  etc.) only ever observe the corrected leaf.
- Use `leaf.parent instanceof WorkspaceTabs` (importing the real `WorkspaceTabs`
  class from `obsidian`), never `parent.constructor.name` — **confirmed by spike**
  that class names are mangled in the production bundle (`parentType` read back as
  `"t"`).

### 4.3 Settings

- Single boolean toggle: "Activate most recently used tab when closing a tab"
  (default on) — lets users disable and fall back to stock behavior if the patch
  ever misbehaves after an Obsidian update.
- No per-scope options planned initially (global vs. per-group) — per-group is the
  only behavior that makes sense; a global MRU would leak focus across splits.

### 4.4 File layout (per this repo's `AGENTS.md` conventions)

```
src/
  main.ts                 # onload/onunload, wires everything together
  settings.ts             # MruTabSettings interface, defaults, settings tab
  tab-mru/
    mru-tracker.ts         # Map<WorkspaceTabs, WorkspaceLeaf[]> + active-leaf-change listener
    detach-patch.ts        # around() patch of WorkspaceLeaf.prototype.detach
    types.ts               # thin internal-API type shims (or import from obsidian-typings)
```

- Add `monkey-around` as a runtime dependency and `obsidian-typings` as a
  devDependency in `package.json`.
- `manifest.json`: new `id`/`name` (e.g. `mru-tab-close` / "MRU tab close"),
  `isDesktopOnly: true` initially (see §5), version `0.1.0`.

## 5. Open questions / risks

### 5.1 Spike results (resolved)

A logging-only patch of `WorkspaceLeaf.prototype.detach` plus `active-leaf-change`/
`layout-change` listeners was installed in a scratch vault (`test-vault/`, gitignored)
and exercised manually. Full console log: this was captured once during the session
and is not preserved in the repo (scratch vault contents are gitignored by design).
Findings:

- **× click, middle-click, and `Ctrl+W` all call `WorkspaceLeaf.prototype.detach()`.**
  Confirmed directly — `detach:before`/`detach:after` fired for all three.
- **"Close other tabs" calls `detach()` once per closed leaf, in a loop, with no
  `active-leaf-change` between individual calls** — only one fires at the end, for
  the surviving tab. Verified with 3 tabs open (B active target, closing "others" C
  and D): two back-to-back `detach:before`/`after` pairs (C, then D), then a single
  `active-leaf-change` for B.
- **Bulk-close is safe under the "only correct if the closed leaf was active" guard**:
  in the "close others" trace, C's close was a background close (C wasn't active,
  so correction would no-op), and D's close *was* the active leaf being closed, so
  correction would fire — but since B was the only leaf left, the MRU pick and
  Obsidian's own default pick necessarily agree. No conflicting/duplicate
  `setActiveLeaf` churn observed. (A scenario with 3+ remaining tabs after a bulk
  close, e.g. "close tabs to the right" with 2+ survivors, was not tested — flagged
  below as the one residual bulk-close variant worth a quick check during
  implementation, but the mechanism already generalizes: correction always reads
  the MRU stack *after* the default detach completes and filters to leaves still
  present, so redundant-but-harmless corrections are the expected worst case, not
  incorrect ones.)
- **No flicker risk** — see §4.2 above; `activeLeaf` is committed synchronously
  inside `detach()`, before the `active-leaf-change` event dispatches.
- **`constructor.name` is mangled in the production bundle** (read back as `"t"`
  for `WorkspaceTabs`) — implementation must use `instanceof WorkspaceTabs` against
  the real imported class, never name-string matching.
- **Sidebar panes (file explorer, search, bookmarks) are also `WorkspaceTabs`
  instances** with their own `children`/tab-switching. The per-`WorkspaceTabs`-keyed
  MRU map will transparently also track sidebar tab groups — harmless and arguably
  a nice bonus, but worth a sanity check that closing a sidebar tab behaves
  reasonably too (not a launch blocker).

### 5.2 Still open

1. **Mobile applicability** — not tested (spike was desktop-only). `WorkspaceLeaf.parent`
   can be `WorkspaceMobileDrawer`, and it's still unclear the "close tab → pick
   sibling" problem exists in the same form on mobile. Recommend shipping
   `isDesktopOnly: true` for v1 and revisiting later.
2. **Command palette "Close current tab" and split-pane/popout scoping** — not
   exercised in the spike. Low risk (the command almost certainly calls the same
   `detach()`, and split/popout scoping falls out naturally from keying the MRU map
   by `WorkspaceTabs` instance rather than anything global) but worth a quick manual
   check during implementation rather than treating as fully proven.
3. **Internal API drift risk** — `WorkspaceTabs`'s internal shape (`children`,
   `currentTab`) is undocumented and can change between Obsidian releases. The
   patch and tracker must fail soft: wrap internal-shape reads in defensive checks,
   and skip correction (not throw) if the expected shape isn't found.
4. **Interaction with other plugins that patch `detach`** — using `dedupe()` avoids
   double-patching the exact same logical patch, but another plugin patching
   `detach` differently is still a possible source of conflicts. No general fix
   beyond being a well-behaved, idempotent wrapper.
5. **Pinned tabs / non-file views** — MRU tracking should work identically for
   pinned tabs and non-markdown views (PDF, image, graph view, etc.) since it keys
   off `WorkspaceLeaf` generically, not file identity. Worth a manual test case.

## 6. Manual test matrix (no automated UI test harness exists for this)

Perform in a scratch vault after `npm run dev` + linking the build into
`<Vault>/.obsidian/plugins/<id>/`:

| # | Setup | Action | Expected result |
|---|-------|--------|------------------|
| 1 | 3 tabs A, B, C (opened in that order, C active) | Visit A, then close C via × | B becomes active (only remaining choice) |
| 2 | 3 tabs A, B, C; visit order A→C→B (B active) | Close B via `Ctrl+W` | C becomes active (last visited before B), not A |
| 3 | Same as #2 | Close via command palette "Close current tab" | Same as #2 |
| 4 | 3 tabs, visit order A→C→B | Close a **background** tab (not active), e.g. close A while B is active | B stays active; no change (sanity check we didn't break the no-op case) |
| 5 | Two splits, each with their own tabs | Close active tab in left split | Only left split's active tab changes, per that split's own MRU; right split untouched |
| 6 | Popout window with its own tabs | Close active tab in popout | MRU correction scoped to the popout window only |
| 7 | Pinned tab open alongside others | Close active unpinned tab with a pinned tab as the MRU candidate | Pinned tab can become active like any other MRU candidate |
| 8 | Fresh plugin load, tabs never focused via clicking (only just opened) | Close active tab | Falls back to Obsidian default gracefully, no error in console |
| 9 | "Close other tabs" on a group of 4 | — | No console errors; final active tab is reasonable (exact target TBD after spike) |
| 10 | Toggle setting off | Close a tab | Stock Obsidian positional behavior returns |

## 7. Suggested build order

1. Spike: temporary `console.log`-only patch of `detach()` to confirm which UI
   actions call it, and whether `leaf.parent` reliably exposes children/active tab
   info needed (§5, item 2). Adjust design if assumptions are wrong.
2. Implement `mru-tracker.ts` (pure logic, unit-testable without Obsidian if the
   tab-group type is abstracted behind a small interface).
3. Implement `detach-patch.ts` wiring the tracker's lookup into the `around()`
   patch, with the fail-soft guards from §5.
4. Wire into `main.ts` lifecycle + add the settings toggle.
5. Run the manual matrix in §6, focusing first on #1–#4 (single split) before
   multi-split/popout cases.
6. Decide on `isDesktopOnly` and bulk-close behavior based on spike findings.
