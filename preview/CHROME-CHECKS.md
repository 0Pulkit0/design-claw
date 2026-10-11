# Chrome checklist — what only a real browser can prove

`node tests/run.mjs` drives the production modules (selection state machine, tile
geometry, pacer, stitch orchestration, compiler, tray/inspector/compile logic)
with controlled promises. It does **not** run inside an extension: there is no
`chrome.*`, no real `captureVisibleTab`, no layout, no second window. The preview
fixtures render the real stylesheets with mocked data — also **not** the runtime.

The native Chrome items below remain **unexecuted** here. See VERIFICATION.md for real-renderer integration checks executed with a mock Chrome API bridge. They are ordered by what breaks most
quietly if wrong.

## Load

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Open any normal site, click the toolbar icon (this grants `activeTab` per tab),
   then open the side panel.

## UI (320 / 400 / 480 px)

- [ ] Drag the panel narrow and wide: header, capture buttons, cards, brief, and
      handoff stay legible; nothing clips or overlaps at 320px.
- [ ] Tab through the whole panel: every control takes focus, the focus ring is
      visible on paper, and the inspector traps focus (Esc closes, focus returns
      to the thumbnail or name you opened it from).
- [ ] A long host name truncates with an ellipsis instead of stretching the card.
- [ ] A very tall capture has a compact preview. Open its inspector and choose
      Open image at full size to inspect the entire image.
- [ ] Empty state, stale banner, and a failed save (toast) all read clearly.
- [ ] Settings page matches the panel's language.

## Element capture

- [ ] Pick an element: crop lands, card says **Styles measured**, the inspector
      shows real values (and `none` where the element genuinely has none).
- [ ] ↑ / ↓ walk to the parent / first child; Esc cancels and restores the page
      (no leftover outline, no frozen animations, scroll position unchanged).

## Extended area capture — the new path

- [ ] Start a drag, hold the pointer near the **bottom** edge: a countdown shows
      2 → 1, then the page starts scrolling while you keep holding.
- [ ] Move away from the edge: scrolling stops immediately and the countdown
      resets (re-entering waits a fresh 2 s, it does not resume instantly).
- [ ] Same at the **top** edge, scrolling up.
- [ ] Wheel/trackpad-scroll mid-drag: the selection's starting corner stays put on
      the page (not on the screen) and the size readout grows accordingly.
- [ ] Release: the progress row counts screenshots, then one reference appears
      whose image contains the **whole** selection — not just the last screen.
- [ ] The inspector's "Captured" line says "stitched from N screenshots".
- [ ] Press **Cancel** mid-capture: nothing is added, the page returns to its
      original scroll position, and sticky/fixed elements look normal again.
- [ ] A page with a sticky header: the header appears **once** in the stitched
      image, not repeated every screen.
- [ ] A page with a full-screen cookie wall: it is hidden in the stitch rather
      than covering every tile.
- [ ] Navigate / reload the tab mid-capture → it aborts with an explanation and
      saves nothing.
- [ ] Switch tabs mid-capture → same.
- [ ] Resize the window mid-capture → same.
- [ ] Select an area inside a page that scrolls in a container (e.g. a chat app
      with its own scroll pane) → it refuses with the "doesn't scroll in the
      window" explanation instead of saving a partial image.
- [ ] A long infinite-scroll feed → either completes or stops with the "page grew
      while capturing" message; it must not save a sheared image.
- [ ] Run two side-panel windows and start an area capture in each: both finish,
      neither reports a `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` error.
- [ ] Afterwards, the page's scroll position, animations, and styles are back to
      normal (check a `position: fixed` header's inline `style` attribute is gone).

## Output clarity

- [ ] An area-only reference set compiles to a handoff with **no** empty token
      block and a "visual direction only" section.
- [ ] A mixed set omits unmeasured properties from DESIGN.md / Prompt, shows one
      Coverage note, and the Tokens tab still lists everything with badges.
- [ ] `resolved-spec.json` (Copy JSON) still contains the unavailable entries and
      their provenance.
- [ ] Export bundle: `DESIGN.md`, `PROMPT.txt`, `resolved-spec.json`,
      `references/REF-NN.png` — the stitched image opens at full height.

## Multi-window / persistence

- [ ] Two panels open: add in one, see it appear in the other; edit a role in one
      and a note in the other — no lost update.
- [ ] Remove a reference while its inspector is open → the dialog closes.
- [ ] Edit a note and click Compile immediately → the button reads "Saving edit…"
      and the compiled output reflects the **new** note.

## Workbench additions — native Chrome checks remain unexecuted here

- Scan visible styles on a real page, choose a sample, verify its outline, click it, and verify measured values after compiling.
- Reload or navigate after a scan; selecting a stale sample should request a new scan.
- Download token CSS; compare the chosen base/override values with Tokens. Edit a note; stale CSS export should refuse.
- Export/extract the ZIP and open BOARD.html without internet. Images should load, and full-size image links should work.
- Back up a collection, import into the same installation, reopen Chrome, and verify duplicate references have new IDs and the existing base remains. Import a corrupted backup; nothing should be added.
- Capture text on an opaque background and review contrast. Transparent/image backgrounds should request review.
- Search references by host, note and role; clear the filter and verify all original references remain.

## 0.4 native acceptance — unexecuted here

- [ ] Reload in the same extension folder; the toolbar and extension-management page show the new mark at normal and high-density sizes.
- [ ] Capture a multi-screen area, then use Download captured image; open the PNG and compare it with the inspector image.
- [ ] Set a name and Borrow/Avoid annotations, then compile; verify the prompt, JSON and offline board agree.
- [ ] Change every structured brief field after compile; Copy, Download and Export refuse stale output.
- [ ] Open studio from a filled brief; its initial inputs and shared board match. Capture remains in the website's side panel.
- [ ] Save a collection; remove its original live references; reopen Chrome and add the collection. Images and metadata remain usable.
- [ ] Open two panels; rename/add/remove saved collections and confirm the list converges without lost snapshots.
- [ ] Check the design controls, inspector and handoff with keyboard focus at 320/400/480px and the wide studio.

The Node and browser-bridge tests do not mark these native checks complete.
