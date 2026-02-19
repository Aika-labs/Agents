import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use standalone output only for Docker / Cloud Run builds.
  // On Vercel the default output mode is used so the platform can apply its
  // own optimisations (edge caching, ISR, serverless functions, etc.).
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
