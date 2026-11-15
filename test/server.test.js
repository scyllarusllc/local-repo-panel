import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

test('settings persist and remain isolated between project roots; managed processes stop', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'local-repo-panel-'));
  let server;
  let base;
  const roots = [join(temp,'a'),join(temp,'b')];
  async function boot(root) {
    server = spawn(process.execPath,['src/server.js'],{env:{...process.env,PROJECTS_DIR:root,PORT:'0'},stdio:['ignore','pipe','pipe']});
    // Read the actual ephemeral address from the startup log.
    let output='';
    await new Promise((resolve,reject)=>{
      server.stdout.on('data',data=>{output+=data; if(output.includes('Local Repo Panel:')) resolve();});
      server.once('error',reject); server.once('exit',()=>reject(Error('Server exited before startup')));
    });
    base=output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  }
  async function close() { const child=server; await new Promise(resolve=>{child.once('exit',resolve);child.kill();});server=null; }
  async function post(action,body={}) {return fetch(`${base}/api/projects/demo/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
  try {
    for(const root of roots) await mkdir(join(root,'demo'),{recursive:true});
    await boot(roots[0]);
    assert.equal((await post('config',{command:'exec sleep 60'})).status,200);
    assert.equal((await post('start')).status,200);
    assert.equal((await post('config',{url:'http://127.0.0.1:49387'})).status,200);
    const restarted = await post('restart');
    assert.equal(restarted.status,200,JSON.stringify(await restarted.json()));
    assert.equal((await post('stop')).status,200);
    assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects[0].managed,false);
    await close(); await boot(roots[0]);
    assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects[0].command,'exec sleep 60');
    await close(); await boot(roots[1]);
    assert.equal((await (await fetch(`${base}/api/projects`)).json()).projects[0].command,'');
    assert.equal((await post('config',{command:42})).status,400);
  } finally {
    if(server) await close();
    for(const root of roots) await rm(join('data',`config-${createHash('sha256').update(root).digest('hex')}.json`),{force:true});
    await rm(temp,{recursive:true,force:true});
  }
});
