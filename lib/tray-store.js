// Single authority for the reference tray, shared across EVERY producer (every
// side-panel window). The entire read → compute → write of each mutation runs under
// one shared lock injected as deps.withLock — in the extension that is the browser's
// Web Locks API (see lib/tray-lock.js), which holds the lock across all same-origin
// contexts. Because the lock spans the whole critical section, two panels can never
// both read the tray and then both write: the lost update is prevented at the
// mechanism level, not merely within one panel's own serializer.
//
// Crop blobs are written under per-op unique keys (no cross-origin collision), so only
// the shared metadata array needs the lock. Ordering keeps images and metadata
// consistent under failure and cancellation:
//   add    — stage the crop FIRST (reversible), then, under the lock, read → (recheck
//            cancel) → write metadata. The crop is rolled back whenever NO metadata
//            commit occurred (cancel, read failure, or write failure). Once the
//            metadata write begins the op is committed and the crop is kept — we never
//            delete a crop that committed metadata references.
//   remove — under the lock, write metadata WITHOUT the item, THEN delete its crop, so
//            a failed metadata write never orphans a still-referenced crop.
//
// PERSISTENCE AND NOTIFICATION ARE SEPARATE STEPS. The view notification (onChange,
// i.e. a render) happens AFTER the outcome of the write is already decided, outside
// the lock, and its failure is captured as `notifyError` on an otherwise successful
// result. It can never flip `committed`, and so can never trigger the add rollback —
// previously a throwing/rejecting renderer turned a fully committed add into a
// reported failure AND deleted the crop its committed metadata still referenced,
// leaving a visible reference pointing at a missing image.
//
// Notification renders the store's CURRENT cache rather than the snapshot the caller
// computed, so even if two notifications resolve out of order both paint the newest
// committed state and the view converges on the truth. Renders are deliberately not
// awaited under the lock: a slow or hung crop read must not block every other panel's
// tray mutation.
//
// Conflict policy for edits to the SAME reference: last writer wins by lock-acquisition
// order (serialized), and a remove that lands first makes a later edit a no-op. We do
// not merge conflicting scalar values. Every method RESOLVES with {ok,…} and never
// rejects, so a panel handler cannot leak an unhandled rejection.
export function createTrayStore(deps) {
  // deps: putCrop(id,blob), deleteCrop(id), loadMeta()->Promise<array>,
  //       saveMeta(array)->Promise, onChange(sortedTray)->void|Promise, withLock(fn)->Promise
  let tray = [];
  const withLock = typeof deps.withLock === "function" ? deps.withLock : (fn) => fn(); // fallback: single-context only
  const sorted = (a) => a.slice().sort((x, y) => x.order - y.order);
  const setCache = (next) => { tray = next; };
  const safeDelete = async (id) => { try { await deps.deleteCrop(id); } catch {} };
  // Run a critical section under the shared lock; map any throw to a useful {ok:false}.
  const guard = (critical) => Promise.resolve(withLock(critical)).catch((e) => ({ ok: false, reason: (e && e.message) || "tray operation failed" }));

  // Tell the view, from the live cache, with its failure isolated from the result.
  async function notify() {
    try { await deps.onChange(sorted(tray)); return null; }
    catch (e) { return (e && e.message) || "the reference list could not be redrawn"; }
  }
  // Notify only when the cache actually changed; attach any notification failure.
  // `_notify` is internal bookkeeping and is stripped from the published result.
  async function settle(res) {
    if (!res || !res._notify) return res;
    const notifyError = await notify();
    const { _notify, ...rest } = res;
    return notifyError ? { ...rest, notifyError } : rest;
  }

  async function load() {
    const res = await guard(async () => {
      try { tray = await deps.loadMeta(); } catch { /* keep the current cache */ }
      return { ok: true };
    });
    const out = await settle({ ...res, _notify: true });
    return { ...out, tray: sorted(tray) };
  }
  // storage.onChanged is a NOTIFICATION, not a lock: just refresh the cache + render.
  function syncExternal(nextMeta) {
    if (Array.isArray(nextMeta)) tray = nextMeta;
    return settle({ ok: true, _notify: true });
  }

  function add({ item, blob, cancelled }) {
    const isCancelled = typeof cancelled === "function" ? cancelled : () => false;
    const id = item.id;
    return (async () => {
      // Stage the crop OUTSIDE the lock (unique key, no cross-panel collision).
      try { await deps.putCrop(id, blob); }
      catch { await safeDelete(id); return { ok: false, committed: false, reason: "could not store the crop image" }; }
      if (isCancelled()) { await safeDelete(id); return { ok: false, committed: false, reason: "cancelled" }; } // before the lock
      const res = await guard(async () => {
        if (isCancelled()) return { ok: false, committed: false, reason: "cancelled" };                 // waited for the lock/queue
        let base;
        try { base = await deps.loadMeta(); }
        catch { return { ok: false, committed: false, reason: "could not read the collection" }; }        // metadata-read failure
        if (isCancelled()) return { ok: false, committed: false, reason: "cancelled" };                  // after the read, before the write
        const order = base.length ? Math.max(...base.map((i) => i.order)) + 1 : 0;
        const next = base.concat([{ ...item, order }]);
        try { await deps.saveMeta(next); }                                                               // COMMIT POINT
        catch { return { ok: false, committed: false, reason: "could not save the collection" }; }
        setCache(next);
        return { ok: true, committed: true, _notify: true };
      });
      // The rollback decision reads ONLY the persistence outcome — never the view's.
      if (!res.committed) await safeDelete(id);
      return settle(res);
    })();
  }

  function remove(id) {
    return (async () => {
      const res = await guard(async () => {
        let base; try { base = await deps.loadMeta(); } catch { return { ok: false, reason: "could not read the collection" }; }
        if (!base.some((i) => i.id === id)) { setCache(base); return { ok: true, removed: false, _notify: true }; }
        const next = base.filter((i) => i.id !== id);
        try { await deps.saveMeta(next); } catch { return { ok: false, reason: "could not save the collection" }; }
        setCache(next);
        await safeDelete(id); // metadata no longer references id -> deleting its crop is safe
        return { ok: true, removed: true, _notify: true };
      });
      return settle(res);
    })();
  }

  // Import is one metadata commit, with all new crops staged first. Existing
  // references are never replaced. Rollback only touches this operation's IDs.
  async function addMany(entries) {
    if(!Array.isArray(entries)||!entries.length)return {ok:false,reason:'No references to import.'};
    const staged=[],ids=new Set();
    for(const entry of entries){
      if(!entry?.item?.id||!entry.blob||ids.has(entry.item.id))return {ok:false,reason:'Imported references need unique IDs and images.'};
      ids.add(entry.item.id);
    }
    // IDs are generated per import; collision checking happens before staging
    // under the same cross-panel lock as the commit, so no crop can overwrite.
    const result=await guard(async()=>{
      const base=await deps.loadMeta();
      if(base.some(it=>ids.has(it.id)))return {ok:false,reason:'Imported IDs collide with existing references.'};
      try {
        for(const {item,blob} of entries){staged.push(item.id);await deps.putCrop(item.id,blob);}
        let order=base.length?Math.max(...base.map(it=>it.order))+1:0;
        let hasBase=base.some(it=>it.role==='spine');
        const imported=entries.map(({item})=>{
          const role=item.role==='spine'?(hasBase?'component':(hasBase=true,'spine')):item.role;
          return {...item,role,order:order++};
        });
        const next=base.concat(imported);await deps.saveMeta(next);setCache(next);
        return {ok:true,committed:true,count:imported.length,_notify:true};
      } catch(e){return {ok:false,committed:false,reason:e?.message||'Could not save imported references.'};}
    });
    if(!result.committed)for(const id of staged)await safeDelete(id);
    return settle(result);
  }

  function setRole(id, role) {
    return (async () => {
      const res = await guard(async () => {
        let base; try { base = await deps.loadMeta(); } catch { return { ok: false, reason: "could not read the collection" }; }
        let hit = false;
        const next = base.map((i) => {
          if (i.id === id) { hit = true; return { ...i, role }; }
          if (role === "spine" && i.role === "spine") return { ...i, role: "component" }; // exactly one spine
          return i;
        });
        if (!hit) { setCache(base); return { ok: true, changed: false, _notify: true }; }
        try { await deps.saveMeta(next); } catch { return { ok: false, reason: "could not save the collection" }; }
        setCache(next); return { ok: true, changed: true, _notify: true };
      });
      return settle(res);
    })();
  }

  function setNote(id, note) {
    return (async () => {
      const res = await guard(async () => {
        let base; try { base = await deps.loadMeta(); } catch { return { ok: false, reason: "could not read the collection" }; }
        let hit = false;
        const next = base.map((i) => (i.id === id ? (hit = true, { ...i, note }) : i));
        if (!hit) { setCache(base); return { ok: true, changed: false, _notify: true }; }
        try { await deps.saveMeta(next); } catch { return { ok: false, reason: "could not save the collection" }; }
        setCache(next); return { ok: true, changed: true, _notify: true };
      });
      return settle(res);
    })();
  }

  function setDetails(id, patch) {
    const limits = { name: 160, borrow: 2000, avoid: 2000 };
    const clean = Object.fromEntries(Object.entries(limits).filter(([key]) => Object.hasOwn(patch || {}, key)).map(([key, max]) => [key, String(patch[key] || '').trim().slice(0, max)]));
    return (async () => {
      const result = await guard(async () => {
        const base = await deps.loadMeta();
        const hit = base.some(item => item.id === id);
        if (!hit) { setCache(base); return { ok: true, changed: false, _notify: true }; }
        const next = base.map(item => item.id === id ? { ...item, ...clean } : item);
        await deps.saveMeta(next); setCache(next);
        return { ok: true, changed: true, _notify: true };
      });
      return settle(result);
    })();
  }

  function move(id, dir) {
    return (async () => {
      const res = await guard(async () => {
        let base; try { base = sorted(await deps.loadMeta()); } catch { return { ok: false, reason: "could not read the collection" }; }
        const i = base.findIndex((x) => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= base.length) { setCache(base); return { ok: true, moved: false, _notify: true }; }
        const next = base.map((x) => ({ ...x }));
        [next[i].order, next[j].order] = [next[j].order, next[i].order];
        try { await deps.saveMeta(next); } catch { return { ok: false, reason: "could not save the collection" }; }
        setCache(next); return { ok: true, moved: true, _notify: true };
      });
      return settle(res);
    })();
  }

  return { load, syncExternal, add, addMany, remove, setRole, setNote, setDetails, move, get: () => sorted(tray) };
}
