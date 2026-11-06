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
    // Self-hosted / `next dev` proxy only: a chat turn (Sonnet, a few tool calls) can exceed the 30 s
    // default. On Vercel, external rewrites wait up to 120 s; analysis is async (202 + polling) anyway.
    proxyTimeout: 120_000,
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
