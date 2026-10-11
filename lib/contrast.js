// Advisory text contrast for an opaque, flat foreground/background pair only.
// Unsupported color spaces, compositing, gradients and images remain unknown.
export function parseColor(input) {
  if(typeof input!=='string')return null;
  const s=input.trim().toLowerCase();
  if(s==='transparent')return [0,0,0,0];
  if(/^#[0-9a-f]{3,8}$/.test(s)){
    let h=s.slice(1);if(h.length===3||h.length===4)h=[...h].map(c=>c+c).join('');
    if(h.length!==6&&h.length!==8)return null;
    return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),h.length===8?parseInt(h.slice(6,8),16)/255:1];
  }
  const m=s.match(/^rgba?\(([^)]+)\)$/);if(!m)return null;
  const p=m[1].replace(/\//g,' ').split(/[\s,]+/).filter(Boolean);if(p.length!==3&&p.length!==4)return null;
  if(p.some(v=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(v)))return null;
  const nums=p.slice(0,3).map(v=>v.endsWith('%')?parseFloat(v)*2.55:Number(v));
  const alpha=p[3]==null?1:p[3].endsWith('%')?parseFloat(p[3])/100:Number(p[3]);
  if(nums.some(v=>!Number.isFinite(v)||v<0||v>255)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
  return [...nums,alpha];
}
export function contrastRatio(a,b) {
  const luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function contrastCheck(tokens) {
  const c=tokens?.computed, context=tokens?.contrastContext;
  if(!c)return {status:'unknown',reason:'No measured CSS.'};
  if(!context)return {status:'unknown',reason:'This older capture has no background evidence. Pick the element again.'};
  if(context.uncertain)return {status:'unknown',reason:context.reason || 'Background or compositing cannot be verified.'};
  const fg=parseColor(c.color),bg=parseColor(context.background);
  if(!fg||!bg||fg[3]!==1||bg[3]!==1)return {status:'unknown',reason:'Contrast needs supported opaque foreground and background colors.'};
  const size=/^\d+(?:\.\d+)?px$/.test(c['font-size']||'')?parseFloat(c['font-size']):null;
  const weight=c['font-weight']==='bold'?700:Number(c['font-weight']);
  if(size==null||!Number.isFinite(weight))return {status:'unknown',reason:'Text size or weight was not measured.'};
  const large=size>=24||(size>=18.6666667&&weight>=700),threshold=large?3:4.5,ratio=contrastRatio(fg,bg);
  return {status:ratio>=threshold?'pass':'fail',ratio,threshold,large,foreground:c.color,background:context.background,reason:'Flat-color text check only; not a full accessibility audit.'};
}
