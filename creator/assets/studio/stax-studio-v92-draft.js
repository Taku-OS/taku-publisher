(function () {
  const board = document.getElementById("pboard");
  const card = document.getElementById("card");
  if (!board || !card || typeof placedP === "undefined") return;

  const debugMode = new URLSearchParams(window.location.search).get("mode") === "debug";
  // Placeholder components belong only to the debug layout preview.
  if (!debugMode) return;
  const unit = typeof U === "number" ? U : 104;
  const gap = typeof GAP === "number" ? GAP : 8;
  const cols = typeof PCOLS === "number" ? PCOLS : 8;
  const rows = typeof PROWS === "number" ? PROWS : 5;
  const slots = [
    { key: "aura", x: 0, y: 0, w: 1, h: 1, label: "TOP", tone: "dark", kind: "rank" },
    { key: "dial", x: 1, y: 0, w: 2, h: 1, label: "SCORE", kind: "score" },
    { key: "team", x: 3, y: 0, w: 2, h: 1, label: "TEAM", kind: "plain" },
    { key: "tally", x: 5, y: 0, w: 2, h: 1, label: "SHIPPED · ALL TIME", kind: "bars" },
    { key: "qr", x: 7, y: 0, w: 1, h: 1, label: "QR LINK", kind: "qr" },
    { key: "heat", x: 0, y: 1, w: 2, h: 2, label: "DAILY BUILDS · 90D", kind: "heat" },
    { key: "hero", x: 2, y: 1, w: 4, h: 2, label: "PRIVATE DRAFT", tone: "peach", kind: "hero" },
    { key: "type", x: 6, y: 1, w: 2, h: 2, label: "TYPE", kind: "type" },
    { key: "trend", x: 0, y: 3, w: 1, h: 1, label: "30 DAYS", kind: "plain" },
    { key: "bars90", x: 1, y: 3, w: 2, h: 1, label: "TOKENS · 90D", kind: "bars" },
    { key: "basic", x: 3, y: 3, w: 1, h: 1, label: "DAYS ON TAKU", tone: "mint", kind: "plain" },
    { key: "seal", x: 4, y: 3, w: 2, h: 2, label: "SERIAL", kind: "seal" },
    { key: "peaks", x: 6, y: 3, w: 2, h: 1, label: "BEST DAY", kind: "bars" },
    { key: "stadium", x: 0, y: 4, w: 2, h: 1, label: "TOKENS · ALL TIME", tone: "cream", kind: "plain" },
    { key: "vsavg", x: 2, y: 4, w: 2, h: 1, label: "TOKENS VS AVG", kind: "bars" },
    { key: "social", x: 6, y: 4, w: 2, h: 1, label: "FIND ME", kind: "plain" },
  ];

  const host = document.createElement("div");
  host.className = "v92-draft-slots";
  host.setAttribute("aria-label", "Draft component placeholders");
  board.appendChild(host);

  const records = slots.map((slot) => ({
    ...slot,
    cx: slot.x,
    cy: slot.y,
    cw: slot.w,
    ch: slot.h,
    el: makeSlot(slot),
    visible: false,
  }));
  let cleared = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function dots(count, green) {
    return `<div class="slot-dots${green ? " green" : ""}">${Array.from({ length: count }, () => "<i></i>").join("")}</div>`;
  }

  function bars(count) {
    return `<div class="slot-bars">${Array.from({ length: count }, () => "<i></i>").join("")}</div>`;
  }

  function contentFor(slot) {
    const label = `<span class="slot-label">${esc(slot.label)}</span>`;
    const waiting = '<span class="slot-lock">AWAITING DATA</span><span class="slot-value">—</span>';
    if (slot.kind === "rank") return `${label}<i class="slot-mark"></i>${waiting}`;
    if (slot.kind === "score") return `${label}${dots(24, false)}${waiting}`;
    if (slot.kind === "bars") return `${label}${bars(13)}${waiting}`;
    if (slot.kind === "qr") return `${label}<div class="slot-qr">${Array.from({ length: 24 }, () => "<i></i>").join("")}</div>${waiting}`;
    if (slot.kind === "heat") return `${label}${dots(91, true)}${waiting}`;
    if (slot.kind === "type") return `${label}${dots(26, false)}${waiting}`;
    if (slot.kind === "seal") return R.seal(slot.w * unit - gap, slot.h * unit - gap);
    if (slot.kind === "hero") {
      const data = window.__TAKU_STAX_DATA__ || {};
      const art = data.artDataUrl || (typeof ART !== "undefined" && ART[data.art || "inv"]) || "";
      return `<div class="slot-hero-head"><span>PRIVATE DRAFT</span><small>${esc(data.family || "BUILDERS")}</small><b>AI</b></div><strong class="slot-hero-title">${esc(data.personaTitle || "AI Builder")}</strong>${data.heroDefinition ? `<p>${esc(data.heroDefinition)}</p>` : ""}${art ? `<img class="slot-hero-art" src="${esc(art)}" alt="">` : ""}`;
    }
    return `${label}${waiting}`;
  }

  function makeSlot(slot) {
    const el = document.createElement("div");
    el.className = `v92-draft-slot${slot.tone ? ` is-${slot.tone}` : ""}${slot.kind === "hero" ? " is-hero" : ""}`;
    el.dataset.draftKey = slot.key;
    el.innerHTML = contentFor(slot);
    if (debugMode) {
      el.classList.add("is-editable");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", `${slot.label} placeholder, draggable component`);
    }
    return el;
  }

  function intersects(a, b) {
    return a.cx < b.cx + b.cw && a.cx + a.cw > b.cx && a.cy < b.cy + b.ch && a.cy + a.ch > b.cy;
  }

  function position(rec) {
    rec.el.style.left = `${rec.cx * unit + gap / 2}px`;
    rec.el.style.top = `${rec.cy * unit + gap / 2}px`;
    rec.el.style.width = `${rec.cw * unit - gap}px`;
    rec.el.style.height = `${rec.ch * unit - gap}px`;
  }

  function visibleRecords() {
    return records.filter((rec) => rec.visible);
  }

  function draftCandidates(real = placedP) {
    const data = window.__TAKU_STAX_DATA__ || {};
    const blockList = Array.isArray(data.blocks) ? data.blocks : [];
    const byKey = new Map(blockList.map((block) => [block.key, block]));
    const isPublisher = typeof CURP !== "undefined" && CURP === "publisher";
    const show = isPublisher && !cleared && !data.readonly;
    if (!show) return [];
    return records.filter((rec) => {
      const block = byKey.get(rec.key);
      return (!block || block.status === "unsupported") && !real.some((item) => item.key === rec.key);
    });
  }

  function render() {
    const real = Array.isArray(placedP) ? placedP : [];
    const candidates = new Set(draftCandidates(real));
    const visible = [];

    for (const rec of records) {
      rec.visible = candidates.has(rec);
      if (!rec.visible || real.some((item) => intersects(rec, item))) {
        rec.visible = false;
        continue;
      }
      // A real block can be dragged over a draft slot. Hide that covered slot
      // and reveal it again when the real block moves away.
      if (visible.some((item) => intersects(rec, item))) {
        rec.visible = false;
        continue;
      }
      position(rec);
      visible.push(rec);
    }

    const keep = new Set(visible.map((rec) => rec.el));
    for (const child of [...host.children]) {
      if (!keep.has(child)) child.remove();
    }
    visible.forEach((rec, index) => {
      const current = host.children[index];
      if (current !== rec.el) host.insertBefore(rec.el, current || null);
    });
  }

  function insideBoard(rec, x, y) {
    return x >= 0 && y >= 0 && x + rec.cw <= cols && y + rec.ch <= rows;
  }

  function reflow(moving, cx, cy) {
    if (!insideBoard(moving, cx, cy)) return null;
    const items = [...placedP, ...draftCandidates(placedP)];
    const movingIndex = items.indexOf(moving);
    if (movingIndex < 0) return null;
    const occupiedMask = (x, y, w, h) => {
      let mask = 0n;
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) mask |= 1n << BigInt((y + dy) * cols + x + dx);
      }
      return mask;
    };
    const positions = (item) => {
      const list = [];
      for (let y = 0; y <= rows - item.ch; y++) {
        for (let x = 0; x <= cols - item.cw; x++) {
          list.push({ x, y, mask: occupiedMask(x, y, item.cw, item.ch), distance: Math.abs(x - item.cx) + Math.abs(y - item.cy) });
        }
      }
      return list.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    };

    const fixedMask = occupiedMask(cx, cy, moving.cw, moving.ch);
    const remaining = items.filter((item) => item !== moving);
    const assigned = new Map([[moving, [cx, cy]]]);
    let visited = 0;
    const search = (pending, occupied) => {
      if (!pending.length) return true;
      if (++visited > 50000) return false;

      let selectedIndex = -1;
      let selectedOptions = null;
      for (let index = 0; index < pending.length; index++) {
        const item = pending[index];
        const options = positions(item).filter((spot) => (spot.mask & occupied) === 0n);
        if (!options.length) return false;
        if (!selectedOptions || options.length < selectedOptions.length || (options.length === selectedOptions.length && item.cw * item.ch > pending[selectedIndex].cw * pending[selectedIndex].ch)) {
          selectedIndex = index;
          selectedOptions = options;
          if (options.length === 1) break;
        }
      }

      const [item] = pending.splice(selectedIndex, 1);
      for (const spot of selectedOptions) {
        assigned.set(item, [spot.x, spot.y]);
        if (search(pending, occupied | spot.mask)) return true;
      }
      assigned.delete(item);
      pending.splice(selectedIndex, 0, item);
      return false;
    };

    if (!search(remaining, fixedMask)) return null;
    return {
      moves: [...assigned.entries()]
        .filter(([item, [x, y]]) => item !== moving && (item.cx !== x || item.cy !== y))
        .map(([item, [x, y]]) => [item, x, y]),
    };
  }

  function findMoves(moving, cx, cy, includeHiddenDraft = false) {
    if (!insideBoard(moving, cx, cy)) return null;
    const target = { cx, cy, cw: moving.cw, ch: moving.ch };
    const draftBlocks = includeHiddenDraft ? draftCandidates(placedP) : visibleRecords();
    const others = [...placedP, ...draftBlocks].filter((item) => item !== moving);
    const blockers = others.filter((item) => intersects(target, item));
    if (!blockers.length) return { moves: [] };

    const occupied = [];
    const reserve = (rec) => occupied.push({ cx: rec.cx, cy: rec.cy, cw: rec.cw, ch: rec.ch });
    reserve(target);
    others.filter((item) => !blockers.includes(item)).forEach(reserve);
    const moves = [];
    const ordered = [...blockers].sort((a, b) => b.cw * b.ch - a.cw * a.ch);

    for (const blocker of ordered) {
      const candidates = [];
      for (let y = 0; y <= rows - blocker.ch; y++) {
        for (let x = 0; x <= cols - blocker.cw; x++) {
          candidates.push({ x, y, distance: Math.abs(x - blocker.cx) + Math.abs(y - blocker.cy) });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
      const spot = candidates.find((candidate) => {
        const box = { cx: candidate.x, cy: candidate.y, cw: blocker.cw, ch: blocker.ch };
        return !occupied.some((item) => intersects(box, item));
      });
      if (!spot) return null;
      moves.push([blocker, spot.x, spot.y]);
      occupied.push({ cx: spot.x, cy: spot.y, cw: blocker.cw, ch: blocker.ch });
    }
    return { moves };
  }

  function setPosition(rec, cx, cy) {
    rec.cx = cx;
    rec.cy = cy;
    position(rec);
  }

  function repackAfterRealMove(moving) {
    if (!debugMode || !moving || !placedP.includes(moving)) return false;
    const candidates = draftCandidates(placedP);
    if (!candidates.some((item) => intersects(moving, item))) return false;
    const solution = findMoves(moving, moving.cx, moving.cy, true)
      || reflow(moving, moving.cx, moving.cy);
    if (!solution) return false;
    for (const [item, x, y] of solution.moves) setPosition(item, x, y);
    return true;
  }

  window.__TAKU_STAX_DRAFT_REPACK__ = repackAfterRealMove;

  function attachDrag(rec) {
    rec.el.addEventListener("pointerdown", (event) => {
      if (!debugMode || event.button !== 0) return;
      event.preventDefault();
      const boardRect = board.getBoundingClientRect();
      const elementRect = rec.el.getBoundingClientRect();
      const scale = typeof boardScale === "function" ? boardScale() : {
        x: boardRect.width / (board.offsetWidth || 1) || 1,
        y: boardRect.height / (board.offsetHeight || 1) || 1,
      };
      const offsetX = (event.clientX - elementRect.left) / scale.x;
      const offsetY = (event.clientY - elementRect.top) / scale.y;
      const point = (e) => [
        (e.clientX - boardRect.left) / scale.x - offsetX,
        (e.clientY - boardRect.top) / scale.y - offsetY,
      ];
      rec.el.classList.add("is-dragging");
      rec.el.style.zIndex = "200";

      const move = (e) => {
        const [left, top] = point(e);
        rec.el.style.left = `${left}px`;
        rec.el.style.top = `${top}px`;
        const cx = Math.round((left - gap / 2) / unit);
        const cy = Math.round((top - gap / 2) / unit);
        const solution = findMoves(rec, cx, cy);
        const previewState = solution ? (solution.moves.length ? 2 : 1) : (insideBoard(rec, cx, cy) ? 2 : 0);
        if (typeof ghost === "function") ghost(rec.cw, rec.ch, cx, cy, previewState);
      };

      const finish = (e) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        rec.el.classList.remove("is-dragging");
        rec.el.style.zIndex = "";
        if (typeof ghost === "function") ghost(null);
        const [left, top] = point(e);
        const cx = Math.round((left - gap / 2) / unit);
        const cy = Math.round((top - gap / 2) / unit);
        const solution = findMoves(rec, cx, cy) || reflow(rec, cx, cy);
        if (solution) {
          for (const [item, x, y] of solution.moves) setPosition(item, x, y);
          setPosition(rec, cx, cy);
        } else {
          position(rec);
        }
        if (typeof counts === "function") counts();
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
    });

    rec.el.addEventListener("keydown", (event) => {
      if (!debugMode || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      }[event.key];
      const cx = rec.cx + delta[0];
      const cy = rec.cy + delta[1];
      const solution = findMoves(rec, cx, cy) || reflow(rec, cx, cy);
      if (!solution) return;
      for (const [item, x, y] of solution.moves) setPosition(item, x, y);
      setPosition(rec, cx, cy);
      if (typeof counts === "function") counts();
    });
  }

  records.forEach(attachDrag);
  const originalCounts = counts;
  counts = function () {
    originalCounts();
    render();
  };

  document.getElementById("bclear")?.addEventListener("click", () => {
    cleared = true;
    render();
  }, true);
  document.getElementById("ball")?.addEventListener("click", () => {
    cleared = false;
    render();
  }, true);

  render();
})();
