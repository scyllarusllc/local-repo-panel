import { githubUpdatedAt } from './github.js';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, mkdir, open } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.PROJECTS_DIR || join(homedir(), 'github'));
const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(join(homedir(), 'github'));
const configFile = root === defaultRoot ? 'config.json' : `config-${createHash('sha256').update(root).digest('hex')}.json`;
const configPath = join(here, '..', 'data', configFile);
const port = Number(process.env.PORT || 8080);
const running = new Map();
let config = {};
try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch {}
const validName = name => typeof name === 'string' && /^[^./][^/\\]*$/.test(name) && name !== '..';
const send = (res, status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store'}); res.end(JSON.stringify(body)); };
const save = async () => { await mkdir(dirname(configPath), {recursive:true}); await writeFile(configPath, JSON.stringify(config, null, 2) + '\n'); };
const readJson = async req => { let s=''; for await (const part of req) { s += part; if (s.length > 65536) throw Error('Request too large'); } return JSON.parse(s || '{}'); };
const gitUrl = async path => { try { const text = await readFile(join(path,'.git','config'),'utf8'); const raw = text.match(/\[remote "origin"\][\s\S]*?url\s*=\s*([^\n]+)/)?.[1]?.trim(); if (!raw) return ''; const m=raw.match(/^git@github\.com:(.+?)(?:\.git)?$/); return m ? `https://github.com/${m[1].replace(/\.git$/,'')}` : /^https?:\/\//.test(raw) ? raw.replace(/\.git$/,'') : ''; } catch { return ''; } };
function portOpen(url) {
  let target;
  try { target = new URL(url); } catch { return Promise.resolve(false); }
  if (!['localhost', '127.0.0.1'].includes(target.hostname)) return Promise.resolve(false);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
const execute = promisify(execFile);
const restarting = new Set();
async function restart(name, project) {
  if (!project.command) throw Error('Set a start command first');
  let target;
  try { target = new URL(project.url); } catch { throw Error('Set a local App URL before restarting'); }
  if (!['http:', 'https:'].includes(target.protocol) || !['localhost','127.0.0.1','[::1]'].includes(target.hostname)) throw Error('Restart requires a local App URL');
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (targetPort === server.address().port) throw Error('Cannot restart the dashboard’s own port');
  async function listeners() {
    try {
      const {stdout} = await execute('lsof',['-nP','-t',`-iTCP:${targetPort}`,'-sTCP:LISTEN']);
      return [...new Set(stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
    } catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return []; throw error; }
  }
  const pids = await listeners();
  if (pids.includes(process.pid)) throw Error('Cannot terminate the dashboard');
  const child = running.get(name);
  const signal = (pid, value) => { try { process.kill(pid,value); } catch (error) { if(error.code !== 'ESRCH') throw error; } };
  if(child) signal(-child.pid,'SIGTERM');
  for(const pid of pids) signal(pid,'SIGTERM');
  const deadline = Date.now()+2000;
  while(Date.now()<deadline && ((child && groupAlive(child.pid)) || (await listeners()).length)) await delay(50);
  if(child && groupAlive(child.pid)) signal(-child.pid,'SIGKILL');
  // Recheck ownership so a replacement listener is never killed accidentally.
  for(const pid of await listeners()) if(pids.includes(pid)) signal(pid,'SIGKILL');
  const killDeadline=Date.now()+2000;
  while(Date.now()<killDeadline && ((child && groupAlive(child.pid)) || (await listeners()).length)) await delay(50);
  if ((child && groupAlive(child.pid)) || (await listeners()).length) throw Error('Port or process group is still busy');
  running.delete(name);
  return launch(name,project.command);
}
async function launch(name, command) {
  const env = {...process.env};
  delete env.PORT;
  delete env.PROJECTS_DIR;
  const logPath=join(here,'..','data','logs',`${createHash('sha256').update(root+'/' + name).digest('hex')}.log`);
  await mkdir(dirname(logPath),{recursive:true});
  const log=await open(logPath,'w');
  let child;
  try { child=spawn(command,{cwd:join(root,name),env,shell:true,detached:true,stdio:['ignore',log.fd,log.fd]}); await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}); }
  finally { await log.close(); }

  running.set(name,child);
  child.on('exit',()=>{ if(running.get(name) === child && !groupAlive(child.pid)) running.delete(name); });
  child.unref();
  await delay(400);
  if (!groupAlive(child.pid)) {
    running.delete(name);
    const output=(await readFile(logPath,'utf8')).slice(-3000).trim();
    throw Error(`Start failed for ${name}: ${output || 'Process exited immediately'}`);
  }
  return child.pid;
}
async function projects() {
  for (const [name, child] of running) if (!groupAlive(child.pid)) running.delete(name);
  const entries = await readdir(root,{withFileTypes:true});
  return Promise.all(entries.filter(e=>e.isDirectory() && !e.name.startsWith('.')).map(async e=>{
    const path=join(root,e.name), s=await stat(path), c=config[e.name] || {};
    let pkg={}; try { pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8')); } catch {}
    let makefile=''; try { makefile=await readFile(join(path,'Makefile'),'utf8'); } catch {}
    const devTarget=/^dev\s*:/m.test(makefile);
    const makePort=makefile.match(/^PORT\s*\?=\s*(\d+)/m)?.[1];
    const documentedPort=makefile.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1];
    const inferredUrl=makePort||documentedPort ? `http://127.0.0.1:${makePort||documentedPort}` : '';
    const appUrl=c.url||inferredUrl;
    const managed=running.has(e.name), reachable=appUrl ? await portOpen(appUrl) : false;
    const origin=await gitUrl(path);
    const link=c.link||pkg.homepage||origin;
    const github_updated_at=githubUpdatedAt(origin || link);
    return {github_updated_at,name:e.name,path,created_at:s.birthtime.toISOString(),updated_at:s.mtime.toISOString(),description:pkg.description||'',link,command:c.command??(devTarget?'make dev':''),url:appUrl,running:managed||reachable,managed,reachable,pid:running.get(e.name)?.pid||null};
  }));
}
async function route(req,res) {
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/api/health') return send(res,200,{ok:true,root,port});
  if(req.method==='GET' && url.pathname==='/api/projects') return send(res,200,{projects:await projects()});
  const match=url.pathname.match(/^\/api\/projects\/([^/]+)\/(config|start|stop|restart)$/);
  if(match && req.method==='POST') {
    const name=decodeURIComponent(match[1]), action=match[2];
    if(!validName(name) || !(await readdir(root)).includes(name)) return send(res,404,{error:'Project not found'});
    if(action==='config') {
      const body=await readJson(req);
      if(['command','url','link'].some(k=>body[k]!==undefined && typeof body[k]!=='string')) return send(res,400,{error:'Invalid settings'});
      config[name]={...config[name],...Object.fromEntries(['command','url','link'].filter(k=>body[k]!==undefined).map(k=>[k,body[k].trim()]))};
      await save(); return send(res,200,{ok:true});
    }
    if(restarting.has(name)) return send(res,409,{error:'Restart in progress'});
    if(action==='restart') {
      restarting.add(name);
      try { return send(res,200,{ok:true,pid:await restart(name,(await projects()).find(p=>p.name===name))}); }
      finally { restarting.delete(name); }
    }
    if(action==='start') {
      if(running.has(name)) return send(res,200,{ok:true,pid:running.get(name).pid});
      const project=(await projects()).find(p=>p.name===name);
      const command=project?.command;
      if(!command) return send(res,400,{error:'Set a start command first'});
      return send(res,200,{ok:true,pid:await launch(name,command)});
    }
    const child=running.get(name);
    if(child) {
      try { process.kill(-child.pid,'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const deadline = Date.now() + 3000;
      while (groupAlive(child.pid) && Date.now() < deadline) await delay(50);
      if (groupAlive(child.pid)) return send(res,409,{error:'Process group has not stopped; retry Stop after checking the project'});
      running.delete(name);
    }
    return send(res,200,{ok:true});
  }
  if(req.method==='GET' && (url.pathname==='/' || /^\/(app\.js|style\.css)$/.test(url.pathname))) {
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const content=await readFile(join(here,'..','public',file));
    res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)]});
    return res.end(content);
  }
  send(res,404,{error:'Not found'});
}
const server = createServer((req,res)=>{ if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(res,403,{error:'Local access only'}); route(req,res).catch(e=>send(res,500,{error:e.message})); }).listen(port,'127.0.0.1',()=>console.log(`Local Repo Panel: http://127.0.0.1:${server.address().port}`));
