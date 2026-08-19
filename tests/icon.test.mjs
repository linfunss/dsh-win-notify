/**
 * Plain-Node test for the icon pipeline (no test framework, no dependencies).
 * Run with: node tests/icon.test.mjs   (or `npm test`)
 */

import { inflateSync } from 'node:zlib'
import { buildWhaleIcon } from '../icon.mjs'

function decodePng(buf) {
  let pos = 8
  let idat = Buffer.alloc(0)
  let width = 0
  let height = 0
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7])
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    } else if (type === 'IDAT') {
      idat = Buffer.concat([idat, Buffer.from(data)])
    }
    pos += 12 + len
  }
  const raw = inflateSync(idat)
  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) raw.copy(rgba, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
  return { width, height, rgba }
}

function icoEntries(ico) {
  const count = ico.readUInt16LE(4)
  const entries = []
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    const dataOff = ico.readUInt32LE(off + 12)
    const size = ico.readUInt32LE(off + 8)
    entries.push({ width: ico.readUInt8(off) || 256, png: ico.subarray(dataOff, dataOff + size) })
  }
  return entries
}

let failed = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}

const ico = buildWhaleIcon()
check('ico reserved == 0', ico.readUInt16LE(0) === 0)
check('ico type == icon', ico.readUInt16LE(2) === 1)
const entries = icoEntries(ico)
check('six sizes 16..256', JSON.stringify(entries.map(e => e.width)) === JSON.stringify([16, 32, 48, 64, 128, 256]))
check('every entry is a PNG', entries.every(e => e.png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'))

const largest = entries.find(e => e.width === 256)
const dec = decodePng(largest.png)
check('256x256 png', dec.width === 256 && dec.height === 256)

// Count opaque pixels by color: brand-blue body and white belly/eye/mouth
// details should both be present (the official DeepSeek whale style).
let blue = 0
let white = 0
for (let y = 0; y < 256; y++) {
  for (let x = 0; x < 256; x++) {
    const o = (y * 256 + x) * 4
    if (dec.rgba[o + 3] !== 255) continue
    if (dec.rgba[o] === 77 && dec.rgba[o + 1] === 107 && dec.rgba[o + 2] === 254) blue++
    else if (dec.rgba[o] === 255 && dec.rgba[o + 1] === 255 && dec.rgba[o + 2] === 255) white++
  }
}
check('blue whale body is rendered', blue > 5000)
check('white belly/eye/mouth details are rendered', white > 500)
check('corners transparent', dec.rgba[3] === 0 && dec.rgba[(255 * 256 + 255) * 4 + 3] === 0)
check('deterministic output', ico.toString('base64') === buildWhaleIcon().toString('base64'))

if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll checks passed.')
