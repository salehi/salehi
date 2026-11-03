// Regenerates the "Latest public activity" block in README.md from the
// public events API. Node 22+, no dependencies.
import { readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER ?? 'salehi';
const TOKEN = process.env.GITHUB_TOKEN;
const headers = { 'User-Agent': `${USER}-profile`, Accept: 'application/vnd.github+json' };
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function events() {
  const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers });
  if (!res.ok) throw new Error(`events: ${res.status}`);
  return res.json();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- activity ----------
function activity(evts, limit = 8) {
  const link = (repo) => `[${repo.replace(`${USER}/`, '')}](https://github.com/${repo})`;
  const items = [];
  for (const e of evts) {
    const repo = e.repo.name, p = e.payload ?? {}, day = e.created_at.slice(0, 10);
    if (repo === `${USER}/${USER}`) continue;
    let kind, text;
    const prN = p.number ?? p.pull_request?.number, prUrl = p.pull_request?.html_url ?? `https://github.com/${repo}/pull/${prN}`;
    const isN = p.issue?.number, isUrl = p.comment?.html_url ?? p.issue?.html_url ?? `https://github.com/${repo}/issues/${isN}`;
    switch (e.type) {
      case 'PushEvent': kind = 'push'; break;
      case 'CreateEvent':
        if (p.ref_type === 'repository') text = `Created ${link(repo)}`;
        else if (p.ref_type === 'tag') text = `Tagged \`${p.ref}\` in ${link(repo)}`;
        break;
      case 'ReleaseEvent': if (p.action === 'published') text = `Released [${esc(p.release?.tag_name ?? 'a new version')}](${p.release?.html_url ?? `https://github.com/${repo}/releases`}) of ${link(repo)}`; break;
      case 'PublicEvent': text = `Open-sourced ${link(repo)}`; break;
      case 'PullRequestEvent':
        if (p.action === 'opened') text = `Opened PR [#${prN}](${prUrl}) in ${link(repo)}`;
        else if (p.action === 'closed' && p.pull_request?.merged) text = `Merged PR [#${prN}](${prUrl}) in ${link(repo)}`;
        else if (p.action === 'closed') text = `Closed PR [#${prN}](${prUrl}) in ${link(repo)}`;
        break;
      case 'IssuesEvent': if (['opened', 'closed'].includes(p.action)) text = `${p.action === 'opened' ? 'Opened' : 'Closed'} issue [#${isN}](${isUrl}) in ${link(repo)}`; break;
      case 'IssueCommentEvent': text = `Commented on [#${isN}](${isUrl}) in ${link(repo)}`; break;
      case 'PullRequestReviewEvent': text = `Reviewed PR [#${prN}](${prUrl}) in ${link(repo)}`; break;
      case 'ForkEvent': text = `Forked ${link(repo)}`; break;
      case 'WatchEvent': text = `Starred ${link(repo)}`; break;
    }
    if (kind === 'push') {
      const prev = items.find((i) => i.kind === 'push' && i.repo === repo && i.day === day);
      if (prev) { prev.n++; continue; }
      items.push({ kind, repo, day, n: 1 });
    } else if (text) {
      items.push({ kind: e.type, repo, day, text });
    }
  }
  items.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return items.slice(0, limit).map((i) => {
    const text = i.kind === 'push' ? `Pushed ${i.n > 1 ? `${i.n} times ` : ''}to ${link(i.repo)}` : i.text;
    return `- \`${fmtDate(i.day)}\` ${text}`;
  });
}

// ---------- main ----------
const rows = activity(await events());
const block = rows.length ? rows.join('\n') : '_No public activity in the last 90 days._';
const readme = await readFile('README.md', 'utf8');
if (!readme.includes('<!-- activity:start -->')) throw new Error('activity markers missing in README.md');
await writeFile('README.md', readme.replace(/(<!-- activity:start -->)[\s\S]*?(<!-- activity:end -->)/, `$1\n${block}\n$2`));
console.log(`activity=${rows.length}`);
