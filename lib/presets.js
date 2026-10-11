// Named run presets: {name, brief, persona, perRunNote}. Stored locally and shared
// across panels. Every write runs the whole read→modify→write under the injected
// shared lock (the same Web Lock mechanism as the tray, under its own name), so two
// panels editing presets at once can't silently overwrite unrelated presets. Each op
// RESOLVES {ok,…} (never rejects). Presets deliberately exclude API keys, provider
// settings, crops, reference trays, and compiled outputs.
import { normalizeGuidance } from './design-guidance.js';
export function createPresetStore(deps) {
  // deps: load()->Promise<array>, save(array)->Promise, withLock(fn)->Promise, onChange(list)?
  const withLock = typeof deps.withLock === "function" ? deps.withLock : (fn) => fn();
  const guard = (fn) => Promise.resolve(withLock(fn)).catch((e) => ({ ok: false, reason: (e && e.message) || "preset operation failed" }));
  const norm = (s) => String(s == null ? "" : s).trim();
  const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
  const sortByName = (a) => a.slice().sort((x, y) => x.name.localeCompare(y.name));
  const sanitize = (name, data) => ({ name: norm(name), brief: norm(data.brief), persona: norm(data.persona), perRunNote: norm(data.perRunNote), ...(data.guidance ? {guidance:normalizeGuidance(data.guidance)} : {}), updatedAt: Date.now() });

  async function list() { try { return sortByName(await deps.load()); } catch { return []; } }

  function save(name, data) {
    return guard(async () => {
      const n = norm(name);
      if (!n) return { ok: false, reason: "Name the preset before saving." };
      let arr; try { arr = await deps.load(); } catch { return { ok: false, reason: "Couldn't read saved presets." }; }
      const i = arr.findIndex((p) => eq(p.name, n));
      const rec = sanitize(n, data || {});
      const next = i >= 0 ? arr.map((p, j) => (j === i ? rec : p)) : arr.concat([rec]);
      try { await deps.save(next); } catch { return { ok: false, reason: "Couldn't save — local storage may be full." }; }
      if (deps.onChange) deps.onChange(sortByName(next));
      return { ok: true, updated: i >= 0, name: n };
    });
  }

  function apply(name) {
    return guard(async () => {
      let arr; try { arr = await deps.load(); } catch { return { ok: false, reason: "Couldn't read saved presets." }; }
      const p = arr.find((x) => eq(x.name, name));
      if (!p) return { ok: false, reason: "That preset no longer exists." };
      return { ok: true, name: p.name, preset: { brief: p.brief || "", persona: p.persona || "", perRunNote: p.perRunNote || "", ...(p.guidance ? {guidance:normalizeGuidance(p.guidance)} : {}) } };
    });
  }

  function rename(oldName, newName) {
    return guard(async () => {
      const n = norm(newName);
      if (!n) return { ok: false, reason: "Enter a new name." };
      let arr; try { arr = await deps.load(); } catch { return { ok: false, reason: "Couldn't read saved presets." }; }
      const i = arr.findIndex((p) => eq(p.name, oldName));
      if (i < 0) return { ok: false, reason: "That preset no longer exists." };
      if (arr.some((p, j) => j !== i && eq(p.name, n))) return { ok: false, reason: `A preset named "${n}" already exists.` };
      const next = arr.map((p, j) => (j === i ? { ...p, name: n, updatedAt: Date.now() } : p));
      try { await deps.save(next); } catch { return { ok: false, reason: "Couldn't save the rename." }; }
      if (deps.onChange) deps.onChange(sortByName(next));
      return { ok: true, name: n };
    });
  }

  function remove(name) {
    return guard(async () => {
      let arr; try { arr = await deps.load(); } catch { return { ok: false, reason: "Couldn't read saved presets." }; }
      if (!arr.some((p) => eq(p.name, name))) return { ok: true, removed: false };
      const next = arr.filter((p) => !eq(p.name, name));
      try { await deps.save(next); } catch { return { ok: false, reason: "Couldn't save the deletion." }; }
      if (deps.onChange) deps.onChange(sortByName(next));
      return { ok: true, removed: true };
    });
  }

  return { list, save, apply, rename, remove };
}
