import { getConfig, generateText } from "./lib/llm.js";
import { dataUrlToImage, planCrop, drawCrop } from "./lib/crop.js";
import { putCrop, getCrop, deleteCrop, getTrayMeta, setTrayMeta } from "./lib/db.js";
import { compile, resolve, needsSpine, enrichWithLLM, withCreativeDirection } from "./lib/compiler.js";
import { buildBundle } from "./lib/bundle.js";
import { DEFAULT_PERSONA } from "./lib/contract.js";
import { newSession, acceptCapture, confirmActive } from "./lib/capture-session.js";
import { createCaptureController } from "./lib/capture-controller.js";
import { createStitchController } from "./lib/stitch-controller.js";
import { createTrayStore } from "./lib/tray-store.js";
import { createTrayMutex, webLocksMutex, locksAvailable, UNSUPPORTED_MESSAGE } from "./lib/tray-lock.js";
import { createCapturePacer } from "./lib/capture-pacer.js";
import { createRawCapture } from "./lib/raw-capture.js";
import { createOutputState } from "./lib/output-state.js";
import { createPendingEdits } from "./lib/pending-edits.js";
import { createCompileGate } from "./lib/compile-gate.js";
import { createTrayRenderer } from "./lib/tray-render.js";
import { createInspectorController } from "./lib/inspector-controller.js";
import { createCaptureDeps } from "./lib/panel-capture.js";
import { createStitchDeps } from "./lib/panel-stitch.js";
import { exportBundle } from "./lib/export-flow.js";
import { tokenPresentation } from "./lib/tokens-view.js";
import { renderTokenCss } from "./lib/design-assets.js";
import { contrastCheck, parseColor } from "./lib/contrast.js";
import { scanVisiblePage } from "./lib/page-scan.js";
import { createProjectBackup, parseProjectBackup } from "./lib/project-backup.js";
import { diagnoseResolved, diagnoseCapture } from "./lib/diagnostics.js";
import { groupMeasurements } from "./lib/inspector-data.js";
import { createPresetStore } from "./lib/presets.js";
import { normalizeGuidance, DESIGN_SYSTEM_INSTRUCTION, renderBuildPlan } from './lib/design-guidance.js';
import { createCollectionLibrary } from './lib/collections.js';
import { collectionRepository } from './lib/collection-db.js';

const $ = (id) => document.getElementById(id);
const isStudio=new URL(location.href).searchParams.get('studio')==='1';
if(isStudio)document.body.dataset.studio='1';
// Stored role values are unchanged (the compiler's precedence policy and the
// exported spec still speak "spine"); only the words shown to the user change.
// "Base reference" is what a spine actually is: the source whose structure and
// spacing everything else is reconciled against.
const ROLES = ["component", "spine", "palette", "type", "shape"];
const ROLE_LABEL = { spine: "Base reference", type: "Typography source", palette: "Color source", shape: "Shape source", component: "Pattern only" };
const ROLE_ORDER = ["spine", "type", "palette", "shape", "component"]; // display order
const thumbs = new Map(); // id -> objectURL (successful reads only)
let session = null;
let pane = "design";
let displayedReferences=[];
let importingProject=false, areaCaptureBusy=false;
const handled = new Set();
// Unsettled local tray edits gate compilation and stamp output freshness.
const pending = createPendingEdits({ onChange: () => refreshEditState() });
const out = createOutputState({ epoch: () => pending.epoch(), settled: () => pending.idle() });

// Inline SVG icons (currentColor) — no icon framework, no network request.
const ICON = {
  up: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.5V3.5M4 7l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5v9M12 9l-4 4-4-4"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};
const ICON_ISSUE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 5.3v3.4M8 10.9h.01" stroke-linecap="round"/></svg>';

// Build an advisory issue list (icon + text, optional "action" link). Shared by the
// tray (capture issues) and the Tokens view (resolution issues).
function issuesEl(list, onAction) {
  const wrap = document.createElement("div"); wrap.className = "item-issues";
  for (const is of list) {
    const row = document.createElement("div"); row.className = "issue " + (is.level || "info");
    row.insertAdjacentHTML("afterbegin", ICON_ISSUE);
    const span = document.createElement("span"); span.textContent = is.message; row.appendChild(span);
    if (is.action && onAction) { const b = document.createElement("button"); b.type = "button"; b.className = "act"; b.textContent = is.action.label; b.addEventListener("click", () => onAction(is.action)); span.appendChild(document.createTextNode(" ")); span.appendChild(b); }
    wrap.appendChild(row);
  }
  return wrap;
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
let toastT;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 5000); }

// Output freshness: an input change marks the last compile stale IMMEDIATELY
// (synchronously, not after an awaited storage write), and the banner mirrors it.
// out.isStale() also reports stale when an edit began after the last compile and
// has not settled, so a compile that raced a pending write can never read fresh.
function markStale() { out.markStale(); $("stale").hidden = !out.isStale(); }
function fresh() { if (!out.current()) { toast("Compile first"); return false; } if (out.isStale()) { toast("Recompile — inputs changed since the last compile"); return false; } return true; }
// Reflect unsettled edits: Compile is disabled and says so while a write is in flight.
function refreshEditState() {
  const btn = $("compile");
  if (btn) btn.textContent = pending.idle() ? "Compile handoff" : "Saving edit…";
  updateCompile(store.get());
  const s = $("stale"); if (s) s.hidden = !out.isStale();
}

async function refreshChip() {
  const { apiBaseUrl, model } = await getConfig();
  const chip = $("chip"), label = $("chip-label");
  if (apiBaseUrl && model) { label.textContent = model; chip.title = hostOf(apiBaseUrl); chip.dataset.ok = "1"; }
  else { label.textContent = apiBaseUrl ? "Choose a model" : "AI settings"; chip.title = "Optional AI enhancement settings — capture and compile work without a key"; chip.dataset.ok = "0"; }
}
$("chip").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- tray store: the single authority for every tray mutation ----------
// All producers (this panel + any other open panel) coordinate through one shared
// Web Lock, so overlapping read→compute→write operations cannot lose each other's
// updates. See lib/tray-lock.js. The store decides the outcome of a write BEFORE it
// notifies this view, and a render failure is reported back as `notifyError` on an
// otherwise successful result — it can never undo a committed reference.
const trayMutex = createTrayMutex();
const store = createTrayStore({
  putCrop, deleteCrop, loadMeta: getTrayMeta, saveMeta: setTrayMeta, withLock: trayMutex.withLock,
  onChange: async (tray) => { const r = await renderer.render(tray); if (r.error) throw new Error(r.error); },
});

