#!/usr/bin/env node
// Builds the jamzo.in website (D-115): a home page plus the policy pages generated from docs/legal/*.md, with
// the business details from apps/website/business.json.
//   node scripts/build-website.mjs            → writes apps/website/public (committed, served by Caddy)
//   node scripts/build-website.mjs --check    → fails if apps/website/public is out of date (pnpm check:docs)
//   node scripts/build-website.mjs --preview  → apps/website/preview, missing details highlighted (not published)
// The real build refuses to run while a business detail is missing or a [[…]] placeholder is left in the text.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'apps/website');
const LEGAL = path.join(ROOT, 'docs/legal');
const KIT = path.join(ROOT, 'assets/brand/jamzo-logo-kit');
const FONTS = path.join(ROOT, 'node_modules/@expo-google-fonts/poppins');
const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--preview')
    ? 'preview'
    : 'build';

const PAGES = [
  { slug: 'terms', file: 'terms.md', nav: 'Terms of Use' },
  { slug: 'privacy', file: 'privacy.md', nav: 'Privacy Policy' },
  { slug: 'refunds', file: 'refunds.md', nav: 'Cancellation & Refunds' },
  { slug: 'delivery', file: 'delivery.md', nav: 'Delivery Policy' },
  { slug: 'contact', file: 'contact.md', nav: 'Contact Us' },
];

