import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@rdan/browse-ui"],
  images: { unoptimized: true },
};

export default nextConfig;
