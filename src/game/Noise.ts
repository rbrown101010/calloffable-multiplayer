/** Small deterministic 2D value-noise + fbm (no deps). */
function hash(x: number, y: number) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; h = h ^ (h >> 16); return ((h >>> 0) % 100000) / 100000; }
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
export function fbm(x: number, y: number, oct = 4, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f + i * 17.3, y * f + i * 9.1) * 2 - 1); n += a; a *= gain; f *= lac; }
  return s / n;
}
