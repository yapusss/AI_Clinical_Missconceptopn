import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    // The /api rewrite proxies the request through Next, which buffers the body
    // with a hard default cap of 10 MB (experimental.proxyClientMaxBodySize,
    // server/lib/router-utils/resolve-routes.js). Reference material uploads are
    // intentionally uncapped (PDFs run to ~50 MB), so anything above the default
    // was silently TRUNCATED and the backend answered 500 -> "Terjadi kesalahan
    // pada server." Raise the cap well past the largest reference PDF.
    proxyClientMaxBodySize: "200mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `${backendUrl}/media/:path*`,
      },
    ];
  },
};

export default nextConfig;