// Every tray edit goes through here: invalidate the output synchronously, hold the
// "unsettled edit" flag until the write resolves (so Compile cannot read a tray that
// is about to change), and on a failed save redraw from the STORED state so the
// inputs stop showing an edit that was never persisted.
async function mutate(fn) {
  markStale();
  let res;
  try { res = await pending.run(fn); }
  catch (e) { res = { ok: false, reason: (e && e.message) || "That change could not be saved" }; } // never leak a rejection out of a DOM handler
  if (res && res.ok === false) {
    toast(res.reason || "That change could not be saved");
    await renderer.render(store.get());
  } else if (res && res.notifyError) toast(res.notifyError);
  return res;
}

// Web Locks missing => we cannot coordinate across windows. Rather than silently
// risk a lost update, block mutating actions and show an actionable message. Tray
// mutations also reject at the store level (defense in depth).
const envSupported = trayMutex.kind !== "unsupported";
function enforceEnvironment() {
  if (envSupported) return;
  const b = $("env-warn"); if (b) { $("env-warn-msg").textContent = UNSUPPORTED_MESSAGE; b.hidden = false; }
  for (const id of ["pick", "pick-region", "compile"]) { const el = $(id); if (el) el.disabled = true; }
}

// Object URL for a reference's crop. Only SUCCESSFUL reads are cached, so a
// transient IndexedDB failure is retried on the next render instead of being
// remembered as "missing". A rejection propagates to the caller (the renderer and
// the inspector controller each handle it visibly).
async function loadThumb(it) {
  if (thumbs.has(it.id)) return thumbs.get(it.id);
  const blob = await getCrop(it.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  thumbs.set(it.id, url);
  return url;
}
function updateCompile(tray) {
  const warn = needsSpine(tray);
  $("spine-warn").hidden = !warn;
  $("compile").disabled = !envSupported || tray.length === 0 || warn || !pending.idle();
  renderReadiness(tray);
}

function renderReadiness(tray) {
  const host=$('readiness'); if(!host)return; host.replaceChildren();
  const measured=tray.filter(item=>Object.values(item.tokens?.computed||{}).some(value=>value!=null&&String(value).trim()));
  let rolesExclude=false;
  if(tray.length&&!needsSpine(tray))try{const resolved=resolve(tray);rolesExclude=resolved.coverage.observed+resolved.coverage.fallback===0&&resolved.refs.some(ref=>ref.usablePropertyCount>0);}catch{/* compile reports malformed references */}
  const body=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
  title.textContent=!tray.length?'Start with a reference':needsSpine(tray)?'Choose your base reference':rolesExclude?'Measured references need a role':!measured.length?'Visual guidance is ready':'Ready to compile';
  detail.textContent=!tray.length?'Capture an element for styles, or an area for composition.':needsSpine(tray)?'The base supplies structure and spacing. Other roles override only their domain.':rolesExclude?'Your measured patterns do not supply global tokens. Use a measured base or a style-source role, or continue with visual guidance.':!measured.length?'These captures are images. Add a measured element if you need CSS tokens.':`${measured.length} of ${tray.length} references contain measured styles. Reference roles decide which values are used.`;
  body.append(title,detail);host.append(body);
  if(tray.length&&!measured.length){const btn=document.createElement('button');btn.className='btn sm';btn.textContent='Measure';btn.type='button';btn.disabled=!envSupported;btn.addEventListener('click',()=>pick('element'));host.append(btn);}
  if(rolesExclude&&measured.length){const btn=document.createElement('button');btn.className='btn sm';btn.textContent='Use measured base';btn.type='button';btn.disabled=!envSupported||!pending.idle();btn.addEventListener('click',()=>mutate(()=>store.setRole(measured[0].id,'spine')));host.append(btn);}
}

// A role <select> built from the stored values but labelled in plain language.
function roleSelect(it, label) {
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", label);
  for (const r of ROLE_ORDER.filter((x) => ROLES.includes(x))) {
    const o = document.createElement("option");
    o.value = r; o.textContent = ROLE_LABEL[r] || r;
    if (r === (it.role || "component")) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}
// What this reference actually contributes, from evidence only. A failed
// extraction is never relabelled as a deliberate image-only capture.
function measuredLabel(it) {
  if (it.tokens && it.tokens.computed) return "Styles measured";
  return ((it.measurement && it.measurement.status) === "failed") ? "Styles not readable" : "Image only";
}

// ONE synchronous commit of the whole list. The renderer guarantees this runs only
// for the newest render and only after every thumbnail for it resolved, so a
// superseded render can no longer append its items over the current ones.
function paintTray({ tray, thumbs: srcs, missing: missingSet, failures }) {
  displayedReferences=tray;
  const keep = new Set(tray.map((it) => it.id));
  for (const [id, url] of thumbs) if (!keep.has(id)) { URL.revokeObjectURL(url); thumbs.delete(id); }
  const failed = new Set((failures || []).map((f) => f.id));
  const ul = $("tray"); ul.innerHTML = "";
  $("empty").hidden = tray.length > 0;
  const th = $("tray-head"); if (th) th.hidden = tray.length === 0;
  const tc = $("tray-count"); if (tc) tc.textContent = tray.length ? `${tray.length} ${tray.length === 1 ? "reference" : "references"}` : "";
  for (const [i, it] of tray.entries()) {
    const host = hostOf(it.sourceUrl);
    const li = document.createElement("li");
    li.className = "item" + (it.role === "spine" ? " spine" : "");
    const src = srcs.get(it.id) || ""; const missing = missingSet.has(it.id);

    // precedence number = tray order (what ↑/↓ change; breaks ties within a role)
    const num = document.createElement("div"); num.className = "pre-num"; num.textContent = String(i + 1);
    num.setAttribute("aria-hidden", "true");

    // the captured specimen; click the thumb OR the name to open the inspector
    const tbtn = document.createElement("button"); tbtn.type = "button"; tbtn.className = "thumb-btn"; tbtn.setAttribute("aria-label", "Inspect " + host);
    const img = document.createElement("img"); img.className = "thumb"; img.alt = ""; img.loading="lazy";img.decoding="async"; if (src) img.src = src;
    if (it.w > it.h * 3) img.style.objectFit = "contain";
    tbtn.appendChild(img); tbtn.addEventListener("click", () => openRef(it.id));

    const body = document.createElement("div"); body.className = "card-body";
    const name = document.createElement("button"); name.type = "button"; name.className = "name"; name.title = it.sourceUrl;
    const nameText = document.createElement("span"); nameText.textContent = it.name || host; nameText.style.overflow = "hidden"; nameText.style.textOverflow = "ellipsis";
    name.appendChild(nameText);
    if (it.role === "spine") { const bt = document.createElement("span"); bt.className = "base-tag"; bt.textContent = "BASE"; name.appendChild(bt); }
    name.addEventListener("click", () => openRef(it.id));

    const roleRow = document.createElement("div"); roleRow.className = "role-row";
    const sel = roleSelect(it, "Role for " + host);
    sel.addEventListener("change", () => mutate(() => store.setRole(it.id, sel.value)));
    roleRow.appendChild(sel);

    // one quiet line of facts instead of a row of badges
    const facts = document.createElement("div"); facts.className = "facts";
    const bits = [measuredLabel(it)];
    if (it.clipped) bits.push("visible part only");
    if (missing) bits.push(failed.has(it.id) ? "image unreadable" : "image missing");
    const line = document.createElement("div"); line.textContent = bits.join(" · "); facts.appendChild(line);
    if (it.name) { const site=document.createElement('div');site.textContent=host;facts.appendChild(site); }
    if (it.borrow || it.note) { const n = document.createElement("div"); n.className = "note-text"; n.textContent = it.borrow ? 'Borrow: '+it.borrow : it.note; facts.appendChild(n); }

    body.append(name, roleRow, facts);
    // Distinguish "absent from storage" from "the read itself failed" — both show a
    // fact line, but only the first is a claim about what storage contains.
    // Routine image-only/clipping information already fits on the fact line.
    // Detailed advice stays in the inspector so references remain easy to scan.
    const issues = diagnoseCapture(it, { missingCrop: missing && !failed.has(it.id) })
      .filter((issue) => !["image-only", "clipped"].includes(issue.kind))
      .map((issue) => issue.kind === "role-needs-measurement" ? { ...issue, message: "This role has no measured styles. Use a measured element or choose Pattern only." } : issue);
    if (failed.has(it.id)) issues.unshift({ level: "error", kind: "crop-read-failed", message: "The image could not be read from storage — capture this reference again before exporting." });
    if (issues.length) body.appendChild(issuesEl(issues, (a) => { if (a.pick) pick("element"); }));

    const tools = document.createElement("div"); tools.className = "card-tools";
    if (tray.length > 1) { // order only matters once something can out-rank something else
      const up = document.createElement("button"); up.type = "button"; up.className = "icon-btn"; up.innerHTML = ICON.up; up.title = "Move up"; up.setAttribute("aria-label", "Move " + host + " up");
      up.disabled = i === 0;
      up.addEventListener("click", () => mutate(() => store.move(it.id, -1)));
      const dn = document.createElement("button"); dn.type = "button"; dn.className = "icon-btn"; dn.innerHTML = ICON.down; dn.title = "Move down"; dn.setAttribute("aria-label", "Move " + host + " down");
      dn.disabled = i === tray.length - 1;
      dn.addEventListener("click", () => mutate(() => store.move(it.id, 1)));
      tools.append(up, dn);
    }
    const spacer = document.createElement("div"); spacer.className = "spacer"; tools.appendChild(spacer);
    const x = document.createElement("button"); x.type = "button"; x.className = "icon-btn danger"; x.innerHTML = ICON.x; x.title = "Remove"; x.setAttribute("aria-label", "Remove " + host);
    x.addEventListener("click", () => mutate(() => store.remove(it.id)));
    tools.appendChild(x);
    body.appendChild(tools);

    li.append(num, tbtn, body);
    ul.appendChild(li);
  }
  updateCompile(tray);
  $("reference-search").hidden=tray.length<2;
  filterReferences();
  if (insp.isOpen()) insp.refresh().then(reportInspector); // keep an open inspector in sync with the new state
}
function filterReferences(){
  const tray=displayedReferences,query=$("reference-search").value.trim().toLowerCase();let visible=0;
  for(const [index,row] of [...$("tray").children].entries()){
    const item=tray[index];
    const match=!query||`${item?.sourceUrl||''} ${item?.name||''} ${item?.borrow||''} ${item?.avoid||''} ${item?.note||''} ${ROLE_LABEL[item?.role]||''}`.toLowerCase().includes(query);
    row.hidden=!match;if(match)visible++;
  }
  $("search-empty").hidden=!tray.length||visible>0;
}
$("reference-search").addEventListener("input",filterReferences);
const renderer = createTrayRenderer({ loadThumb, paint: paintTray, onIssue: toast });

// ---------- reference inspector (accessible <dialog>) ----------
// Opening is asynchronous (the crop is read from IndexedDB), so the controller owns
// the identity + invalidation rules: a reference removed, the dialog closed, or a
// different reference chosen while a read is in flight voids that open instead of
// showing a dialog for something that is no longer there.
const field = (label, el) => { const w = document.createElement("div"); w.className = "insp-field"; const k = document.createElement("span"); k.className = "insp-k"; k.textContent = label; w.append(k, el); return w; };
const textEl = (t) => { const s = document.createElement("div"); s.className = "insp-url"; s.textContent = t; return s; };

// ONE synchronous commit of the dialog body, from a single snapshot — two
// overlapping opens can never interleave their fields.
function paintInspector({ item: it, thumb, missing, thumbFailed }) {
  const id = it.id;
  $("insp-title").textContent = it.name || hostOf(it.sourceUrl);
  const body = $("insp-body"); body.innerHTML = "";
  if (thumb) {
    const img = document.createElement("img"); img.className = "insp-crop"; img.alt = "Captured crop of " + hostOf(it.sourceUrl); img.src = thumb; body.appendChild(img);
    const full = document.createElement("a"); full.className = "insp-full"; full.href = thumb; full.target = "_blank"; full.rel = "noopener"; full.textContent = "Open image at full size ↗"; body.appendChild(full);
    const download=document.createElement('a');download.className='btn sm';download.href=thumb;download.download=`design-claw-${String(it.name||hostOf(it.sourceUrl)).replace(/[^a-z0-9]+/gi,'-').slice(0,60)}.png`;download.textContent='Download captured image';body.appendChild(download);
  }
  body.appendChild(field("Source", textEl(it.sourceUrl)));
  for(const [key,label,placeholder] of [['name','Name','A name you can recognize'],['borrow','Borrow','The layout, detail or feeling to reuse'],['avoid','Avoid','What should not carry into your design']]){
    const input=document.createElement(key==='name'?'input':'textarea');input.className='note';input.value=it[key]||'';input.placeholder=placeholder;input.maxLength=key==='name'?160:2000;input.setAttribute('aria-label',label);if(key==='name')input.type='text';
    input.addEventListener('change',()=>mutate(()=>store.setDetails(id,{[key]:input.value})));
    body.appendChild(field(label,input));
  }
  const sel = roleSelect(it, "Role");
  sel.addEventListener("change", () => mutate(() => store.setRole(id, sel.value)));
  body.appendChild(field("Role", sel));
  const note = document.createElement("input"); note.className = "note"; note.value = it.note || ""; note.placeholder = "Why this reference — what to keep"; note.setAttribute("aria-label", "Note");
  note.addEventListener("change", () => mutate(() => store.setNote(id, note.value)));
  body.appendChild(field("Note", note));
  body.appendChild(field("Contributes", textEl(measuredLabel(it))));
  const bits = [];
  if (it.w && it.h) bits.push(`${it.w}×${it.h}px`);
  if (it.bytes) bits.push(`${Math.max(1, Math.round(it.bytes / 1024))} KB`);
  if (it.tiles > 1) bits.push(`stitched from ${it.tiles} screenshots`);
  if (it.createdAt) bits.push(new Date(it.createdAt).toLocaleString());
  if (it.clipped) bits.push("visible part only");
  body.appendChild(field("Captured", textEl(bits.join("  ·  ") || "—")));
  if(it.tokens?.computed){
    const check=contrastCheck(it.tokens),box=document.createElement("div");box.className="contrast-result";
    const title=document.createElement("strong");
    title.textContent=check.status==='unknown'?'Text contrast: needs review':`Text contrast: ${check.ratio.toFixed(2)}:1 · ${check.status==='pass'?'meets':'below'} ${check.threshold}:1`;
    const detail=document.createElement("p");detail.textContent=check.reason;
    box.append(title,detail);body.appendChild(box);
  }
  for (const g of groupMeasurements(it)) {
    if (g.title !== "Typography" && !g.rows.some((r) => r.value != null)) continue; // hide empty groups (keep Typography for the candidate)
    const sec = document.createElement("div"); sec.className = "msr-group";
    const h = document.createElement("h4"); h.textContent = g.title; sec.appendChild(h);
    for (const r of g.rows) {
      const row = document.createElement("div"); row.className = "msr-row";
      const k = document.createElement("span"); k.className = "mk"; k.textContent = r.label;
      // A recorded "none" is a measurement (flat / unbordered / no transform) and is
      // shown as the value; only an absent recording reads "not measured".
      const v = document.createElement("span"); v.className = "mv" + (r.value == null ? " none" : r.absent ? " absent" : "");
      v.textContent = r.value == null ? "not measured" : r.value;
      if (r.uncertain && r.value) { const u = document.createElement("span"); u.className = "unc"; u.textContent = r.hint || "unverified"; v.appendChild(u); }
      row.append(k, v); sec.appendChild(row);
    }
    body.appendChild(sec);
  }
  // "absent from storage" and "the read itself failed" are different facts — report
  // whichever actually happened, not both.
  const issues = diagnoseCapture(it, { missingCrop: missing && !thumbFailed });
  if (thumbFailed) issues.unshift({ level: "error", kind: "crop-read-failed", message: "The image could not be read from storage — capture this reference again before exporting." });
  if (issues.length) body.appendChild(issuesEl(issues, (a) => { if (a.pick) { insp.close(); pick("element"); } }));
}

const insp = createInspectorController({
  getItem: (id) => store.get().find((x) => x.id === id),
  loadThumb,
  paint: paintInspector,
  show: () => $("inspector").showModal(),
  close: () => { const d = $("inspector"); if (d && d.open) d.close(); },
  isOpen: () => !!$("inspector")?.open,
  activeElement: () => document.activeElement,
  restoreFocus: (el) => { if (el && el.focus) { try { el.focus(); } catch {} } },
});
const reportInspector = (r) => { if (r && r.error) toast(r.error); return r; };
const openRef = (id) => { insp.open(id).then(reportInspector); };
$("insp-close").addEventListener("click", () => insp.close());
$("inspector").addEventListener("close", () => insp.closed());

// ---------- capture + pick ----------
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

// One raw screenshot, with quota errors preserved for the pacer and the toolbar-
// grant message reserved for an actual access failure (see lib/raw-capture.js).
const rawCapture = createRawCapture({
  captureVisibleTab: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
  sendMessage: (windowId) => chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB", windowId }),
  toImage: dataUrlToImage,
});

// The ONE extension-wide capture coordinator: a shared Web Lock + a shared
// last-capture timestamp so every side-panel window — and both element and area
// capture — queue behind each other on Chrome's per-extension captureVisibleTab
// quota. Element and stitched screenshots both run through this.
const captureLock = locksAvailable() ? webLocksMutex("design-compositor-capture").withLock : (fn) => fn();
const capturePacer = createCapturePacer({
  withLock: captureLock,
  readLast: async () => { try { const g = await chrome.storage.local.get("lastCaptureAt"); return g && g.lastCaptureAt; } catch { return 0; } },
  writeLast: async (t) => { try { await chrome.storage.local.set({ lastCaptureAt: t }); } catch {} },
});

const captureEnv = {
  chrome, confirmActive, screenshot: rawCapture, capturePacer, planCrop, drawCrop, store,
  getSession: () => session, setSession: (s) => { session = s; },
  addThumb: (id, blob) => { if (!thumbs.has(id)) thumbs.set(id, URL.createObjectURL(blob)); },
  markStale, toast,
};
const captureCtl = createCaptureController(createCaptureDeps(captureEnv));

// Extended area capture: many screenshots through the SAME coordinator, with a
// visible progress + cancel path.
const stitchCtl = createStitchController(createStitchDeps({
  ...captureEnv,
  progress: (state) => showProgress(state),
}));

// One progress row for the multi-screenshot capture. Capture buttons are held
// while it runs so a second pick can't fight the one scrolling the page.
function showProgress(state) {
  const box = $("cap-progress"), msg = $("cap-progress-msg");
  if (!box) return;
  const phase = state && state.phase;
  if (!phase || phase === "done") { areaCaptureBusy=false;box.hidden = true; setCaptureEnabled(true); return; }
  areaCaptureBusy=true;box.hidden = false; setCaptureEnabled(false);
  msg.textContent =
    phase === "preparing" ? "Preparing the page…" :
    phase === "tile" ? `Capturing area — screenshot ${state.tile} of ${state.total}` :
    phase === "composing" ? "Stitching the image…" :
    phase === "saving" ? "Saving the reference…" : "Capturing…";
}
function setCaptureEnabled(on) {
  if (!envSupported) return; // blocked for a different, louder reason
  for (const id of ["pick", "pick-region"]) { const el = $(id); if (el) el.disabled = isStudio || !on || importingProject || areaCaptureBusy; }
}
$("cap-cancel").addEventListener("click", () => { stitchCtl.cancelAll(); toast("Cancelling the area capture…"); });

async function pick(mode, targetSelector = null) {
  if(isStudio)return toast('Capture from the side panel on a website. This studio is for arranging references and building your handoff.');
  if(!envSupported)return toast(UNSUPPORTED_MESSAGE);
  if(importingProject)return toast("Wait for the project import to finish.");
  const t = await activeTab();
  if (!t) return toast("No active tab");
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(t.url || "")) return toast("Switch to a normal website");
  session = newSession(t, mode);
  if (!session) return toast("Could not identify the active tab");
  captureCtl.cancelAllExcept(session.requestId); // abandon any older in-flight capture
  stitchCtl.cancelAll();                          // and any area capture still stitching
  try {
    await chrome.scripting.executeScript({ target: { tabId: t.id }, func: (cfg) => { window.__dc_pick = cfg; }, args: [{ mode, requestId: session.requestId, targetSelector }] });
    // Classic scripts, in order: the lifecycle controller, then (for area mode)
    // the edge-hold selection state machine, then the picker that drives them.
    const libs = mode === "area" ? ["content/pick-controller.js", "content/area-select.js"] : ["content/pick-controller.js"];
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: libs });
    const res = await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content/picker.js"] });
    const inj = Array.isArray(res) ? res[0] : null;
    if (inj) { session.documentId = inj.documentId; session.frameId = inj.frameId; } // bind the document + frame
  } catch (e) { session = null; toast("Click the toolbar icon on this tab first"); }
}
$("pick").addEventListener("click", () => pick("element"));
$("pick-region").addEventListener("click", () => pick("area"));

