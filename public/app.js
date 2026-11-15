const $=s=>document.querySelector(s); let items=[],editing=''; const pending=new Map();
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>/^https?:\/\//i.test(s||'')?s:'';
const date=s=>new Date(s).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
function render(){
  const q=$('#search').value.toLowerCase(),sort=$('#sort').value;
  const filtered=items.filter(p=>p.name.toLowerCase().includes(q)||p.description.toLowerCase().includes(q)).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):new Date(b[sort])-new Date(a[sort]));
  $('#count').textContent=`${filtered.length} / ${items.length} projects`;
  $('#list').innerHTML=filtered.map(p=>`<tr>
    <td><strong>${esc(p.name)}</strong><small>${esc(p.description||p.path)}</small></td>
    <td><span class="status ${p.running?'on':''}">${p.managed?'Running':p.reachable?'Running externally':'Stopped'}</span></td>
    <td><code>${esc(p.command||'Not configured')}</code></td>
    <td>${safeUrl(p.url)?`<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)} ↗</a>`:'—'}</td>
    <td>${safeUrl(p.link)?`<a href="${esc(p.link)}" target="_blank" rel="noopener">Repository ↗</a>`:'—'}</td>
    <td>${date(p.updated_at)}</td><td>${date(p.created_at)}</td>
    <td><div class="row-actions">${p.managed?`<button data-action="stop" data-name="${esc(p.name)}" class="primary">Stop</button>`:p.reachable?`<span class="external-note" title="This process was not started by Local Repo Panel">External</span>`:`<button data-action="start" data-name="${esc(p.name)}" class="primary">Start</button>`}<button class="restart" title="Free the app port and launch the saved command" data-action="restart" data-name="${esc(p.name)}">↻ Restart</button><button data-action="settings" data-name="${esc(p.name)}">Edit</button></div></td>
  </tr>`).join('')||'<tr><td colspan="8" class="empty">No projects found.</td></tr>';
  for(const button of document.querySelectorAll('[data-action]')) {
    const action=pending.get(button.dataset.name);
    if(action) {button.disabled=true;if(button.dataset.action===action) {button.textContent={restart:'Restarting…',start:'Starting…',stop:'Stopping…'}[action];button.setAttribute('aria-busy','true');}}
  }
}
async function load(){try{const r=await fetch('/api/projects');const d=await r.json();if(!r.ok)throw Error(d.error);items=d.projects;render()}catch(e){$('#notice').textContent=e.message}}
async function post(name,action,body){const r=await fetch(`/api/projects/${encodeURIComponent(name)}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(r.status===404&&action==='restart'?'The dashboard server needs updating. Restart Local Repo Panel and refresh this page.':d.error);await load()}
$('#list').addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const name=b.dataset.name,action=b.dataset.action,p=items.find(p=>p.name===name);if(pending.has(name))return;if(action==='settings'||(['start','restart'].includes(action)&&!p.command)){editing=name;$('#settings-title').textContent=name;$('#command').value=p.command;$('#url').value=p.url;$('#link').value=p.link;$('#settings').showModal();return}pending.set(name,action);render();$('#notice').textContent=`${name}: ${{restart:'releasing port and restarting…',start:'starting…',stop:'stopping…'}[action]}`;try{await post(name,action);$('#notice').textContent=`${name}: ${action} complete`;}catch(err){$('#notice').textContent=err.message}finally{pending.delete(name);render()}});
$('#settings').addEventListener('close',async()=>{if($('#settings').returnValue!=='save')return;try{await post(editing,'config',{command:$('#command').value,url:$('#url').value,link:$('#link').value});$('#notice').textContent=`${editing}: settings saved`;}catch(e){$('#notice').textContent=e.message}});
$('#search').addEventListener('input',render);$('#sort').addEventListener('change',render);$('#refresh').addEventListener('click',load);load();setInterval(load,10000);
