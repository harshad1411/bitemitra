// Jamzo Admin. The browser only talks to this origin: /api/* is proxied to the Jamzo API so the refresh
// token can live in an httpOnly SameSite=Strict cookie on the same site (DECISIONS D-22).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@jamzo/api-client',
    '@jamzo/config',
    '@jamzo/shared-types',
    '@jamzo/ui',
    '@jamzo/validation',
  ],
  poweredByHeader: false,
  // Docker images use the standalone server (D-101); the trace root is the monorepo.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone', outputFileTracingRoot: new URL('../../', import.meta.url).pathname }
    : {}),
  // E2E builds use their own output directory (they proxy to a separate test API).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Production only (D-100): HTTPS for a year, and a content security policy. Next.js needs inline
          // scripts for hydration; everything else comes from this origin, images also from the media CDN.
          ...(process.env.NODE_ENV === 'production'
            ? [
                { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
                {
                  key: 'Content-Security-Policy',
                  value: [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline'",
                    "img-src 'self' data: blob: https:",
                    "font-src 'self' data:",
                    "connect-src 'self'",
                    "frame-ancestors 'none'",
                    "base-uri 'self'",
                    "form-action 'self'",
                    "object-src 'none'",
                  ].join('; '),
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