// Style inventory is separate from global role resolution. Selecting a sample
// starts the ordinary element picker; no sampled value silently becomes a token.
let lastScan=null;
$("scan-page").addEventListener("click",async()=>{
  const btn=$("scan-page");btn.disabled=true;btn.textContent="Reading visible styles…";
  try {
    const tab=await activeTab();if(!tab)throw new Error("No active tab");
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:scanVisiblePage});
    const report=results?.[0]?.result;if(!report)throw new Error("No styles returned. Click the extension icon on this website first.");
    lastScan={...report,tabId:tab.id,documentId:results[0].documentId};
    $("scan-summary").textContent=`${report.sampled} visible elements sampled${report.bounded?' (scan limit reached)':''}. Counts are sampled uses, not brand importance. Pick a sample to save its image and full measured CSS.`;
    const host=$("scan-results");host.replaceChildren();
    const titles={colors:"Colors",typography:"Typography",spacing:"Spacing",shape:"Shape"};
    for(const [group,rows] of Object.entries(report.groups)){
      if(!rows.length)continue;const sec=document.createElement("div");sec.className="scan-group";
      const title=document.createElement("h4");title.textContent=titles[group]||group;sec.appendChild(title);
      for(const sample of rows){
        const row=document.createElement("div");row.className="scan-row";
        const swatch=document.createElement("span");swatch.className="scan-swatch";
        if(group==='colors'&&parseColor(sample.value))swatch.style.backgroundColor=sample.value;
        const value=document.createElement("div");value.className="scan-value";value.textContent=sample.value;
        const note=document.createElement("small");note.textContent=`${sample.property} · ${sample.count} uses`;value.appendChild(note);
        const b=document.createElement("button");b.type="button";b.className="btn quiet sm";b.textContent="Pick";b.disabled=!sample.selector;
        b.addEventListener("click",async()=>{
          try {
            const now=await activeTab();
            if(now?.id!==lastScan.tabId||new URL(now.url).origin+new URL(now.url).pathname!==lastScan.url)throw new Error("This report is from another page. Scan the current page again.");
            // Check document identity before using a selector from a previous scan.
            const alive=await chrome.scripting.executeScript({target:{tabId:now.id},func:()=>true});
            if(lastScan.documentId&&alive[0]?.documentId!==lastScan.documentId)throw new Error("The page was reloaded. Scan it again.");
            await pick("element",sample.selector);
          }catch(e){toast(e.message);}
        });
        row.append(swatch,value,b);sec.appendChild(row);
      }
      host.appendChild(sec);
    }
    $("scan-report").hidden=false;$("scan-report").open=true;
  }catch(e){toast(e.message||"Click the toolbar icon on this website, then scan again.");}
  finally{btn.disabled=false;btn.textContent="Scan visible page styles";}
});
$("scan-copy").addEventListener("click",()=>{if(lastScan)copyText(JSON.stringify(lastScan,null,2),"Copied page style report");});
$("scan-download").addEventListener("click",()=>{if(lastScan)downloadText("page-style-report.json",JSON.stringify(lastScan,null,2),"application/json");});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "DC_PICKED") {
    if (!acceptCapture({ session, msg, sender, handled }).accept) return;
    handled.add(msg.requestId);
    // An area selection may be taller than the viewport: it is composed from
    // several paced screenshots instead of one crop.
    if (msg.mode === "area") stitchCtl.run(session, msg);
    else captureCtl.run(session, msg);
  } else if (msg?.type === "DC_PICK_CANCELLED") {
    captureCtl.cancel(msg.requestId);
    stitchCtl.cancel(msg.requestId);
    if (session && msg.requestId === session.requestId) { session = null; toast(msg.reason === "expired" ? "Capture timed out — capture again" : "Capture cancelled"); }
  }
});

