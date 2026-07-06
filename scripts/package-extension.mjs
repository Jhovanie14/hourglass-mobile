// Builds a Chrome Web Store upload ZIP from extension/ without touching the dev
// source. Mirrors the manual prod-hardening we do by hand:
//   - rewrites the panel iframe origin (localhost in dev) to PANEL_ORIGIN
//   - strips the `key` field (the store assigns its own extension ID)
//   - drops any localhost host_permissions
//   - excludes *.test.* files
// Zero dependencies on purpose (same spirit as make-icon.mjs): we hand-roll the
// ZIP container with node:zlib rather than pulling in archiver/adm-zip.
//
// Usage:
//   node scripts/package-extension.mjs
//   PANEL_ORIGIN=https://staging.megestic.com node scripts/package-extension.mjs

import { deflateRawSync } from "node:zlib"
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "extension")
const OUT_DIR = join(ROOT, "build")

const DEV_ORIGIN = "http://localhost:3000"
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || "https://www.megestic.com"

// --- CRC32 (same table-free variant as make-icon.mjs) -----------------------
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

// --- Minimal ZIP writer (deflate) -------------------------------------------
function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8")
    const crc = crc32(data)
    const compressed = deflateRawSync(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)   // local file header signature
    local.writeUInt16LE(20, 4)           // version needed
    local.writeUInt16LE(0, 6)            // flags
    local.writeUInt16LE(8, 8)            // method: deflate
    local.writeUInt16LE(0, 10)           // mod time
    local.writeUInt16LE(0x21, 12)        // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)           // extra length
    chunks.push(local, nameBuf, compressed)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)      // central dir header signature
    cd.writeUInt16LE(20, 4)              // version made by
    cd.writeUInt16LE(20, 6)              // version needed
    cd.writeUInt16LE(0, 8)               // flags
    cd.writeUInt16LE(8, 10)              // method
    cd.writeUInt16LE(0, 12)              // mod time
    cd.writeUInt16LE(0x21, 14)           // mod date
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)         // local header offset
    central.push(cd, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }

  const cdBuf = Buffer.concat(central)
  const cdOffset = offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)      // end of central dir signature
  eocd.writeUInt16LE(entries.length, 8)  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(cdBuf.length, 12)   // central dir size
  eocd.writeUInt32LE(cdOffset, 16)       // central dir offset

  return Buffer.concat([...chunks, cdBuf, eocd])
}

// --- Collect files -----------------------------------------------------------
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const IS_TEST = /\.test\.[jt]s$/
const IS_TEXT = /\.(html|js|json|css)$/

const entries = []
let manifestVersion = "0.0.0"

for (const full of walk(SRC)) {
  const rel = relative(SRC, full).split(sep).join("/") // zip paths use "/"
  if (IS_TEST.test(rel)) continue

  let data = readFileSync(full)

  if (rel === "manifest.json") {
    const m = JSON.parse(data.toString("utf8"))
    manifestVersion = m.version
    delete m.key
    if (Array.isArray(m.host_permissions)) {
      m.host_permissions = m.host_permissions.filter((h) => !h.includes("localhost"))
    }
    data = Buffer.from(JSON.stringify(m, null, 2) + "\n", "utf8")
  } else if (IS_TEXT.test(rel)) {
    const rewritten = data.toString("utf8").split(DEV_ORIGIN).join(PANEL_ORIGIN)
    data = Buffer.from(rewritten, "utf8")
  }

  entries.push({ name: rel, data })
}

// Guard: nothing should still point at the dev origin.
for (const { name, data } of entries) {
  if (IS_TEXT.test(name) && data.toString("utf8").includes(DEV_ORIGIN)) {
    throw new Error(`Dev origin ${DEV_ORIGIN} still present in ${name}`)
  }
}

mkdirSync(OUT_DIR, { recursive: true })
const outPath = join(OUT_DIR, `hourglass-call-panel-v${manifestVersion}.zip`)
writeFileSync(outPath, buildZip(entries))

console.log(`Packaged ${entries.length} files -> ${relative(ROOT, outPath)}`)
console.log(`  panel origin: ${PANEL_ORIGIN}`)
