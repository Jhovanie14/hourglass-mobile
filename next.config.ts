import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "telnyx"],
}

export default nextConfig
