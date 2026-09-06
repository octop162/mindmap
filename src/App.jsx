import React from "react";

// Fresh-start tree: just a root, no sample content. buildSeed() still expects the
// [text, children[]] shape used elsewhere (paste, fromMermaid's tree building).
const SEED = ["", []];

const SIZES = {
  sm: { fs: 13, padX: 8, padY: 4, maxW: 168, along: 46, cross: 10 },
  md: { fs: 15, padX: 10, padY: 6, maxW: 200, along: 64, cross: 16 },
  lg: { fs: 18, padX: 12, padY: 8, maxW: 240, along: 80, cross: 22 }
};
const INK = {
  paper: { solid: "var(--color-text)", text: "var(--color-neutral-900)", edge: "var(--color-neutral-400)", ring: "var(--color-text)" },
  cyan: { solid: "var(--color-accent)", text: "var(--color-accent-700)", edge: "var(--color-accent-400)", ring: "var(--color-accent)" },
  magenta: { solid: "var(--color-accent-2)", text: "var(--color-accent-2-700)", edge: "var(--color-accent-2-400)", ring: "var(--color-accent-2)" },
  yellow: { solid: "var(--color-yellow-500)", text: "var(--color-yellow-700)", edge: "var(--color-yellow-400)", ring: "var(--color-yellow-500)" },
  green: { solid: "var(--color-green-500)", text: "var(--color-green-700)", edge: "var(--color-green-400)", ring: "var(--color-green-500)" },
  purple: { solid: "var(--color-purple-500)", text: "var(--color-purple-700)", edge: "var(--color-purple-400)", ring: "var(--color-purple-500)" }
};
// "multi" (カラフル) cycles through these per top-level branch instead of using one ink for the whole map.
const MULTI_PALETTE = ["cyan", "magenta", "green", "purple", "yellow"].map((k) => INK[k]);
const DIRS = {
  "both-h": { axis: "h", both: true }, right: { axis: "h", both: false },
  "both-v": { axis: "v", both: true }, down: { axis: "v", both: false }
};
const STORE = "mm-doc-v1";
// Separate from STORE: UI/theme preferences persist automatically on every change,
// unlike the document itself which only saves on an explicit 保存 click.
const SETTINGS_STORE = "mm-settings-v1";
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORE);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
// Separate again from both STORE and SETTINGS_STORE: a debounced, silent backup of
// the tree itself (nodes/rootId/seq only — theme/dir already autosave via
// SETTINGS_STORE), written on every edit so a crash/reload/closed-tab doesn't lose
// work the user never explicitly 保存'd. STORE stays a manual, user-controlled
// checkpoint independent of this.
const AUTOSAVE_STORE = "mm-autosave-v1";
function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_STORE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && d.nodes && d.rootId && d.nodes[d.rootId]) ? d : null;
  } catch (e) {
    return null;
  }
}
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 640;

function buildSeed(seed) {
  const nodes = {}; let seq = 1;
  const add = (item, parent) => {
    const id = "n" + (seq++);
    nodes[id] = { id, text: item[0], parent, children: [], collapsed: false };
    if (parent) nodes[parent].children.push(id);
    (item[1] || []).forEach((k) => add(k, id));
    return id;
  };
  const rootId = add(seed, null);
  return { nodes, rootId, seq };
}
function descendants(nodes, id) {
  const out = [];
  const walk = (i) => { out.push(i); (nodes[i] ? nodes[i].children : []).forEach(walk); };
  walk(id);
  return out;
}
function detach(nodes, id) {
  const p = nodes[id].parent;
  if (p && nodes[p]) nodes[p].children = nodes[p].children.filter((c) => c !== id);
}
function subtree(nodes, id) {
  const n = nodes[id];
  return { text: n.text, children: n.children.map((c) => subtree(nodes, c)) };
}
// Walks up from id to the root's direct child that contains it — the "branch" a
// node belongs to, for the colorful (multi-ink) theme. Returns null for the root itself.
function branchAncestor(nodes, rootId, id) {
  if (id === rootId) return null;
  let cur = id;
  while (nodes[cur].parent !== rootId) {
    cur = nodes[cur].parent;
    if (cur == null) return null;
  }
  return cur;
}

// Converts a CSS declaration string (as used throughout this component's
// inline styles) into the object form React's `style` prop requires.
function kebabToCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function styleObj(css) {
  if (!css) return undefined;
  const o = {};
  for (const decl of String(css).split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop) continue;
    o[prop.startsWith("--") ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
  }
  return o;
}

class MindMapApp extends React.Component {
  constructor(props) {
    super(props);
    const seed = buildSeed(SEED);
    const autosave = loadAutosave();
    this._restoredFromAutosave = !!autosave;
    const saved = loadSettings();
    const savedTheme = saved.theme || {};
    this.state = {
      nodes: autosave ? autosave.nodes : seed.nodes,
      rootId: autosave ? autosave.rootId : seed.rootId,
      seq: autosave ? (autosave.seq || 999) : seed.seq,
      sel: autosave ? autosave.rootId : seed.rootId, multiSel: [], selVisible: true, editing: null,
      pan: { x: 0, y: 0 }, zoom: 1,
      sidebarOpen: saved.sidebarOpen != null ? saved.sidebarOpen : this.props.sidebarOpen !== false,
      sidebarWidth: saved.sidebarWidth || 330,
      panel: "src",
      dir: saved.dir || this.props.direction || "both-h",
      theme: {
        ink: savedTheme.ink || this.props.ink || "multi",
        shape: savedTheme.shape || this.props.nodeShape || "box",
        edge: savedTheme.edge || this.props.edgeShape || "curve",
        size: savedTheme.size || this.props.textSize || "lg",
        invert: savedTheme.invert !== undefined ? savedTheme.invert : true,
        svgTransparentBg: savedTheme.svgTransparentBg !== undefined ? savedTheme.svgTransparentBg : true
      },
      past: [], future: [], clip: null,
      src: "", srcDirty: false, drop: null, ghost: null, toast: "", dragOverFile: false
    };
    this.mctx = document.createElement("canvas").getContext("2d");
    this.mcache = {};
    // Sticky branch -> palette-slot assignments for the "multi" (カラフル) ink theme.
    // Assigned once per branch id and never reassigned, so editing one branch never
    // recolors an unrelated one (see branchColorOf in renderVals).
    this._branchColors = {};
    this._branchColorSeq = 0;
  }

