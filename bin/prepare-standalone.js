#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// Copies .next/static and public/ into .next/standalone/ so that
// `node .next/standalone/server.js` can serve a fully self-contained app.
// Next emits these alongside .next/standalone but does not copy them in.

const fs   = require('fs')
const path = require('path')

const root         = path.join(__dirname, '..')
const standaloneDir = path.join(root, '.next', 'standalone')
const staticSrc    = path.join(root, '.next', 'static')
const staticDst    = path.join(standaloneDir, '.next', 'static')
const publicSrc    = path.join(root, 'public')
const publicDst    = path.join(standaloneDir, 'public')

if (!fs.existsSync(standaloneDir)) {
  console.error(`[claude-hub] .next/standalone not found. Did \`next build\` run with output: 'standalone'?`)
  process.exit(1)
}

if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDst, { recursive: true, force: true })
}
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDst, { recursive: true, force: true })
}

console.log('[claude-hub] standalone bundle prepared at .next/standalone')
