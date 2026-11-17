// Development-only layout renderer. It draws captured shipping Lua widgets;
// it neither implements nor replaces the addon and is never shipped in the ZIP.
import fs from 'node:fs';
const [input = '.cache/vendetta-ui-scenes.json', output = '.cache/vendetta-ui-preview.html'] = process.argv.slice(2);
const scenes = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const values = o => Object.values(o || {});
const esc = s => String(s || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const plain = s => String(s || '').replace(/\|c[0-9a-f]{8}/gi,'').replaceAll('|r','');
const color = c => { const v = values(c); return v.length ? `rgba(${v.slice(0,3).map(n=>Math.round(n*255)).join(',')},${v[3] ?? 1})` : ''; };
function draw(w) {
  if (w.shown === false || w.isTemplateTitle) return '';
  let cls = 'node ' + w.kind;
  let style = `left:${w.x||0}px;top:${w.y||0}px;`;
  if (w.width) style += `width:${w.width}px;`;
  if (w.height) style += `height:${w.height}px;`;
  if (w.color) style += `background:${color(w.color)};`;
  if (w.textColor) style += `color:${color(w.textColor)};`;
  if (w.font?.includes('Large')) style += 'font-size:16px;';
  if (w.font?.includes('Small')) style += 'font-size:11px;';
  if (w.enabled === false) cls += ' disabled';
  const words = plain(w.text);
  let content = w.kind === 'Button' ? `<span>${esc(words)}</span>` : esc(words);
  if (w.kind === 'CheckButton') content = `<span class="tick">${w.checked ? '✓' : ''}</span>`;
  if (w.kind === 'Slider') content = '<span class="track"></span><span class="thumb"></span>';
  return `<div class="${cls}" style="${style}" data-kind="${w.kind}">${content}${values(w.children).map(draw).join('')}</div>`;
}
fs.writeFileSync(output, `<!doctype html><html><head><meta charset="utf-8"><title>Forever Vendetta — native layout preview</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#14191d;color:#e8e5de;font:12px Arial,sans-serif}
header{width:860px;margin:0 auto 20px;display:flex;align-items:center;justify-content:space-between}
header p{color:#a7afb5;font-size:11px;margin:5px 0}h1{font-size:16px;letter-spacing:.4px;margin:0;color:#eed18a}
nav button{background:#242a30;border:1px solid #4d5156;color:#eed18a;padding:7px 14px;margin-left:6px;cursor:pointer}
.scene{position:relative;margin:0 auto;width:860px;height:590px;background:#171b20;border:1px solid #6b6452;box-shadow:0 14px 50px #0008}
.scene::before{content:'Forever Vendetta';position:absolute;top:0;left:0;right:0;height:25px;text-align:center;padding:5px;background:linear-gradient(#46423b,#252624);border-bottom:1px solid #605b4d;color:#e5c56e;font:13px Georgia,serif}
.node{position:absolute;line-height:1.3;white-space:pre-wrap}.Frame{z-index:1}.Texture{z-index:0;pointer-events:none}.FontString{z-index:2;pointer-events:none}
.Button{z-index:3;text-align:center;display:flex;align-items:center;justify-content:center;cursor:default}
.Button:has(>span:not(:empty)){background:linear-gradient(#42372a,#2d2017 45%,#3b2416);border:1px solid #79664a;box-shadow:inset 0 0 0 1px #181714;color:#eed18a;border-radius:2px}
.Button>span{z-index:2;position:relative;font-size:12px}.disabled{opacity:.4}
.EditBox{z-index:2;padding:5px 8px}.EditBox>.Texture{z-index:-1}.CheckButton{z-index:2}.tick{display:block;border:1px solid #716148;background:#191b1e;width:22px;height:22px;color:#edca6c;text-align:center;font-size:20px;line-height:20px}
.ScrollFrame{overflow:auto;z-index:2}.Slider{z-index:2}.track{display:block;background:#131619;border:1px solid #585650;height:6px;top:6px;width:100%;position:absolute}.thumb{display:block;position:absolute;width:12px;height:18px;background:#bdac86;border:1px solid #e7d9b9;left:10%;top:0}
footer{width:860px;margin:14px auto;color:#959da5;font-size:11px}.hidden{display:none}
</style></head><body><header><div><h1>FOREVER VENDETTA · UI LAYOUT PREVIEW</h1><p>Captured from shipping Lua widgets. Approximate fonts and native textures; sample data.</p></div><nav><button data-view="blacklist">Blacklist</button><button data-view="friends">Friends</button><button data-view="alerts">Alerts</button></nav></header>
${Object.entries(scenes).map(([id,s])=>`<section id="${id}" class="scene ${id!=='blacklist'?'hidden':''}">${values(s.children).map(draw).join('')}</section>`).join('')}
<footer>The addon is native Lua. This development preview is excluded from the installable package.</footer>
<script>document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>document.querySelectorAll('.scene').forEach(s=>s.classList.toggle('hidden',s.id!==b.dataset.view)))</script></body></html>`);
console.log(output);

// SVG version for environments where a browser cannot reach the local preview.
function svgText(s, width, size) {
  const lines = [];
  for (const paragraph of plain(s).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (next.length * size * .52 > width && line) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines.map((line,i)=>`<tspan x="0" y="${size + i*(size+3)}">${esc(line)}</tspan>`).join('');
}
let clipId = 0;
function svgNode(w) {
  if (w.shown === false || w.isTemplateTitle) return '';
  const width=w.width||0, height=w.height||0;
  const size=w.font?.includes('Large')?16:w.font?.includes('Small')?11:12;
  let body='';
  if(w.kind==='Texture') body=`<rect width="${width}" height="${height}" fill="${color(w.color)||'none'}"/>`;
  if(w.kind==='FontString') body=`<text fill="${color(w.textColor)||'#e8e5de'}" font-size="${size}">${svgText(w.text,width||300,size)}</text>`;
  if(w.kind==='Button' && plain(w.text)) body=`<rect width="${width}" height="${height}" rx="2" fill="#382a1d" stroke="#79664a"/><text x="${width/2}" y="17" text-anchor="middle" font-size="12" fill="#eed18a">${esc(plain(w.text))}</text>`;
  if(w.kind==='EditBox') body=`<text x="8" y="18" fill="#e8e5de" font-size="12">${esc(plain(w.text))}</text>`;
  if(w.kind==='CheckButton') body=`<rect width="22" height="22" fill="#191b1e" stroke="#716148"/>${w.checked?'<path d="M4 11 L9 17 L19 4" stroke="#edca6c" stroke-width="3" fill="none"/>':''}`;
  if(w.kind==='Slider') body=`<rect y="6" width="${width}" height="6" fill="#131619" stroke="#585650"/><rect x="28" width="12" height="18" fill="#bdac86"/>`;
  const children=values(w.children);
  // WoW draws background textures before children, regardless of creation order.
  const textures=children.filter(c=>c.kind==='Texture' && c.layer!=='OVERLAY');
  const overlay=children.filter(c=>c.kind==='Texture' && c.layer==='OVERLAY');
  const rest=children.filter(c=>c.kind!=='Texture');
  body=textures.map(svgNode).join('')+body+rest.map(svgNode).join('')+overlay.map(svgNode).join('');
  if(w.kind==='ScrollFrame') {
    const id='clip'+clipId++;
    body=`<defs><clipPath id="${id}"><rect width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#${id})">${body}</g>`;
  }
  return `<g transform="translate(${w.x||0},${w.y||0})"${w.enabled===false?' opacity=".4"':''}>${body}</g>`;
}
for(const [id,scene] of Object.entries(scenes)) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="920" height="670" viewBox="0 0 920 670"><rect width="920" height="670" fill="#14191d"/><g transform="translate(30,28)" font-family="Arial, sans-serif"><rect width="860" height="590" fill="#171b20" stroke="#6b6452"/><rect width="860" height="25" fill="#383630"/><text x="430" y="17" text-anchor="middle" fill="#e5c56e" font-size="13">Forever Vendetta</text>${values(scene.children).map(svgNode).join('')}</g><text x="30" y="648" font-family="Arial, sans-serif" font-size="11" fill="#959da5">Layout captured from Lua widgets. Sample data; native WoW textures and fonts are approximated.</text></svg>`;
  const svgPath=output.replace(/\.html$/,`-${id}.svg`);
  fs.writeFileSync(svgPath,svg);
  console.log(svgPath);
}