// ── Business details ──
const business = JSON.parse(readFileSync(path.join(SITE, 'business.json'), 'utf8'));
const LABELS = {
  legalName: 'Business name as on Udyam',
  ownerName: 'Owner name',
  address: 'Business address',
  supportPhone: 'Support phone',
  supportEmail: 'Support email',
  partnersEmail: 'Partners email',
  supportHours: 'Support hours',
  grievanceOfficer: 'Grievance Officer name',
  udyam: 'Udyam number',
  effectiveDate: 'Effective date',
};
const missing = Object.keys(LABELS).filter((k) => !business[k]);
if (mode === 'check' && missing.length && !existsSync(path.join(SITE, 'public'))) {
  console.log('✓ website not published yet (waiting for the business details)');
  process.exit(0);
}
if (mode !== 'preview' && missing.length) {
  console.error(`✗ apps/website/business.json is missing: ${missing.map((k) => LABELS[k]).join(', ')}`);
  console.error('  Nothing was built. Fill them in, or run with --preview to see the pages.');
  process.exit(1);
}
const TODO = (label) => `⟦${label}⟧`; // shown highlighted in preview pages only
const val = (k) => business[k] || TODO(LABELS[k]);
const effective = business.effectiveDate
  ? new Date(`${business.effectiveDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
  : TODO(LABELS.effectiveDate);
const registrations = [
  `Udyam registration: ${val('udyam')}`,
  business.gstin ? `GSTIN: ${business.gstin}` : null,
].filter(Boolean);

// ── Placeholders in docs/legal: values, the drafts' proposed defaults, and review notes (removed) ──
const VALUES = {
  'LEGAL NAME': val('legalName'),
  'OWNER NAME': val('ownerName'),
  ADDRESS: val('address'),
  'SUPPORT PHONE': val('supportPhone'),
  'support@jamzo.in': val('supportEmail'),
  'partners@jamzo.in': val('partnersEmail'),
  'GRIEVANCE OFFICER': val('grievanceOfficer'),
  'EFFECTIVE DATE': effective,
  UDYAM: val('udyam'),
  REGISTRATIONS: registrations.join(' · '),
  2: '2',
  'REVIEW: Mehsana, Gujarat': 'Mehsana, Gujarat',
  'REVIEW: 24 hours': '24 hours',
  'REVIEW: 7': '7',
  'REVIEW: 30': '30',
  'REVIEW: retention period, e.g. 90 days': '90 days',
  'REVIEW: support hours, e.g. 9 am – 11 pm every day': val('supportHours'),
  'until in-app deletion is built: email the Grievance Officer from your registered email, or contact support from the app':
    'email the Grievance Officer from your registered email, or contact support from the app',
};
const NOTES = new Set([
  'REVIEW Q-4: disclosure wording.',
  'REVIEW Q-4: state whether Jamzo is a marketplace (restaurants sell to you) or the seller, once the markup question is decided.',
  'REVIEW: liability cap wording.',
  'REVIEW: confirm fairness under consumer protection rules.',
  'REVIEW: confirm cross-border transfer wording under the DPDP Act.',
]);

function resolve(text, file) {
  return text.replace(/\[\[([\s\S]*?)\]\]/g, (_, raw) => {
    const key = raw.replace(/\s+/g, ' ').trim();
    if (NOTES.has(key)) return '';
    if (key in VALUES) return VALUES[key];
    throw new Error(`${file}: unknown placeholder [[${key}]] — add it to scripts/build-website.mjs`);
  });
}

// ── A small Markdown reader for the subset used in docs/legal ──
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
const href = (h) => (/^https?:/.test(h) ? h : h.replace(/^([a-z-]+)\.md/, '/$1'));

function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${href(h)}">${t}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w.+-])([\w.+-]+@jamzo\.in)\b/g, '<a href="mailto:$1">$1</a>');
}

function markdown(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  const isList = (l) => /^(- |\d+\. )/.test(l);
  const isBlockStart = (l) => !l.trim() || /^#{1,3} /.test(l) || l.startsWith('|') || isList(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.slice(level + 1).trim();
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(
        `<div class="table"><table><thead><tr>${cells(head)
          .map((c) => `<th>${inline(c)}</th>`)
          .join('')}</tr></thead><tbody>${body
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody></table></div>`,
      );
    } else if (isList(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (isList(lines[i]) || /^ {2,}\S/.test(lines[i]))) {
        if (isList(lines[i])) items.push(lines[i].replace(/^(- |\d+\. )/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
    } else {
      const para = [];
      while (i < lines.length && !isBlockStart(lines[i])) para.push(lines[i++].trim());
      const text = para.join(' ').trim();
      if (text) out.push(`<p>${inline(text)}</p>`);
    }
  }
  return out.join('\n');
}

// ── Page shell ──
const files = new Map(); // published path → Buffer
const put = (p, data) => files.set(p, Buffer.isBuffer(data) ? data : Buffer.from(data));
const css = readFileSync(path.join(SITE, 'src/site.css'));
const cssVersion = createHash('sha256').update(css).digest('hex').slice(0, 10);
const todoMarks = (html) =>
  html.replace(/⟦([^⟧]+)⟧/g, (_, label) => `<mark class="todo">${esc(label)}</mark>`);

function shell({ title, description, body, current }) {
  // From the effective date, not today, so the committed pages stay identical across years (--check).
  const year = business.effectiveDate ? business.effectiveDate.slice(0, 4) : new Date().getFullYear();
  const nav = (slug, label) =>
    `<a href="/${slug}"${current === slug ? ' aria-current="page"' : ''}>${label}</a>`;
  return todoMarks(`<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#1B2250">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="https://jamzo.in/assets/social-profile-800.png">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="icon" href="/assets/favicon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon-180.png">
<link rel="stylesheet" href="/assets/site.css?v=${cssVersion}">
</head>
<body>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="Jamzo home"><img src="/assets/jamzo-logo-on-light.svg" alt="Jamzo" width="136" height="40"></a>
    <nav class="top-nav" aria-label="Main">
      <a href="/#how">How it works</a>
      <a href="/#partners">Partner with us</a>
      ${nav('contact', 'Contact')}
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <img src="/assets/jamzo-logo-on-dark.svg" alt="Jamzo" width="122" height="36">
      <p class="tagline">Good food. Closer.</p>
      <p class="muted">Food delivery in Unjha, Gujarat.</p>
    </div>
    <div>
      <h2>Policies</h2>
      <ul>${PAGES.filter((p) => p.slug !== 'contact')
        .map((p) => `<li>${nav(p.slug, p.nav)}</li>`)
        .join('')}</ul>
    </div>
    <div>
      <h2>Contact</h2>
      <ul>
        <li><a href="mailto:${esc(business.supportEmail)}">${esc(business.supportEmail)}</a></li>
        <li>${business.supportPhone ? `<a href="tel:${esc(business.supportPhone.replace(/[^\d+]/g, ''))}">${esc(business.supportPhone)}</a>` : esc(val('supportPhone'))}</li>
        <li class="muted">${esc(val('supportHours'))}</li>
        <li>${nav('contact', 'All contact details')}</li>
      </ul>
    </div>
  </div>
  <div class="wrap legal-line">
    <p>© ${year} ${esc(val('legalName'))}. Jamzo is a trade name of ${esc(val('legalName'))}. ${esc(registrations.join(' · '))}.</p>
  </div>
</footer>
</body>
</html>
`);
}

// ── Policy pages ──
for (const page of PAGES) {
  let src = readFileSync(path.join(LEGAL, page.file), 'utf8');
  src = src.replace(/^\*\*DRAFT[^*]*\*\*\s*/m, ''); // the draft banner is for the repository, not the public page
  src = resolve(src, page.file);
  const title = src.match(/^# (.+)$/m)[1];
  const html = markdown(src.replace(/^# .+$/m, ''));
  put(
    `${page.slug}.html`,
    shell({
      title: `${title} · Jamzo`,
      description: `${title} for Jamzo, food delivery in Unjha, Gujarat.`,
      current: page.slug,
      body: `<section class="page-hero"><div class="wrap"><p class="eyebrow">Jamzo</p><h1>${esc(title)}</h1></div></section>
<article class="wrap prose">
${html}
</article>`,
    }),
  );
}

// ── Home page ──
const icon = (d) =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h4l3-6h3l2 6"/><path d="M13 11 11 7H8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8L12 3Z"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M9 20v-5h6v5"/>',
  helmet: '<path d="M4 15a8 8 0 0 1 16 0v2H4v-2Z"/><path d="M12 7v5h8"/>',
};
const card = (i, title, text) =>
  `<div class="card"><span class="icon">${icon(ICONS[i])}</span><h3>${title}</h3><p>${text}</p></div>`;
put(
  'index.html',
  shell({
    title: 'Jamzo · Food delivery in Unjha',
    description:
      'Jamzo brings food from Unjha’s favourite restaurants to your door. See the full bill before you pay, pay by UPI or cash, and follow your order live.',
    current: 'home',
    body: `<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="pill">Launching soon in Unjha, Gujarat</p>
      <h1>Good food.<br><span>Closer.</span></h1>
      <p class="lead">Order from Unjha’s favourite restaurants and get it delivered hot to your door — with the full bill before you pay, and live tracking until it arrives.</p>
      <div class="actions">
        <span class="button soon" aria-disabled="true">App coming soon</span>
        <a class="button ghost" href="#partners">Partner with us</a>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="disc"><img src="/assets/jamzo-mark-white-turmeric.svg" alt="" width="180" height="180"></div>
    </div>
  </div>
</section>

<section class="section" id="how">
  <div class="wrap">
    <h2 class="section-title">How it works</h2>
    <div class="cards three">
      ${card('search', '1. Choose', 'Find restaurants that deliver to you, browse their menus and add dishes to your cart.')}
      ${card('bag', '2. Order', 'See every rupee of the bill before you pay. Pay by UPI, card or cash on delivery.')}
      ${card('bike', '3. Enjoy', 'The restaurant prepares your food and a delivery partner brings it. Follow it live in the app.')}
    </div>
  </div>
</section>

<section class="section alt">
  <div class="wrap">
    <h2 class="section-title">Why Jamzo</h2>
    <div class="cards four">
      ${card('receipt', 'Honest bill', 'Item prices, delivery fee and any charges are shown before you order. No surprises.')}
      ${card('pin', 'Local first', 'Built for Unjha: your neighbourhood restaurants, delivered by people from your town.')}
      ${card('wallet', 'Pay your way', 'UPI, cards, net banking or cash on delivery.')}
      ${card('star', 'Real ratings', 'Star ratings from customers who actually ordered.')}
    </div>
  </div>
</section>

<section class="section" id="partners">
  <div class="wrap">
    <h2 class="section-title">Grow with Jamzo</h2>
    <div class="cards two">
      <div class="card big">
        <span class="icon">${icon(ICONS.store)}</span>
        <h3>Restaurants</h3>
        <p>Reach more customers in Unjha. Manage your menu, orders and payouts from the Jamzo Restaurant Partner app, with a clear statement for every settlement.</p>
        <a class="button" href="mailto:${esc(business.partnersEmail)}?subject=List%20my%20restaurant%20on%20Jamzo">List your restaurant</a>
      </div>
      <div class="card big">
        <span class="icon">${icon(ICONS.helmet)}</span>
        <h3>Delivery partners</h3>
        <p>Earn on your own time with your own two-wheeler. See your pay before you accept an order; tips are 100% yours.</p>
        <a class="button" href="mailto:${esc(business.partnersEmail)}?subject=Become%20a%20Jamzo%20delivery%20partner">Become a delivery partner</a>
      </div>
    </div>
  </div>
</section>

<section class="section contact-strip">
  <div class="wrap strip">
    <div>
      <h2>Questions?</h2>
      <p>Write to <a href="mailto:${esc(business.supportEmail)}">${esc(business.supportEmail)}</a> or call ${esc(val('supportPhone'))} (${esc(val('supportHours'))}).</p>
    </div>
    <a class="button light" href="/contact">Contact us</a>
  </div>
</section>`,
  }),
);

put(
  '404.html',
  shell({
    title: 'Page not found · Jamzo',
    description: 'This page does not exist.',
    body: `<section class="page-hero"><div class="wrap"><p class="eyebrow">404</p><h1>Page not found</h1></div></section>
<article class="wrap prose"><p>This page does not exist. <a href="/">Go to the Jamzo home page</a>.</p></article>`,
  }),
);
put('robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://jamzo.in/sitemap.xml\n');
put(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    '',
    ...PAGES.map((p) => p.slug),
  ]
    .map((s) => `  <url><loc>https://jamzo.in/${s}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);

// ── Assets ──
put('assets/site.css', css);
const copy = (to, from) => put(`assets/${to}`, readFileSync(from));
copy('jamzo-logo-on-light.svg', path.join(KIT, '1-logo-without-tagline/svg/jamzo-logo-on-light.svg'));
copy('jamzo-logo-on-dark.svg', path.join(KIT, '1-logo-without-tagline/svg/jamzo-logo-on-dark.svg'));
copy('jamzo-mark-white-turmeric.svg', path.join(KIT, '3-icon-mark/svg/jamzo-mark-white-turmeric.svg'));
for (const f of ['favicon-32.png', 'favicon-192.png', 'apple-touch-icon-180.png', 'social-profile-800.png'])
  copy(f, path.join(KIT, '4-app-icons/png', f));
copy('poppins-600.ttf', path.join(FONTS, '600SemiBold/Poppins_600SemiBold.ttf'));
copy('poppins-700.ttf', path.join(FONTS, '700Bold/Poppins_700Bold.ttf'));

// ── Write or check ──
if (mode !== 'preview') {
  for (const [p, data] of files) {
    if (data.includes('⟦')) throw new Error(`${p}: a business detail is missing`);
    if (/\[\[/.test(data.toString('utf8')) && p.endsWith('.html'))
      throw new Error(`${p}: an unresolved [[…]] is left`);
  }
}
const outDir = path.join(SITE, mode === 'preview' ? 'preview' : 'public');
const listAll = (dir, base = '') =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? listAll(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`],
      )
    : [];
if (mode === 'check') {
  const onDisk = new Set(listAll(outDir));
  const stale = [...files].filter(
    ([p, d]) => !onDisk.has(p) || !readFileSync(path.join(outDir, p)).equals(d),
  );
  const extra = [...onDisk].filter((p) => !files.has(p));
  if (stale.length || extra.length) {
    console.error(
      `✗ apps/website/public is out of date (${[...stale.map(([p]) => p), ...extra].join(', ')}). Run: node scripts/build-website.mjs`,
    );
    process.exit(1);
  }
  console.log(`✓ website up to date (${files.size} files)`);
} else {
  rmSync(outDir, { recursive: true, force: true });
  for (const [p, data] of files) {
    mkdirSync(path.dirname(path.join(outDir, p)), { recursive: true });
    writeFileSync(path.join(outDir, p), data);
  }
  console.log(`✓ wrote ${files.size} files to ${path.relative(ROOT, outDir)}`);
  if (mode === 'preview' && missing.length)
    console.log(`  (preview: still needed — ${missing.map((k) => LABELS[k]).join(', ')})`);
}