// cross-panel: another panel's tray write refreshes this one and invalidates output.
// syncExternal resolves (never rejects) with any redraw failure.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.tray) { markStale(); store.syncExternal(changes.tray.newValue || []).then((r) => { if (r && r.notifyError) toast(r.notifyError); }); }
  if (changes.runPresets) refreshPresets();
  if (changes.collectionRevision) refreshCollections();
});

// ---------- compile + output ----------
// The gate refuses while a tray edit of ours is unsettled, so compilation can never
// read a pre-edit tray and then present it as fresh (the button is disabled in that
// window too, and output-state's epoch stamp rejects any output that slips through).
const compileGate = createCompileGate({
  pending, out, compile,
  getItems: () => store.get(),
  getInputs: () => projectInputs(),
  onCompiled: () => {
    $("stale").hidden = !out.isStale();
    $("out").hidden = false;
    const c=out.current(),count=c.resolved.coverage.observed+c.resolved.coverage.fallback;
    $('handoff-title').textContent=count?'Your measured build kit is ready':'Your visual build kit is ready';
    $('handoff-detail').textContent=`${c.refs.length} references · ${count} measured properties · ${c.meta.guidance.productType}. Attach the images with your prompt.`;
    showPane(pane);
    $("out").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  onRefuse: toast,
});
$("compile").addEventListener("click", () => compileGate.run());
function showPane(which) {
  pane = which;
  const c = out.current();
  const isTokens = which === "tokens";
  $("tab-design").setAttribute("aria-selected", String(which === "design"));
  $("tab-prompt").setAttribute("aria-selected", String(which === "prompt"));
  $("tab-tokens").setAttribute("aria-selected", String(isTokens));
  for (const key of ["design", "prompt", "tokens"]) $("tab-" + key).tabIndex = which === key ? 0 : -1;
  $("download").textContent = which === "prompt" ? "Download prompt.txt" : "Download DESIGN.md";
  $("output").hidden = isTokens;
  $("tokens-view").hidden = !isTokens;
  $("md-actions").hidden = isTokens;
  $("json-actions").hidden = !isTokens;
  if (isTokens) renderTokens(c);
  else $("output").textContent = c ? (which === "design" ? c.designMd : c.prompt) : "";
}
function jumpToRef(refId) {
  const c = out.current(); if (!c) return;
  const ref = c.resolved.refs.find((r) => r.id === refId);
  if (!ref) return;
  // The reference may have been removed since this output was compiled; the
  // controller reports that instead of opening an empty dialog.
  insp.open(ref.sourceId).then((r) => { reportInspector(r); if (r && r.reason === "not-found") toast(`${refId} is no longer in the tray — recompile`); });
}
function renderTokens(c) {
  const host = $("tokens-view"); host.innerHTML = "";
  if (!c) return;
  const view = tokenPresentation(c.resolved);
  const intro = document.createElement("div"); intro.className = "tok-intro";
  const title = document.createElement("h4"); title.textContent = view.title;
  const explanation = document.createElement("p"); explanation.textContent = view.message;
  intro.append(title, explanation);
  if (!view.available.length) {
    const actions = document.createElement("div"); actions.className = "tok-actions";
    if (view.kind === "roles") {
      for (const ref of view.candidates) {
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn sm";
        btn.textContent = `Use ${ref.id} as base`;
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          const result = await mutate(() => store.setRole(ref.sourceId, "spine"));
          if (result?.ok) toast(`${ref.id} is the base — compile again to update tokens`);
          btn.disabled = false;
        });
        actions.appendChild(btn);
      }
    } else {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn primary sm";
      btn.textContent = "Pick element to measure CSS"; btn.addEventListener("click", () => pick("element"));
      actions.appendChild(btn);
    }
    intro.appendChild(actions);
  }
  host.appendChild(intro);
  const groups = [];
  for (const r of view.available) { let g = groups.find((x) => x.title === r.group); if (!g) { g = { title: r.group, rows: [] }; groups.push(g); } g.rows.push(r); }
  for (const g of groups) {
    const sec = document.createElement("div"); sec.className = "tok-group";
    const h = document.createElement("h4"); h.textContent = g.title; sec.appendChild(h);
    for (const r of g.rows) {
      const row = document.createElement("div"); row.className = "tok-row";
      const k = document.createElement("span"); k.className = "tok-k"; k.textContent = r.key;
      const v = document.createElement(r.value == null ? "span" : "button"); v.className = "tok-v" + (r.value == null ? " none" : ""); v.textContent = r.value == null ? "unavailable" : r.value;
      if(r.value!=null){v.type="button";v.title="Copy "+r.key;v.setAttribute("aria-label",`Copy ${r.key}: ${r.value}`);v.addEventListener("click",()=>{if(fresh())copyText(String(r.value),`Copied ${r.key}`);});}
      if(r.group==='Color' && parseColor(String(r.value))){const swatch=document.createElement('i');swatch.className='token-swatch';swatch.style.backgroundColor=String(r.value);swatch.setAttribute('aria-hidden','true');v.prepend(swatch);}
      const right = document.createElement("span"); right.className = "tok-right";
      if (r.status && r.status !== "observed") { const b = document.createElement("span"); b.className = "tok-badge " + r.status; b.textContent = r.status; right.appendChild(b); }
      if (r.refId) { const s = document.createElement("button"); s.type = "button"; s.className = "tok-src"; s.textContent = r.refId; s.title = "Open " + r.refId + " in the inspector"; s.addEventListener("click", () => jumpToRef(r.refId)); right.appendChild(s); }
      row.append(k, v, right); sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  if (view.missing.length) {
    const details = document.createElement("details"); details.className = "tok-missing";
    const summary = document.createElement("summary"); summary.textContent = `Not measured (${view.missing.length})`;
    const list = document.createElement("p"); list.textContent = view.missing.map((r) => `${r.group}: ${r.key}`).join(" · ");
    details.append(summary, list); host.appendChild(details);
  }
  const contrasts=c.resolved.refs.filter(r=>r.measured);
  if(contrasts.length){
    const sec=document.createElement("details");sec.className="tok-missing";
    const summary=document.createElement("summary");summary.textContent="Text contrast checks";sec.appendChild(summary);
    for(const ref of contrasts){
      const p=document.createElement("p");const result=ref.contrast;
      p.textContent=`${ref.id}: ${result?.ratio!=null?`${result.ratio.toFixed(2)}:1 — ${result.status==='pass'?'meets':'below'} ${result.threshold}:1`:result?.reason||'Pick again to record background evidence.'}`;
      sec.appendChild(p);
    }
    const caveat=document.createElement("p");caveat.textContent="Recorded text and flat-background pairs only. Gradients, images, transparency, overlays and rendered font faces need review; this is not a full accessibility audit.";sec.appendChild(caveat);host.appendChild(sec);
  }
  const diags = diagnoseResolved(c.resolved);
  if (diags.length) {
    // Advanced: kept one click away so the token list reads cleanly.
    const box = document.createElement("details"); box.className = "diag";
    const sum = document.createElement("summary");
    sum.innerHTML = '<svg class="caret" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    sum.appendChild(document.createTextNode(` Diagnostics (${diags.length})`));
    box.appendChild(sum);
    const inner = document.createElement("div"); inner.className = "inner";
    inner.appendChild(issuesEl(diags.map((d) => ({ ...d, action: d.refId ? { label: "open " + d.refId, refId: d.refId } : (d.action || null) })), (a) => { if (a.refId) jumpToRef(a.refId); else if (a.pick) pick("element"); }));
    box.appendChild(inner);
    host.appendChild(box);
  }
}
$("tab-design").addEventListener("click", () => showPane("design"));
$("tab-prompt").addEventListener("click", () => showPane("prompt"));
$("tab-tokens").addEventListener("click", () => showPane("tokens"));
for (const [index, key] of ["design", "prompt", "tokens"].entries()) {
  $("tab-" + key).addEventListener("keydown", (e) => {
    const keys = ["design", "prompt", "tokens"];
    const next = e.key === "ArrowRight" ? (index + 1) % 3 : e.key === "ArrowLeft" ? (index + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : null;
    if (next == null) return;
    e.preventDefault(); showPane(keys[next]); $("tab-" + keys[next]).focus();
  });
}
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Clipboard access failed. Use Download to save this output."); }
}
function downloadText(filename,text,type="text/plain"){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast(`Downloaded ${filename}`);
}
$("copy-css").addEventListener("click",()=>{if(fresh())copyText(renderTokenCss(out.current().resolved),"Copied measured token CSS");});
$("download-css").addEventListener("click",()=>{if(fresh())downloadText("tokens.css",renderTokenCss(out.current().resolved),"text/css");});
const GUIDANCE_FIELDS={productType:'product-type',audience:'audience',primaryAction:'primary-action',mustInclude:'must-include',avoid:'design-avoid',stack:'target-stack'};
const getGuidance=()=>normalizeGuidance(Object.fromEntries(Object.entries(GUIDANCE_FIELDS).map(([key,id])=>[key,$(id).value])));
function applyGuidance(input){const g=normalizeGuidance(input);for(const [key,id]of Object.entries(GUIDANCE_FIELDS))$(id).value=g[key];}
const projectInputs=()=>({brief:$("brief").value,persona:$("persona").value,perRunNote:$("perrun").value,guidance:getGuidance()});
function applyProjectInputs(inputs){$('brief').value=inputs.brief||'';$('perrun').value=inputs.perRunNote||'';$('persona').value=inputs.persona||$('persona').value;applyGuidance(inputs.guidance);markStale();}
$('copy-system').addEventListener('click',()=>{if(fresh())copyText(DESIGN_SYSTEM_INSTRUCTION,'Copied design instructions');});
$('download-plan').addEventListener('click',()=>{if(fresh())downloadText('BUILD-PLAN.md',renderBuildPlan(out.current()),'text/markdown');});
$('open-studio').addEventListener('click',async()=>{
  const key='designClawStudio:'+crypto.randomUUID(),button=$('open-studio');button.disabled=true;
  try{
    await chrome.storage.session.set({[key]:projectInputs()});
    await chrome.tabs.create({url:chrome.runtime.getURL('sidepanel.html?studio=1&draft='+encodeURIComponent(key))});
  }catch(e){try{await chrome.storage.session.remove(key);}catch{}toast('Could not open the studio: '+e.message);}
  finally{button.disabled=false;}
});
document.querySelector('.studio-nav a[href="#out"]').addEventListener('click',event=>{if($('out').hidden){event.preventDefault();toast('Compile your brief to prepare the handoff.');}});
$("backup-project").addEventListener("click",async()=>{
  const btn=$("backup-project");btn.disabled=true;btn.textContent="Backing up…";
  try {
    if(!pending.idle())throw new Error("Wait for edits to finish saving before backing up.");
    const items=store.get(),inputs=projectInputs(),stamp=JSON.stringify({items,inputs});
    const text=await createProjectBackup(items,inputs,getCrop);
    if(!pending.idle()||JSON.stringify({items:store.get(),inputs:projectInputs()})!==stamp)throw new Error("Collection or inputs changed during backup. Try again.");
    downloadText("design-claw-project.json",text,"application/json");
  }catch(e){toast(e.message);}
  finally{btn.disabled=false;btn.textContent="Download project backup";}
});
$("import-project").addEventListener("click",()=>$("project-file").click());
$("project-file").addEventListener("change",async()=>{
  const file=$("project-file").files?.[0];if(!file)return;
  const btn=$("import-project");btn.disabled=true;btn.textContent="Checking backup…";importingProject=true;setCaptureEnabled(false);
  try {
    if(file.size>96*1024*1024)throw new Error("Backup must be under 96 MiB.");
    const parsed=await parseProjectBackup(await file.text());
    // Decode every PNG before staging metadata; corrupt images cannot become
    // references. Close each bitmap immediately to bound decompressed memory.
    for(const entry of parsed.entries){
      const bitmap=await createImageBitmap(entry.blob);
      const valid=bitmap.width===entry.item.w&&bitmap.height===entry.item.h;bitmap.close();
      if(!valid)throw new Error("Backup image dimensions do not match.");
    }
    btn.textContent="Importing…";
    const result=await mutate(()=>store.addMany(parsed.entries));
    if(!result?.ok)return;
    if(!$("brief").value.trim()){
      applyProjectInputs(parsed.inputs);
    }
    toast(`Imported ${result.count} references${result.notifyError?' — reopen the panel to refresh':''}. Existing references were kept.`);
  }catch(e){toast(`Import failed: ${e.message||"The backup could not be read"}`);}
  finally{$("project-file").value="";btn.disabled=false;btn.textContent="Import backup";importingProject=false;setCaptureEnabled(true);}
});
$("copy-json").addEventListener("click", () => { if (fresh()) copyText(out.current().specJson, "Copied resolved-spec.json"); });
$("download-json").addEventListener("click", () => {
  if (!fresh()) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out.current().specJson], { type: "application/json" }));
  a.download = "resolved-spec.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("Downloaded resolved-spec.json");
});
$("copy").addEventListener("click", () => { if (fresh()) copyText($("output").textContent, "Copied"); });
$("download").addEventListener("click", () => {
  if (!fresh()) return;
  const a = document.createElement("a");
  const isPrompt = pane === "prompt";
  a.href = URL.createObjectURL(new Blob([isPrompt ? out.current().prompt : out.current().designMd], { type: isPrompt ? "text/plain" : "text/markdown" }));
  a.download = isPrompt ? "PROMPT.txt" : "DESIGN.md"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast("Downloaded " + a.download);
});
$("enhance").addEventListener("click", async () => {
  if (!fresh()) return;
  const btn = $("enhance"), prev = btn.textContent, token = out.begin();
  btn.disabled = true; btn.textContent = "Enhancing…";
  try {
    const direction = await enrichWithLLM(token.compiled, generateText);
    if (!out.stillCurrent(token)) { toast("Ignored — inputs changed since enhancement started"); return; }
    out.applyEnhancement(withCreativeDirection(token.compiled, direction));
    showPane("prompt"); toast("Added creative direction (advisory)");
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = prev; }
});
$("export").addEventListener("click", async () => {
  const btn = $("export"), prev = btn.textContent;
  await exportBundle({
    out, buildBundle,
    getBytes: async (sid) => { const blob = await getCrop(sid); return blob ? new Uint8Array(await blob.arrayBuffer()) : null; },
    download: (filename, bytes) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    toast,
    setBusy: (b) => { btn.disabled = b; btn.textContent = b ? "Bundling…" : prev; },
  });
});

