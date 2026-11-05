import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres"], // load the DB driver from node_modules, unbundled
};

export default nextConfig;
