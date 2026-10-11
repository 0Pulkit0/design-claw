// Named, independent snapshots. Mutations use a separate same-origin Web Lock.
// Loading adds references to the live board; deletion never touches live crops.
export function createCollectionLibrary({ repo, withLock, now = Date.now, newId = () => crypto.randomUUID(), maxCount = 20, maxBytes = 256*1024*1024 }) {
  const nameOf = value => String(value || '').trim().slice(0, 80);
  const safe = async fn => { try { return await fn(); } catch (e) { return {ok:false,reason:e.message || 'Saved collection operation failed.'}; } };
  const eq = (a,b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  async function list() {
    return safe(async () => ({ok:true,collections:(await repo.list()).sort((a,b)=>b.updatedAt-a.updatedAt)}));
  }
  async function save(name, text, count) {
    return safe(() => withLock(async () => {
      name = nameOf(name);
      if (!name) throw new Error('Name the collection before saving.');
      if (typeof text !== 'string' || !Number.isInteger(count) || count < 1) throw new Error('A collection needs references and a valid snapshot.');
      const bytes = new TextEncoder().encode(text).length, all = await repo.list();
      const existing = all.find(item => eq(item.name,name));
      if (!existing && all.length >= maxCount) throw new Error(`You can save ${maxCount} collections. Delete one or download a backup first.`);
      if (all.filter(item=>item.id!==existing?.id).reduce((n,item)=>n+item.bytes,0)+bytes > maxBytes) throw new Error('Saved collections exceed the storage budget. Download backups and remove an older collection.');
      const record = {id:existing?.id || newId(),name,count,bytes,updatedAt:now()};
      await repo.put(record,text);
      return {ok:true,collection:record,updated:!!existing};
    }));
  }
  async function read(id) {
    return safe(() => withLock(async () => {
      const text = await repo.get(id);
      if (typeof text !== 'string') throw new Error('That collection no longer exists.');
      return {ok:true,text};
    }));
  }
  async function rename(id,name) {
    return safe(() => withLock(async () => {
      name=nameOf(name); if(!name)throw new Error('Enter a collection name.');
      const all=await repo.list(),record=all.find(item=>item.id===id);
      if(!record)throw new Error('That collection no longer exists.');
      if(all.some(item=>item.id!==id&&eq(item.name,name)))throw new Error('A collection with that name already exists.');
      const text=await repo.get(id);if(typeof text!=='string')throw new Error('Collection images are missing; use a backup.');
      await repo.put({...record,name,updatedAt:now()},text);return {ok:true};
    }));
  }
  async function remove(id) { return safe(() => withLock(async () => {await repo.remove(id);return {ok:true};})); }
  return {list,save,read,rename,remove};
}
