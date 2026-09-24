// Deep-link parsing (each app has its own scheme from the registry; universal links for the customer app).

/**
 * @param {string} url
 * @param {{ schemes: string[], domains?: string[] }} accepted
 * @returns {{ path: string, params: Record<string, string> } | null} null when the link is not ours
 */
export function parseDeepLink(url, { schemes, domains = [] }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, '');
  let path;
  if (schemes.includes(scheme)) {
    // jamzo://orders/123 → host "orders", pathname "/123"
    path = `/${[u.host, u.pathname.replace(/^\//, '')].filter(Boolean).join('/')}`;
  } else if ((scheme === 'https' || scheme === 'http') && domains.includes(u.hostname)) {
    path = u.pathname || '/';
  } else {
    return null;
  }
  path = path.replace(/\/+$/, '') || '/';
  if (path.includes('..')) return null;
  return { path, params: Object.fromEntries(u.searchParams.entries()) };
}
