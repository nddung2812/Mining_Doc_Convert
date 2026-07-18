import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Templates, prompts, and schemas are read from disk at runtime — make sure
  // they ship inside the serverless function bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./templates/**", "./prompts/**", "./schemas/**"],
    "/runs/**": ["./templates/**", "./prompts/**", "./schemas/**"],
  },
};

export default nextConfig;
