import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compile,withCreativeDirection} from '../lib/compiler.js';
import {renderTokenCss,renderReferenceCss,renderBoard,safeCssValue} from '../lib/design-assets.js';
import {contrastRatio,contrastCheck,parseColor} from '../lib/contrast.js';
import {createProjectBackup,parseProjectBackup} from '../lib/project-backup.js';
import {createTrayStore} from '../lib/tray-store.js';
import {inMemoryMutex} from '../lib/tray-lock.js';
import {buildBundle} from '../lib/bundle.js';
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const source=(id,role,computed)=>({id,role,order:0,sourceUrl:'https://example.com/page?secret=123#section',note:'',tokens:{computed},measurement:{status:'measured'}});
const tokens=(color,background,size='16px',weight='400')=>({computed:{color,'font-size':size,'font-weight':weight},contrastContext:{background,uncertain:false}});
// A valid one-pixel PNG; import must preserve bytes, not re-encode them.
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
await test('CSS uses canonical winning role values with provenance and no unavailable inventions',()=>{
  const a=source('a','spine',{'border-radius':'0px',color:'rgb(0, 0, 0)','box-shadow':'none'}),b=source('b','shape',{'border-radius':'24px'});b.order=1;
  const c=compile([a,b],'b'),css=renderTokenCss(c.resolved);
  assert.match(css,/--dc-shape-border-radius: 24px; \/\* REF-02/);assert.match(css,/--dc-shape-box-shadow: none/);
  assert.ok(!css.includes('font-size'));assert.equal(renderTokenCss(withCreativeDirection(c,'Advisory only').resolved),css);
});
await test('CSS blocks resource loads and stylesheet escapes without changing the recorded JSON',()=>{
  for(const value of ['red;}body{display:none','url(https://tracking.example)','image-set("https://tracking.example" 1x)','"unfinished','rgb(1 2 3','/* hidden */red','red\n!important'])assert.equal(safeCssValue(value),null,value);
  assert.equal(safeCssValue('"Noto Sans", sans-serif'),'"Noto Sans", sans-serif');
  const c=compile([source('a','spine',{'background-image':'url("https://example.com/a.png")'})],'b');
  assert.ok(JSON.parse(c.specJson).tokens.color['background-image'].value.includes('https://example.com'));assert.ok(!renderTokenCss(c.resolved).includes('https://example.com'));
});
await test('Reference CSS retains each measured source rather than substituting global tokens',()=>{
  const a=source('a','spine',{'border-radius':'0px'}),b=source('b','component',{'border-radius':'16px'});b.order=1;
  const c=compile([a,b],'b'),css=renderReferenceCss([a,b],c.resolved);
  assert.match(css,/\.dc-ref-01 \{\n  border-radius: 0px/);assert.match(css,/\.dc-ref-02 \{\n  border-radius: 16px/);
});
await test('Offline board escapes notes and brief, references local images, and has no scripts',()=>{
  const a=source('a','component',{color:'#000'});a.note='<img src=x onerror=alert(1)>';const c=compile([a],'<script>alert(1)</script>');
  const html=renderBoard(c);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!/<script\b/.test(html));assert.ok(html.includes('src="references/REF-01.png"'));assert.ok(!html.includes('?secret='));
});
await test('Contrast ratios and thresholds use measured opaque pairs',()=>{
  assert.equal(contrastRatio(parseColor('#000'),parseColor('#fff')),21);
  assert.equal(contrastCheck(tokens('#000','#fff')).status,'pass');assert.equal(contrastCheck(tokens('#fff','#fff')).status,'fail');
  assert.equal(contrastCheck(tokens('#777','#fff','24px')).threshold,3);
  assert.equal(contrastCheck(tokens('#777','#fff','18.67px','700')).threshold,3);
  assert.equal(contrastCheck(tokens('#777','#fff','18px','700')).threshold,4.5);
});
await test('Contrast stays unknown for transparency, missing evidence, images, and unsupported spaces',()=>{
  assert.equal(contrastCheck({computed:{color:'#000'}}).status,'unknown');
  assert.equal(contrastCheck(tokens('rgba(0, 0, 0, .5)','#fff')).status,'unknown');
  assert.equal(contrastCheck({...tokens('#000','#fff'),contrastContext:{uncertain:true,reason:'gradient'}}).status,'unknown');
  assert.equal(contrastCheck(tokens('oklch(.4 .2 60)','#fff')).status,'unknown');
});
await test('Backup round trip preserves PNG bytes and measurements, excludes secrets, and assigns new IDs',async()=>{
  const a=source('old','spine',{'font-size':'32px','box-shadow':'none'});a.apiKey='do-not-export';a.tokens.contrastContext={background:'#fff',uncertain:false};
  const text=await createProjectBackup([a],{brief:'A project',persona:'Careful',perRunNote:'Sparse',apiKey:'do-not-export'},async()=>new Blob([png]));
  assert.ok(!text.includes('do-not-export'));assert.ok(!text.includes('secret=123'));
  const parsed=await parseProjectBackup(text,()=> 'new');assert.equal(parsed.entries[0].item.id,'new');
  assert.deepEqual(new Uint8Array(await parsed.entries[0].blob.arrayBuffer()),png);assert.equal(parsed.entries[0].item.tokens.computed['font-size'],'32px');assert.equal(parsed.inputs.brief,'A project');
});
await test('Corrupt backups, checksums, oversized dimensions and unsupported formats reject before persistence',async()=>{
  const text=await createProjectBackup([source('old','spine',{color:'#000'})],{},async()=>new Blob([png]));
  const d=JSON.parse(text);d.references[0].sha256='tampered';await assert.rejects(parseProjectBackup(JSON.stringify(d)),/checksum/);
  d.references[0].png='bad';await assert.rejects(parseProjectBackup(JSON.stringify(d)),/invalid image/);
  await assert.rejects(parseProjectBackup('{}'),/Design Claw/);await assert.rejects(parseProjectBackup('{'),/valid JSON/);
  await assert.rejects(createProjectBackup([source('x','component',{})],{},async()=>null),/Image missing/);
  const bytes=png.slice();new DataView(bytes.buffer).setUint32(16,20000);await assert.rejects(createProjectBackup([source('x','component',{})],{},async()=>new Blob([bytes])),/size limit/);
});
function rig(existing=[],opts={}){
  let meta=structuredClone(existing),writes=0,notify=0;const crops=new Map(existing.map(it=>[it.id,new Blob([png])]));
  const mutex=inMemoryMutex();
  const deps={withLock:mutex.withLock,loadMeta:async()=>structuredClone(meta),saveMeta:async next=>{writes++;if(opts.failSave)throw Error('Save failed');meta=structuredClone(next);},putCrop:async(id,blob)=>{if(opts.failCrop===id)throw Error('Crop failed');crops.set(id,blob);},deleteCrop:async id=>crops.delete(id),onChange:async()=>{notify++;if(opts.failNotify)throw Error('Render failed');}};
  return {store:createTrayStore(deps),second:()=>createTrayStore(deps),crops,meta:()=>meta,writes:()=>writes,notify:()=>notify};
}
await test('Aggregate pixel budget rejects oversized collections before image decoding',async()=>{
  // Header-only budget fixture; real decoder rejection is browser-tested.
  const bytes=png.slice(),view=new DataView(bytes.buffer);view.setUint32(16,5000);view.setUint32(20,4000);
  const items=Array.from({length:5},(_,i)=>source(`large-${i}`,'component',{}));
  await assert.rejects(createProjectBackup(items,{},async()=>new Blob([bytes])),/96 megapixels/);
});
await test('Import is a single metadata commit, preserves existing base, and keeps both crop sets',async()=>{
  const r=rig([source('existing','spine',{})]);
  const result=await r.store.addMany([{item:source('a','spine',{}),blob:new Blob([png])},{item:source('b','spine',{}),blob:new Blob([png])}]);
  assert.equal(result.count,2);assert.equal(r.writes(),1);assert.deepEqual(r.meta().map(it=>it.role),['spine','component','component']);assert.equal(r.crops.size,3);
});
await test('A failed import rolls back only new crops, with no partial metadata',async()=>{
  for(const options of [{failSave:true},{failCrop:'b'}]){
    const r=rig([source('existing','spine',{})],options),res=await r.store.addMany(['a','b'].map(id=>({item:source(id,'component',{}),blob:new Blob([png])})));
    assert.equal(res.ok,false);assert.deepEqual([...r.crops.keys()],['existing']);assert.deepEqual(r.meta().map(it=>it.id),['existing']);
  }
});
await test('Import commits survive notification failure and duplicate IDs never overwrite images',async()=>{
  const r=rig([source('existing','spine',{})],{failNotify:true});const res=await r.store.addMany([{item:source('a','component',{}),blob:new Blob([png])}]);
  assert.equal(res.committed,true);assert.equal(res.notifyError,'Render failed');assert.equal(r.crops.size,2);
  const clash=await r.store.addMany([{item:source('existing','component',{}),blob:new Blob([new Uint8Array([1])])}]);assert.equal(clash.ok,false);assert.equal(r.writes(),1);
});
await test('Concurrent import and normal capture share one mutation authority',async()=>{
  const r=rig(),second=r.second();
  await Promise.all([r.store.addMany([{item:source('import','spine',{}),blob:new Blob([png])}]),second.add({item:source('capture','component',{}),blob:new Blob([png])})]);
  assert.deepEqual(r.meta().map(it=>it.id).sort(),['capture','import']);assert.equal(r.crops.size,2);
});
await test('Bundle includes all implementation files and matches captured image bytes',async()=>{
  const c=compile([source('s','component',{'font-size':'32px'})],'b');const bundle=await buildBundle(c,async()=>png);fs.writeFileSync('/tmp/design-claw-upgrade-kit.zip',bundle.bytes);
  const bytes=bundle.bytes,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),n=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+n+extra;entries.set(new TextDecoder().decode(bytes.slice(offset+30,offset+30+n)),bytes.slice(start,start+size));offset=start+size;}
  for(const name of ['BOARD.html','tokens.css','reference-styles.css','KIT-README.md','DESIGN.md','PROMPT.txt','resolved-spec.json'])assert.ok(entries.has(name),name);
  assert.deepEqual(entries.get('references/REF-01.png'),png);
});
console.log(`${passed} upgrade checks passed`);
