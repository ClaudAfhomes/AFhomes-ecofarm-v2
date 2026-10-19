// Generates a static, faithful harness of the customer-detail MASTHEAD so the
// taste-skill inspector can measure it. It is not a mock: it concatenates the
// real token/base/component stylesheets and the real masthead rules straight out
// of the source, and reproduces the exact DOM that DetailFieldGrid/DetailField/
// StatusChip/TierBadge render. The only reason this exists is that the admin
// SPA is behind auth, so the route itself cannot be opened for measurement.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = process.cwd();
const read = (p) => readFileSync(`${root}/${p}`, 'utf8').replace(/\r\n/g, '\n');

const SHARED = [
  'packages/ui/src/styles/tokens.css',
  'packages/ui/src/styles/base.css',
  'packages/ui/src/components/DetailCard.module.css',
  'packages/ui/src/components/PageHeader.module.css',
  'packages/ui/src/components/StatusChip.module.css',
  'apps/admin/src/features/business/TierBadge.module.css',
].map(read);

// The masthead rules exactly as they stood before this change (the version read
// off disk at the start of the task), so the inspector's "before" is the real
// prior state and not a reconstruction.
const BEFORE = `
.masthead {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: var(--space-6);
  margin: 0;
}
.page .mastheadState,
.page .mastheadIds { gap: var(--space-3) var(--space-5); }
.page .mastheadState { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.page .mastheadIds { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.page .mastheadState dt,
.page .mastheadIds dt { font-size: var(--text-caption); }
.page .mastheadState dd {
  font-size: var(--text-h3);
  font-weight: 500;
  letter-spacing: -0.01em;
}
@media (max-width: 899px) {
  .masthead { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .page .mastheadState,
  .page .mastheadIds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 479px) {
  .page .mastheadState,
  .page .mastheadIds { grid-template-columns: minmax(0, 1fr); }
}
`;

// The masthead rules as they are now: lifted out of the module file itself, so
// this harness cannot drift from the stylesheet it is measuring.
const CURRENT = read('apps/admin/src/features/business/CustomerDetailPage.module.css');
const AFTER = CURRENT.slice(
  CURRENT.indexOf('.masthead {'),
  CURRENT.indexOf('/* Panels: card sales'),
);

const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

const field = (label, value) => `        <div class="field"><dt>${label}</dt><dd>${value}</dd></div>`;

// The masthead is one region of a page, so the harness renders the page around
// it: the real PageHeader above (h1, description, the permission-gated action)
// and one real DetailCard below. Measuring the strip in isolation would report
// a missing title and an empty screen that belong to the harness, not the app.
const BODY = `
    <section class="page">
      <header class="header">
        <div class="text">
          <h1 class="title">MARIA SANTOS</h1>
          <p class="description">Customer record and card sales.</p>
        </div>
        <div class="actions"><button class="btn" type="button">Edit company record</button></div>
      </header>
      <div class="masthead">
        <dl class="fieldGrid mastheadState">
${field('Status', `<span class="chip success">${CHECK_ICON}Active</span>`)}
${field('Tier', '<span class="badge gold"><span class="dot" aria-hidden="true"></span>GOLD</span>')}
${field('Category', 'Active VIP')}
${field('Portal account', 'Not activated')}
        </dl>
        <dl class="fieldGrid mastheadIds">
${field('Customer ID', '<span class="mono">CUS-000001</span>')}
${field('Customer code', '<span class="mono">AF-CC-1A2B3C4D</span>')}
${field('Registered', 'Sep 1, 2026, 12:00 AM')}
        </dl>
      </div>
      <div class="grid">
        <div class="card">
          <h2 class="cardTitle">Contact and identity</h2>
          <dl class="fieldGrid">
${field('Email', 'maria.santos@afhomesmail.ph')}
${field('Phone', '+63 917 123 4567')}
${field('Date of birth', 'May 5, 1990')}
${field('Gender', 'female')}
          </dl>
        </div>
        <div class="card">
          <h2 class="cardTitle">Membership</h2>
          <dl class="fieldGrid">
${field('Membership status', '<span class="chip success">Active</span>')}
${field('VIP tier', '<span class="badge gold"><span class="dot" aria-hidden="true"></span>GOLD</span>')}
${field('Valid until', 'May 5, 2027')}
          </dl>
        </div>
      </div>
    </section>`;

const page = (title, mastheadCss) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — customer masthead</title>
<style>
${SHARED.join('\n')}
/* page canvas: the admin shell's content column at its real width */
body { padding: var(--space-8); }
.page { max-width: 1100px; margin: 0 auto; display: grid; gap: var(--space-4); align-content: start; }
.grid { display: grid; gap: var(--space-4); align-items: start; }
@media (min-width: 768px) { .grid { grid-template-columns: 1fr 1fr; } }
.btn {
  min-height: var(--control-md);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-control);
  background: var(--color-bg-surface-raised);
  font: inherit; font-size: var(--text-body-s); font-weight: 500;
  color: var(--color-text-primary); cursor: pointer;
}
${mastheadCss}
</style>
</head>
<body>
${BODY}
</body>
</html>
`;

for (const [dir, title, css] of [
  ['before', 'BEFORE', BEFORE],
  ['after', 'AFTER', AFTER],
]) {
  mkdirSync(`${root}/.taste-skill/${dir}`, { recursive: true });
  writeFileSync(`${root}/.taste-skill/${dir}/index.html`, page(title, css));
  console.log(`wrote .taste-skill/${dir}/index.html`);
}