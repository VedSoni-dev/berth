// A small QR code encoder (byte mode, versions 1-10, error correction L or M), so `berth serve` can
// print the pairing code in the terminal without installing anything. Follows ISO/IEC 18004.

const EC = {
  // per version 1..10: [ecc codewords per block, number of blocks]
  L: { ecc: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], bits: 1 },
  M: { ecc: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5], bits: 0 },
};

const rawModules = (v) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
};
const dataCodewords = (v, lvl) => Math.floor(rawModules(v) / 8) - EC[lvl].ecc[v - 1] * EC[lvl].blocks[v - 1];

/* ---- Reed-Solomon over GF(256), polynomial 0x11D ---- */
const gmul = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
};
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gmul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gmul(root, 2);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= gmul(c, f)));
  }
  return r;
}

/** Returns a square boolean matrix (true = dark) for `text`. */
export function qrMatrix(text, level = "M") {
  const bytes = [...Buffer.from(text, "utf8")];
  let v = 1;
  for (; v <= 10; v++) if (4 + 8 + bytes.length * 8 <= dataCodewords(v, level) * 8) break;
  if (v > 10) throw new Error("QR: text too long");

  // data bits: byte mode, 8-bit count (versions 1-9) or 16-bit (version 10)
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const cap = dataCodewords(v, level) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // split into blocks, add error correction, interleave
  const nBlocks = EC[level].blocks[v - 1];
  const eccLen = EC[level].ecc[v - 1];
  const raw = Math.floor(rawModules(v) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(d, div);
    if (i < nShort) d.push(-1); // placeholder so every block has the same length
    blocks.push(d.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) for (const b of blocks) if (b[i] !== -1) codewords.push(b[i]);

  // modules
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); }
      }
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
  }
  const drawFormat = (mask) => {
    const d = (EC[level].bits << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve the format areas
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1; const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
  }

  // place the codewords in the zigzag
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
  }

  // try the eight masks, keep the one with the lowest penalty
  const masks = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    applyMask(k);
    drawFormat(k);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = k; }
    applyMask(k); // undo
  }
  applyMask(best);
  drawFormat(best);
  return m;
}

function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const line = (get) => {
    let s = 0, run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    return s;
  };
  const finderLike = (get) => {
    let s = 0;
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= n; i++) {
      if (!pat.every((b, k) => get(i + k) === b)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
      const after = i + 11 <= n && [7, 8, 9, 10].every((k) => !get(i + k));
      if (before || after) s += 40;
    }
    return s;
  };
  for (let y = 0; y < n; y++) {
    p += line((x) => m[y][x]) + line((x) => m[x][y]);
    p += finderLike((x) => m[y][x]) + finderLike((x) => m[x][y]);
    for (let x = 0; x < n; x++) {
      if (m[y][x]) dark++;
      if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  }
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** The code as terminal text: two rows per line with half blocks, black on white so it scans on dark terminals too. */
export function qrTerminal(text, { quiet = 2, color = true } = {}) {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2;
  const at = (x, y) => { x -= quiet; y -= quiet; return y >= 0 && y < m.length && x >= 0 && x < m.length && m[y][x]; };
  const out = [];
  for (let y = 0; y < n; y += 2) {
    let row = "";
    for (let x = 0; x < n; x++) {
      const top = at(x, y), bottom = y + 1 < n && at(x, y + 1);
      if (color) row += `\x1b[${top ? 30 : 97};${bottom ? 40 : 107}m▀`;
      else row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    out.push(color ? row + "\x1b[0m" : row);
  }
  return out.join("\n");
}

/** The code as an SVG string. */
export function qrSvg(text, { quiet = 4, dark = "#000", light = "#fff" } = {}) {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2;
  let d = "";
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
