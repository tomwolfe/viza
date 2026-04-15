import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Required for WebXR and camera access in static export
  images: {
    unoptimized: true,
  },
  // Ensure trailing slash for static deployment
  trailingSlash: true,
};

export default nextConfig;
