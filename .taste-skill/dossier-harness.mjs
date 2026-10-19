// Static harness for the COMPANY RECORD tab, for the same reason as the
// masthead one: the admin SPA is auth-gated, so the route itself cannot be
// opened for measurement. The field labels are parsed straight out of the
// component so this cannot drift from what actually renders, and the icon paths
// are lifted from the real Icon component.
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
  'apps/admin/src/features/business/CustomerDetailPage.module.css',
].map(read);

const tsx = read('apps/admin/src/features/business/CustomerDetailPage.tsx');

// Real labels, in real order, for one section.
function labels(title) {
  const start = tsx.indexOf(`title: '${title}',`);
  if (start < 0) throw new Error('section not found: ' + title);
  const end = tsx.indexOf('fields: [', start);
  const block = tsx.slice(end, tsx.indexOf('],\n    },', end));
  return [...block.matchAll(/\['([A-Z0-9/ .()\-]+)',/g)].map((m) => m[1]);
}

// The real Icon paths, extracted so the marks are the shipped ones.
const iconSrc = read('packages/ui/src/components/Icon.tsx');
function iconPaths(name) {
  const key = name === 'user-plus' ? "'user-plus'" : name;
  const start = iconSrc.indexOf(`\n  ${key}: (`);
  const end = iconSrc.indexOf('\n  ),', start);
  const body = iconSrc.slice(start, end);
  const out = [];
  for (const m of body.matchAll(/<(path|circle|polyline|line|rect)\b([^/>]*)\/>/g)) {
    const attrs = m[2]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(\w+)="([^"]*)"/g, (_, k, v) => `${k}="${v}"`);
    out.push(`<${m[1]} ${attrs} />`);
  }
  if (!out.length) throw new Error('no path for icon: ' + name);
  return out.join('');
}

const svg = (name) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths(name)}</svg>`;

// A believable record: mostly filled, a few genuinely blank cells.
const VALUES = {
  'RA NO': ['RA-2026-0001', true],
  STATUS: ['Active Member', false],
  'FIRST NAME': ['MARIA', false],
  'LAST NAME': ['SANTOS', false],
  'MIDDLE NAME': ['DELA', false],
  SUFFIX: [null, false],
  BIRTHDAY: ['May 5, 1990', false],
  GENDER: ['female', false],
  AGE: ['36', false],
  CITIZENSHIP: ['Filipino', false],
  'CIVIL STATUS': ['Married', false],
  'PERMANENT ADDRESS LINE 1': ['1 SSOT Street', false],
  'PERMANENT ADDRESS LINE 2': ['Unit 7', false],
  PROVINCE: ['Laguna', false],
  CITY: ['Calamba', false],
  BARANGAY: ['Parian', false],
  'POSTAL CODE': ['4027', true],
  LANDLINE: ['(049) 555-1234', false],
  EMAIL: ['maria.santos@afhomesmail.ph', false],
  'TIN NO.': ['********9012', true],
  'MOBILE NO.': ['+63 917 123 4567', true],
  'OCCUPATION / BUSINESS NAME': ['Engineer', false],
  'OFFICE / BUSINESS ADDRESS': ['Makati HQ', false],
  'EMPLOYED POSITION': ['Engineer II', false],
  'SUPPLEMENTARY FULL NAME': ['JUAN CRUZ', false],
  'SUPPLEMENTARY ADDRESS': ['1 Side St, Biñan', false],
  'SUPPLIMENTARY BIRTHDAY': ['Aug 10, 1992', false],
  'VIP PACKAGE': ['GOLD VIP', false],
  'PAYMENT TERMS': ['24 months', false],
  'REGULAR PRICE': ['60000.00', true],
  DISCOUNT: [null, false],
  'TOTAL AMOUNT': ['54000.00', true],
  RF: ['RF-001', true],
  'PAYMENT TYPE': ['Bank transfer', false],
  'REF NO': ['TRF-88214', true],
  'OST/IST NAME': ['OST Silk', false],
  'SVD (NAME)': ['SVD Santos', false],
  'SSM (NAME)': [null, false],
  'SM (NAME)': ['SM Reyes', false],
  'REFERRER (NAME)': ['Ref Reyes', false],
  'VIP RECOMMENDER (NAME)': [null, false],
  'CONTACT NO.': ['+63 918 555 0101', false],
  'EMAIL ADDRESS': ['related@afhomesmail.ph', false],
};

// The supplementary block repeats several labels; give those their own values.
const SUPP = {
  'SUPPLEMENTARY FULL NAME': ['JUAN DELA CRUZ', false],
  'SUPPLEMENTARY ADDRESS': ['1 Side St, Biñan, Laguna', false],
  BIRTHDAY: ['Aug 10, 1992', false],
  GENDER: ['male', false],
  AGE: ['34', false],
  CITIZENSHIP: ['Filipino', false],
  'CIVIL STATUS': ['Married', false],
  'TIN NO.': ['********7001', true],
  LANDLINE: ['(02) 8999-0000', false],
  'MOBILE NO.': ['+63 918 555 0101', true],
  EMAIL: ['juan.cruz@afhomesmail.ph', false],
  'OCCUPATION / BUSINESS NAME': ['Teacher', false],
  'OFFICE / BUSINESS ADDRESS': ['Laguna State University', false],
  'EMPLOYED POSITION': ['Instructor II', false],
};

const PACKAGE = {
  'VIP PACKAGE': ['GOLD VIP', false],
  'PAYMENT TERMS': ['24 months', false],
  'REGULAR PRICE': ['60000.00', true],
  DISCOUNT: ['6000.00', true],
  'TOTAL AMOUNT': ['54000.00', true],
  RF: ['0012', true],
  'PAYMENT TYPE': ['Bank transfer', false],
  'REF NO': ['TRF-88214', true],
  DATE: ['Jan 4, 2026', false],
};

function fields(title, table) {
  return labels(title)
    .map((label) => {
      const [value, mono] = table[label] ?? [null, false];
      const body = value ? (mono ? `<span class="mono">${value}</span>` : value) : `<span class="absent">Not Recorded</span>`;
      return `            <div class="field"><dt>${label}</dt><dd>${body}</dd></div>`;
    })
    .join('\n');
}

const card = (title, icon, tone, blurb, table) => `
          <article class="dossierCard">
            <header class="dossierHead ${tone}">
              <span class="dossierMark" aria-hidden="true">${svg(icon)}</span>
              <h2 class="dossierTitle">${title}</h2>
              <p class="dossierBlurb">${blurb}</p>
            </header>
            <dl class="fieldGrid dossierFields">
