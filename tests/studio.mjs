import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeGuidance,renderBuildPlan,renderReviewChecklist,DESIGN_SYSTEM_INSTRUCTION} from '../lib/design-guidance.js';
import {compile,enrichWithLLM,withCreativeDirection,enhancementContext} from '../lib/compiler.js';
import {createCompileGate} from '../lib/compile-gate.js';
import {createPresetStore} from '../lib/presets.js';
import {createProjectBackup,parseProjectBackup} from '../lib/project-backup.js';
import {createTrayStore} from '../lib/tray-store.js';
import {inMemoryMutex} from '../lib/tray-lock.js';
import {createCollectionLibrary} from '../lib/collections.js';
import {renderBoard} from '../lib/design-assets.js';
import {buildBundle} from '../lib/bundle.js';
let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const source={id:'a',sourceUrl:'https://example.com/ref',role:'component',order:0,name:'Quiet navigation',borrow:'The clear grouping',avoid:'The promotional banner',note:'A note',tokens:{computed:{color:'#123456','font-family':'"Source Serif", serif','font-size':'18px','box-shadow':'none'}},measurement:{status:'measured'}};
const guidance={productType:'app',audience:'Independent makers',primaryAction:'Create a project',mustInclude:'Search and empty states',avoid:'Marketing hero',stack:'Plain HTML/CSS'};
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
await test('Structured direction is bounded and whitelisted, with compatible defaults',()=>{
  const g=normalizeGuidance({...guidance,apiKey:'secret',audience:'x'.repeat(1100)});assert.equal(g.audience.length,1000);assert.ok(!JSON.stringify(g).includes('secret'));
  assert.equal(normalizeGuidance({productType:'unknown'}).productType,'website');assert.equal(normalizeGuidance(null).audience,'');
});
await test('Compile includes the same reference intent and structured inputs in all handoff records',()=>{
  const c=compile([source],'Project',{guidance}),j=JSON.parse(c.specJson);
  assert.deepEqual(j.guidance,guidance);assert.equal(j.references[0].borrow,source.borrow);
  for(const output of [c.prompt,c.designMd]){assert.ok(output.includes(source.borrow));assert.ok(output.includes(source.avoid));assert.ok(output.includes(guidance.primaryAction));assert.ok(output.includes(JSON.stringify(source.tokens.computed['font-family'])));}
  assert.match(c.prompt,/operational workspace/);assert.ok(!c.prompt.includes('impeccable taste'));
});
await test('Product-specific guidance differentiates dashboard, store and reading tasks',()=>{
  const c=type=>compile([source],'b',{guidance:{productType:type}}).prompt;
  assert.match(c('dashboard'),/units, time ranges/);assert.match(c('store'),/out-of-stock/);assert.match(c('article'),/Prioritize reading/);
});
await test('Compile gate forwards direction rather than silently dropping new input fields',()=>{
  let opts;const g=createCompileGate({pending:{idle:()=>true},out:{setCompiled:()=>{}},getItems:()=>[],getInputs:()=>({brief:'B',guidance}),compile:(_items,_brief,o)=>(opts=o,{})});assert.equal(g.run().ok,true);assert.deepEqual(opts.guidance,guidance);
});
await test('Advisory enhancement sees the real task and leaves measured evidence byte-identical',async()=>{
  const c=compile([source],'B',{guidance});let seen;
  const direction=await enrichWithLLM(c,async(prompt,options)=>(seen={prompt,options},{text:'Lead with the project workspace, using the reference grouping to prioritize creation.'}));
  assert.ok(seen.prompt.includes(guidance.audience));assert.ok(seen.options.system.includes('Borrow and Avoid'));
  const e=withCreativeDirection(c,direction);assert.equal(JSON.stringify(e.resolved),JSON.stringify(c.resolved));assert.deepEqual(JSON.parse(e.specJson).guidance,guidance);
});
await test('Build plan and checklist are tailored and do not turn unknown values into measurements',()=>{
  const c=compile([source],'B',{guidance});assert.match(renderBuildPlan(c),/Create a project/);assert.match(renderBuildPlan(c),/Quiet navigation/);assert.match(renderReviewChecklist(c),/narrow and wide/i);assert.match(DESIGN_SYSTEM_INSTRUCTION,/not captured facts/);
});
await test('Advisory context is bounded and excludes long keyframes while exports preserve them',()=>{
  const item={...source,tokens:{...source.tokens,keyframes:'KEYFRAME_SENTINEL'+ 'x'.repeat(60000)}};
  const c=compile([item],'B'.repeat(20000),{guidance}),context=enhancementContext(c);
  assert.ok(context.length<30000);assert.ok(!context.includes('KEYFRAME_SENTINEL'));assert.ok(c.specJson.includes('KEYFRAME_SENTINEL'));assert.ok(context.includes('images are not provided'));
});
await test('Preset guidance survives save/apply while provider secrets remain excluded',async()=>{
  let records=[];const p=createPresetStore({load:async()=>records,save:async next=>{records=next;},withLock:inMemoryMutex().withLock});
  await p.save('App',{guidance,brief:'B',apiKey:'secret'});const applied=await p.apply('App');assert.deepEqual(applied.preset.guidance,guidance);assert.ok(!JSON.stringify(records).includes('secret'));
});
await test('Old presets still apply without requiring newly introduced fields',async()=>{
  const p=createPresetStore({load:async()=>[{name:'Old',brief:'B'}],save:async()=>{},withLock:inMemoryMutex().withLock});const r=await p.apply('Old');assert.equal(r.preset.brief,'B');assert.ok(!r.preset.guidance);
});
await test('Project backups preserve new intent fields and direction without exporting secrets',async()=>{
  const text=await createProjectBackup([source],{guidance,apiKey:'secret'},async()=>new Blob([png]));const p=await parseProjectBackup(text,()=> 'new');assert.equal(p.entries[0].item.name,source.name);assert.equal(p.entries[0].item.avoid,source.avoid);assert.deepEqual(p.inputs.guidance,guidance);assert.ok(!text.includes('secret'));
});
await test('Legacy backups obtain safe guidance defaults',async()=>{
  const text=await createProjectBackup([source],{},async()=>new Blob([png]));const data=JSON.parse(text);delete data.inputs.guidance;const p=await parseProjectBackup(JSON.stringify(data));assert.equal(p.inputs.guidance.productType,'website');
});
function trayRig(){let meta=[structuredClone(source)];const lock=inMemoryMutex();return {store:createTrayStore({loadMeta:async()=>structuredClone(meta),saveMeta:async next=>{meta=structuredClone(next);},putCrop:async()=>{},deleteCrop:async()=>{},onChange:()=>{},withLock:lock.withLock}),read:()=>meta};}
await test('Reference detail writes reject unrelated keys and preserve role, note and measured CSS',async()=>{
  const r=trayRig();await r.store.setDetails('a',{name:'Name',borrow:'A useful rhythm',role:'spine',apiKey:'secret'});assert.equal(r.read()[0].name,'Name');assert.equal(r.read()[0].role,'component');assert.equal(r.read()[0].note,'A note');assert.equal(r.read()[0].tokens.computed.color,'#123456');assert.ok(!JSON.stringify(r.read()).includes('secret'));
});
await test('Concurrent annotation and note edits compose under the existing mutation authority',async()=>{
  const r=trayRig();await Promise.all([r.store.setDetails('a',{borrow:'Keep it'}),r.store.setNote('a','New note')]);assert.equal(r.read()[0].borrow,'Keep it');assert.equal(r.read()[0].note,'New note');await r.store.remove('a');assert.equal((await r.store.setDetails('a',{name:'Resurrect'})).changed,false);assert.equal(r.read().length,0);
});
function libraryRig(options={}){
  const meta=new Map(),snapshots=new Map(),lock=inMemoryMutex();let fail=false;
  const repo={list:async()=>[...meta.values()].map(v=>({...v})),get:async id=>snapshots.get(id),put:async(record,text)=>{if(fail)throw Error('Disk full');meta.set(record.id,{...record});snapshots.set(record.id,text);},remove:async id=>{meta.delete(id);snapshots.delete(id);}};
  let id=0;return {library:createCollectionLibrary({repo,withLock:lock.withLock,newId:()=>`c${++id}`,...options}),repo,meta,snapshots,lock,setFail:v=>{fail=v;}};
}
await test('Named library snapshots remain independent of the live board and survive renaming',async()=>{
  const r=libraryRig(),saved=await r.library.save('Editorial','independent image snapshot',3);assert.equal(saved.ok,true);await r.library.rename(saved.collection.id,'Reading');assert.equal((await r.library.list()).collections[0].name,'Reading');assert.equal((await r.library.read(saved.collection.id)).text,'independent image snapshot');
});
await test('Collection name upsert does not add duplicate snapshots',async()=>{
  const r=libraryRig();await r.library.save('Board','first',1);const s=await r.library.save('board','second',2);assert.equal(s.updated,true);assert.equal(r.meta.size,1);assert.equal((await r.library.read(s.collection.id)).text,'second');
});
await test('Collection rename conflicts and deletion are isolated from live tray crops',async()=>{
  const r=libraryRig(),a=await r.library.save('A','a',1),b=await r.library.save('B','b',1);assert.equal((await r.library.rename(a.collection.id,'B')).ok,false);await r.library.remove(a.collection.id);assert.equal((await r.library.read(a.collection.id)).ok,false);assert.equal((await r.library.read(b.collection.id)).ok,true);
});
await test('Collection count and byte budgets reject writes before persistence',async()=>{
  const r=libraryRig({maxCount:1,maxBytes:8});await r.library.save('A','abc',1);assert.equal((await r.library.save('B','abc',1)).ok,false);assert.equal((await r.library.save('A','0123456789',1)).ok,false);assert.equal((await r.library.read('c1')).text,'abc');
});
await test('Collection persistence failures surface clearly and the next mutation succeeds',async()=>{
  const r=libraryRig();r.setFail(true);assert.match((await r.library.save('A','a',1)).reason,/Disk full/);r.setFail(false);assert.equal((await r.library.save('B','b',1)).ok,true);
});
await test('Separate library instances coordinate the full read-compute-write critical section',async()=>{
  const r=libraryRig(),hold=gate();let calls=0;const orig=r.repo.list;r.repo.list=async()=>{calls++;if(calls===1)await hold.promise;return orig();};
  const second=createCollectionLibrary({repo:r.repo,withLock:r.lock.withLock,newId:()=> 'other'});
  const a=r.library.save('A','a',1),b=second.save('B','b',1);await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);hold.release();await Promise.all([a,b]);assert.equal(r.meta.size,2);
});
await test('Offline board escapes new human names and intent annotations',()=>{
  const c=compile([{...source,name:'<img src=x>',borrow:'<script>bad</script>'}],'B');const board=renderBoard(c);assert.ok(board.includes('&lt;img src=x&gt;'));assert.ok(board.includes('&lt;script&gt;'));assert.ok(!board.includes('<script>'));
});
await test('The kit contains tailored build and review instructions plus unmodified image bytes',async()=>{
  const c=compile([source],'B',{guidance}),{bytes}=await buildBundle(c,async()=>png),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();let o=0;
  while(view.getUint32(o,true)===0x04034b50){const size=view.getUint32(o+18,true),n=view.getUint16(o+26,true),extra=view.getUint16(o+28,true),start=o+30+n+extra;entries.set(new TextDecoder().decode(bytes.slice(o+30,o+30+n)),bytes.slice(start,start+size));o=start+size;}
  for(const name of ['SYSTEM.md','BUILD-PLAN.md','REVIEW-CHECKLIST.md'])assert.ok(entries.has(name));assert.deepEqual(entries.get('references/REF-01.png'),png);assert.ok(new TextDecoder().decode(entries.get('BUILD-PLAN.md')).includes(guidance.primaryAction));
});
await test('Manifest declares original, valid toolbar and management icons at every size',()=>{
  const root=new URL('../',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  for(const [size,name]of Object.entries(manifest.icons)){const bytes=fs.readFileSync(new URL(name,root));assert.equal(bytes.readUInt32BE(16),Number(size));assert.equal(bytes.readUInt32BE(20),Number(size));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
  assert.equal(manifest.action.default_icon['16'],manifest.icons['16']);assert.equal(manifest.version,'0.4.0');
});
console.log(`${count} studio checks passed`);