// ---------- persona + init ----------
// Independent local snapshots use their own database and same-origin lock.
const collectionMutex=createTrayMutex('design-claw-collections');
const library=createCollectionLibrary({repo:collectionRepository,withLock:collectionMutex.withLock});
let collectionBusy=false,collectionRenderGeneration=0;
async function collectionChanged(){
  await refreshCollections();
  try{await chrome.storage.local.set({collectionRevision:crypto.randomUUID()});}catch{/* snapshot is already committed; notification failure cannot undo it */}
}
async function refreshCollections(){
  const generation=++collectionRenderGeneration,result=await library.list();if(generation!==collectionRenderGeneration)return;
  const host=$('collection-list');host.replaceChildren();
  if(!result.ok){$('collection-message').textContent=result.reason;return;}
  $('collection-message').textContent='';
  if(!result.collections.length){const p=document.createElement('p');p.className='collection-empty';p.textContent='No saved collections yet. Save this board to reuse it later.';host.append(p);}
  for(const saved of result.collections){
    const row=document.createElement('div');row.className='collection-row';row.dataset.id=saved.id;
    const title=document.createElement('strong');title.textContent=saved.name;
    const detail=document.createElement('p');detail.textContent=`${saved.count} references · ${Math.max(1,Math.round(saved.bytes/1024))} KB · ${new Date(saved.updatedAt).toLocaleDateString()}`;
    const actions=document.createElement('div');actions.className='workbench-actions';
    for(const [label,action]of [['Add to board',()=>addSavedCollection(saved.id)],['Rename',async()=>{const r=await library.rename(saved.id,$('collection-name').value);if(!r.ok)toast(r.reason);else await collectionChanged();}],['Delete',async()=>{if(!confirm(`Delete saved collection “${saved.name}”? Current board references will be kept.`))return;const r=await library.remove(saved.id);if(!r.ok)toast(r.reason);else await collectionChanged();}]]){
      const btn=document.createElement('button');btn.type='button';btn.className='btn sm';btn.textContent=label;
      btn.addEventListener('click',async()=>{if(collectionBusy)return toast('A collection operation is still running.');collectionBusy=true;btn.disabled=true;try{await action();}catch(e){toast(e.message);}finally{collectionBusy=false;if(btn.isConnected)btn.disabled=false;}});actions.append(btn);
    }
    row.append(title,detail,actions);host.append(row);
  }
}
async function addSavedCollection(id){
  if(importingProject||areaCaptureBusy||session)throw new Error('Finish the capture or import before adding a collection.');
  importingProject=true;setCaptureEnabled(false);
  try{
    const result=await library.read(id);if(!result.ok)throw new Error(result.reason);
    const parsed=await parseProjectBackup(result.text);
    for(const entry of parsed.entries){const bitmap=await createImageBitmap(entry.blob);const valid=bitmap.width===entry.item.w&&bitmap.height===entry.item.h;bitmap.close();if(!valid)throw new Error('Saved image dimensions do not match.');}
    const added=await mutate(()=>store.addMany(parsed.entries));
    if(added?.ok){if(!$('brief').value.trim())applyProjectInputs(parsed.inputs);toast(`Added ${added.count} saved references. Existing references were kept.`);}
  }finally{importingProject=false;setCaptureEnabled(true);}
}
$('collection-save').addEventListener('click',async()=>{
  if(collectionBusy||importingProject)return toast('A collection operation is still running.');
  const btn=$('collection-save');collectionBusy=true;btn.disabled=true;btn.textContent='Saving…';
  try{
    if(!pending.idle())throw new Error('Wait for reference edits to finish saving.');
    const items=store.get(),inputs=projectInputs(),stamp=JSON.stringify({items,inputs});
    const snapshot=await createProjectBackup(items,inputs,getCrop);
    if(!pending.idle()||JSON.stringify({items:store.get(),inputs:projectInputs()})!==stamp)throw new Error('The board or brief changed while saving. Try again.');
    const saved=await library.save($('collection-name').value,snapshot,items.length);if(!saved.ok)throw new Error(saved.reason);
    await collectionChanged();toast(`${saved.updated?'Updated':'Saved'} collection “${saved.collection.name}”.`);
  }catch(e){toast(e.message);}finally{collectionBusy=false;btn.disabled=false;btn.textContent='Save board';}
});