${fields(title, table)}
            </dl>
          </article>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Customer company record</title>
<style>
${SHARED.join('\n')}
body { padding: var(--space-8); }
.page { max-width: 1100px; margin: 0 auto; display: grid; gap: var(--space-4); align-content: start; }
.btn {
  min-height: var(--control-md); padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong); border-radius: var(--radius-control);
  background: var(--color-bg-surface-raised); font: inherit; font-size: var(--text-body-s);
  font-weight: 500; color: var(--color-text-primary); cursor: pointer;
}
.tabs { display: flex; gap: var(--space-6); border-bottom: 1px solid var(--color-border-default); }
.tab {
  display: inline-flex; align-items: center; min-height: 44px; margin-bottom: -1px;
  padding: 0; border-bottom: 2px solid transparent; font-size: var(--text-body-s);
  color: var(--color-text-secondary); text-decoration: none;
}
.tabCurrent { color: var(--color-text-primary); font-weight: 600; border-bottom-color: var(--color-brand-secondary); }
</style>
</head>
<body>
    <section class="page">
      <header class="header">
        <div class="text">
          <h1 class="title">MARIA SANTOS</h1>
          <p class="description">Customer record and card sales.</p>
        </div>
        <div class="actions"><button class="btn" type="button">Edit company record</button></div>
      </header>
      <nav class="tabs" aria-label="Customer record sections">
        <span class="tab">Overview</span>
        <span class="tab">Sales and payments</span>
        <span class="tab tabCurrent">Company record</span>
      </nav>
      <div class="dossier">
${card('Primary Member', 'user', 'tonebrand', 'Who holds the card', VALUES)}
${card('Supplementary Member', 'users', 'toneinfo', 'Second holder, Gold only', SUPP)}
${card('Related Persons and Referral', 'user-plus', 'toneneutral', 'Stated names, not the genealogy', VALUES)}
${card('Package and Payment (company stated)', 'wallet', 'tonegold', 'Company figures, not sale totals', PACKAGE)}
      </div>
    </section>
</body>
</html>
`;

mkdirSync(`${root}/.taste-skill/dossier`, { recursive: true });
writeFileSync(`${root}/.taste-skill/dossier/index.html`, html);
for (const t of ['Primary Member', 'Supplementary Member', 'Related Persons and Referral', 'Package and Payment (company stated)'])
  console.log(`${t}: ${labels(t).length} fields`);
console.log('wrote .taste-skill/dossier/index.html');