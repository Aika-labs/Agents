import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a standalone build for Docker deployments.
  output: "standalone",
};

export default nextConfig;