$("persona-save").addEventListener("click", async () => { await chrome.storage.local.set({ persona: $("persona").value }); toast("Persona saved"); });
$("persona-reset").addEventListener("click", async () => {
  $("persona").value = DEFAULT_PERSONA;
  markStale(); // a programmatic value change does NOT fire the 'input' listener — invalidate here
  await chrome.storage.local.set({ persona: DEFAULT_PERSONA });
  toast("Persona reset");
});

// ---------- named run presets (lock-coordinated, local, inputs only) ----------
const presetMutex = createTrayMutex("design-compositor-presets");
const presetStore = createPresetStore({
  load: async () => { const { runPresets } = await chrome.storage.local.get("runPresets"); return Array.isArray(runPresets) ? runPresets : []; },
  save: async (arr) => chrome.storage.local.set({ runPresets: arr }),
  withLock: presetMutex.withLock,
  onChange: (list) => fillPresetSelect(list),
});
function fillPresetSelect(list) {
  const sel = $("preset-select"); const prev = sel.value;
  sel.innerHTML = '<option value="">Saved presets…</option>';
  for (const p of list) { const o = document.createElement("option"); o.value = p.name; o.textContent = p.name; sel.appendChild(o); }
  if (list.some((p) => p.name === prev)) sel.value = prev;
}
async function refreshPresets() { fillPresetSelect(await presetStore.list()); }
$("preset-save").addEventListener("click", async () => {
  const r = await presetStore.save($("preset-name").value, projectInputs());
  if (r.ok) { $("preset-select").value = r.name; toast(r.updated ? `Updated "${r.name}"` : `Saved "${r.name}"`); } else toast(r.reason);
});
$("preset-apply").addEventListener("click", async () => {
  const name = $("preset-select").value; if (!name) return toast("Choose a preset to apply");
  const r = await presetStore.apply(name); if (!r.ok) return toast(r.reason);
  $("brief").value = r.preset.brief; $("persona").value = r.preset.persona; $("perrun").value = r.preset.perRunNote; $("preset-name").value = r.name;
  applyGuidance(r.preset.guidance);
  markStale(); // applying a preset invalidates the last compile immediately
  toast(`Applied "${r.name}"`);
});
$("preset-rename").addEventListener("click", async () => {
  const sel = $("preset-select").value; if (!sel) return toast("Choose a preset to rename");
  const r = await presetStore.rename(sel, $("preset-name").value);
  if (r.ok) { $("preset-select").value = r.name; toast(`Renamed to "${r.name}"`); } else toast(r.reason);
});
$("preset-delete").addEventListener("click", async () => {
  const sel = $("preset-select").value; if (!sel) return toast("Choose a preset to delete");
  const r = await presetStore.remove(sel);
  if (r.ok) { $("preset-name").value = ""; toast(`Deleted "${sel}"`); } else toast(r.reason);
});

