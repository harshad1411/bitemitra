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
        ],
      },
    ];
  },
};

export default nextConfig;
