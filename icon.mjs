/**
 * DeepSeek whale icon generation in pure Node (zero dependencies): flatten
 * the official favicon whale path (M/C/Z cubics) into a polygon, fill it via
 * scanlines, encode PNGs with a minimal zlib-backed encoder, and pack a
 * multi-size ICO.
 *
 * A rendering library is deliberately avoided: librsvg (used by `sharp`)
 * mis-scales this specific path into a thin strip at the top of the canvas,
 * so the geometry is computed here directly from the embedded path data.
 * @see WHALE_PATH in `whale-path.mjs`
 */

import { deflateSync } from 'node:zlib'
import { WHALE_PATH } from './whale-path.mjs'

/** DeepSeek brand blue `#4D6BFE`. */
const WHALE_R = 77
const WHALE_G = 107
const WHALE_B = 254

/** Icon sizes emitted into the ICO, one PNG entry each. */
const ICO_SIZES = [16, 32, 48, 64, 128, 256]

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Encode an RGBA buffer as a PNG (8-bit, color type 6, no interlace). */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

/** Parse the favicon path (`M`/`C`/`Z` commands only) into cubic curves. */
function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  const subpaths = []
  let cur = null
  let cmd = ''
  let buf = []
  for (const token of tokens) {
    if (/^[a-zA-Z]$/.test(token)) {
      cmd = token
      if (token === 'M') {
        if (cur) subpaths.push(cur)
        cur = { curves: [], last: null }
      } else if (token === 'Z' && cur) {
        subpaths.push(cur)
        cur = null
      }
      buf = []
      continue
    }
    buf.push(parseFloat(token))
    const arity = { M: 2, C: 6, Z: 0 }[cmd] ?? 0
    if (cur && buf.length >= arity && arity > 0) {
      if (cmd === 'M') {
        cur.last = [buf[0], buf[1]]
      } else if (cmd === 'C') {
        cur.curves.push({ p0: cur.last, p1: [buf[0], buf[1]], p2: [buf[2], buf[3]], p3: [buf[4], buf[5]] })
        cur.last = [buf[4], buf[5]]
      }
      buf = []
    }
  }
  if (cur) subpaths.push(cur)
  return subpaths
}

/** Flatten one cubic bezier into `segs` line segments. */
function flatten(curve, segs) {
  const { p0, p1, p2, p3 } = curve
  const points = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const mt = 1 - t
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0]
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]
    points.push([x, y])
  }
  return points
}

/** Flatten the outer whale body (first subpath) into one closed outline. */
function whaleOutline() {
  const subpaths = parsePath(WHALE_PATH)
  const body = subpaths[0]
  const outline = []
  for (const curve of body.curves) {
    const flat = flatten(curve, 24)
    if (outline.length === 0) outline.push(...flat)
    else outline.push(...flat.slice(1))
  }
  return outline
}

/** Rasterize a closed polygon into an RGBA buffer via even-odd scanline fill. */
function rasterize(outline, size) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of outline) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const scale = size / Math.max(maxX - minX, maxY - minY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const poly = outline.map(([x, y]) => [(x - cx) * scale + size / 2, (y - cy) * scale + size / 2])
  const edges = []
  for (let i = 0; i < poly.length - 1; i++) edges.push([poly[i], poly[i + 1]])
  edges.push([poly[poly.length - 1], poly[0]])
  const buf = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    const xs = []
    for (const [a, b] of edges) {
      const y0 = a[1]
      const y1 = b[1]
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
        xs.push(a[0] + (y - y0) * (b[0] - a[0]) / (y1 - y0))
      }
    }
    xs.sort((m, n) => m - n)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let x0 = Math.floor(xs[i])
      let x1 = Math.ceil(xs[i + 1])
      if (x0 < 0) x0 = 0
      if (x1 > size) x1 = size
      for (let x = x0; x < x1; x++) {
        const o = (y * size + x) * 4
        buf[o] = WHALE_R
        buf[o + 1] = WHALE_G
        buf[o + 2] = WHALE_B
        buf[o + 3] = 255
      }
    }
  }
  return buf
}

/** Pack PNG entries into a Windows ICO file (PNG-in-ICO, Vista+). */
function buildIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + count * 16
  for (let i = 0; i < count; i++) {
    const s = ICO_SIZES[i] >= 256 ? 0 : ICO_SIZES[i]
    const entry = Buffer.alloc(16)
    entry.writeUInt8(s, 0)
    entry.writeUInt8(s, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(pngs[i].length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += pngs[i].length
  }
  return Buffer.concat([header, ...entries, ...pngs])
}

/**
 * Build the multi-size DeepSeek whale icon as an ICO buffer.
 * @returns {Buffer} the ICO file contents (16/32/48/64/128/256 px PNG entries).
 */
export function buildWhaleIcon() {
  const outline = whaleOutline()
  const pngs = ICO_SIZES.map(size => encodePng(size, size, rasterize(outline, size)))
  return buildIco(pngs)
}
