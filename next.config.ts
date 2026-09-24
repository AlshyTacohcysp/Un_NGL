import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "node-vibrant"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.googleusercontent.com", // widely used for google avatars
      },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
