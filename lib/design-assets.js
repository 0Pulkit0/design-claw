// Portable implementation files from the same canonical spec as the handoff.
// CSS is additive and deliberately scoped; no original HTML/scripts are copied.
export const CSS_PROPS = new Set(['color','background-color','background-image','border-radius','border-top-width','border-top-style','border-top-color','box-shadow','outline-color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-transform','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','gap','display','flex-direction','justify-content','align-items']);
export const htmlEscape = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeCssValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  // Reject declaration/style escapes and external resources. Original values
  // remain intact in JSON; CSS export omits these with an explicit comment.
  if (/[;{}<>\x00-\x1f]/.test(value) || /\/\*|\*\/|\\|(?:url|image-set|image|src|expression)\s*\(|@import/i.test(value)) return null;
  let quote=null,depth=0;
  for(const c of value){
    if(quote){if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'")quote=c;
    else if(c==='(')depth++;
    else if(c===')'&&--depth<0)return null;
  }
  if(quote||depth)return null;
  return value.trim();
}
export function renderTokenCss(resolved) {
  const lines=['/* Design Claw: measured values only. Import this file and use var(--dc-...). */',':root {'];
  for (const [domain,props] of Object.entries(resolved.tokens)) {
    if(domain==='typographyFont')continue;
    for(const [prop,rec] of Object.entries(props)) {
      if(rec.unavailable || rec.value == null)continue;
      const value=safeCssValue(rec.value), name=`--dc-${domain}-${prop}`;
      if(value)lines.push(`  ${name}: ${value}; /* ${rec.provenance?.ref || 'source'}${rec.kind==='fallback'?' fallback':''} */`);
      else lines.push(`  /* ${name}: omitted from CSS; see original value in resolved-spec.json. */`);
    }
  }
  lines.push('}','');return lines.join('\n');
}
export function renderReferenceCss(items, resolved) {
  const lines=['/* Each class describes one captured element, not a reconstructed component. */','/* Apply dc-ref-01, etc. to your own markup; inspect contextual/inherited values. */'];
  for(const ref of resolved.refs) {
    const item=items.find(it=>it.id===ref.sourceId);if(!item?.tokens?.computed)continue;
    lines.push('',`.dc-${ref.id.toLowerCase()} {`);
    for(const [prop,value] of Object.entries(item.tokens.computed)) {
      if(!CSS_PROPS.has(prop))continue;
      const safe=safeCssValue(value);if(safe)lines.push(`  ${prop}: ${safe};`);
    }
    lines.push('}');
  }
  return lines.join('\n')+'\n';
}
export function renderBoard(compiled) {
  const cards=compiled.resolved.refs.map(r=>`<article><div class="meta"><b>${htmlEscape(r.id)}</b><span>${htmlEscape(r.role)}</span></div><a href="${htmlEscape(r.imageFile)}"><img src="${htmlEscape(r.imageFile)}" alt="${htmlEscape(r.id+' captured reference')}" loading="lazy"></a><h2>${htmlEscape(r.name || r.host)}</h2><p>${htmlEscape(r.note || '')}</p>${r.borrow ? `<p><b>Borrow:</b> ${htmlEscape(r.borrow)}</p>` : ''}${r.avoid ? `<p><b>Avoid:</b> ${htmlEscape(r.avoid)}</p>` : ''}<small>${r.measured?'Computed CSS measured':'Image reference only'}${r.clipped?' · clipped':''}</small>${r.contrast?.ratio!=null?`<p>Text contrast ${r.contrast.ratio.toFixed(2)}:1 · ${r.contrast.status==='pass'?'meets':'below'} ${r.contrast.threshold}:1. Flat-color check only.</p>`:''}<p class="url">${htmlEscape(r.url)}</p></article>`).join('\n');
  const tokenGroups=Object.entries(compiled.resolved.tokens).filter(([domain])=>domain!=='typographyFont').map(([domain,props])=>{
    const rows=Object.entries(props).filter(([,rec])=>!rec.unavailable).map(([prop,rec])=>`<tr><th>${htmlEscape(prop)}</th><td><code>${htmlEscape(rec.value)}</code></td><td>${htmlEscape(rec.provenance?.ref)}</td></tr>`).join('');
    return rows?`<section><h2>${htmlEscape(domain)}</h2><table>${rows}</table></section>`:'';
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>Design Claw reference board</title><style>body{margin:0;padding:32px;background:#f5f6f8;color:#242733;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto}h1{font-size:32px;letter-spacing:-1px}h2{font-size:16px;margin:12px 0 6px}.intro{max-width:720px;white-space:pre-wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:18px}article,section{background:white;border:1px solid #dfe2e9;border-radius:12px;padding:18px;min-width:0}img{width:100%;height:250px;object-fit:contain;object-position:top;background:#eff1f5}.meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px}.url,code{overflow-wrap:anywhere}small,.url{color:#626979}.tokens{margin-top:28px;display:grid;gap:18px}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th,td{border-bottom:1px solid #e8ebf0;padding:8px;vertical-align:top}th{width:30%}a{color:#2f4c8b}footer{margin-top:24px}@media(max-width:480px){body{padding:16px}th,td{padding:5px}}</style></head><body><main><h1>Your design reference board</h1><p class="intro">${htmlEscape(compiled.brief || JSON.parse(compiled.specJson).brief || '')}</p><p>Saved images and measured CSS. Open an image for its full size. Images guide the design; unmeasured values are not inferred.</p><div class="grid">${cards}</div><div class="tokens">${tokenGroups || '<section>No measured global values. The images above remain useful visual references.</section>'}</div><footer>Implementation files: tokens.css · reference-styles.css · resolved-spec.json · DESIGN.md · PROMPT.txt · SYSTEM.md · BUILD-PLAN.md · REVIEW-CHECKLIST.md. No network or scripts required.</footer></main></body></html>`;
}
export const KIT_README = `# Design Claw implementation kit

Open BOARD.html after extracting the whole ZIP to review references offline.
Start with BUILD-PLAN.md, use SYSTEM.md as design guidance, and review the result
with REVIEW-CHECKLIST.md. Those instructions are tailored to the structured brief.
Add tokens.css to your project and use the --dc-* custom properties.
reference-styles.css contains measured declarations for each element, scoped to
.dc-ref-01 etc. They are starting points for your markup, not recreated components.
No original HTML, scripts, remote assets, or inferred values are included.
Values unsafe to embed or requiring external URLs are omitted from CSS, while
resolved-spec.json preserves their original measurement and provenance.
DESIGN.md and PROMPT.txt use the same resolved spec. Attach references/ images
when giving the handoff to a coding assistant. Review font availability and contrast.
`;