(async () => {
  enforceEnvironment();
  if(isStudio){setCaptureEnabled(false);document.querySelector('.capture-section h2').textContent='Your shared reference board';document.querySelector('.capture-section .sec-sub').textContent='Sources, roles and the details worth borrowing.';$('scan-page').disabled=true;$('bar-hint').textContent='Collect from the extension side panel on a website. Use this wider studio to organize the same board and prepare your handoff.';$('open-studio').hidden=true;}
  const loaded = await store.load();
  if (loaded && loaded.notifyError) toast(loaded.notifyError);
  refreshChip();
  refreshPresets();
  refreshCollections();
  const { persona } = await chrome.storage.local.get("persona");
  $("persona").value = persona ?? DEFAULT_PERSONA;
  const draftKey=isStudio?new URL(location.href).searchParams.get('draft'):null;
  if(draftKey?.startsWith('designClawStudio:')){
    try{const data=await chrome.storage.session.get(draftKey);if(data[draftKey])applyProjectInputs(data[draftKey]);await chrome.storage.session.remove(draftKey);}catch(e){toast('The studio opened, but the brief could not be transferred. Use a saved setup or collection.');}
  }
})();
for (const id of ["brief", "perrun", "persona"]) $(id).addEventListener("input", markStale);
for(const id of Object.values(GUIDANCE_FIELDS))$(id).addEventListener('input',markStale);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshChip(); });
