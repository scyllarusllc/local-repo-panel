import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const cache = new Map();
export function githubUpdatedAt(link) {
  let url;
  try { url = new URL(link); } catch { return null; }
  if (url.hostname !== 'github.com') return null;
  const parts = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean);
  if (parts.length < 2 || !parts.slice(0,2).every(p => /^[\w.-]+$/.test(p))) return null;
  const repo = parts.slice(0,2).join('/');
  const previous = cache.get(repo);
  if (!previous || Date.now() >= previous.expires) {
    const entry = { value: previous?.value ?? null, expires: Date.now() + 300000 };
    cache.set(repo, entry);
    // Background lookup keeps project listing and process controls responsive.
    execute('gh', ['api', `repos/${repo}`, '--jq', '.updated_at'], {timeout: 8000})
      .then(({stdout}) => { const value=stdout.trim(); if (Number.isFinite(Date.parse(value))) entry.value=value; })
      .catch(() => {});
  }
  return cache.get(repo).value;
}
