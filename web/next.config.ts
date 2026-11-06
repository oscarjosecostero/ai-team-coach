import type { NextConfig } from "next";

/**
 * The browser only ever talks to this origin: `/api/*` is proxied to the Fastify API, so the
 * httpOnly session cookie is first-party and no CORS is needed. Set API_URL at build time.
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@coach/contracts"],
  experimental: {
    // A synchronous weekly analysis (Sonnet, several tool turns) can exceed the 30 s default.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
