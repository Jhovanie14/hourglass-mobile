import type { NextConfig } from "next"

// Replaced with the real, pinned extension id in Task 8.
const EXTENSION_ID = "__EXTENSION_ID__"

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "telnyx"],
  async headers() {
    return [
      {
        source: "/panel",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors chrome-extension://${EXTENSION_ID}`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
