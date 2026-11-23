"use strict"
/**
 * Copy browser assets that `tsc` does not emit into `dist`.
 *
 * `src/server/server.ts` serves `/ui/3d-force-graph.min.js` from its own
 * directory, so the same relative path must exist next to the compiled server.
 */

const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const source = path.join(ROOT, "src", "server", "ui", "vendor", "3d-force-graph.min.js")
const targetDir = path.join(ROOT, "dist", "server", "ui", "vendor")
const target = path.join(targetDir, "3d-force-graph.min.js")

if (!fs.existsSync(source)) {
  console.error(`❌ copy-ui-assets: missing ${path.relative(ROOT, source)}`)
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
console.log(`✅ copied ${path.relative(ROOT, target)}`)
