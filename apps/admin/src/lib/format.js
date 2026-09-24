const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** Admin times are shown in IST (the first city's timezone); per-city timezones arrive with multi-city ops views. */
export function formatDateTime(value) {
  if (!value) return '—';
  return `${dateTime.format(new Date(value))} IST`;
}

export function titleCase(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** URL slug from a name: "Mehsana City" → "mehsana-city". */
export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
