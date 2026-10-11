// Injected into the active tab from the side panel with window.__dc_pick =
// { mode, requestId }.
//
//   element mode — hover-highlight, ArrowUp/Down to the parent/child, click to
//     capture (reads measured tokens). One screenshot, short release timeout.
//   area mode   — drag a box in DOCUMENT coordinates. Holding the pointer at the
//     bottom (or top) edge for 2s starts scrolling, so the selection can extend
//     past the viewport. On release the panel drives a scroll-and-stitch capture
//     through DC_PREPARE_STITCH / DC_SCROLL_TO / DC_END_STITCH, and this script
//     keeps the page still and restores it afterwards.
//
// Reports requestId + geometry + viewport; the panel validates sender identity,
// intersects/clamps geometry, and screenshots. Animations are paused and overlays
// hidden before any capture. Every exit path restores styles and listeners.
(() => {
  const KEY = "__dc_picker__";
  const CFG = window.__dc_pick || { mode: "element" };
  const MODE = CFG.mode === "region" || CFG.mode === "area" ? "area" : "element";
  const REQ = CFG.requestId || `local-${Date.now()}`;
  if (window[KEY]) { try { window[KEY].stop(); } catch {} } // supersede any prior session

  const PROPS = [
    "color","background-color","background-image","border-top-color","border-top-width",
    "border-top-style","border-radius","box-shadow","outline-color","font-family","font-size",
    "font-weight","font-style","line-height","letter-spacing","text-transform","padding-top",
    "padding-right","padding-bottom","padding-left","margin-top","margin-bottom","display",
    "flex-direction","justify-content","align-items","gap","color-scheme",
  ];
  function scanSheetsForRootVars() {
    const vars = {};
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) if (rule.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText))
        for (const p of rule.style) if (p.startsWith("--")) vars[p] = rule.style.getPropertyValue(p).trim();
    }
    return vars;
  }
  function findKeyframes(name) {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === name) return rule.cssText;
    }
    return "";
  }
  const STATE_PROPS = ["color", "background-color", "border-color", "box-shadow", "transform", "opacity", "text-decoration", "filter"];
  function matchStateRules(el) {
    const out = {};
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        for (const sel of rule.selectorText.split(",")) {
          const m = /:(hover|focus(?:-visible)?)\b/.exec(sel);
          if (!m) continue;
          const base = sel.replace(/:(hover|focus(?:-visible)?|active)\b/g, "").trim();
          let hit = false; try { hit = !!base && el.matches(base); } catch {}
          if (!hit) continue;
          const key = m[1].startsWith("focus") ? "focus" : "hover";
          const decls = out[key] || (out[key] = {});
          for (const p of STATE_PROPS) { const v = rule.style.getPropertyValue(p).trim(); if (v) decls[p] = v; }
        }
      }
    }
    return out;
  }
  function resolveFonts(stack) {
    const families = stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    let candidate = null;
    for (const f of families) { try { if (document.fonts && document.fonts.check(`16px "${f}"`)) { candidate = f; break; } } catch {} }
    // document.fonts.check reports a face as usable — not that it exists on the
    // system, nor that it rendered this element. A hint only; never verified.
    return { stack, families, availabilityCandidate: candidate, method: "document.fonts.check", verified: false, uncertain: true };
  }
  function fontsReady(ms) {
    const ready = (document.fonts && document.fonts.ready) || Promise.resolve();
    return Promise.race([Promise.resolve(ready).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  }
  async function extractTokens(el) {
    const pre = getComputedStyle(el); // motion read before pausing
    const motion = { transition: pre.getPropertyValue("transition").trim(), animation: pre.getPropertyValue("animation").trim(), animationName: pre.getPropertyValue("animation-name").trim(), duration: pre.getPropertyValue("transition-duration").trim(), timing: pre.getPropertyValue("transition-timing-function").trim() };
    let keyframes = ""; try { if (motion.animationName && motion.animationName !== "none") keyframes = findKeyframes(motion.animationName); } catch {}
    let states = {}; try { states = matchStateRules(el); } catch {}
    await fontsReady(1500); // bounded: picking cannot hang on web fonts
    const cs = getComputedStyle(el); const computed = {};
    for (const p of PROPS) computed[p] = cs.getPropertyValue(p).trim();
    let rootVars = {}, rootVarsPath = "none";
    try { const rcs = getComputedStyle(document.documentElement); for (let i = 0; i < rcs.length; i++) { const n = rcs[i]; if (n.startsWith("--")) rootVars[n] = rcs.getPropertyValue(n).trim(); } if (Object.keys(rootVars).length) rootVarsPath = "computed"; } catch {}
    if (rootVarsPath === "none") { try { rootVars = scanSheetsForRootVars(); if (Object.keys(rootVars).length) rootVarsPath = "stylesheets"; } catch {} }
    const contrastContext = { background: null, uncertain: false, reason: null };
    let ancestor=el, depth=0;
    while(ancestor&&depth++<40){
      const s=getComputedStyle(ancestor);
      if(Number(s.opacity)!==1||s.filter!=='none'||s.mixBlendMode!=='normal'){
        contrastContext.uncertain=true;contrastContext.reason='Opacity, filters, or blending affect the painted colors.';
      }
      if(!contrastContext.background){
        if(s.backgroundImage!=='none'){
          contrastContext.uncertain=true;contrastContext.reason='A gradient or image affects the text background.';
        }
        const bg=s.backgroundColor;
        if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')contrastContext.background=bg;
      }
      ancestor=ancestor.parentElement;
    }
    if(!contrastContext.background){contrastContext.uncertain=true;contrastContext.reason='No explicit opaque background was found; the browser canvas is not inferred.';}
    if(ancestor){contrastContext.uncertain=true;contrastContext.reason='Background ancestry exceeds the inspection limit.';}
    return { computed, rootVars, rootVarsPath, fonts: resolveFonts(computed["font-family"] || ""), motion, keyframes, states, contrastContext };
  }

  // ---------------- page metrics ----------------
  const scrollEl = () => document.scrollingElement || document.documentElement;
  const getScroll = () => ({ x: window.scrollX || 0, y: window.scrollY || 0 });
  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
  function metrics() {
    const se = scrollEl();
    const b = document.body;
    const docH = Math.max(se ? se.scrollHeight : 0, b ? b.scrollHeight : 0, window.innerHeight);
    const docW = Math.max(se ? se.scrollWidth : 0, b ? b.scrollWidth : 0, window.innerWidth);
    const v = viewport();
    return { docH, docW, vw: v.w, vh: v.h, maxScroll: Math.max(0, docH - v.h), scrollX: getScroll().x, scrollY: getScroll().y, scrolls: docH > v.h + 2 };
  }

  // ---------------- overlays ----------------
  const z = 2147483647;
  const box = document.createElement("div");
  Object.assign(box.style, { position: "fixed", zIndex: z, pointerEvents: "none", display: "none", left: "0", top: "0", width: "0", height: "0", boxSizing: "border-box" });
  if (MODE === "area") Object.assign(box.style, { border: "2px dashed #2F4C8B", background: "rgba(47,76,139,0.12)" });
  else Object.assign(box.style, { border: "2px solid #2F4C8B", background: "rgba(47,76,139,0.14)", boxShadow: "0 0 0 100vmax rgba(0,0,0,0.06)" });
  const label = document.createElement("div");
  Object.assign(label.style, { position: "fixed", zIndex: z, pointerEvents: "none", display: "none", font: "11px ui-monospace,Menlo,monospace", background: "#2F4C8B", color: "#fff", padding: "2px 6px", borderRadius: "3px", whiteSpace: "nowrap" });
  const hint = document.createElement("div");
  Object.assign(hint.style, { position: "fixed", zIndex: z, pointerEvents: "none", left: "50%", bottom: "16px", transform: "translateX(-50%)", font: "12px ui-sans-serif,system-ui,sans-serif", background: "#191917", color: "#fff", padding: "8px 14px", borderRadius: "999px", boxShadow: "0 6px 20px rgba(0,0,0,.35)", textAlign: "center" });
  const HINT_IDLE = MODE === "area"
    ? "Drag to select  ·  hold at the bottom edge to scroll  ·  Esc cancels"
    : "Click to capture  ·  ↑ parent · ↓ child  ·  Esc to cancel";
  hint.textContent = HINT_IDLE;
  document.documentElement.append(box, label, hint);
  const showOverlays = () => { hint.style.display = "block"; };

  function drawElement(el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    label.style.display = "block"; label.style.left = r.left + "px"; label.style.top = Math.max(0, r.top - 20) + "px";
    label.textContent = `${el.tagName.toLowerCase()} · ${Math.round(r.width)}×${Math.round(r.height)}` + (el.tagName === "IFRAME" ? " · iframe (box only)" : "");
  }

  // ---- lifecycle via the shared controller (content/pick-controller.js) ----
  let torn = false, pauseStyle = null, releaseTimer = 0, totalTimer = 0;
  const prevUS = document.body ? document.body.style.userSelect : "";
  const listeners = [];
  const on = (target, t, h, c) => { target.addEventListener(t, h, c); listeners.push([target, t, h, c]); };

  // ---- stitch support: keep the page still, then put it back exactly ----
  const pinned = new WeakSet();
  let pinnedList = [];            // [{el, style}] — style is the ORIGINAL style attribute
  let stitchStyle = null;         // scroll-behavior + animation freeze
  let originalScroll = null;      // restored when the stitch ends
  let scanLimited = false;
  let scrollBlockers = [];        // user-scroll blockers added during the controlled stage

  function freezePage() {
    if (!stitchStyle) {
      stitchStyle = document.createElement("style");
      // Instant scrolling is required: a smooth-scrolling page would be captured
      // mid-animation. Animations are paused so tiles can't disagree.
      stitchStyle.textContent = "html,body{scroll-behavior:auto!important}*,*::before,*::after{animation-play-state:paused!important}";
      document.documentElement.appendChild(stitchStyle);
    }
  }
  // While WE drive the scroll for a stitch, the user must not also scroll — a wheel
  // nudge or a scroll key between a tile's planned offset and its screenshot would
  // misplace that tile. Block the usual user-scroll inputs (our window.scrollTo is
  // not affected); every blocker is restored by restorePage() on end/cancel/fail.
  const SCROLL_KEYS = new Set([" ", "Spacebar", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  function blockUserScroll() {
    if (scrollBlockers.length) return;
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    const key = (e) => { if (SCROLL_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); } };
    const add = (t, type, h, opts) => { t.addEventListener(type, h, opts); scrollBlockers.push([t, type, h, opts]); };
    add(window, "wheel", swallow, { passive: false, capture: true });
    add(window, "touchmove", swallow, { passive: false, capture: true });
    add(window, "keydown", key, true);
  }
  function unblockUserScroll() {
    for (const [t, type, h, opts] of scrollBlockers.splice(0)) { try { t.removeEventListener(type, h, opts); } catch {} }
  }
  // Fixed elements are pinned where they are so they appear exactly ONCE instead
  // of in every tile; sticky elements fall back to their natural flow position.
  // A fixed element covering most of the viewport is an overlay (cookie wall,
  // modal backdrop) — hidden instead of pinned, or it would mask the content.
  function neutralizeFixed(budget) {
    const all = document.body ? document.body.querySelectorAll("*") : [];
    const v = viewport(); const s = getScroll();
    let scanned = 0;
    for (const el of all) {
      if (scanned++ >= budget) { scanLimited = true; break; }
      if (el === box || el === label || el === hint || pinned.has(el)) continue;
      let cs; try { cs = getComputedStyle(el); } catch { continue; }
      const pos = cs.position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      const r = el.getBoundingClientRect();
      pinned.add(el);
      pinnedList.push({ el, style: el.getAttribute("style") });
      const covers = r.width * r.height > v.w * v.h * 0.6;
      if (pos === "fixed" && covers) {
        el.style.setProperty("visibility", "hidden", "important");
      } else if (pos === "fixed") {
        el.style.setProperty("position", "absolute", "important");
        el.style.setProperty("top", (r.top + s.y) + "px", "important");
        el.style.setProperty("left", (r.left + s.x) + "px", "important");
        el.style.setProperty("right", "auto", "important");
        el.style.setProperty("bottom", "auto", "important");
        el.style.setProperty("width", r.width + "px", "important");
      } else {
        el.style.setProperty("position", "static", "important");
      }
    }
  }
  function restorePage() {
    unblockUserScroll();
    for (const { el, style } of pinnedList.splice(0)) {
      try { if (style == null) el.removeAttribute("style"); else el.setAttribute("style", style); } catch {}
    }
    if (stitchStyle) { stitchStyle.remove(); stitchStyle = null; }
    if (originalScroll) { try { window.scrollTo(originalScroll.x, originalScroll.y); } catch {} originalScroll = null; }
  }

  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Bounded settle: two frames, then wait for the scroll offset to stop moving,
  // never longer than `budget`.
  async function settleScroll(budget) {
    await nextPaint();
    const deadline = Date.now() + budget;
    let last = getScroll().y;
    for (;;) {
      await sleep(32);
      const now = getScroll().y;
      if (now === last || Date.now() > deadline) return;
      last = now;
    }
  }

  function cleanupDom() {
    if (torn) return; torn = true; // idempotent across success / cancel / timeout / re-injection
    clearTimeout(releaseTimer); clearTimeout(totalTimer);
    for (const [target, t, h, c] of listeners.splice(0)) target.removeEventListener(t, h, c);
    try { chrome.runtime.onMessage.removeListener(onMsg); } catch {}
    restorePage();
    if (pauseStyle) { pauseStyle.remove(); pauseStyle = null; }
    if (document.body) document.body.style.userSelect = prevUS;
    box.remove(); label.remove(); hint.remove();
    if (window[KEY] === api) delete window[KEY];
  }

  const host = {
    requestId: REQ, releaseMs: 2500, stitchIdleMs: 15000, stitchTotalMs: 150000,
    send: (m) => chrome.runtime.sendMessage(m),
    extract: (el) => extractTokens(el),
    rect: (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
    viewport,
    metrics,
    sourceUrl: () => location.href,
    applyPause: () => { if (!pauseStyle) { pauseStyle = document.createElement("style"); pauseStyle.textContent = "*,*::before,*::after{animation-play-state:paused!important}"; document.documentElement.appendChild(pauseStyle); } },
    hideOverlays: () => { box.style.display = "none"; label.style.display = "none"; hint.style.display = "none"; },
    nextPaint,
    setReleaseTimer: (fn, ms) => { clearTimeout(releaseTimer); releaseTimer = setTimeout(fn, ms); },
    clearReleaseTimer: () => clearTimeout(releaseTimer),
    setTotalTimer: (fn, ms) => { clearTimeout(totalTimer); totalTimer = setTimeout(fn, ms); },
    clearTotalTimer: () => clearTimeout(totalTimer),
    cleanup: cleanupDom,
  };
  const controller = globalThis.__dcCreatePickController(host);
  const api = { stop: cleanupDom, mode: MODE, requestId: REQ };
  window[KEY] = api;

  function onMsg(m, _s, sendResponse) {
    if (!m || m.requestId !== REQ) return;
    if (m.type === "DC_RELEASE") { controller.release(); return; }
    if (m.type === "DC_CONFIRM") { sendResponse(controller.confirm()); return true; }
    // Once the pick lifecycle has settled (Escape/cancel/expiry ran cleanupDom),
    // a late stitch message must NOT resume scrolling or re-mutate the page.
    const settled = () => torn || controller.getState() === "settled";
    if (m.type === "DC_PREPARE_STITCH") {
      if (settled()) { sendResponse({ ok: false, reason: "cancelled" }); return true; }
      controller.touch();
      try {
        originalScroll = getScroll();
        freezePage();
        blockUserScroll();            // controlled capture stage begins — hold user scrolling
        host.applyPause();
        host.hideOverlays();
        scanLimited = false;
        neutralizeFixed(5000);
        sendResponse({ ok: true, ...metrics(), scanLimited });
      } catch (e) { sendResponse({ ok: false, reason: (e && e.message) || "the page could not be prepared" }); }
      return true;
    }
    if (m.type === "DC_SCROLL_TO") {
      if (settled()) { sendResponse({ ok: false, reason: "cancelled" }); return true; }
      controller.touch();
      (async () => {
        try {
          if (settled()) { sendResponse({ ok: false, reason: "cancelled" }); return; } // re-check after the await boundary
          // Keep the horizontal offset the user had: only the vertical position is
          // ours to drive, and placeTile composes from the reported scrollX.
          window.scrollTo(originalScroll ? originalScroll.x : getScroll().x, m.y);
          await settleScroll(400);
          if (settled()) { sendResponse({ ok: false, reason: "cancelled" }); return; }
          neutralizeFixed(1500);        // catch headers that only turn fixed once scrolled
          await nextPaint();
          sendResponse({ ok: true, ...metrics(), scanLimited });
        } catch (e) { sendResponse({ ok: false, reason: (e && e.message) || "the page could not be scrolled" }); }
      })();
      return true;
    }
    // Scroll re-confirmation around the actual screenshot (drift detection).
    if (m.type === "DC_CONFIRM_SCROLL") {
      if (settled()) { sendResponse({ ok: false, reason: "cancelled" }); return true; }
      sendResponse({ ok: true, ...metrics() });
      return true;
    }
    if (m.type === "DC_END_STITCH") { restorePage(); controller.release(); sendResponse({ ok: true }); return true; }
  }

  // ---------------- element mode ----------------
  let current = null;
  const onMove = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); if (!el || el === current || el === box || el === label || el === hint) return; current = el; drawElement(el); };
  const onClick = (e) => { e.preventDefault(); e.stopPropagation(); controller.begin(() => current || document.elementFromPoint(e.clientX, e.clientY)); };

  // ---------------- area mode ----------------
  const selector = MODE === "area" ? globalThis.__dcCreateAreaSelector({
    now: () => Date.now(),
    getScroll,
    getViewport: viewport,
    scrollBy: (dy) => window.scrollBy(0, dy),
    draw: ({ rectDoc, scroll, countdown, scrolling, atEnd }) => {
      if (!rectDoc) return;
      const left = rectDoc.x - scroll.x, top = rectDoc.y - scroll.y;
      Object.assign(box.style, { display: "block", left: left + "px", top: top + "px", width: rectDoc.w + "px", height: rectDoc.h + "px" });
      label.style.display = "block";
      label.style.left = Math.max(0, left) + "px";
      label.style.top = Math.max(0, top - 20) + "px";
      label.textContent = `${Math.round(rectDoc.w)}×${Math.round(rectDoc.h)}`;
      hint.style.display = "block";
      if (scrolling) hint.textContent = atEnd ? "End of page  ·  release to capture" : "Scrolling…  ·  release to capture  ·  Esc cancels";
      else if (countdown != null) hint.textContent = `Hold to scroll… ${countdown}`;
      else hint.textContent = HINT_IDLE;
    },
    clear: () => { box.style.display = "none"; label.style.display = "none"; hint.textContent = HINT_IDLE; },
    onComplete: (rectDoc) => { controller.beginArea(rectDoc, metrics()); },
    onCancel: () => controller.cancel(),
  }) : null;

  let raf = 0;
  const loop = () => { if (!selector || torn) return; selector.tick(); raf = requestAnimationFrame(loop); };
  const onDown = (e) => { if (!controller.canStart() || e.button !== 0) return; e.preventDefault(); if (selector.down(e.clientX, e.clientY) && !raf) raf = requestAnimationFrame(loop); };
  const onDrag = (e) => { if (!selector.isDragging()) return; e.preventDefault(); selector.move(e.clientX, e.clientY); };
  const onUp = (e) => { if (!selector.isDragging()) return; e.preventDefault(); selector.up(); cancelAnimationFrame(raf); raf = 0; };
  const onScrollEvt = () => { if (selector) selector.onScroll(); };
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };

  const onKey = (e) => {
    if (e.key === "Escape") {
      // Escape must cancel the WHOLE capture lifecycle, at every phase. While the
      // area selector is still dragging, cancel through it (it resets selection UI
      // and routes to controller.cancel via onCancel). Once the drag has ended and
      // the stitch is underway the selector is settled and its cancel() is a no-op,
      // so cancel the pick controller directly — otherwise the running stitch would
      // ignore Escape.
      if (selector && selector.state().dragging) selector.cancel("escape");
      else controller.cancel();
      return;
    }
    if (MODE !== "element" || !controller.canStart() || !current) return;
    if (e.key === "ArrowUp") { const p = current.parentElement; if (p && p !== document.documentElement && p !== document.body) { e.preventDefault(); current = p; drawElement(p); } }
    else if (e.key === "ArrowDown") { const c = Array.from(current.children).find((n) => n.nodeType === 1); if (c) { e.preventDefault(); current = c; drawElement(c); } }
  };
  const onVis = () => { if (document.hidden) controller.cancel(); };

  chrome.runtime.onMessage.addListener(onMsg);
  on(document, "keydown", onKey, true);
  on(document, "visibilitychange", onVis, true);
  on(window, "pagehide", () => controller.cancel(), true);
  if (MODE === "area") {
    if (document.body) document.body.style.userSelect = "none";
    on(document, "mousedown", onDown, true);
    on(document, "mousemove", onDrag, true);
    on(document, "mouseup", onUp, true);
    on(document, "click", block, true);
    on(window, "scroll", onScrollEvt, true);
  } else {
    on(document, "mousemove", onMove, true);
    on(document, "click", onClick, true);
  }
  showOverlays();
  // A style-scan sample starts the ordinary picker with a highlighted element.
  // The user still chooses/clicks; extraction and screenshot checks stay intact.
  if(MODE==='element'&&CFG.targetSelector){
    try {const sample=document.querySelector(CFG.targetSelector);if(sample){current=sample;drawElement(sample);hint.textContent='Sample highlighted · click it to save measured CSS · Esc cancels';}} catch {}
  }
})();
