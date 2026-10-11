// Self-contained so chrome.scripting.executeScript can serialize this function.
// Only visible top-frame elements are sampled; no page text or input values.
export function scanVisiblePage() {
  if(window.__dc_picker__)throw new Error('Finish or cancel the current capture before scanning.');
  const props=['color','background-color','font-family','font-size','font-weight','line-height','padding-top','padding-left','gap','border-radius'];
  const buckets={colors:new Map(),typography:new Map(),spacing:new Map(),shape:new Map()};
  const pathFor=el=>{
    const parts=[];let n=el;
    while(n&&n.nodeType===1&&parts.length<24){
      const tag=n.tagName.toLowerCase();
      let index=1;for(let p=n.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===n.tagName)index++;
      parts.unshift(`${tag}:nth-of-type(${index})`);n=n.parentElement;
    }
    return n?null:parts.join(' > ');
  };
  const add=(group,key,value,el,computed)=>{
    if(!value)return;
    const map=buckets[group],id=key+'\0'+value;
    if(map.has(id)){map.get(id).count++;return;}
    if(map.size>=80)return;
    map.set(id,{property:key,value,count:1,selector:pathFor(el),tag:el.tagName.toLowerCase(),computed});
  };
  const tree=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_ELEMENT);
  const start=performance.now();let examined=0,sampled=0,node=tree.currentNode;
  while(node&&examined<3000&&sampled<500&&performance.now()-start<250){
    examined++;
    if(!node.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],script,style,iframe')){
      const r=node.getBoundingClientRect();
      if(r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth){
        const cs=getComputedStyle(node);
        if(cs.visibility==='visible'&&cs.display!=='none'&&Number(cs.opacity)>0){
          sampled++;const computed=Object.fromEntries(props.map(p=>[p,cs.getPropertyValue(p).trim()]));
          add('colors','color',computed.color,node,computed);
          if(computed['background-color']!=='rgba(0, 0, 0, 0)'&&computed['background-color']!=='transparent')add('colors','background-color',computed['background-color'],node,computed);
          add('typography','font',`${computed['font-family']} · ${computed['font-size']} · ${computed['font-weight']}`,node,computed);
          for(const p of ['padding-top','padding-left','gap'])if(computed[p]&&computed[p]!=='0px'&&computed[p]!=='normal')add('spacing',p,computed[p],node,computed);
          if(computed['border-radius']!=='0px')add('shape','border-radius',computed['border-radius'],node,computed);
        }
      }
    }
    node=tree.nextNode();
  }
  const url=new URL(location.href);
  return {version:1,url:url.origin+url.pathname,createdAt:Date.now(),viewport:{w:innerWidth,h:innerHeight},scope:'Visible top-frame DOM only; counts reflect sampled elements, not brand importance. Inputs and page text are excluded.',sampled,examined,bounded:!!node,groups:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,[...v.values()].sort((a,b)=>b.count-a.count).slice(0,12)]))};
}
