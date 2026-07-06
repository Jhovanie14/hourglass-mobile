import type { NextConfig } from "next"

// Extension ids allowed to embed the /panel iframe.
//   - published: the id the Chrome Web Store assigned the item (what the team installs)
//   - dev: the unpacked-load id derived from the manifest `key` (local testing)
// Both must be listed so the panel renders in production and in dev.
const EXTENSION_IDS = {
  published: "fdephfjginmnbodclcinbjgelleihnak",
  dev: "idfnhbgmbkpeajjdpbbnepmifkgcenne",
}

const frameAncestors = Object.values(EXTENSION_IDS)
  .map((id) => `chrome-extension://${id}`)
  .join(" ")

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "telnyx"],
  async headers() {
    return [
      {
        source: "/panel",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
