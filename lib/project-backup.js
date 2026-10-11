// Portable, bounded project backup. It contains images + capture measurements,
// never provider configuration, keys, cached AI output or browsing history.
import { sanitizeUrl } from './compiler.js';
import { normalizeGuidance } from './design-guidance.js';
const FORMAT='design-claw-project', VERSION=1, MAX_REFS=100, MAX_BYTES=64*1024*1024, MAX_PIXELS=96e6;
const roles=new Set(['spine','component','type','palette','shape']);
const str=(v,max=8192)=>typeof v==='string'?v.slice(0,max):'';
const fields=['id','role','note','order','w','h','bytes','createdAt','clipped','mode','tiles'];
function cleanItem(item) {
  const url=new URL(item.sourceUrl);
  if(!['https:','http:'].includes(url.protocol))throw new Error('Backup references must come from http or https websites.');
  const out=Object.fromEntries(fields.filter(k=>item[k]!=null).map(k=>[k,item[k]]));
  out.id=str(item.id,200);out.sourceUrl=sanitizeUrl(item.sourceUrl);out.role=roles.has(item.role)?item.role:'component';out.note=str(item.note,10000);
  out.name=str(item.name,160);out.borrow=str(item.borrow,2000);out.avoid=str(item.avoid,2000);
  for(const k of ['order','w','h','bytes','createdAt','tiles'])out[k]=Number.isFinite(item[k])&&item[k]>=0?item[k]:0;
  out.clipped=!!item.clipped;out.mode=item.mode==='area'?'area':'element';
  const tokens=item.tokens;
  if(tokens&&typeof tokens==='object') {
    const objectStrings=obj=>Object.fromEntries(Object.entries(obj||{}).slice(0,200).filter(([k,v])=>k.length<200&&typeof v==='string').map(([k,v])=>[k,str(v)]));
    out.tokens={computed:objectStrings(tokens.computed),rootVars:objectStrings(tokens.rootVars),rootVarsPath:str(tokens.rootVarsPath,100),keyframes:str(tokens.keyframes,50000),motion:objectStrings(tokens.motion),states:{}};
    for(const state of ['hover','focus'])if(tokens.states?.[state])out.tokens.states[state]=objectStrings(tokens.states[state]);
    if(tokens.fonts)out.tokens.fonts={stack:str(tokens.fonts.stack),families:Array.isArray(tokens.fonts.families)?tokens.fonts.families.slice(0,50).map(v=>str(v,300)):[],availabilityCandidate:str(tokens.fonts.availabilityCandidate||tokens.fonts.firstAvailable,300)||null,method:str(tokens.fonts.method,100),verified:false,uncertain:true};
    if(tokens.contrastContext)out.tokens.contrastContext={background:str(tokens.contrastContext.background,300)||null,uncertain:!!tokens.contrastContext.uncertain,reason:str(tokens.contrastContext.reason,500)||null};
  } else out.tokens=null;
  const m=item.measurement||{};out.measurement={status:['measured','image-only','failed'].includes(m.status)?m.status:out.tokens?'measured':'image-only',method:str(m.method,100),reason:str(m.reason,1000)||null};
  return out;
}
function pngSize(bytes) {
  const sig=[137,80,78,71,13,10,26,10];
  if(bytes.length<33||sig.some((v,i)=>bytes[i]!==v)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new Error('Backup contains an invalid PNG image.');
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=d.getUint32(16),h=d.getUint32(20);
  if(!w||!h||w>16384||h>16384||w*h>24e6)throw new Error('Backup image exceeds the capture size limit.');
  return {w,h};
}
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
export async function createProjectBackup(items,inputs,getCrop) {
  if(!items.length)throw new Error('Capture a reference before making a backup.');
  if(items.length>MAX_REFS)throw new Error('A backup supports at most 100 references.');
  let size=0,pixels=0;const references=[];
  for(const item of items){
    const blob=await getCrop(item.id);if(!blob)throw new Error(`Image missing for ${item.id}; no incomplete backup was created.`);
    const bytes=new Uint8Array(await blob.arrayBuffer());size+=bytes.length;
    if(size>MAX_BYTES)throw new Error('Backup images exceed 64 MiB. Export a smaller collection.');
    const dimensions=pngSize(bytes);
    pixels+=dimensions.w*dimensions.h;if(pixels>MAX_PIXELS)throw new Error('Backup exceeds 96 megapixels of images. Use a smaller collection.');
    references.push({item:{...cleanItem(item),...dimensions,bytes:bytes.length},png:base64(bytes),sha256:await digest(bytes)});
  }
  return JSON.stringify({format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),inputs:{brief:str(inputs.brief,20000),persona:str(inputs.persona,20000),perRunNote:str(inputs.perRunNote,10000),guidance:normalizeGuidance(inputs.guidance)},references},null,2);
}
export async function parseProjectBackup(text, newId=()=>`import-${crypto.randomUUID()}`) {
  if(typeof text!=='string'||text.length>96*1024*1024)throw new Error('Backup must be a JSON file under 96 MiB.');
  let data;try{data=JSON.parse(text);}catch{throw new Error('That file is not valid JSON.');}
  if(data?.format!==FORMAT||data?.version!==VERSION)throw new Error('Choose a Design Claw project backup (.json), not a handoff ZIP or resolved spec.');
  if(!Array.isArray(data.references)||!data.references.length||data.references.length>MAX_REFS)throw new Error('Backup must contain 1–100 references.');
  let total=0,pixels=0;const entries=[],ids=new Set();
  for(const ref of data.references){
    if(typeof ref.png!=='string'||ref.png.length>MAX_BYTES*4/3+4||ref.png.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(ref.png))throw new Error('Backup contains invalid image data.');
    const raw=atob(ref.png);total+=raw.length;if(total>MAX_BYTES)throw new Error('Backup images exceed 64 MiB.');
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),dimensions=pngSize(bytes);
    pixels+=dimensions.w*dimensions.h;if(pixels>MAX_PIXELS)throw new Error('Backup exceeds 96 megapixels of images. Use a smaller collection.');
    if(await digest(bytes)!==ref.sha256)throw new Error('Backup image checksum mismatch; no references were imported.');
    if(!ref.item||typeof ref.item!=='object')throw new Error('Backup reference metadata is missing.');
    const item=cleanItem(ref.item);item.id=newId();
    if(!item.id||ids.has(item.id))throw new Error('Could not assign unique imported reference IDs.');ids.add(item.id);
    Object.assign(item,dimensions,{bytes:bytes.length,importedAt:Date.now()});
    entries.push({item,blob:new Blob([bytes],{type:'image/png'})});
  }
  return {entries,inputs:{brief:str(data.inputs?.brief,20000),persona:str(data.inputs?.persona,20000),perRunNote:str(data.inputs?.perRunNote,10000),guidance:normalizeGuidance(data.inputs?.guidance)}};
}
