import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a self-contained build in .next/standalone
  output: "standalone",
};

export default nextConfig;