  componentDidMount() {
    this._key = (e) => this.onKeyDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    window.addEventListener("keydown", this._key);
    window.addEventListener("mousemove", this._move);
    window.addEventListener("mouseup", this._up);
    if (this.canvas) {
      this._wheel = (e) => this.onWheel(e);
      this.canvas.addEventListener("wheel", this._wheel, { passive: false });
    }
    setTimeout(() => { this.fit(); this.focusSel(); }, 60);
    if (this._restoredFromAutosave) this.toast("自動保存から復元しました");
    this._beforeUnload = () => this.autosave();
    window.addEventListener("beforeunload", this._beforeUnload);
    // A drop that misses the canvas (or isn't a Files drag at all) would otherwise
    // fall through to the browser's default "navigate to this file" behavior and
    // blow away the whole app. Swallow it at the window level as a backstop.
    this._winDragOver = (e) => e.preventDefault();
    this._winDrop = (e) => e.preventDefault();
    window.addEventListener("dragover", this._winDragOver);
    window.addEventListener("drop", this._winDrop);
  }
  componentWillUnmount() {
    window.removeEventListener("keydown", this._key);
    window.removeEventListener("mousemove", this._move);
    window.removeEventListener("mouseup", this._up);
    window.removeEventListener("beforeunload", this._beforeUnload);
    window.removeEventListener("dragover", this._winDragOver);
    window.removeEventListener("drop", this._winDrop);
    if (this.canvas && this._wheel) this.canvas.removeEventListener("wheel", this._wheel);
    clearTimeout(this._autosaveT);
    this.autosave();
  }
  componentDidUpdate(prevProps, prevState) {
    if (prevState.theme !== this.state.theme || prevState.dir !== this.state.dir
      || prevState.sidebarWidth !== this.state.sidebarWidth || prevState.sidebarOpen !== this.state.sidebarOpen) {
      this.saveSettings();
    }
    if (prevState.nodes !== this.state.nodes || prevState.rootId !== this.state.rootId || prevState.seq !== this.state.seq) {
      this.scheduleAutosave();
    }
    // Keep the selected node's (visually silent) <input> focused whenever the
    // selection is shown, so a keystroke — Latin or an IME composition — lands in
    // it directly without a click first. Never call .select() here: that's reserved
    // for an explicit edit start (F2 / double-click / type-to-replace) so it can't
    // clobber the caret mid-typing.
    const s = this.state;
    if (s.selVisible && s.sel && (prevState.sel !== s.sel
      || prevState.selVisible !== s.selVisible || prevState.editing !== s.editing)) {
      const el = this._inputEls && this._inputEls[s.sel];
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  }
  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORE, JSON.stringify({
        theme: this.state.theme, dir: this.state.dir,
        sidebarWidth: this.state.sidebarWidth, sidebarOpen: this.state.sidebarOpen
      }));
    } catch (e) { /* best-effort; a full/unavailable localStorage shouldn't break the app */ }
  }
  // Debounced so rapid edits (typing, dragging) don't hit localStorage on every
  // keystroke; flushed immediately on unmount/beforeunload so a closed tab never
  // loses more than the in-flight debounce window.
  scheduleAutosave() {
    clearTimeout(this._autosaveT);
    this._autosaveT = setTimeout(() => this.autosave(), 800);
  }
  autosave() {
    try {
      localStorage.setItem(AUTOSAVE_STORE, JSON.stringify({
        nodes: this.state.nodes, rootId: this.state.rootId, seq: this.state.seq
      }));
    } catch (e) { /* best-effort; a full/unavailable localStorage shouldn't break the app */ }
  }

  /* ——— measurement & layout ——— */
  metrics() { return SIZES[this.state.theme.size] || SIZES.md; }

  measure(text, bold) {
    const m = this.metrics();
    const key = m.fs + "|" + (bold ? 1 : 0) + "|" + text;
    if (this.mcache[key]) return this.mcache[key];
    this.mctx.font = (bold ? "600 " : "400 ") + m.fs + 'px "Source Serif 4","Noto Serif JP",serif';
    // Explicit "\n"s (from Shift+Enter) are measured/wrapped per segment: width is
    // the widest segment (capped at maxW), lines is the sum of each segment's own
    // wrap count.
    const segs = String(text || "").split("\n");
    let maxRaw = 0, lines = 0;
    segs.forEach((seg) => {
      const raw = this.mctx.measureText(seg).width;
      if (raw > maxRaw) maxRaw = raw;
      lines += raw <= m.maxW ? 1 : Math.ceil(raw / m.maxW);
    });
    if (!text) maxRaw = this.mctx.measureText("　").width; // empty node: keep the old placeholder-driven minimum width
    const w = Math.min(maxRaw, m.maxW);
    const lh = Math.round(m.fs * 1.5);
    const out = { w: Math.max(Math.ceil(w) + m.padX * 2 + 10, 46), h: lines * lh + m.padY * 2, lines };
    this.mcache[key] = out;
    return out;
  }

  layout() {
    const { nodes, rootId } = this.state;
    const m = this.metrics();
    const cfg = DIRS[this.state.dir] || DIRS["both-h"];
    const vert = cfg.axis === "v";
    const alongGap = vert ? Math.round(m.along * 0.72) : m.along;
    const crossGap = vert ? m.cross + 8 : m.cross;
    const pos = {};
    const size = (id) => this.measure(nodes[id].text, id === rootId || nodes[id].parent === rootId);
    const alongOf = (s) => (vert ? s.h : s.w);
    const crossOf = (s) => (vert ? s.w : s.h);

    const place = (id, sign, depth, start) => {
      const s = size(id);
      const kids = nodes[id].collapsed ? [] : nodes[id].children;
      let extent;
      if (!kids.length) { pos[id] = { cc: start + crossOf(s) / 2 }; extent = crossOf(s); }
      else {
        let cur = start; const cs = [];
        kids.forEach((k) => { const ke = place(k, sign, depth + 1, cur); cs.push(pos[k].cc); cur += ke + crossGap; });
        extent = Math.max(cur - crossGap - start, crossOf(s));
        pos[id] = { cc: (cs[0] + cs[cs.length - 1]) / 2 };
      }
      pos[id].depth = depth; pos[id].sign = sign; pos[id].w = s.w; pos[id].h = s.h; pos[id].lines = s.lines;
      return extent;
    };

    const rootKids = nodes[rootId].collapsed ? [] : nodes[rootId].children;
    const groups = cfg.both
      ? [[rootKids.filter((_, i) => i % 2 === 0), 1], [rootKids.filter((_, i) => i % 2 === 1), -1]]
      : [[rootKids, 1]];
    const rs = size(rootId);
    pos[rootId] = { cc: 0, ac: 0, depth: 0, sign: 0, w: rs.w, h: rs.h, lines: rs.lines };

    groups.forEach((g) => {
      const list = g[0], sign = g[1];
      let cur = 0;
      list.forEach((k) => { cur += place(k, sign, 1, cur) + crossGap; });
      const shift = -Math.max(cur - crossGap, 0) / 2;
      // descendants() walks the full tree regardless of collapsed state, but place()
      // above never assigns pos[] entries for children hidden under a collapsed
      // ancestor — guard so shifting a collapsed branch doesn't touch those.
      list.forEach((k) => descendants(nodes, k).forEach((d) => { if (pos[d]) pos[d].cc += shift; }));
    });

    const setAlong = (id) => {
      const p = nodes[id].parent;
      if (p && pos[p]) {
        pos[id].ac = pos[p].ac + pos[id].sign * (alongOf(pos[p]) / 2 + alongGap + alongOf(pos[id]) / 2);
      }
      (nodes[id].collapsed ? [] : nodes[id].children).forEach(setAlong);
    };
    setAlong(rootId);

    Object.keys(pos).forEach((id) => {
      const p = pos[id];
      p.x = vert ? p.cc : p.ac;
      p.y = vert ? p.ac : p.cc;
      p.vert = vert;
    });
    return pos;
  }

  /* ——— history ——— */
  snapshot() { return JSON.stringify({ nodes: this.state.nodes, rootId: this.state.rootId, sel: this.state.sel }); }
  mutate(fn, patch) {
    const snap = this.snapshot();
    const nodes = JSON.parse(JSON.stringify(this.state.nodes));
    const extra = fn(nodes) || {};
    this.setState((s) => Object.assign({ nodes, past: s.past.concat(snap).slice(-80), future: [], srcDirty: false }, extra, patch || {}));
  }
  undo() {
    const s = this.state;
    if (!s.past.length) return this.toast("履歴がありません");
    const prev = JSON.parse(s.past[s.past.length - 1]);
    this.setState({ nodes: prev.nodes, rootId: prev.rootId, sel: prev.sel, multiSel: [], past: s.past.slice(0, -1), future: s.future.concat(this.snapshot()), editing: null, srcDirty: false });
  }
  redo() {
    const s = this.state;
    if (!s.future.length) return this.toast("やり直せる操作がありません");
    const next = JSON.parse(s.future[s.future.length - 1]);
    this.setState({ nodes: next.nodes, rootId: next.rootId, sel: next.sel, multiSel: [], future: s.future.slice(0, -1), past: s.past.concat(this.snapshot()), editing: null, srcDirty: false });
  }

  newId() { const id = "n" + this.state.seq; this.setState((s) => ({ seq: s.seq + 1 })); return id; }

  /* ——— selection ——— */
  // Any plain (non-multi) selection change goes through this so multiSel never
  // lingers stale — e.g. selecting a fresh node, editing, or rebuilding the tree
  // from mermaid/localStorage/an SVG all mean "forget the old multi-selection."
  selectOnly(id) { this.setState({ sel: id, multiSel: [] }); }
  // The full current selection as an array, anchor (`sel`) first, deduped.
  selectedIds() {
    const { sel, multiSel } = this.state;
    const ids = [sel];
    multiSel.forEach((id) => { if (ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }
  // Collapses `ids` to just the ones that are NOT a descendant of another id also
  // in the set — acting on an ancestor already covers its descendants, so e.g.
  // selecting both a branch and one of its own children should only affect the
  // branch once — returned in left-to-right document order. Used before any bulk
  // delete/move so nothing gets processed twice, and so a moved/reordered group
  // keeps its original relative order regardless of click order.
  orderedTopLevel(ids) {
    const nodes = this.state.nodes;
    const set = new Set(ids);
    const out = [];
    const walk = (id, covered) => {
      const hit = set.has(id);
      if (hit && !covered) out.push(id);
      nodes[id].children.forEach((c) => walk(c, covered || hit));
    };
    walk(this.state.rootId, false);
    return out;
  }
  // Ctrl/Cmd+click on a node: toggle it into/out of the multi-selection. The root
  // can never join it — it can't be bulk-deleted or bulk-moved anyway (see
  // removeSel/onUp), so a mixed selection containing it would have no meaning.
  toggleMultiSelect(id) {
    if (id === this.state.rootId) return this.toast("中心ノードは複数選択できません");
    this.setState((s) => {
      if (s.sel === s.rootId) return { sel: id, multiSel: [], editing: null, selVisible: true };
      if (id === s.sel) {
        if (s.multiSel.length) {
          const ms = s.multiSel.slice();
          return { sel: ms.pop(), multiSel: ms, editing: null, selVisible: true };
        }
        // Nothing else selected: toggling off the only member just hides the ring
        // (same as clicking empty canvas) rather than jumping `sel` to the root.
        return { selVisible: false, editing: null };
      }
      const idx = s.multiSel.indexOf(id);
      if (idx >= 0) {
        const ms = s.multiSel.slice(); ms.splice(idx, 1);
        return { multiSel: ms, editing: null, selVisible: true };
      }
      return { multiSel: s.multiSel.concat([id]), editing: null, selVisible: true };
    });
  }
  // Ctrl/Cmd+A: select every node except the root (it can't join multiSel — same
  // reasoning as toggleMultiSelect) so a following Delete clears the whole map
  // back down to just the center node.
  selectAll() {
    const { nodes, rootId } = this.state;
    const ids = Object.keys(nodes).filter((id) => id !== rootId);
    if (!ids.length) return;
    this.setState({ sel: ids[0], multiSel: ids.slice(1), editing: null, selVisible: true });
  }

  addNode(parentId, index) {
    const id = this.newId();
    this.mutate((nodes) => {
      nodes[id] = { id, text: "", parent: parentId, children: [], collapsed: false };
      nodes[parentId].collapsed = false;
      const kids = nodes[parentId].children;
      if (index == null || index >= kids.length) kids.push(id); else kids.splice(index, 0, id);
    }, { sel: id, multiSel: [], editing: id });
  }
  addSibling() {
    const { sel, nodes, rootId } = this.state;
    if (sel === rootId) return this.addNode(rootId, null);
    const p = nodes[sel].parent;
    this.addNode(p, nodes[p].children.indexOf(sel) + 1);
  }
  addChild() { this.addNode(this.state.sel, null); }

  // Deletes each of `ids`' subtrees (assumed already top-level/deduped, no root) in
  // one undo step, then selects a nearby surviving sibling, or the parent if none
  // of `ids[0]`'s siblings survive.
  removeIds(ids) {
    const { nodes } = this.state;
    const idSet = new Set(ids);
    const p = nodes[ids[0]].parent;
    const siblings = nodes[p].children;
    const idx = siblings.indexOf(ids[0]);
    let next = null;
    for (let i = idx + 1; i < siblings.length && next == null; i++) if (!idSet.has(siblings[i])) next = siblings[i];
    for (let i = idx - 1; i >= 0 && next == null; i--) if (!idSet.has(siblings[i])) next = siblings[i];
    if (next == null) next = p;
    this.mutate((n) => {
      ids.forEach((id) => { detach(n, id); descendants(n, id).forEach((d) => { delete n[d]; }); });
    }, { sel: next, multiSel: [], editing: null });
  }
  // Deletes every top-level selected node's subtree (see orderedTopLevel). Never
  // deletes the root; if it's the only thing selected, no-ops with a toast exactly
  // like the old single-select version did.
  removeSel() {
    const ids = this.orderedTopLevel(this.selectedIds()).filter((id) => id !== this.state.rootId);
    if (!ids.length) return this.toast("中心ノードは削除できません");
    this.removeIds(ids);
  }
  reorder(delta) {
    const { sel, nodes, rootId } = this.state;
    if (sel === rootId) return;
    const p = nodes[sel].parent;
    const i = nodes[p].children.indexOf(sel);
    const j = i + delta;
    if (j < 0 || j >= nodes[p].children.length) return this.toast("これ以上動かせません");
    this.mutate((n) => {
      const k = n[p].children;
      k.splice(i, 1); k.splice(j, 0, sel);
    });
  }

  // Copy/cut/paste stay single-node (the anchor only) even with a multi-selection
  // active — unlike delete/drag-move, "cut" implies one clipboard payload, and
  // extending it to a multi-subtree clip is a separate feature, not this one.
  copy() { this.setState({ clip: JSON.stringify(subtree(this.state.nodes, this.state.sel)) }); this.toast("コピーしました"); }
  cut() {
    if (this.state.sel === this.state.rootId) return this.toast("中心ノードは切り取れません");
    this.copy(); this.removeIds([this.state.sel]); this.toast("切り取りました");
  }
  paste() {
    const { clip, sel } = this.state;
    if (!clip) return this.toast("貼り付けるものがありません");
    const tree = JSON.parse(clip);
    let seq = this.state.seq, newSel = null;
    this.mutate((nodes) => {
      const insert = (t, parent) => {
        const id = "n" + (seq++);
        if (!newSel) newSel = id;
        nodes[id] = { id, text: t.text, parent, children: [], collapsed: false };
        nodes[parent].children.push(id);
        nodes[parent].collapsed = false;
        (t.children || []).forEach((c) => insert(c, id));
      };
      insert(tree, sel);
    });
    setTimeout(() => this.setState({ seq, sel: newSel, multiSel: [] }), 0);
    this.toast("貼り付けました");
  }

  // Arrow-key navigation always settles on a single node — it's moving a cursor,
  // not extending a selection — so every branch goes through selectOnly().
  move(dir) {
    const { sel, nodes, rootId } = this.state;
    const pos = this.layout();
    const vert = pos[rootId].vert;
    const sign = pos[sel] ? pos[sel].sign : 1;
    const n = nodes[sel];
    const outKey = vert ? "down" : "right", inKey = vert ? "up" : "left";
    const along = dir === outKey || dir === inKey;
    if (along) {
      const outward = (dir === outKey && sign >= 0) || (dir === inKey && sign < 0);
      if (outward) {
        if (n.collapsed && n.children.length) return this.mutate((m) => { m[sel].collapsed = false; });
        if (n.children[0]) this.selectOnly(n.children[0]);
        else if (sel === rootId) { const f = nodes[rootId].children[0]; if (f) this.selectOnly(f); }
      } else if (n.parent) this.selectOnly(n.parent);
      else {
        const back = nodes[rootId].children.find((c) => pos[c] && pos[c].sign === -1);
        if (back) this.selectOnly(back);
      }
      return;
    }
    if (!pos[sel]) return;
    const peers = Object.keys(pos)
      .filter((id) => pos[id].depth === pos[sel].depth && pos[id].sign === pos[sel].sign)
      .sort((a, b) => (vert ? pos[a].x - pos[b].x : pos[a].y - pos[b].y));
    const i = peers.indexOf(sel);
    const back = dir === "up" || dir === "left";
    const t = peers[back ? i - 1 : i + 1];
    if (t) this.selectOnly(t);
  }

  startEdit(id) {
    this.setState({ sel: id, multiSel: [], editing: id, selVisible: true }, () => {
      const el = this._inputEls && this._inputEls[id];
      if (el) { el.focus({ preventScroll: true }); el.select(); }
    });
  }

  // Focus the selected node's <input> (see componentDidUpdate for why it stays
  // focused). No-op when nothing is selected or the selection ring is hidden.
  focusSel() {
    const el = this._inputEls && this._inputEls[this.state.sel];
    if (el && this.state.selVisible) el.focus({ preventScroll: true });
  }

  // A stable ref callback per node id. renderVals() runs on every render, so an
  // inline closure here would give React a new `ref` identity each time — React
  // treats that as the ref detaching and reattaching. It now only records the DOM
  // node; focus is driven explicitly (focusSel/startEdit/componentDidUpdate) so
  // that merely selecting a node — which now also mounts its <input> — never
  // selects that node's text.
  inputRef(id) {
    if (!this._inputRefs) this._inputRefs = {};
    if (!this._inputEls) this._inputEls = {};
    if (!this._inputRefs[id]) {
      this._inputRefs[id] = (el) => {
        if (el) this._inputEls[id] = el;
        else delete this._inputEls[id];
      };
    }
    return this._inputRefs[id];
  }

  /* ——— pointer ——— */
  toGraph(e) {
    const r = this.canvas.getBoundingClientRect();
    const { pan, zoom } = this.state;
    return {
      x: (e.clientX - r.left - r.width / 2 - pan.x) / zoom,
      y: (e.clientY - r.top - r.height / 2 - pan.y) / zoom
    };
  }
  onCanvasDown(e) {
    if (e.button === 0 && e.target === this.canvas) this.setState({ editing: null, selVisible: false, multiSel: [] });
    this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, pan: this.state.pan };
    e.preventDefault();
  }
  onSidebarResizeDown(e) {
    this.sidebarResize = { sx: e.clientX, w: this.state.sidebarWidth };
    e.preventDefault();
  }
  onNodeDown(id, e) {
    e.stopPropagation();
    if (e.button !== 0) { this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, pan: this.state.pan }; return; }
    if (this.state.editing === id) return;
    if (e.metaKey || e.ctrlKey) { this.toggleMultiSelect(id); this.drag = null; return; }
    // Grabbing a node that's already part of the current multi-selection drags the
    // whole group together; grabbing anything else collapses to just that node
    // first (standard multi-select convention — matches Finder/design tools).
    const inSelection = id === this.state.sel || this.state.multiSel.indexOf(id) >= 0;
    if (!inSelection) this.setState({ sel: id, multiSel: [], editing: null, selVisible: true }, () => this.focusSel());
    else if (this.state.editing !== null || !this.state.selVisible) this.setState({ editing: null, selVisible: true });
    if (id === this.state.rootId) { this.drag = null; return; }
    const moveIds = this.orderedTopLevel(inSelection ? this.selectedIds() : [id]);
    const sameParent = moveIds.length <= 1 || moveIds.every((mid) => this.state.nodes[mid].parent === this.state.nodes[moveIds[0]].parent);
    this.drag = { kind: "node", moveIds, sameParent, sx: e.clientX, sy: e.clientY, moved: false };
    e.preventDefault();
  }
  onMove(e) {
    const r = this.sidebarResize;
    if (r) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, r.w + (e.clientX - r.sx)));
      return this.setState({ sidebarWidth: w });
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.kind === "pan") return this.setState({ pan: { x: d.pan.x + dx, y: d.pan.y + dy } });
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!d.moved) { d.moved = true; d.snap = this.snapshot(); }
    const z = this.state.zoom;
    const g = this.toGraph(e);
    const pos = this.layout();
    const banned = d.moveIds.reduce((acc, id) => acc.concat(descendants(this.state.nodes, id)), []);
    let drop = null;
    Object.keys(pos).forEach((id) => {
      if (banned.indexOf(id) >= 0 || drop) return;
      const p = pos[id];
      if (g.x < p.x - p.w / 2 || g.x > p.x + p.w / 2 || g.y < p.y - p.h / 2 || g.y > p.y + p.h / 2) return;
      const t = p.vert ? (g.x - (p.x - p.w / 2)) / p.w : (g.y - (p.y - p.h / 2)) / p.h;
      // A mixed-parent group can only be reparented ("into") together — there's no
      // single well-defined sibling slot to slot them all "before/after" into.
      if (id === this.state.rootId) drop = { id, mode: "into" };
      else if (t < 0.3) drop = { id, mode: d.sameParent ? "before" : "into" };
      else if (t > 0.7) drop = { id, mode: d.sameParent ? "after" : "into" };
      else drop = { id, mode: "into" };
    });
    this.setState({ ghost: { ids: d.moveIds, dx: dx / z, dy: dy / z }, drop });
  }
  onUp() {
    if (this.sidebarResize) { this.sidebarResize = null; return; }
    const d = this.drag; this.drag = null;
    if (!d || d.kind !== "node" || !d.moved) return this.setState({ ghost: null, drop: null });
    const drop = this.state.drop;
    if (!drop) return this.setState({ ghost: null, drop: null });
    const ids = d.moveIds;
    const nodes = JSON.parse(JSON.stringify(this.state.nodes));
    if (drop.mode === "into") {
      if (ids.every((id) => nodes[id].parent === drop.id)) return this.setState({ ghost: null, drop: null });
      ids.forEach((id) => { detach(nodes, id); nodes[id].parent = drop.id; nodes[drop.id].children.push(id); });
      nodes[drop.id].collapsed = false;
      this.toast(ids.length > 1 ? "まとめて付け替えました" : "付け替えました");
    } else {
      const parent = nodes[drop.id].parent;
      ids.forEach((id) => detach(nodes, id));
      const kids = nodes[parent].children;
      const at = kids.indexOf(drop.id) + (drop.mode === "after" ? 1 : 0);
      ids.forEach((id, i) => { nodes[id].parent = parent; kids.splice(at + i, 0, id); });
      this.toast(ids.length > 1 ? "まとめて並べ替えました" : "並べ替えました");
    }
    this.setState((s) => ({ nodes, ghost: null, drop: null, past: s.past.concat(d.snap).slice(-80), future: [], srcDirty: false }));
  }
  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const { pan, zoom } = this.state;
    const z2 = Math.min(2.6, Math.max(0.25, zoom * Math.exp(-e.deltaY * 0.0016)));
    const gx = (mx - cx - pan.x) / zoom, gy = (my - cy - pan.y) / zoom;
    this.setState({ zoom: z2, pan: { x: mx - cx - z2 * gx, y: my - cy - z2 * gy } });
  }
  setZoom(z) { this.setState({ zoom: Math.min(2.6, Math.max(0.25, z)) }); }
  fit() {
    if (!this.canvas) return;
    const pos = this.layout();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    Object.keys(pos).forEach((id) => {
      const p = pos[id];
      x1 = Math.min(x1, p.x - p.w / 2); x2 = Math.max(x2, p.x + p.w / 2);
      y1 = Math.min(y1, p.y - p.h / 2); y2 = Math.max(y2, p.y + p.h / 2);
    });
    const r = this.canvas.getBoundingClientRect();
    const z = Math.min(2.2, Math.max(0.25, Math.min((r.width - 90) / (x2 - x1), (r.height - 110) / (y2 - y1))));
    this.setState({ zoom: z, pan: { x: -((x1 + x2) / 2) * z, y: -((y1 + y2) / 2) * z } });
  }

  // Map-level shortcuts (navigation, structure, history, clipboard) for the selected
  // node while it is NOT being edited. Shared by the window key handler (focus on the
  // canvas) and handleNodeKey (focus in the selected node's own <input>). Returns
  // true when it consumed the key.
  mapShortcut(e) {
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (meta && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return true; }
    if (meta && k === "y") { e.preventDefault(); this.redo(); return true; }
    if (meta && k === "c") { e.preventDefault(); this.copy(); return true; }
    if (meta && k === "x") { e.preventDefault(); this.cut(); return true; }
    if (meta && k === "v") { e.preventDefault(); this.paste(); return true; }
    if (meta && k === "a") { e.preventDefault(); this.selectAll(); return true; }
    if (meta && e.shiftKey && k === "h") { e.preventDefault(); this.fit(); return true; }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowLeft")) { e.preventDefault(); this.reorder(-1); return true; }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowRight")) { e.preventDefault(); this.reorder(1); return true; }
    if (e.key === "Enter") { e.preventDefault(); this.addSibling(); return true; }
    if (e.key === "Tab") { e.preventDefault(); this.addChild(); return true; }
    if (e.key === "F2") { e.preventDefault(); this.startEdit(this.state.sel); return true; }
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); this.removeSel(); return true; }
    if (e.key === " ") { e.preventDefault(); this.toggleCollapse(this.state.sel); return true; }
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (map[e.key]) { e.preventDefault(); this.move(map[e.key]); return true; }
    return false;
  }

  // Does e look like a printable character (opens the editor and gets typed in),
  // rather than a named key like "Enter" / "ArrowUp"?
  isTypingKey(e) {
    return e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
  }

  // ⌘S/Ctrl+S saves to localStorage instead of triggering the browser's native
  // "Save Page As" dialog. Checked ahead of every other keydown path — including
  // mid-edit, where handleNodeKey's unconditional stopPropagation would otherwise
  // keep it from ever reaching mapShortcut or the window handler below.
  trySaveShortcut(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      this.saveLocal();
      return true;
    }
    return false;
  }

  onKeyDown(e) {
    if (this.trySaveShortcut(e)) return;
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
    if (this.state.editing) return;
    if (!this.state.selVisible) this.setState({ selVisible: true });
    if (this.mapShortcut(e)) return;
    // Focus is on the canvas, not the selected node's <input> (e.g. right after a
    // toolbar button click). Begin editing on a printable key so typing still works;
    // IME composition needs the input pre-focused and isn't available on this path
    // (the input-focused path in handleNodeKey covers it).
    if (this.isTypingKey(e)) { e.preventDefault(); this.beginTypeEdit(this.state.sel, e.key); }
  }

  // Enter edit mode on `id` with `ch` as its (replacement) text and the caret at the
  // end. Only for a key typed while the canvas — not the node's input — had focus,
  // so the character can't fall through into the input on its own.
  beginTypeEdit(id, ch) {
    if (!this.state.nodes[id]) return;
    const nn = Object.assign({}, this.state.nodes);
    nn[id] = Object.assign({}, nn[id], { text: ch });
    this.setState({ nodes: nn, sel: id, multiSel: [], editing: id, selVisible: true, srcDirty: false }, () => {
      const el = this._inputEls && this._inputEls[id];
      if (el) { el.focus({ preventScroll: true }); const n = el.value.length; el.setSelectionRange(n, n); }
    });
  }

  // Keydown from the selected node's own <input>: it owns both the "navigate the
  // map" keys (when not editing) and the "edit the text" keys (when editing).
  handleNodeKey(id, e) {
    e.stopPropagation();
    if (this.trySaveShortcut(e)) return;
    const composing = e.nativeEvent ? (e.nativeEvent.isComposing || e.keyCode === 229) : (e.keyCode === 229);
    if (this.state.editing === id) {
      if (composing) return; // let the IME consume Enter/Space/… while a candidate is open
      if (e.key === "Enter") {
        if (e.shiftKey) return; // let the textarea insert a literal "\n"
        e.preventDefault(); this.setState({ editing: null }); // confirm only — no sibling added
      }
      else if (e.key === "Tab") { e.preventDefault(); this.setState({ editing: null }); setTimeout(() => this.addChild(), 0); }
      else if (e.key === "Escape") { e.preventDefault(); this.setState({ editing: null }); }
      return; // any other key: ordinary text editing inside the input
    }
    if (composing) return; // an IME composition is starting on the selected node → onCompositionStart handles it
    if (this.mapShortcut(e)) return;
    if (this.isTypingKey(e)) {
      // Printable key on a selected-but-not-editing node: select the old text so this
      // keystroke replaces it, then let the character fall through into the input
      // (NOT preventDefault-ed — that's what lets the browser, and the IME, insert it).
      const el = this._inputEls && this._inputEls[id];
      if (el) el.select();
    }
  }
  toggleCollapse(id) {
    if (!this.state.nodes[id].children.length) return;
    this.mutate((n) => { n[id].collapsed = !n[id].collapsed; });
  }

  /* ——— mermaid ——— */
  toMermaid() {
    const { nodes, rootId } = this.state;
    const lines = ["mindmap"];
    const walk = (id, depth) => {
      // The mindmap dialect is one node per line, so a literal "\n" (from Shift+Enter)
      // would split into extra lines on round-trip — encode it as mermaid's own <br/>.
      const txt = (nodes[id].text || " ").split("\n").join("<br/>");
      lines.push("  ".repeat(depth + 1) + (depth === 0 ? "root((" + txt + "))" : txt));
      nodes[id].children.forEach((k) => walk(k, depth + 1));
    };
    walk(rootId, 0);
    return lines.join("\n");
  }

  fromMermaid(text) {
    const body = text.split(/\r?\n/).filter((l) => !/^\s*%%/.test(l));
    const nodes = {}; let seq = 1;
    const mk = (txt, parent) => {
      const id = "n" + (seq++);
      nodes[id] = { id, text: txt, parent, children: [], collapsed: false };
      if (parent) nodes[parent].children.push(id);
      return id;
    };
    const clean = (s) => s.trim()
      .replace(/^root\s*\(\(([\s\S]*)\)\)$/, "$1")
      .replace(/^\(\(([\s\S]*)\)\)$/, "$1")
      .trim()
      .replace(/<br\s*\/?>/gi, "\n"); // undo toMermaid()'s "\n" → <br/> encoding

    let rootId = null;
    const stack = [];
    body.forEach((l) => {
      if (!l.trim() || /^\s*mindmap\s*$/.test(l)) return;
      const indent = l.match(/^\s*/)[0].replace(/\t/g, "  ").length;
      const txt = clean(l);
      if (!txt) return;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].id : null;
      const id = mk(txt, parent);
      if (!rootId) rootId = id;
      else if (!parent) { nodes[id].parent = rootId; nodes[rootId].children.push(id); }
      stack.push({ indent, id });
    });
    if (!rootId) return null;
    return { nodes, rootId, seq };
  }

  applySrc() {
    const parsed = this.fromMermaid(this.state.src || this.toMermaid());
    if (!parsed) return this.toast("解釈できませんでした");
    const snap = this.snapshot();
    this.setState((s) => ({
      nodes: parsed.nodes, rootId: parsed.rootId, seq: parsed.seq, sel: parsed.rootId, multiSel: [],
      editing: null, srcDirty: false, past: s.past.concat(snap).slice(-80), future: []
    }));
    this.toast("ソースを反映しました");
  }
  copyMermaid() {
    const text = this.toMermaid();
    const done = () => this.toast("mermaidをコピーしました");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => this.fallbackCopy(text, done));
    else this.fallbackCopy(text, done);
  }
  fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (err) { this.toast("コピーできませんでした"); }
    document.body.removeChild(ta);
  }
  saveLocal() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        nodes: this.state.nodes, rootId: this.state.rootId, seq: this.state.seq,
        theme: this.state.theme, dir: this.state.dir
      }));
      this.toast("localStorageに保存しました");
    } catch (e) { this.toast("保存できませんでした"); }
  }
  loadLocal() {
    let raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = null; }
    if (!raw) return this.toast("保存データがありません");
    try {
      const d = JSON.parse(raw);
      const snap = this.snapshot();
      this.setState((s) => ({
        nodes: d.nodes, rootId: d.rootId, seq: d.seq || 999, sel: d.rootId, multiSel: [], editing: null,
        theme: d.theme || s.theme, dir: d.dir || s.dir,
        srcDirty: false, past: s.past.concat(snap).slice(-80), future: []
      }));
      setTimeout(() => this.fit(), 40);
      this.toast("読み込みました");
    } catch (e) { this.toast("読み込みに失敗しました"); }
  }

  /* ——— svg export ——— */
  // Resolves a color (a literal, or "var(--x)") to a concrete rgb()/rgba() string via
  // a hidden probe element, so color-mix()/custom-property values that only make sense
  // inside this page's own stylesheet still render correctly in the standalone SVG file.
  resolveColor(value) {
    const v = String(value).trim();
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    const raw = m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : v;
    if (!this._colorProbe) {
      this._colorProbe = document.createElement("div");
      this._colorProbe.style.display = "none";
      document.body.appendChild(this._colorProbe);
    }
    this._colorProbe.style.color = raw;
    return getComputedStyle(this._colorProbe).color || raw;
  }
  // Greedy any-character wrap, mirroring the canvas nodes' CSS (overflow-wrap:anywhere)
  // since SVG <text> never wraps on its own. Explicit "\n"s (from Shift+Enter) are
  // split first — each segment wraps independently — so a manual line break always
  // survives the export even if it wouldn't have needed wrapping on its own.
  wrapLines(text, bold) {
    const m = this.metrics();
    this.mctx.font = (bold ? "600 " : "400 ") + m.fs + 'px "Source Serif 4","Noto Serif JP",serif';
    const wrapSeg = (seg) => {
      const chars = Array.from(seg);
      if (!chars.length) return [""];
      const lines = [];
      let cur = "";
      for (const ch of chars) {
        const test = cur + ch;
        if (cur && this.mctx.measureText(test).width > m.maxW) { lines.push(cur); cur = ch; }
        else cur = test;
      }
      lines.push(cur);
      return lines;
    };
    const segs = String(text || "").split("\n");
    const lines = [];
    segs.forEach((seg) => { wrapSeg(seg).forEach((ln) => lines.push(ln)); });
    return lines;
  }
  buildSvg() {
    const s = this.state;
    const m = this.metrics();
    const ink = INK[s.theme.ink] || INK.cyan;
    const pos = this.layout();
    const nodes = s.nodes;
    const multiMode = s.theme.ink === "multi";
    if (multiMode) {
      nodes[s.rootId].children.forEach((childId) => {
        if (this._branchColors[childId] == null) {
          this._branchColors[childId] = this._branchColorSeq % MULTI_PALETTE.length;
          this._branchColorSeq++;
        }
      });
    }
    const branchColorOf = (id) => {
      if (!multiMode) return ink;
      const b = branchAncestor(nodes, s.rootId, id);
      if (b == null || this._branchColors[b] == null) return INK.paper;
      return MULTI_PALETTE[this._branchColors[b]];
    };
    const radiusPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--radius-md")) || 2;
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    Object.keys(pos).forEach((id) => {
      const p = pos[id];
      x1 = Math.min(x1, p.x - p.w / 2); x2 = Math.max(x2, p.x + p.w / 2);
      y1 = Math.min(y1, p.y - p.h / 2); y2 = Math.max(y2, p.y + p.h / 2);
    });
    const pad = 30;
    x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
    const W = Math.max(1, x2 - x1), H = Math.max(1, y2 - y1);

    const edgeEls = [];
    Object.keys(pos).forEach((id) => {
      const parent = nodes[id].parent;
      if (!parent || !pos[parent]) return;
      const a = pos[parent], b = pos[id];
      const vert = b.vert;
      let x1e, y1e, x2e, y2e;
      if (vert) {
        const dir = b.y >= a.y ? 1 : -1;
        x1e = a.x; y1e = a.y + dir * a.h / 2; x2e = b.x; y2e = b.y - dir * b.h / 2;
      } else {
        const dir = b.x >= a.x ? 1 : -1;
        x1e = a.x + dir * a.w / 2; y1e = a.y; x2e = b.x - dir * b.w / 2; y2e = b.y;
      }
      let d;
      if (s.theme.edge === "line") d = "M" + x1e + " " + y1e + " L" + x2e + " " + y2e;
      else if (s.theme.edge === "ortho") {
        d = vert
          ? "M" + x1e + " " + y1e + " V" + (y1e + y2e) / 2 + " H" + x2e + " V" + y2e
          : "M" + x1e + " " + y1e + " H" + (x1e + x2e) / 2 + " V" + y2e + " H" + x2e;
      } else if (vert) {
        const k = Math.abs(y2e - y1e) * 0.5 * (y2e >= y1e ? 1 : -1);
        d = "M" + x1e + " " + y1e + " C" + x1e + " " + (y1e + k) + ", " + x2e + " " + (y2e - k) + ", " + x2e + " " + y2e;
      } else {
        const k = Math.abs(x2e - x1e) * 0.5 * (x2e >= x1e ? 1 : -1);
        d = "M" + x1e + " " + y1e + " C" + (x1e + k) + " " + y1e + ", " + (x2e - k) + " " + y2e + ", " + x2e + " " + y2e;
      }
      const edgeColorize = multiMode || b.depth === 1;
      const stroke = this.resolveColor(edgeColorize ? branchColorOf(id).edge : "var(--color-neutral-400)");
      const w = b.depth === 1 ? 1.8 : 1.2;
      edgeEls.push('<path d="' + d + '" stroke="' + stroke + '" stroke-width="' + w + '" fill="none" stroke-linecap="round"/>');
    });

    const nodeEls = Object.keys(pos).map((id) => {
      const n = nodes[id], p = pos[id];
      const isRoot = id === s.rootId;
      const nodeInk = branchColorOf(id);
      const colorize = multiMode || p.depth === 1;
      const invert = s.theme.invert;
      const chipInk = isRoot ? (invert ? INK.paper : nodeInk) : (invert && p.depth === 1 ? nodeInk : null);
      const bold = isRoot || colorize;

      let fill = null, borderColor = null, underlineColor = null, textColor;
      if (chipInk) {
        fill = this.resolveColor(chipInk.solid);
        textColor = this.resolveColor("var(--color-bg)");
      } else if (s.theme.shape === "box") {
        fill = this.resolveColor("var(--color-neutral-100)");
        borderColor = this.resolveColor("var(--color-divider)");
        textColor = this.resolveColor(colorize ? nodeInk.text : "var(--color-text)");
      } else if (s.theme.shape === "underline") {
        underlineColor = this.resolveColor(colorize ? nodeInk.solid : "var(--color-neutral-400)");
        textColor = this.resolveColor(colorize ? nodeInk.text : "var(--color-text)");
      } else {
        textColor = this.resolveColor(colorize ? nodeInk.text : "var(--color-text)");
      }

      const lines = this.wrapLines(n.text, bold);
      const lh = Math.round(m.fs * 1.5);
      const startY = p.y - (lines.length * lh) / 2 + lh / 2 + m.fs * 0.35;

      const parts = [];
      if (fill) {
        parts.push('<rect x="' + (p.x - p.w / 2) + '" y="' + (p.y - p.h / 2) + '" width="' + p.w + '" height="' + p.h + '" rx="' + radiusPx + '" fill="' + fill + '"'
          + (borderColor ? ' stroke="' + borderColor + '" stroke-width="1"' : '') + '/>');
      }
      if (underlineColor) {
        const ly = p.y + p.h / 2 - 1;
        parts.push('<line x1="' + (p.x - p.w / 2 + m.padX) + '" y1="' + ly + '" x2="' + (p.x + p.w / 2 - m.padX) + '" y2="' + ly + '" stroke="' + underlineColor + '" stroke-width="2"/>');
      }
      const tspans = lines.map((ln, i) => '<tspan x="' + p.x + '" y="' + (startY + i * lh) + '">' + esc(ln) + '</tspan>').join("");
      parts.push('<text text-anchor="middle" font-family="Source Serif 4, Noto Serif JP, serif" font-size="' + m.fs + '" font-weight="' + (bold ? 600 : 400) + '" fill="' + textColor + '">' + tspans + '</text>');
      return parts.join("");
    });

    const bgRect = s.theme.svgTransparentBg ? "" :
      '<rect x="' + x1 + '" y="' + y1 + '" width="' + W + '" height="' + H + '" fill="' + this.resolveColor("var(--color-bg)") + '"/>';
    // Round-trip data: the same mindmap dialect toMermaid()/fromMermaid() already
    // speak, embedded in a <metadata> element so viewers ignore it but a dropped
    // .mindmap.svg (see onCanvasDrop/loadSvgFile) can rebuild the node tree exactly.
    // "]]>" can't appear inside a CDATA section, so any occurrence in the source
    // (a node could legitimately contain it) is split across two adjacent sections.
    const mermaidCdata = this.toMermaid().split("]]>").join("]]]]><![CDATA[>");
    const metadata = '<metadata id="mindmap-mermaid"><![CDATA[' + mermaidCdata + ']]></metadata>';
    // Theme/direction round-trip alongside the tree — same {theme, dir} shape saveLocal()
    // bundles into STORE. JSON never contains a literal "]]>" (theme values are all plain
    // enums/booleans) so it doesn't need the mermaid block's CDATA-splitting.
    const themeJson = JSON.stringify({ theme: s.theme, dir: s.dir });
    const themeMetadata = '<metadata id="mindmap-theme"><![CDATA[' + themeJson + ']]></metadata>';
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x1 + ' ' + y1 + ' ' + W + ' ' + H + '" width="' + Math.round(W) + '" height="' + Math.round(H) + '">'
      + metadata
      + themeMetadata
      + bgRect
      + edgeEls.join("")
      + nodeEls.join("")
      + '</svg>';
  }
  // Reverses buildSvg()'s <metadata id="mindmap-mermaid"> embedding. Returns null for
  // an SVG that never went through buildSvg() (no embedded data to recover).
  extractMermaidFromSvg(text) {
    const m = text.match(/<metadata[^>]*\bid=["']mindmap-mermaid["'][^>]*>([\s\S]*?)<\/metadata>/);
    if (!m) return null;
    const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
    const raw = cdata ? cdata[1] : m[1];
    return raw.split("]]]]><![CDATA[>").join("]]>");
  }
  // Reverses the <metadata id="mindmap-theme"> embedding. Returns null when absent
  // or unparseable (an older export, or a hand-edited/corrupt file) — the caller
  // falls back to keeping the current theme rather than failing the whole load.
  extractThemeFromSvg(text) {
    const m = text.match(/<metadata[^>]*\bid=["']mindmap-theme["'][^>]*>([\s\S]*?)<\/metadata>/);
    if (!m) return null;
    const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
    try { return JSON.parse(cdata ? cdata[1] : m[1]); } catch (e) { return null; }
  }
  loadSvgFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const mermaidText = this.extractMermaidFromSvg(text);
      if (!mermaidText) return this.toast("このSVGにはマインドマップのデータが見つかりません");
      const parsed = this.fromMermaid(mermaidText);
      if (!parsed) return this.toast("読み込みに失敗しました");
      const themeData = this.extractThemeFromSvg(text);
      const snap = this.snapshot();
      this.setState((s) => ({
        nodes: parsed.nodes, rootId: parsed.rootId, seq: parsed.seq, sel: parsed.rootId, multiSel: [], editing: null,
        theme: (themeData && themeData.theme) ? Object.assign({}, s.theme, themeData.theme) : s.theme,
        dir: (themeData && themeData.dir) || s.dir,
        srcDirty: false, past: s.past.concat(snap).slice(-80), future: []
      }));
      setTimeout(() => this.fit(), 40);
      this.toast("SVGから読み込みました");
    };
    reader.onerror = () => this.toast("読み込みに失敗しました");
    reader.readAsText(file);
  }
  // Files dragged onto the canvas: highlight while a file (not an internal node
  // drag, which never sets dataTransfer's Files type) hovers, load on drop.
  onCanvasDragOver(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types || Array.prototype.indexOf.call(types, "Files") < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!this.state.dragOverFile) this.setState({ dragOverFile: true });
  }
  onCanvasDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (this.state.dragOverFile) this.setState({ dragOverFile: false });
  }
  onCanvasDrop(e) {
    e.preventDefault();
    this.setState({ dragOverFile: false });
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.svg$/i.test(file.name)) return this.toast("SVGファイルをドロップしてください");
    this.loadSvgFile(file);
  }
  saveSvg() {
    try {
      const svg = this.buildSvg();
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const name = ((this.state.nodes[this.state.rootId].text || "").trim() || "mindmap").replace(/[\\/:*?"<>|]/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = name + ".mindmap.svg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast("SVGを保存しました");
    } catch (e) { console.error(e); this.toast("SVGの保存に失敗しました"); }
  }

  toast(msg) {
    this.setState({ toast: msg });
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.setState({ toast: "" }), 2000);
  }
  pick(e, fn) {
    fn();
    if (e && e.target && e.target.blur) e.target.blur();
    // Return focus to the selected node's input so map shortcuts (and typing) keep
    // working; fall back to the canvas when nothing is selected.
    const el = this._inputEls && this._inputEls[this.state.sel];
    if (el && this.state.selVisible) el.focus({ preventScroll: true });
    else if (this.canvas) this.canvas.focus();
  }
  setTheme(k, v) { this.mcache = {}; this.setState((s) => ({ theme: Object.assign({}, s.theme, { [k]: v }) })); }
  setDir(v) { this.setState({ dir: v }); setTimeout(() => this.fit(), 30); }

  /* ——— derived view values ——— */
  renderVals() {
    const s = this.state;
    const m = this.metrics();
    const ink = INK[s.theme.ink] || INK.cyan;
    const pos = this.layout();
    const nodes = s.nodes;
    const ghost = s.ghost;
    const ghostSet = ghost ? ghost.ids.reduce((acc, id) => acc.concat(descendants(nodes, id)), []) : [];
    const selSet = s.selVisible ? new Set([s.sel].concat(s.multiSel)) : new Set();

    // "multi" (カラフル): each top-level branch gets its own ink from MULTI_PALETTE,
    // inherited by all of that branch's descendants; the root stays neutral (paper).
    // Outside multi mode branchColorOf always returns the single selected `ink`,
    // so the rest of this method reads the same regardless of theme.
    const multiMode = s.theme.ink === "multi";
    if (multiMode) {
      // Seed any not-yet-colored root children in their current sibling order, but
      // never touch an existing assignment — that's what keeps a branch's color
      // fixed while unrelated siblings are added, removed, or reordered.
      nodes[s.rootId].children.forEach((childId) => {
        if (this._branchColors[childId] == null) {
          this._branchColors[childId] = this._branchColorSeq % MULTI_PALETTE.length;
          this._branchColorSeq++;
        }
      });
    }
    const branchColorOf = (id) => {
      if (!multiMode) return ink;
      const b = branchAncestor(nodes, s.rootId, id);
      if (b == null || this._branchColors[b] == null) return INK.paper;
      return MULTI_PALETTE[this._branchColors[b]];
    };

    const edges = [];
    Object.keys(pos).forEach((id) => {
      const p = nodes[id].parent;
      if (!p || !pos[p]) return;
      const a = pos[p], b = pos[id];
      const vert = b.vert;
      let x1, y1, x2, y2;
      if (vert) {
        const dir = b.y >= a.y ? 1 : -1;
        x1 = a.x; y1 = a.y + dir * a.h / 2; x2 = b.x; y2 = b.y - dir * b.h / 2;
      } else {
        const dir = b.x >= a.x ? 1 : -1;
        x1 = a.x + dir * a.w / 2; y1 = a.y; x2 = b.x - dir * b.w / 2; y2 = b.y;
      }
      let d;
      if (s.theme.edge === "line") d = "M" + x1 + " " + y1 + " L" + x2 + " " + y2;
      else if (s.theme.edge === "ortho") {
        d = vert
          ? "M" + x1 + " " + y1 + " V" + (y1 + y2) / 2 + " H" + x2 + " V" + y2
          : "M" + x1 + " " + y1 + " H" + (x1 + x2) / 2 + " V" + y2 + " H" + x2;
      } else if (vert) {
        const k = Math.abs(y2 - y1) * 0.5 * (y2 >= y1 ? 1 : -1);
        d = "M" + x1 + " " + y1 + " C" + x1 + " " + (y1 + k) + ", " + x2 + " " + (y2 - k) + ", " + x2 + " " + y2;
      } else {
        const k = Math.abs(x2 - x1) * 0.5 * (x2 >= x1 ? 1 : -1);
        d = "M" + x1 + " " + y1 + " C" + (x1 + k) + " " + y1 + ", " + (x2 - k) + " " + y2 + ", " + x2 + " " + y2;
      }
      const edgeColorize = multiMode || b.depth === 1;
      edges.push({ d, stroke: edgeColorize ? branchColorOf(id).edge : "var(--color-neutral-400)", w: b.depth === 1 ? 1.8 : 1.2 });
    });

    const nodeViews = Object.keys(pos).map((id) => {
      const n = nodes[id], p = pos[id];
      const isRoot = id === s.rootId;
      const selected = selSet.has(id);
      const intoTarget = s.drop && s.drop.mode === "into" && s.drop.id === id;
      const editing = s.editing === id;
      const dragging = ghostSet.indexOf(id) >= 0;
      const padY = isRoot ? m.padY + 2 : m.padY;
      // Same line-height measure()/buildSvg() use, so the <span>, the editing
      // <textarea>, and the offscreen-canvas height math all agree pixel-for-pixel.
      const lh = Math.round(m.fs * 1.5);

      let box = "position:relative;display:flex;align-items:center;justify-content:center;text-align:center;box-sizing:border-box;"
        + "width:100%;min-height:" + p.h + "px;padding:" + padY + "px " + m.padX + "px;"
        + "font-size:" + m.fs + "px;line-height:" + lh + "px;cursor:grab;"
        + (p.lines === 1 ? "white-space:nowrap;" : "white-space:pre-wrap;overflow-wrap:anywhere;")
        + "font-family:'Source Serif 4','Noto Serif JP',serif;";
      const nodeInk = branchColorOf(id);
      const colorize = multiMode || p.depth === 1;
      // Normally the root alone gets the solid filled "chip" look, ink-colored, and
      // depth 1 just gets colored text on the regular shape. Inverting swaps which
      // depth gets the chip: depth 1 becomes the vivid filled chip and the root
      // becomes a fixed neutral (paper) anchor instead of taking the ink color.
      const invert = s.theme.invert;
      const chipInk = isRoot ? (invert ? INK.paper : nodeInk) : (invert && p.depth === 1 ? nodeInk : null);
      if (chipInk) box += "background:" + chipInk.solid + ";color:var(--color-bg);font-weight:600;border-radius:var(--radius-md);box-shadow:var(--shadow-sm);";
      else if (s.theme.shape === "box") {
        box += "background:var(--color-neutral-100);border:1px solid var(--color-divider);border-radius:var(--radius-md);"
          + "color:" + (colorize ? nodeInk.text : "var(--color-text)") + ";font-weight:" + (colorize ? 600 : 400) + ";";
      } else if (s.theme.shape === "underline") {
        box += "background:transparent;border-bottom:2px solid " + (colorize ? nodeInk.solid : "var(--color-neutral-400)") + ";"
          + "color:" + (colorize ? nodeInk.text : "var(--color-text)") + ";font-weight:" + (colorize ? 600 : 400) + ";";
      } else {
        box += "background:transparent;color:" + (colorize ? nodeInk.text : "var(--color-text)") + ";font-weight:" + (colorize ? 600 : 400) + ";";
      }
      const ringInk = isRoot && invert ? INK.paper : nodeInk;
      if (selected) box += "outline:2px solid " + ringInk.ring + ";outline-offset:3px;";
      if (intoTarget) box += "outline:2px dashed var(--color-accent-2);outline-offset:3px;";

      const gx = dragging && ghost ? ghost.dx : 0;
      const gy = dragging && ghost ? ghost.dy : 0;
      const hidden = n.collapsed ? n.children.length : 0;

      return {
        id, text: n.text, editing, showInput: editing || selected, showText: !editing,
        wrap: "position:absolute;left:" + p.x + "px;top:" + p.y + "px;width:" + p.w + "px;"
          + "transform:translate(-50%,-50%) translate(" + gx + "px," + gy + "px);"
          + (dragging ? "opacity:0.5;" : "")
          + "z-index:" + (dragging ? 9 : selected ? 5 : 2) + ";",
        box,
        // Editing: an ordinary centered text field. Selected only: the same field
        // kept mounted but visually silent (transparent text, no caret, click-through)
        // and pulled out of flow so the wrapped <span> underneath still shows — it is
        // there purely to hold focus so a keystroke or IME composition starts in place.
        inputStyle: editing
          ? "width:100%;height:" + (p.lines * lh) + "px;border:none;outline:none;background:transparent;text-align:center;font:inherit;"
            + "line-height:" + lh + "px;color:inherit;padding:0;caret-color:var(--color-accent);resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;"
          : "position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;pointer-events:none;border:none;outline:none;background:transparent;text-align:center;font:inherit;color:transparent;caret-color:transparent;padding:0;resize:none;overflow:hidden;",
        inputRef: this.inputRef(id),
        onDown: (e) => this.onNodeDown(id, e),
        onEdit: (e) => { e.stopPropagation(); this.startEdit(id); },
        onInput: (e) => {
          const v = e.target.value;
          const nn = Object.assign({}, this.state.nodes);
          nn[id] = Object.assign({}, nn[id], { text: v });
          const patch = { nodes: nn, srcDirty: false };
          // First character — a Latin keystroke or the first char of an IME
          // composition — typed on a selected node turns the selection into an edit.
          if (this.state.sel === id && this.state.editing !== id) { patch.editing = id; patch.multiSel = []; }
          this.setState(patch);
        },
        onCompositionStart: () => {
          // IME composition started while the node was only selected: select the old
          // text so the composed string replaces it, and switch to the visible editor
          // now so the unconfirmed characters show in place while composing.
          if (this.state.sel === id && this.state.editing !== id) {
            const el = this._inputEls && this._inputEls[id];
            if (el) el.select();
            this.setState({ editing: id, multiSel: [] });
          }
        },
        onKey: (e) => this.handleNodeKey(id, e),
        onBlur: () => { if (this.state.editing === id) this.setState({ editing: null }); },
        hasHidden: hidden > 0,
        hiddenCount: hidden,
        onToggle: (e) => { e.stopPropagation(); this.toggleCollapse(id); },
        badgeStyle: "position:absolute;" + (p.vert
          ? "left:50%;bottom:-11px;transform:translateX(-50%);"
          : "top:50%;" + (p.sign < 0 ? "left:-11px" : "right:-11px") + ";transform:translateY(-50%);")
          + "width:22px;height:22px;border-radius:11px;border:1px solid var(--color-divider);background:var(--color-bg);"
          + "color:var(--color-neutral-700);font:inherit;font-size:11px;line-height:1;cursor:pointer;"
          + "display:flex;align-items:center;justify-content:center;padding:0;"
      };
    });

    let dropLine = "", hasDropLine = false;
    if (s.drop && s.drop.mode !== "into" && pos[s.drop.id]) {
      const p = pos[s.drop.id];
      const before = s.drop.mode === "before";
      hasDropLine = true;
      dropLine = p.vert
        ? "position:absolute;top:" + (p.y - p.h / 2 - 4) + "px;left:" + (p.x + (before ? -p.w / 2 - 5 : p.w / 2 + 5)) + "px;"
          + "width:3px;height:" + (p.h + 8) + "px;background:var(--color-accent-2);z-index:8;"
        : "position:absolute;left:" + (p.x - p.w / 2 - 4) + "px;top:" + (p.y + (before ? -p.h / 2 - 5 : p.h / 2 + 5)) + "px;"
          + "width:" + (p.w + 8) + "px;height:3px;background:var(--color-accent-2);z-index:8;";
    }

    return {
      nodeViews, edges, dropLine, hasDropLine,
      viewStyle: "position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(" + s.pan.x + "px," + s.pan.y + "px) scale(" + s.zoom + ");",
      canvasRef: (el) => { this.canvas = el; },
      sidebarOpen: s.sidebarOpen,
      toggleSidebar: () => this.setState((st) => ({ sidebarOpen: !st.sidebarOpen })),
      sidebarWidth: s.sidebarWidth,
      onSidebarResizeDown: (e) => this.onSidebarResizeDown(e),
      panelSrc: s.panel === "src", panelTheme: s.panel === "theme",
      showSrc: (e) => this.pick(e, () => this.setState({ panel: "src" })),
      showTheme: (e) => this.pick(e, () => this.setState({ panel: "theme" })),
      src: s.srcDirty ? s.src : this.toMermaid(),
      onSrcInput: (e) => this.setState({ src: e.target.value, srcDirty: true }),
      onSrcKey: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); this.applySrc(); } },
      applySrc: () => this.applySrc(),
      dirBothH: s.dir === "both-h", dirRight: s.dir === "right", dirBothV: s.dir === "both-v", dirDown: s.dir === "down",
      setDirBothH: (e) => this.pick(e, () => this.setDir("both-h")), setDirRight: (e) => this.pick(e, () => this.setDir("right")),
      setDirBothV: (e) => this.pick(e, () => this.setDir("both-v")), setDirDown: (e) => this.pick(e, () => this.setDir("down")),
      undo: () => this.undo(), redo: () => this.redo(),
      cut: () => this.cut(), copy: () => this.copy(), paste: () => this.paste(),
      removeSel: () => this.removeSel(),
      moveUp: () => this.reorder(-1), moveDown: () => this.reorder(1),
      copyMermaid: () => this.copyMermaid(), saveLocal: () => this.saveLocal(), loadLocal: () => this.loadLocal(), saveSvg: () => this.saveSvg(),
      zoomIn: () => this.setZoom(s.zoom * 1.2), zoomOut: () => this.setZoom(s.zoom / 1.2), fit: () => this.fit(),
      zoomLabel: Math.round(s.zoom * 100) + "%",
      onCanvasDown: (e) => this.onCanvasDown(e),
      onCanvasDouble: (e) => { if (e.target === this.canvas) this.fit(); },
      noMenu: (e) => e.preventDefault(),
      dragOverFile: s.dragOverFile,
      onCanvasDragOver: (e) => this.onCanvasDragOver(e),
      onCanvasDragLeave: (e) => this.onCanvasDragLeave(e),
      onCanvasDrop: (e) => this.onCanvasDrop(e),
      inkPaper: s.theme.ink === "paper", inkCyan: s.theme.ink === "cyan", inkMagenta: s.theme.ink === "magenta",
      inkYellow: s.theme.ink === "yellow", inkGreen: s.theme.ink === "green", inkPurple: s.theme.ink === "purple",
      inkMulti: s.theme.ink === "multi",
      invertOff: !s.theme.invert, invertOn: !!s.theme.invert,
      setInvertOff: (e) => this.pick(e, () => this.setTheme("invert", false)), setInvertOn: (e) => this.pick(e, () => this.setTheme("invert", true)),
      svgBgPaper: !s.theme.svgTransparentBg, svgBgTransparent: !!s.theme.svgTransparentBg,
      setSvgBgPaper: (e) => this.pick(e, () => this.setTheme("svgTransparentBg", false)), setSvgBgTransparent: (e) => this.pick(e, () => this.setTheme("svgTransparentBg", true)),
      setInkPaper: (e) => this.pick(e, () => this.setTheme("ink", "paper")), setInkCyan: (e) => this.pick(e, () => this.setTheme("ink", "cyan")), setInkMagenta: (e) => this.pick(e, () => this.setTheme("ink", "magenta")),
      setInkYellow: (e) => this.pick(e, () => this.setTheme("ink", "yellow")), setInkGreen: (e) => this.pick(e, () => this.setTheme("ink", "green")), setInkPurple: (e) => this.pick(e, () => this.setTheme("ink", "purple")),
      setInkMulti: (e) => this.pick(e, () => this.setTheme("ink", "multi")),
      shapeBox: s.theme.shape === "box", shapeUnderline: s.theme.shape === "underline", shapeBare: s.theme.shape === "bare",
      setShapeBox: (e) => this.pick(e, () => this.setTheme("shape", "box")), setShapeUnderline: (e) => this.pick(e, () => this.setTheme("shape", "underline")), setShapeBare: (e) => this.pick(e, () => this.setTheme("shape", "bare")),
      edgeCurve: s.theme.edge === "curve", edgeOrtho: s.theme.edge === "ortho", edgeLine: s.theme.edge === "line",
      setEdgeCurve: (e) => this.pick(e, () => this.setTheme("edge", "curve")), setEdgeOrtho: (e) => this.pick(e, () => this.setTheme("edge", "ortho")), setEdgeLine: (e) => this.pick(e, () => this.setTheme("edge", "line")),
      sizeSm: s.theme.size === "sm", sizeMd: s.theme.size === "md", sizeLg: s.theme.size === "lg",
      setSizeSm: (e) => this.pick(e, () => this.setTheme("size", "sm")), setSizeMd: (e) => this.pick(e, () => this.setTheme("size", "md")), setSizeLg: (e) => this.pick(e, () => this.setTheme("size", "lg")),
      toast: s.toast, hasToast: !!s.toast
    };
  }

  /* ——— render ——— */
  render() {
    const v = this.renderVals();
    return (
      <div style={styleObj("display:flex;flex-direction:column;height:100vh;background:var(--color-bg);color:var(--color-text);font-family:'Source Serif 4','Noto Serif JP',serif")}>

        <div style={styleObj("display:flex;align-items:center;gap:14px;padding:10px 16px 10px 14px;flex:0 0 auto")}>
          <button className="btn btn-secondary btn-icon" title="サイドバーの表示切替" onClick={v.toggleSidebar}><i className="ph-duotone ph-sidebar-simple" style={styleObj("font-size:18px")}></i></button>
          <div className="mm-brand" style={styleObj("font-family:var(--font-heading);font-weight:600;font-size:17px;letter-spacing:-0.015em;white-space:nowrap")}>マインドマップ</div>

          <div style={styleObj("display:flex;align-items:center;gap:4px")}>
            <button className="btn btn-secondary btn-icon" title="もとに戻す (⌘Z)" onClick={v.undo}><i className="ph-duotone ph-arrow-counter-clockwise" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="やり直す (⇧⌘Z)" onClick={v.redo}><i className="ph-duotone ph-arrow-clockwise" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="切り取り (⌘X)" onClick={v.cut}><i className="ph-duotone ph-scissors" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="コピー (⌘C)" onClick={v.copy}><i className="ph-duotone ph-copy" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="貼り付け (⌘V)" onClick={v.paste}><i className="ph-duotone ph-clipboard-text" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="削除 (⌫)" onClick={v.removeSel}><i className="ph-duotone ph-trash" style={styleObj("font-size:17px")}></i></button>
          </div>

          <div style={styleObj("display:flex;align-items:center;gap:4px")}>
            <button className="btn btn-secondary btn-icon" title="ひとつ前へ並べ替え (⌥↑)" onClick={v.moveUp}><i className="ph-duotone ph-arrow-line-up" style={styleObj("font-size:17px")}></i></button>
            <button className="btn btn-secondary btn-icon" title="ひとつ後へ並べ替え (⌥↓)" onClick={v.moveDown}><i className="ph-duotone ph-arrow-line-down" style={styleObj("font-size:17px")}></i></button>
          </div>

          <div style={styleObj("display:flex;align-items:center;gap:6px")}>
            <button className="btn btn-secondary" style={styleObj("height:36px")} title="mermaidをクリップボードにコピー" onClick={v.copyMermaid}><i className="ph-duotone ph-clipboard" style={styleObj("font-size:16px")}></i><span className="mm-lbl">mermaidをコピー</span></button>
            <button className="btn btn-secondary" style={styleObj("height:36px")} title="SVGとして保存" onClick={v.saveSvg}><i className="ph-duotone ph-image" style={styleObj("font-size:16px")}></i><span className="mm-lbl">SVGで保存</span></button>
            <button className="btn btn-secondary" style={styleObj("height:36px")} title="localStorageに保存 (⌘S)" onClick={v.saveLocal}><i className="ph-duotone ph-floppy-disk" style={styleObj("font-size:16px")}></i><span className="mm-lbl">保存</span></button>
            <button className="btn btn-secondary" style={styleObj("height:36px")} title="localStorageから読み込み" onClick={v.loadLocal}><i className="ph-duotone ph-folder-open" style={styleObj("font-size:16px")}></i><span className="mm-lbl">読み込み</span></button>
          </div>

          <div style={styleObj("display:flex;align-items:center;gap:4px;margin-left:auto")}>
            <button className="btn btn-secondary btn-icon" title="縮小" onClick={v.zoomOut}><i className="ph-duotone ph-minus" style={styleObj("font-size:16px")}></i></button>
            <div style={styleObj("min-width:52px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums;color:var(--color-neutral-700)")}>{v.zoomLabel}</div>
            <button className="btn btn-secondary btn-icon" title="拡大" onClick={v.zoomIn}><i className="ph-duotone ph-plus" style={styleObj("font-size:16px")}></i></button>
            <button className="btn btn-secondary" style={styleObj("height:36px")} title="全体表示 (⌘⇧H)" onClick={v.fit}><i className="ph-duotone ph-frame-corners" style={styleObj("font-size:16px")}></i><span className="mm-lbl">全体表示</span></button>
          </div>
        </div>

        <div style={styleObj("display:flex;flex:1;min-height:0")}>

          {v.sidebarOpen && (
            <>
            <div style={styleObj("width:" + v.sidebarWidth + "px;flex:0 0 " + v.sidebarWidth + "px;display:flex;flex-direction:column;gap:14px;padding:4px 20px 18px 18px;min-height:0")}>
              <div className="seg" role="radiogroup" style={styleObj("align-self:flex-start")}>
                <label className="seg-opt">ソース
                  <input type="radio" name="mmpanel" checked={v.panelSrc} onChange={v.showSrc} style={styleObj("position:absolute;opacity:0;width:0;height:0")} />
                </label>
                <label className="seg-opt">テーマ
                  <input type="radio" name="mmpanel" checked={v.panelTheme} onChange={v.showTheme} style={styleObj("position:absolute;opacity:0;width:0;height:0")} />
                </label>
              </div>

              {v.panelSrc && (
                <div style={styleObj("display:flex;flex-direction:column;gap:10px;flex:1;min-height:0")}>
                  <textarea className="input mm-src" spellCheck={false} value={v.src} onChange={v.onSrcInput} onKeyDown={v.onSrcKey} style={styleObj("flex:1;min-height:0;resize:none")} />
                  <div style={styleObj("display:flex;align-items:center;gap:10px")}>
                    <button className="btn btn-primary" style={styleObj("height:36px")} onClick={v.applySrc}>反映</button>
                    <span style={styleObj("font-size:12px;color:var(--color-neutral-700)")}>⌘Enter でも反映。図の編集はソースに自動反映。</span>
                  </div>
                </div>
              )}

              {v.panelTheme && (
                <div style={styleObj("display:flex;flex-direction:column;gap:18px;overflow-y:auto")}>
                  <div className="field">
                    <label>展開方向</label>
                    <div style={styleObj("display:flex;flex-wrap:wrap;gap:6px")}>
                      <div className="seg">
                        <label className="seg-opt">中心から左右<input type="radio" name="mmdir" checked={v.dirBothH} onChange={v.setDirBothH} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">左から右<input type="radio" name="mmdir" checked={v.dirRight} onChange={v.setDirRight} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      </div>
                      <div className="seg">
                        <label className="seg-opt">中心から上下<input type="radio" name="mmdir" checked={v.dirBothV} onChange={v.setDirBothV} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">上から下<input type="radio" name="mmdir" checked={v.dirDown} onChange={v.setDirDown} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      </div>
                    </div>
                  </div>
                  <div className="field">
                    <label>配色</label>
                    <div style={styleObj("display:flex;flex-wrap:wrap;gap:6px")}>
                      <div className="seg">
                        <label className="seg-opt">紙<input type="radio" name="mmink" checked={v.inkPaper} onChange={v.setInkPaper} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">シアン<input type="radio" name="mmink" checked={v.inkCyan} onChange={v.setInkCyan} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">マゼンタ<input type="radio" name="mmink" checked={v.inkMagenta} onChange={v.setInkMagenta} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      </div>
                      <div className="seg">
                        <label className="seg-opt">イエロー<input type="radio" name="mmink" checked={v.inkYellow} onChange={v.setInkYellow} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">グリーン<input type="radio" name="mmink" checked={v.inkGreen} onChange={v.setInkGreen} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                        <label className="seg-opt">パープル<input type="radio" name="mmink" checked={v.inkPurple} onChange={v.setInkPurple} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      </div>
                      <div className="seg">
                        <label className="seg-opt">カラフル<input type="radio" name="mmink" checked={v.inkMulti} onChange={v.setInkMulti} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      </div>
                    </div>
                  </div>
                  <div className="field">
                    <label>1階層目の塗り</label>
                    <div className="seg">
                      <label className="seg-opt">通常<input type="radio" name="mminvert" checked={v.invertOff} onChange={v.setInvertOff} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">反転(中心を黒に)<input type="radio" name="mminvert" checked={v.invertOn} onChange={v.setInvertOn} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                    </div>
                  </div>
                  <div className="field">
                    <label>SVG背景</label>
                    <div className="seg">
                      <label className="seg-opt">紙<input type="radio" name="mmsvgbg" checked={v.svgBgPaper} onChange={v.setSvgBgPaper} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">透明<input type="radio" name="mmsvgbg" checked={v.svgBgTransparent} onChange={v.setSvgBgTransparent} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                    </div>
                  </div>
                  <div className="field">
                    <label>ノードの形</label>
                    <div className="seg">
                      <label className="seg-opt">角丸ボックス<input type="radio" name="mmshape" checked={v.shapeBox} onChange={v.setShapeBox} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">下線のみ<input type="radio" name="mmshape" checked={v.shapeUnderline} onChange={v.setShapeUnderline} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">枠なし<input type="radio" name="mmshape" checked={v.shapeBare} onChange={v.setShapeBare} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                    </div>
                  </div>
                  <div className="field">
                    <label>接続線</label>
                    <div className="seg">
                      <label className="seg-opt">曲線<input type="radio" name="mmedge" checked={v.edgeCurve} onChange={v.setEdgeCurve} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">直角<input type="radio" name="mmedge" checked={v.edgeOrtho} onChange={v.setEdgeOrtho} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">直線<input type="radio" name="mmedge" checked={v.edgeLine} onChange={v.setEdgeLine} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                    </div>
                  </div>
                  <div className="field">
                    <label>文字サイズ・密度</label>
                    <div className="seg">
                      <label className="seg-opt">小<input type="radio" name="mmsize" checked={v.sizeSm} onChange={v.setSizeSm} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">中<input type="radio" name="mmsize" checked={v.sizeMd} onChange={v.setSizeMd} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                      <label className="seg-opt">大<input type="radio" name="mmsize" checked={v.sizeLg} onChange={v.setSizeLg} style={styleObj("position:absolute;opacity:0;width:0;height:0")} /></label>
                    </div>
                  </div>
                  <p style={styleObj("font-size:12.5px;color:var(--color-neutral-700);margin:0")}>配置は展開方向から自動で決まります。ドラッグはノードの端に落とすと並べ替え、中央に落とすとその子として付け替えです。</p>
                </div>
              )}
            </div>
            <div className="mm-sidebar-handle" title="サイドバーの幅を調整" onMouseDown={v.onSidebarResizeDown} style={styleObj("flex:0 0 6px;width:6px;cursor:col-resize")} />
            </>
          )}

          <div ref={v.canvasRef} tabIndex={-1} onMouseDown={v.onCanvasDown} onContextMenu={v.noMenu} onDoubleClick={v.onCanvasDouble}
            onDragOver={v.onCanvasDragOver} onDragLeave={v.onCanvasDragLeave} onDrop={v.onCanvasDrop}
            style={styleObj("position:relative;flex:1;min-width:0;overflow:hidden;background-image:radial-gradient(var(--color-neutral-300) 1px, transparent 1px);background-size:26px 26px;background-position:center;cursor:default;outline:none"
              + (v.dragOverFile ? ";outline:3px dashed var(--color-accent);outline-offset:-3px;" : ""))}>
            <div style={styleObj(v.viewStyle)}>
              <svg width="1" height="1" style={styleObj("position:absolute;left:0;top:0;overflow:visible;pointer-events:none")}>
                {v.edges.map((e, i) => (
                  <path key={i} d={e.d} stroke={e.stroke} strokeWidth={e.w} fill="none" strokeLinecap="round" />
                ))}
              </svg>
              {v.nodeViews.map((n) => (
                <div key={n.id} style={styleObj(n.wrap)}>
                  <div style={styleObj(n.box)} onMouseDown={n.onDown} onDoubleClick={n.onEdit}>
                    {n.showInput && (
                      <textarea value={n.text} ref={n.inputRef} onChange={n.onInput} onKeyDown={n.onKey} onCompositionStart={n.onCompositionStart} onBlur={n.onBlur} style={styleObj(n.inputStyle)} />
                    )}
                    {n.showText && <span>{n.text}</span>}
                  </div>
                  {n.hasHidden && (
                    <button onClick={n.onToggle} title="子を開く" style={styleObj(n.badgeStyle)}>{n.hiddenCount}</button>
                  )}
                </div>
              ))}
              {v.hasDropLine && <div style={styleObj(v.dropLine)} />}
            </div>

            <div className="mm-hints" style={styleObj("position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:10px 16px;font-size:12px;color:var(--color-neutral-700);pointer-events:none")}>
              <span>Enter 兄弟・確定</span><span>⇧Enter 改行</span><span>Tab 子</span><span>↑↓←→ 移動</span><span>⌥↑↓ 並べ替え</span><span>F2 編集</span><span>⌫ 削除</span><span>⌘S 保存</span><span>⌘クリック 複数選択</span><span>⌘A 全選択</span><span>⌘⇧H 全体表示</span><span>ドラッグ 並べ替え・付け替え</span><span>右ドラッグ 画面移動</span><span>ホイール ズーム</span>
              {v.hasToast && <span className="tag tag-accent" style={styleObj("margin-left:auto")}>{v.toast}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default MindMapApp;
