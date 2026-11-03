// Regenerates the contribution heatmap (assets/graph-{dark,light}.svg) and the
// "Recent activity" block in README.md. Node 22+, no dependencies.
// Needs GITHUB_TOKEN (GraphQL requires auth; public data only is read).
import { readFile, writeFile } from 'node:fs/promises';

const USER = process.env.GH_USER ?? 'salehi';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');
const headers = { Authorization: `Bearer ${TOKEN}`, 'User-Agent': `${USER}-profile`, Accept: 'application/vnd.github+json' };

// ---------- data ----------
async function calendar() {
  const query = `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query, variables: { u: USER } }) });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? res.status)}`);
  return json.data.user.contributionsCollection.contributionCalendar;
}

async function events() {
  const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers });
  if (!res.ok) throw new Error(`events: ${res.status}`);
  return res.json();
}

// ---------- stats ----------
function stats(cal) {
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  const today = new Date().toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today);
  let longest = 0, run = 0;
  for (const d of past) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = past.length - 1;
  if (i >= 0 && past[i].contributionCount === 0) i--; // today not counted yet
  let current = 0;
  for (; i >= 0 && past[i].contributionCount > 0; i--) current++;
  const best = past.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), past[0]);
  return { total: cal.totalContributions, current, longest, best, days };
}

// ---------- heatmap svg ----------
const THEMES = {
  dark: { bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#8b949e', faint: '#6e7681', accent: '#3dd6c0', levels: ['#161b22', '#0e4a43', '#11786b', '#22a896', '#3dd6c0'] },
  light: { bg: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#59636e', faint: '#818b98', accent: '#0c7a6e', levels: ['#eff2f1', '#b3e6dc', '#6cccbb', '#25a491', '#0c7a6e'] },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function levelFn(days) {
  const nz = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 1;
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n === 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
}

function heatmap(cal, s, t, fontB64) {
  const CELL = 12, GAP = 3, STEP = CELL + GAP, PAD = 24, LABEL = 30;
  const weeks = cal.weeks;
  const gridW = weeks.length * STEP - GAP;
  const W = PAD * 2 + LABEL + gridW;
  const statsH = 64, monthsY = PAD + statsH + 22, gridY = monthsY + 10;
  const gridH = 7 * STEP - GAP;
  const H = gridY + gridH + 44;
  const level = levelFn(s.days);
  const today = new Date().toISOString().slice(0, 10);

  const cells = [];
  weeks.forEach((w, x) => w.contributionDays.forEach((d) => {
    if (d.date > today) return;
    const fill = t.levels[level(d.contributionCount)];
    cells.push(`<rect x="${PAD + LABEL + x * STEP}" y="${gridY + d.weekday * STEP}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"><title>${d.contributionCount} on ${d.date}</title></rect>`);
  }));

  const months = [];
  let last = -1;
  weeks.forEach((w, x) => {
    const first = w.contributionDays[0];
    const m = new Date(first.date + 'T00:00:00Z').getUTCMonth();
    if (m !== last && x < weeks.length - 2) { if (last !== -1 || first.date.slice(8) <= '07') months.push(`<text x="${PAD + LABEL + x * STEP}" y="${monthsY}">${MONTHS[m]}</text>`); last = m; }
  });

  const statItems = [
    ['contributions · 12 mo', s.total.toLocaleString('en-US')],
    ['current streak', `${s.current} ${s.current === 1 ? 'day' : 'days'}`],
    ['longest streak', `${s.longest} days`],
    ['best day', `${s.best.contributionCount} · ${fmtDate(s.best.date)}`],
  ];
  const colW = (W - PAD * 2) / statItems.length;
  const statsSvg = statItems.map(([k, v], i) => `
    <text class="k" x="${PAD + i * colW}" y="${PAD + 12}">${esc(k.toUpperCase())}</text>
    <text class="v${i === 0 ? ' a' : ''}" x="${PAD + i * colW}" y="${PAD + 46}">${esc(v)}</text>`).join('');

  const legendX = W - PAD - (5 * 15 + 70);
  const legendY = gridY + gridH + 26;
  const legend = t.levels.map((c, i) => `<rect x="${legendX + 34 + i * 15}" y="${legendY - 10}" width="12" height="12" rx="2.5" fill="${c}"/>`).join('');
  const updated = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${s.total} contributions in the last 12 months">
<style>
@font-face{font-family:JBM;src:url(data:font/woff2;base64,${fontB64}) format('woff2');font-weight:100 800}
text{font-family:JBM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:${t.muted};font-size:11px}
.k{font-size:10.5px;letter-spacing:.08em;fill:${t.faint}}
.v{font-size:24px;font-weight:650;fill:${t.text};letter-spacing:-.02em}
.a{fill:${t.accent}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
${statsSvg}
<line x1="${PAD}" x2="${W - PAD}" y1="${PAD + statsH}" y2="${PAD + statsH}" stroke="${t.border}"/>
${months.join('')}
<text x="${PAD}" y="${gridY + 1 * STEP + 10}">Mon</text><text x="${PAD}" y="${gridY + 3 * STEP + 10}">Wed</text><text x="${PAD}" y="${gridY + 5 * STEP + 10}">Fri</text>
${cells.join('')}
<text x="${PAD}" y="${legendY}">updated ${updated}</text>
<text x="${legendX}" y="${legendY}">less</text>${legend}<text x="${legendX + 34 + 5 * 15 + 4}" y="${legendY}">more</text>
</svg>`;
}

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
const [cal, evts, font] = await Promise.all([calendar(), events(), readFile('assets/fonts/jetbrains-mono-latin-wght-normal.woff2')]);
const s = stats(cal);
const b64 = font.toString('base64');
for (const [name, t] of Object.entries(THEMES)) await writeFile(`assets/graph-${name}.svg`, heatmap(cal, s, t, b64));

const rows = activity(evts);
const block = rows.length ? rows.join('\n') : '_No public activity in the last 90 days._';
const readme = await readFile('README.md', 'utf8');
const next = readme.replace(/(<!-- activity:start -->)[\s\S]*?(<!-- activity:end -->)/, `$1\n${block}\n$2`);
if (next === readme && !readme.includes('<!-- activity:start -->')) throw new Error('activity markers missing in README.md');
await writeFile('README.md', next);
console.log(`total=${s.total} current=${s.current} longest=${s.longest} best=${s.best.contributionCount}@${s.best.date} activity=${rows.length}`);
