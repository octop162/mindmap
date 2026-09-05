# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
make dev      # npm install (if package.json is newer than node_modules) then `vite` dev server
make build    # npm install (if needed) then `vite build` -> dist/
make preview  # serve the built dist/ locally
make clean    # rm -rf node_modules dist
```

These wrap the plain `npm run dev|build|preview` scripts in `package.json`. There is no lint or test setup in this repo — don't invent one.

To manually exercise the app after a change, start `make dev` and drive it with a real browser (Playwright/headless Chromium works well here); there's no automated test suite to lean on instead.

## Architecture

This is a single-page mind-mapping editor: one React class component (`src/App.jsx`, ~1150 lines) rendering into `src/main.jsx`, styled by `src/styles.css` (design-system tokens/components) + `src/app.css` (page-specific overrides). No router, no other components, no state library — everything lives in `MindMapApp`'s state and methods.

**Origin note:** this app began as a Claude Design "design canvas" prototype (`.dc.html`, a custom template DSL rendered by a `dc-runtime`) and was ported into a plain Vite + React app. The original prototype's `renderVals()` method — which computed a flat object of template values every render — was kept almost verbatim; `render()` just destructures `const v = this.renderVals()` and builds real JSX from it instead of feeding it through the old template compiler. If you're touching rendering, `renderVals()` is where node/edge geometry and styling get computed, `render()` is pure layout of what `renderVals()` produced.

### Data model and layout

- Node tree: `state.nodes` is a flat `{id: {id, text, parent, children[], collapsed}}` map; `state.rootId` points at the root. `buildSeed()` builds this from the literal `SEED` array at the top of the file.
- `layout()` recomputes every node's `{x, y, w, h, depth, sign, vert}` from scratch on every render (no memoization) based on `state.dir` (both-h/right/both-v/down). For a "both" direction, root's children are split into two alternating groups (even/odd index → opposite sides) — inserting a sibling shifts the even/odd parity of everything after it, which can flip later siblings to the other side. This is a known, accepted quirk, not a bug to silently "fix" if you notice it.
- `descendants(nodes, id)` walks the **full** tree regardless of `collapsed` — it does not know about layout. `layout()`'s cross-axis shift step guards every access with `if (pos[d])` specifically because collapsed branches never get a `pos[]` entry; removing that guard reintroduces a crash when collapsing a node.
- Text measurement (`measure()`/`wrapLines()`) uses an offscreen `<canvas>` 2D context (`this.mctx`) with a cache (`this.mcache`, cleared on theme changes) keyed by font-size/weight/text.
- Undo/redo is a plain snapshot stack (`state.past`/`state.future`, JSON string snapshots of `{nodes, rootId, sel}`, capped at 80).

### Theming

`state.theme = {ink, shape, edge, size, invert, svgTransparentBg}`.

- **ink**: `paper|cyan|magenta|yellow|green|purple` each look up a `{solid, text, edge, ring}` quad in the `INK` map (values are `var(--color-*)` refs into `styles.css`). `multi` ("カラフル") is different: each of the root's direct children gets its own color from `MULTI_PALETTE`, inherited by that branch's entire subtree via `branchAncestor()` (walk up to the root's direct child) + `branchColorOf()`. **Branch→color assignment is sticky**, cached on the instance in `this._branchColors`/`this._branchColorSeq` and only ever added to, never recomputed from a branch's current sibling index — an earlier index-based version caused unrelated branches to swap colors whenever a sibling was added/removed/dragged elsewhere. Root itself always resolves to `INK.paper` in multi mode (a node has no branch ancestor).
- **invert**: normally only the root renders as a solid filled "chip" (ink-colored, light text); depth-1 nodes just get colored text on the regular `shape`. Inverting swaps this: depth-1 becomes the chip (in its own ink/branch color) and the root becomes a fixed neutral `INK.paper` anchor. The chip look ignores `shape` entirely for whichever depth has it, same as the root always did.
- **shape**: `box|underline|bare`, decided per-node in the `nodeViews` builder inside `renderVals()`.
- Selection ring visibility (`selVisible`) is separate from `sel` itself — `sel` always points at a real node (every editing method assumes this and will throw on `null`), so "click empty canvas to deselect" only toggles whether the ring renders, not the underlying selection.

### Mermaid sync

`toMermaid()`/`fromMermaid()` only speak the indented `mindmap` dialect (flowchart support was deliberately removed). The sidebar's source textarea always reflects live state (`s.srcDirty ? s.src : this.toMermaid()`) unless the user is actively typing in it, and "反映" round-trips through `fromMermaid()` to rebuild the node tree.

### SVG export

`buildSvg()` does **not** serialize the DOM (nodes are absolutely-positioned `<div>`s, not SVG) — it independently re-derives the same layout/ink/shape/invert decisions as `renderVals()`'s node/edge builders, but resolving every `var(--color-*)` (including `color-mix()` values) to a concrete `rgb()`/`rgba()` string via a hidden probe element (`resolveColor()`), and wrapping text itself with the canvas context (`wrapLines()`) since SVG `<text>` doesn't wrap. If you change how nodes/edges are colored or shaped in `renderVals()`, check whether `buildSvg()` needs the equivalent change — the two are intentionally independent implementations, not shared code.

### Persistence — three separate localStorage keys, don't conflate them

- `mm-doc-v1` (`STORE`): the document itself (nodes/rootId/seq + theme/dir as a convenience bundle). Only written/read on the explicit 保存/読み込み buttons (`saveLocal()`/`loadLocal()`) — a user-controlled checkpoint, independent of autosave below.
- `mm-settings-v1` (`SETTINGS_STORE`): UI/theme preferences (theme, dir, sidebarWidth, sidebarOpen). Auto-saved on every relevant change via `componentDidUpdate` (reference/value comparison against `prevState`), auto-loaded in the constructor via `loadSettings()`. Current defaults (when nothing is saved) are ink=`multi`, invert=`true`, svgTransparentBg=`true`, size=`lg`, edge=`curve`, dir=`both-h`.
- `mm-autosave-v1` (`AUTOSAVE_STORE`): a silent, debounced (800ms, via `scheduleAutosave()`) backup of just `{nodes, rootId, seq}`, written whenever `componentDidUpdate` sees any of those three change, and flushed immediately on `beforeunload`/unmount so a closed tab loses at most the in-flight debounce window. Auto-loaded in the constructor via `loadAutosave()` (which validates `nodes[rootId]` exists, falling back to `buildSeed(SEED)` on anything missing/corrupt) — this is what the app opens with on a fresh reload, not the seed, unless nothing has ever been autosaved. A toast ("自動保存から復元しました") fires once on mount when this path was taken. It intentionally does not carry theme/dir (already covered by `SETTINGS_STORE`) and is never touched by the manual 保存/読み込み buttons.
- Boolean settings that default to `true` (`invert`, `svgTransparentBg`) must be read back with an explicit `!== undefined` check, not `||` — `||` would silently stomp an explicitly-saved `false` back to the `true` default on the next load.

### Event wiring gotcha

Per-node callback refs (`n.inputRef`, used to focus+select a node's `<input>` when it starts editing) must **not** be a fresh closure created inline inside `renderVals()`. Because `renderVals()` reruns on every render, a fresh `ref` function every time makes React treat it as a detach+reattach of the DOM node on every keystroke, which re-ran the `.focus()/.select()` and clobbered typed text after 1-2 characters. The fix is `inputRef(id)`, which caches one stable closure per node id (`this._inputRefs`) — keep using that pattern for any future per-node ref callback.
