// Real Chromium DOM/screenshot/canvas/IndexedDB integration with a MOCK Chrome API
// bridge. This is intentionally not an MV3 permission or native side-panel test.
// CHROME_BIN=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1000,height:800},acceptDownloads:true});
context.setDefaultTimeout(20000);
const server=createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const full=path.resolve(root,'.'+pathname);
  if(!full.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try {res.setHeader('Content-Type',full.endsWith('.html')?'text/html':full.endsWith('.js')||full.endsWith('.mjs')?'text/javascript':full.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(full));}
  catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const sessionValues={};
const values={},panels=new Set(),errors=[],results=[];
let createdTabUrl;
let target,documentId='D1',snapshotDelay=0;
async function shot(){if(snapshotDelay)await new Promise(r=>setTimeout(r,snapshotDelay));return 'data:image/png;base64,'+(await target.screenshot()).toString('base64');}
await context.exposeBinding('__dcBridge',async({page},arg)=>{
  if(arg.op==='sessionGet')return {[arg.key]:sessionValues[arg.key]};
  if(arg.op==='sessionSet'){Object.assign(sessionValues,arg.value);return;}
  if(arg.op==='sessionRemove'){delete sessionValues[arg.key];return;}
  if(arg.op==='get') {
    if(arg.keys==null)return structuredClone(values);
    const keys=typeof arg.keys==='string'?[arg.keys]:Array.isArray(arg.keys)?arg.keys:Object.keys(arg.keys);
    return Object.fromEntries(keys.map(k=>[k,values[k]??(typeof arg.keys==='object'&&!Array.isArray(arg.keys)?arg.keys[k]:undefined)]));
  }
  if(arg.op==='set') {
    const changes={};for(const [k,v] of Object.entries(arg.value)){changes[k]={oldValue:values[k],newValue:v};values[k]=v;}
    for(const p of panels)if(!p.isClosed())void p.evaluate(c=>{for(const fn of window.__storageListeners)fn(c,'local');},changes).catch(e=>errors.push(e.message));
    return;
  }
  if(arg.op==='createTab'){createdTabUrl=arg.url;return {id:2,url:arg.url};}
  if(arg.op==='query')return [{id:1,windowId:1,url:target.url()}];
  if(arg.op==='execute') {
    let result=null;
    if(arg.source)result=await target.evaluate(({source,args})=>(0,eval)('('+source+')')(...args),{source:arg.source,args:arg.args||[]});
    for(const file of arg.files||[])await target.evaluate(source=>(0,eval)(source),fs.readFileSync(path.join(root,file),'utf8'));
    return [{frameId:0,documentId,result}];
  }
  if(arg.op==='pageMessage')return target.evaluate(message=>new Promise((resolve,reject)=>{
    let replied=false,async=false;
    const respond=value=>{replied=true;resolve(value);};
    for(const fn of window.__runtimeListeners)if(fn(message,{},respond)===true)async=true;
    if(!replied&&!async)reject(Error('Message channel closed without a response'));
    if(async&&!replied)setTimeout(()=>reject(Error('Message response timed out')),5000);
  }),arg.message);
  if(arg.op==='runtime') {
    if(arg.message.type==='CAPTURE_VISIBLE_TAB')return {ok:true,dataUrl:await shot()};
    if(page===target){
      for(const p of panels)if(!p.isClosed())await p.evaluate(({msg,sender})=>{for(const fn of window.__runtimeListeners)fn(msg,sender,()=>{});},{msg:arg.message,sender:{tab:{id:1,windowId:1,url:target.url()},frameId:0,documentId}});
    }
    return {};
  }
  if(arg.op==='capture')return shot();
  if(arg.op==='options')return;
  throw Error('Unknown bridge operation '+arg.op);
});
await context.addInitScript(()=>{
  window.__runtimeListeners=[];window.__storageListeners=[];
  const runtime={getURL: file=>new URL(file,location.href).href,onMessage:{addListener:f=>window.__runtimeListeners.push(f),removeListener:f=>{window.__runtimeListeners=window.__runtimeListeners.filter(x=>x!==f);}},sendMessage:message=>window.__dcBridge({op:'runtime',message}),openOptionsPage:()=>window.__dcBridge({op:'options'})};
  window.chrome={runtime,storage:{session:{get:key=>window.__dcBridge({op:'sessionGet',key}),set:value=>window.__dcBridge({op:'sessionSet',value}),remove:key=>window.__dcBridge({op:'sessionRemove',key})},local:{get:keys=>window.__dcBridge({op:'get',keys}),set:value=>window.__dcBridge({op:'set',value})},onChanged:{addListener:f=>window.__storageListeners.push(f)}},tabs:{create:spec=>window.__dcBridge({op:'createTab',url:spec.url}),query:()=>window.__dcBridge({op:'query'}),sendMessage:(id,message)=>window.__dcBridge({op:'pageMessage',message}),captureVisibleTab:()=>window.__dcBridge({op:'capture'})},scripting:{executeScript:spec=>window.__dcBridge({op:'execute',source:spec.func?.toString(),args:spec.args,files:spec.files})},permissions:{contains:async()=>true,request:async()=>true}};
});
async function openPanel(width=400){const p=await context.newPage();panels.add(p);await p.setViewportSize({width,height:800});p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/sidepanel.html');await p.waitForFunction(()=>document.getElementById('chip-label').textContent!=='checking…');return p;}
async function check(name,fn){await fn();results.push(name);console.log('PASS',name);}
let panel;
try {
  target=await context.newPage();target.on('pageerror',e=>errors.push(e.message));await target.goto(base+'/tests/capture-page.html');
  panel=await openPanel();
  await check('Visible page scan returns measured inventory, excludes form values, and highlights a sample',async()=>{
    await target.evaluate(()=>{const input=document.createElement('input');input.id='private-input';input.value='PRIVATE_INPUT_SENTINEL';document.body.prepend(input);});
    await panel.locator('#scan-page').click();await panel.waitForFunction(()=>!document.getElementById('scan-report').hidden);
    assert.ok(await panel.locator('.scan-row').count()>2);
    const waiting=panel.waitForEvent('download');await panel.locator('#scan-download').click();const download=await waiting;
    const report=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.ok(report.sampled>0);assert.ok(report.groups.typography.length>0);
    assert.ok(!JSON.stringify(report).includes('PRIVATE_INPUT_SENTINEL'));
    await panel.locator('.scan-row button').first().click();await target.waitForFunction(()=>!!window.__dc_picker__);
    assert.ok(await target.evaluate(()=>[...document.querySelectorAll('div')].some(el=>el.textContent.includes('Sample highlighted · click it'))));
    await target.keyboard.press('Escape');await target.waitForFunction(()=>!window.__dc_picker__);
    await target.evaluate(()=>document.getElementById('private-input').remove());
    await panel.locator('#scan-report').evaluate(el=>{el.open=false;});
  });
  await check('Live panel renders at 320/400/480px without horizontal overflow',async()=>{
    for(const width of [320,400,480]){await panel.setViewportSize({width,height:800});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await panel.locator('#compile').isVisible(),true);}
  });
  await check('Element capture saves real PNG bytes and measured styles',async()=>{
    await target.bringToFront();await panel.locator('#pick').click();
    await target.waitForFunction(()=>!!window.__dc_picker__);await target.mouse.move(160,140);await target.mouse.click(160,140);
    await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===1);
    assert.equal(values.tray[0].measurement.status,'measured');assert.ok(values.tray[0].bytes>0);
  });
  await check('Actual extracted element CSS reaches the compiled Tokens view',async()=>{
    const computed=values.tray[0].tokens.computed;
    assert.ok(computed['font-size']);assert.ok(computed.color);
    await panel.locator('#brief').fill('A measured reference');await panel.locator('#compile').click();
    await panel.locator('#tab-tokens').click();
    assert.equal(await panel.locator('.tok-intro h4').textContent(),'Measured CSS');
    const sizeRow=panel.locator('.tok-row').filter({has:panel.locator('.tok-k',{hasText:/^Size$/})});
    assert.equal(await sizeRow.locator('.tok-v').textContent(),computed['font-size']);
    assert.equal(await panel.locator('.tok-v.none').count(),0);
  });
  await check('Captured background evidence gives a transparent-aware text contrast check',async()=>{
    assert.ok(values.tray[0].tokens.contrastContext.background);
    await panel.locator('.thumb-btn').first().click();await panel.waitForFunction(()=>document.getElementById('inspector').open);
    assert.match(await panel.locator('.contrast-result').textContent(),/Text contrast: .*:1/);
    await panel.keyboard.press('Escape');
  });
  await check('Area edge hold scrolls after 2 seconds and persists one multi-tile PNG',async()=>{
    await target.evaluate(()=>window.scrollTo(0,0));await panel.locator('#pick-region').click();await target.waitForFunction(()=>window.__dc_picker__?.mode==='area');
    await target.mouse.move(80,90);await target.mouse.down();await target.mouse.move(650,790);await target.waitForTimeout(2600);
    assert.ok(await target.evaluate(()=>scrollY)>200,'edge hold should scroll');
    await target.mouse.up();await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===2,{},{timeout:15000});
    assert.ok(values.tray[1].tiles>=2);assert.ok(values.tray[1].h>800);assert.equal(values.tray[1].measurement.status,'image-only');
    await target.waitForFunction(()=>!window.__dc_picker__);
    assert.equal(await target.evaluate(()=>document.getElementById('fixed-header').getAttribute('style')||null),null);
    assert.equal(await target.evaluate(()=>!!window.__dc_picker__),false);
  });
  await check('Native dialog opens stored tall crop and closes with Escape',async()=>{
    await panel.locator('.thumb-btn').nth(1).click();await panel.waitForFunction(()=>document.getElementById('inspector').open);
    assert.equal(await panel.locator('.insp-crop').evaluate(img=>img.naturalHeight>800),true);
    assert.match(await panel.locator('.insp-full').getAttribute('href'),/^blob:/);
    await panel.keyboard.press('Escape');await panel.waitForFunction(()=>!document.getElementById('inspector').open);
  });
  await check('Reopening the panel retains both metadata and IndexedDB image blobs',async()=>{
    await panel.close();panel=await openPanel(320);await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===2);
    assert.equal(await panel.locator('.thumb').nth(1).evaluate(img=>img.complete&&img.naturalHeight>800),true);
  });
  await check('Area-only compilation explains missing CSS without an unavailable-row wall',async()=>{
    const saved=structuredClone(values.tray);
    await panel.evaluate(item=>chrome.storage.local.set({tray:[{...item,role:'component',order:0}]}),saved[1]);
    await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===1);
    await panel.locator('#brief').fill('Visual area reference');await panel.locator('#compile').click();await panel.locator('#tab-tokens').click();
    assert.match(await panel.locator('.tok-intro').textContent(),/Capture area saves a screenshot/);
    assert.equal(await panel.locator('.tok-row').count(),0);assert.equal(await panel.locator('.tok-actions button').textContent(),'Pick element to measure CSS');
    assert.equal(await panel.locator('.tok-missing').getAttribute('open'),null);
    for(const width of [320,400,480]){await panel.setViewportSize({width,height:800});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await panel.evaluate(tray=>chrome.storage.local.set({tray}),saved);
    await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===2);
  });
  await check('An image base with measured pattern offers a persisted base-role repair',async()=>{
    await panel.locator('.role-row select').nth(1).selectOption('spine');
    await panel.waitForFunction(()=>!document.getElementById('compile').disabled);
    await panel.locator('#compile').click();await panel.locator('#tab-tokens').click();
    assert.equal(await panel.locator('.tok-intro h4').textContent(),'Measured styles need a contributing role');
    await panel.locator('.tok-actions button').click();
    await panel.waitForFunction(()=>document.querySelector('.role-row select').value==='spine'&&!document.getElementById('compile').disabled);
    assert.equal(values.tray[0].role,'spine');assert.equal(values.tray[1].role,'component');
    assert.equal(await panel.locator('#stale').isVisible(),true);
    await panel.locator('#compile').click();
    assert.equal(await panel.locator('.tok-intro h4').textContent(),'Measured CSS');
    assert.ok(await panel.locator('.tok-row').count()>20);
  });
  await check('Pending role edit then compilation produce matching output and keyboard tabs',async()=>{
    await panel.locator('.role-row select').first().selectOption('spine');await panel.waitForFunction(()=>!document.getElementById('compile').disabled);
    await panel.locator('#brief').fill('An editorial product page');await panel.locator('#compile').click();await panel.waitForFunction(()=>!document.getElementById('out').hidden);
    await panel.locator('#tab-design').focus();await panel.keyboard.press('ArrowRight');assert.equal(await panel.locator('#tab-prompt').getAttribute('aria-selected'),'true');
    assert.match(await panel.locator('#download').textContent(),/prompt/i);
    const d=panel.waitForEvent('download');await panel.locator('#download').click();assert.equal((await d).suggestedFilename(),'PROMPT.txt');
  });
  await check('Download CSS matches canonical measured element values',async()=>{
    const waiting=panel.waitForEvent('download');await panel.locator('#download-css').click();const download=await waiting;
    assert.equal(download.suggestedFilename(),'tokens.css');const css=fs.readFileSync(await download.path(),'utf8');
    assert.ok(css.includes(`--dc-typography-font-size: ${values.tray[0].tokens.computed['font-size']};`));
    assert.ok(!css.includes('unavailable'));
  });
  await check('Reference search filters the view without changing captured data or roles',async()=>{
    const snapshot=JSON.stringify(values.tray);await panel.locator('#reference-search').fill('pattern only');
    assert.equal(await panel.locator('#tray .item:visible').count(),1);
    await panel.locator('#reference-search').fill('no-such-reference');assert.equal(await panel.locator('#search-empty').isVisible(),true);
    await panel.locator('#reference-search').fill('');assert.equal(await panel.locator('#tray .item:visible').count(),2);assert.equal(JSON.stringify(values.tray),snapshot);
  });
  await check('ZIP export downloads actual saved references',async()=>{
    const waiting=panel.waitForEvent('download');await panel.locator('#export').click();const download=await waiting;
    const file=path.join(os.tmpdir(),'design-claw-browser-bundle.zip');await download.saveAs(file);assert.ok(fs.statSync(file).size>5000);
    const zip=fs.readFileSync(file), entries=new Map();let offset=0;
    while(offset+30<zip.length&&zip.readUInt32LE(offset)===0x04034b50){
      assert.equal(zip.readUInt16LE(offset+8),0,'bundle entries use stored ZIP encoding');
      const size=zip.readUInt32LE(offset+18),n=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+n+extra;
      entries.set(zip.subarray(offset+30,offset+30+n).toString('utf8'),zip.subarray(start,start+size));offset=start+size;
    }
    for(const [index,item] of values.tray.entries()){
      const bytes=Buffer.from(await panel.evaluate(async id=>{const {getCrop}=await import('./lib/db.js');return [...new Uint8Array(await(await getCrop(id)).arrayBuffer())];},item.id));
      assert.ok(bytes.equals(entries.get(`references/REF-${String(index+1).padStart(2,'0')}.png`)),'exported PNG must equal its stored blob');
    }
    for(const name of ['BOARD.html','tokens.css','reference-styles.css','KIT-README.md','SYSTEM.md','BUILD-PLAN.md','REVIEW-CHECKLIST.md'])assert.ok(entries.has(name),name);
    const boardDir=fs.mkdtempSync(path.join(os.tmpdir(),'design-claw-board-'));
    for(const [name,bytes] of entries){const dest=path.join(boardDir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
    const board=await context.newPage();const requests=[];board.on('request',req=>requests.push(req.url()));
    await board.goto(pathToFileURL(path.join(boardDir,'BOARD.html')).href);await board.locator('img').first().waitFor();
    assert.equal(await board.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true);
    for(const width of [320,900]){await board.setViewportSize({width,height:800});assert.equal(await board.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    assert.ok(requests.every(url=>url.startsWith('file:')),'offline board must make no network requests');
    if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await board.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'board.png')});}
    await board.close();fs.rmSync(boardDir,{recursive:true,force:true});

    console.log('BUNDLE',file);
  });
  await check('Compiled output and token rows stay within 320/400/480px',async()=>{
    for(const width of [320,400,480]){
      await panel.setViewportSize({width,height:800});await panel.locator('#tab-tokens').click();
      assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const bad=await panel.locator('.tok-row').evaluateAll(rows=>rows.filter(row=>row.scrollWidth>row.clientWidth+1).length);assert.equal(bad,0);
      await panel.locator('#tab-design').click();
      if(process.env.UI_SCREENSHOT_DIR){fs.mkdirSync(process.env.UI_SCREENSHOT_DIR,{recursive:true});await panel.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await panel.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,`panel-${width}.png`)});}
    }
  });
  await check('Editing brief marks handoff stale and prevents stale CSS download',async()=>{
    await panel.locator('#brief').fill('Changed brief');assert.equal(await panel.locator('#stale').isVisible(),true);
    let downloads=0;const onDownload=()=>downloads++;panel.on('download',onDownload);await panel.locator('#download-css').click();
    assert.match(await panel.locator('#toast').textContent(),/Recompile/);assert.equal(downloads,0);panel.off('download',onDownload);
  });
  await check('Escape during a pending screenshot saves no reference and restores page styles',async()=>{
    const count=values.tray.length;snapshotDelay=700;await target.evaluate(()=>scrollTo(0,0));await panel.locator('#pick-region').click();await target.waitForFunction(()=>window.__dc_picker__?.mode==='area');
    await target.mouse.move(80,100);await target.mouse.down();await target.mouse.move(650,600);await target.mouse.up();
    await panel.waitForFunction(()=>!document.getElementById('cap-progress').hidden);await target.keyboard.press('Escape');
    await panel.waitForFunction(()=>document.getElementById('cap-progress').hidden);assert.equal(values.tray.length,count);snapshotDelay=0;
    await target.waitForFunction(()=>!window.__dc_picker__);
    assert.equal(await target.evaluate(()=>document.getElementById('fixed-header').getAttribute('style')||null),null);
  });
  await check('Two browser panels converge after a shared tray change',async()=>{
    const other=await openPanel(480);await other.waitForFunction(()=>document.querySelectorAll('#tray .item').length===2);
    await panel.locator('.role-row select').nth(1).selectOption('palette');await other.waitForFunction(()=>document.querySelectorAll('.role-row select')[1].value==='palette');await other.close();
  });
  await check('Reference names and borrow/avoid notes persist and enter the actual compile',async()=>{
    await panel.locator('.thumb-btn').first().click();await panel.waitForFunction(()=>document.getElementById('inspector').open);
    await panel.getByRole('textbox',{name:'Name',exact:true}).fill('Workspace rhythm');await panel.getByRole('textbox',{name:'Name',exact:true}).press('Tab');
    await panel.waitForFunction(()=>document.querySelector('#insp-body input[aria-label=Name]').value==='Workspace rhythm');
    await panel.getByRole('textbox',{name:'Borrow',exact:true}).fill('Clear groups and quiet navigation');await panel.getByRole('textbox',{name:'Borrow',exact:true}).press('Tab');
    await panel.waitForTimeout(100);await panel.getByRole('textbox',{name:'Avoid',exact:true}).fill('Promotional banners');await panel.getByRole('textbox',{name:'Avoid',exact:true}).press('Tab');
    await panel.waitForTimeout(100);await panel.keyboard.press('Escape');
    assert.equal(values.tray[0].name,'Workspace rhythm');assert.equal(values.tray[0].borrow,'Clear groups and quiet navigation');assert.equal(values.tray[0].avoid,'Promotional banners');
    await panel.locator('#compile').click();await panel.locator('#tab-prompt').click();assert.match(await panel.locator('#output').textContent(),/Clear groups and quiet navigation/);
  });
  await check('Captured images download directly before a fresh compile, byte-identical to IndexedDB',async()=>{
    await panel.locator('.thumb-btn').nth(1).click();await panel.waitForFunction(()=>document.getElementById('inspector').open);
    const waiting=panel.waitForEvent('download');await panel.getByRole('link',{name:'Download captured image'}).click();const download=await waiting;
    const stored=Buffer.from(await panel.evaluate(async id=>{const {getCrop}=await import('./lib/db.js');return [...new Uint8Array(await(await getCrop(id)).arrayBuffer())];},values.tray[1].id));
    assert.ok(fs.readFileSync(await download.path()).equals(stored));await panel.keyboard.press('Escape');
  });
  await check('Structured design fields invalidate stale output and tailor the actual prompt and build plan',async()=>{
    await panel.locator('#product-type').selectOption('app');await panel.locator('#primary-action').fill('Create a workspace');
    await panel.locator('#design-controls').evaluate(el=>{el.open=true;});await panel.locator('#audience').fill('Independent designers');
    await panel.locator('#must-include').fill('Search, saved projects and an empty state');await panel.locator('#design-avoid').fill('No invented testimonials');await panel.locator('#target-stack').fill('Plain HTML and CSS');
    assert.equal(await panel.locator('#stale').isVisible(),true);await panel.locator('#compile').click();await panel.locator('#tab-prompt').click();
    const prompt=await panel.locator('#output').textContent();assert.match(prompt,/operational workspace/);assert.match(prompt,/Independent designers/);assert.match(prompt,/No invented testimonials/);
    const waiting=panel.waitForEvent('download');await panel.locator('#download-plan').click();const download=await waiting;assert.match(fs.readFileSync(await download.path(),'utf8'),/Create a workspace/);
    await panel.locator('#presets-box').evaluate(el=>{el.open=true;});await panel.locator('#preset-name').fill('Workspace setup');await panel.locator('#preset-save').click();
    await panel.waitForFunction(()=>[...document.querySelectorAll('#preset-select option')].some(el=>el.value==='Workspace setup'));
    await panel.locator('#product-type').selectOption('website');await panel.locator('#primary-action').fill('Other');await panel.locator('#preset-select').selectOption('Workspace setup');await panel.locator('#preset-apply').click();await panel.waitForFunction(()=>document.getElementById('product-type').value==='app');
    assert.equal(await panel.locator('#product-type').inputValue(),'app');assert.equal(await panel.locator('#primary-action').inputValue(),'Create a workspace');
    await panel.locator('#presets-box').evaluate(el=>{el.open=false;});await panel.locator('#design-controls').evaluate(el=>{el.open=false;});
  });
  await check('Project backup and import preserve real PNGs, measured CSS, and the existing base',async()=>{
    const before=structuredClone(values.tray),count=before.length;
    await panel.locator('#project-tools').evaluate(el=>{el.open=true;});
    const waiting=panel.waitForEvent('download');await panel.locator('#backup-project').click();const download=await waiting;
    const backupFile=await download.path(),backup=JSON.parse(fs.readFileSync(backupFile,'utf8'));
    assert.equal(backup.format,'design-claw-project');assert.equal(backup.references.length,count);
    assert.ok(backup.references[0].item.tokens.computed['font-size']);
    await panel.locator('#project-file').setInputFiles(backupFile);
    await panel.waitForFunction(n=>document.querySelectorAll('#tray .item').length===n,count*2);
    const after=values.tray;assert.equal(after.filter(it=>it.role==='spine').length,1);
    assert.equal(after[0].id,before[0].id);assert.notEqual(after[count].id,before[0].id);
    assert.equal(after[count].tokens.computed['font-size'],before[0].tokens.computed['font-size']);
    assert.equal(await panel.locator('.thumb').nth(count).evaluate(img=>img.complete&&img.naturalWidth>0),true);
    const bad=structuredClone(backup);bad.references[0].sha256='invalid';
    await panel.locator('#project-file').setInputFiles({name:'corrupt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});
    await panel.waitForFunction(()=>document.getElementById('toast').textContent.includes('checksum'));
    assert.equal(values.tray.length,count*2);
    // A valid header + checksum is still insufficient: the actual decoder must
    // reject a truncated PNG before any metadata is written.
    const truncated=structuredClone(backup),raw=Buffer.from(truncated.references[0].png,'base64').subarray(0,33);
    truncated.references[0].png=raw.toString('base64');truncated.references[0].sha256=createHash('sha256').update(raw).digest('hex');
    await panel.locator('#project-file').setInputFiles({name:'truncated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(truncated))});
    await panel.waitForFunction(()=>document.getElementById('toast').textContent.includes('decoded'));
    assert.equal(values.tray.length,count*2);
    // Real panel reopening also retrieves imported image blobs.
    await panel.close();panel=await openPanel(320);await panel.waitForFunction(n=>document.querySelectorAll('#tray .item').length===n,count*2);
    assert.equal(await panel.locator('.thumb').nth(count).evaluate(img=>img.complete&&img.naturalWidth>0),true);
  });
  await check('Saved collections keep independent PNG snapshots after live deletion and restore them on reopen',async()=>{
    await panel.locator('#brief').fill('A reusable product workspace');await panel.locator('#product-type').selectOption('app');await panel.locator('#primary-action').fill('Create a workspace');
    await panel.locator('#collections-box').evaluate(el=>{el.open=true;});await panel.locator('#collection-name').fill('Reusable inspiration');
    const original=structuredClone(values.tray),count=original.length;await panel.locator('#collection-save').click();
    await panel.waitForFunction(()=>document.querySelectorAll('.collection-row').length===1);assert.match(await panel.locator('.collection-row').textContent(),/Reusable inspiration/);
    const id=original[0].id;await panel.locator('#tray .item').first().getByRole('button',{name:/^Remove /}).click();
    await panel.waitForFunction(n=>document.querySelectorAll('#tray .item').length===n,count-1);
    assert.equal(await panel.evaluate(async id=>{const {getCrop}=await import('./lib/db.js');return await getCrop(id)===null;},id),true);
    await panel.close();panel=await openPanel(400);await panel.locator('#collections-box').evaluate(el=>{el.open=true;});await panel.waitForFunction(()=>document.querySelectorAll('.collection-row').length===1);
    await panel.locator('.collection-row').getByRole('button',{name:'Add to board'}).click();await panel.waitForFunction(n=>document.querySelectorAll('#tray .item').length===n,count*2-1);
    const added=values.tray.slice(count-1);assert.equal(added[0].name,'Workspace rhythm');assert.equal(added[0].borrow,'Clear groups and quiet navigation');assert.notEqual(added[0].id,id);
    await panel.waitForFunction(()=>document.getElementById('product-type').value==='app');
    assert.equal(await panel.locator('#product-type').inputValue(),'app');assert.equal(await panel.locator('#primary-action').inputValue(),'Create a workspace');
    assert.equal(await panel.locator('.thumb').nth(count-1).evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await panel.locator('#collection-name').fill('Renamed inspiration');await panel.locator('.collection-row').getByRole('button',{name:'Rename',exact:true}).click();await panel.waitForFunction(()=>document.querySelector('.collection-row strong').textContent==='Renamed inspiration');
    const other=await openPanel(480);await other.locator('#collections-box').evaluate(el=>{el.open=true;});await other.waitForFunction(()=>document.querySelector('.collection-row strong').textContent==='Renamed inspiration');await other.close();
    panel.once('dialog',dialog=>dialog.accept());await panel.locator('.collection-row').getByRole('button',{name:'Delete',exact:true}).click();await panel.waitForFunction(()=>!document.querySelector('.collection-row'));
    assert.equal(values.tray.length,count*2-1);await panel.locator('#collections-box').evaluate(el=>{el.open=false;});
  });
  await check('Wide studio opens the shared board, has usable layout, and limits capture to the website panel',async()=>{
    await panel.locator('#open-studio').click();await panel.waitForFunction(()=>!document.getElementById('open-studio').disabled);assert.match(createdTabUrl,/sidepanel\.html\?studio=1&draft=/);
    const studio=await openPanel(1280);await studio.goto(createdTabUrl);await studio.waitForFunction(()=>document.getElementById('chip-label').textContent!=='checking…');
    await studio.waitForFunction(n=>document.querySelectorAll('#tray .item').length===n,values.tray.length);
    assert.equal(await studio.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await studio.locator('#pick').isDisabled(),true);
    assert.match(await studio.locator('#bar-hint').textContent(),/side panel/);await studio.waitForFunction(()=>document.getElementById('primary-action').value==='Create a workspace');assert.equal(await studio.locator('#product-type').inputValue(),'app');assert.equal(Object.keys(sessionValues).length,0);await studio.locator('#brief').fill('A useful application');await studio.locator('#compile').click();await studio.locator('#tab-tokens').click();
    if(process.env.UI_SCREENSHOT_DIR){await studio.evaluate(()=>scrollTo(0,0));await studio.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'studio-1280.png'),fullPage:true});}
    await studio.close();
  });
  await check('Settings fit narrow screens and key visibility toggles',async()=>{
    const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.setViewportSize({width:320,height:800});await settings.goto(base+'/options.html');
    await settings.locator('#key').fill('test-key-not-real');await settings.locator('#toggle').click();assert.equal(await settings.locator('#key').getAttribute('type'),'text');
    await settings.locator('#toggle').click();assert.equal(await settings.locator('#key').getAttribute('type'),'password');
    await settings.evaluate(()=>{const li=document.createElement('li'),b=document.createElement('button');b.textContent='a-very-long-model-name/'.repeat(8);li.appendChild(b);document.getElementById('models').appendChild(li);});
    assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await settings.close();
  });
  if(process.env.UI_SCREENSHOT_DIR){
    const visual=await context.newPage();await visual.goto(base+'/preview/visual-sources.html');
    const definitions=[['source-layout','spine','Workspace structure','Clear navigation and content grouping','The sample numbers'],['source-type','type','Editorial typography','The deliberate headline rhythm','Marketing-only content'],['source-palette','palette','Forest palette','The dark green foundation and fresh accent','Decorative circles']];
    const samples=[];
    for(const [id,role,name,borrow,avoid]of definitions){
      const bytes=await visual.locator('#'+id).screenshot();
      const data=await visual.evaluate(id=>{const el=document.getElementById(id==='source-type'?'type-heading':id),cs=getComputedStyle(el),computed={};for(const key of ['font-family','font-size','font-weight','line-height','letter-spacing','text-transform','font-style','color','background-color','background-image','border-radius','border-top-width','border-top-style','border-top-color','box-shadow','outline-color','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','gap','display','flex-direction','justify-content','align-items'])computed[key]=cs.getPropertyValue(key);return {computed};},id);
      samples.push({item:{id:'visual-'+id,sourceUrl:'https://example.com/'+id,role,name,borrow,avoid,note:'Synthetic visual-review fixture',tokens:data,w:900,h:420,bytes:bytes.length,createdAt:Date.now(),measurement:{status:'measured'},mode:'element',order:samples.length},png:bytes.toString('base64')});
    }
    await panel.evaluate(async samples=>{const {putCrop,setTrayMeta}=await import('./lib/db.js');for(const sample of samples){const raw=atob(sample.png);await putCrop(sample.item.id,new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'image/png'}));}await setTrayMeta(samples.map(sample=>sample.item));},samples);
    await panel.waitForFunction(()=>document.querySelectorAll('#tray .item').length===3);await panel.locator('#brief').fill('A shared reference workspace for independent designers');await panel.locator('#product-type').selectOption('app');await panel.locator('#primary-action').fill('Save and organize inspiration');
    await panel.locator('#compile').click();await panel.locator('#tab-tokens').click();
    await panel.evaluate(()=>document.getElementById('toast').classList.remove('show'));
    for(const width of [320,400,480]){await panel.setViewportSize({width,height:850});await panel.evaluate(()=>scrollTo(0,0));await panel.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,`showcase-${width}.png`)});}
    await panel.locator('#open-studio').click();await panel.waitForFunction(()=>!document.getElementById('open-studio').disabled);const studio=await openPanel(1280);await studio.goto(createdTabUrl);await studio.waitForFunction(()=>document.getElementById('primary-action').value==='Save and organize inspiration');await studio.locator('#compile').click();await studio.locator('#tab-tokens').click();await studio.evaluate(()=>scrollTo(0,0));await studio.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'showcase-studio.png')});
    await studio.close();await visual.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:await browser.version(),mode:'Real renderer and storage; Chrome APIs mocked',passed:results.length,results},null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}
