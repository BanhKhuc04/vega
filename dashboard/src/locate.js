// Stylised district map with route, radar sweep and target pulse (all sample geometry).
export function mapSVG() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blocks = [];
  const xs = [0, 140, 300, 470, 640, 800], ys = [0, 120, 220, 400, 480];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const x0 = xs[i] + 10, y0 = ys[j] + 10, x1 = xs[i + 1] - 10, y1 = ys[j + 1] - 10;
    for (let k = 0; k < 6; k++) {
      const w = 14 + rnd() * 34, h = 10 + rnd() * 26, x = x0 + rnd() * Math.max(1, x1 - x0 - w), y = y0 + rnd() * Math.max(1, y1 - y0 - h);
      blocks.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`);
    }
  }
  return `<svg viewBox="0 0 800 480" role="img" aria-label="Stylised map with a route from your position to the target">
  <defs>
    <pattern id="mg" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" stroke-opacity=".07"/></pattern>
    <linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor" stop-opacity=".45"/></linearGradient>
  </defs>
  <rect width="800" height="480" fill="url(#mg)"/>
  <path d="M0 312 C150 282 250 352 380 322 S600 272 800 302" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="28"/>
  <path d="M0 312 C150 282 250 352 380 322 S600 272 800 302" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1" stroke-dasharray="2 6"/>
  <polygon points="320,240 450,236 455,290 330,300" fill="currentColor" fill-opacity=".06"/>
  <polygon points="660,240 780,236 784,286 668,292" fill="currentColor" fill-opacity=".06"/>
  <g fill="currentColor" fill-opacity=".05" stroke="currentColor" stroke-opacity=".14">${blocks.join('')}</g>
  <g stroke="currentColor" stroke-opacity=".38" stroke-width="2" fill="none">
    <path d="M0 120H800M0 220H800M0 400H800M140 0V480M300 0V480M470 0V480M640 0V480"/><path d="M40 480 L420 40" stroke-opacity=".25"/>
  </g>
  <g stroke="currentColor" stroke-opacity=".14" fill="none"><path d="M0 60H800M0 170H800M0 310H800M70 0V480M220 0V480M385 0V480M555 0V480M720 0V480"/></g>
  <g font-family="JetBrains Mono, monospace" font-size="10" fill="currentColor" fill-opacity=".55" letter-spacing="1.5">
    <text x="8" y="114">AVE 3</text><text x="8" y="214">AVE 7</text><text x="8" y="394">RIVERSIDE RD</text><text x="306" y="16">ST 12</text><text x="476" y="16">ST 18</text><text x="646" y="16">ST 24</text><text x="560" y="292">RIVER</text>
  </g>
  <path id="route" d="M140 400 H300 V220 H640 V120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px currentColor)"/>
  <path class="route-flow" d="M140 400 H300 V220 H640 V120" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="4 14" stroke-linecap="round"/>
  <g class="sweep"><path d="M640 120 L640 10 A110 110 0 0 1 717.8 42.2 Z" fill="url(#sw)"/></g>
  <circle class="ping" cx="640" cy="120" r="14" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle class="ping p2" cx="640" cy="120" r="14" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle class="ping p3" cx="640" cy="120" r="14" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <g class="pin"><path d="M640 106 L652 120 L640 134 L628 120 Z" fill="currentColor"/><circle cx="640" cy="120" r="3" fill="#fff"/></g>
  <g class="tag"><path d="M628 112 L600 84 H470" fill="none" stroke="currentColor" stroke-opacity=".8"/><text x="596" y="78" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="#fff" letter-spacing="1">ELECTRONICS MARKET</text><text x="596" y="100" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="currentColor" letter-spacing="1">2.4 KM · OPEN</text></g>
  <g class="you"><circle cx="140" cy="400" r="18" fill="currentColor" fill-opacity=".15"/><circle cx="140" cy="400" r="6" fill="#fff"/><text x="152" y="426" font-family="JetBrains Mono, monospace" font-size="10" fill="#fff" letter-spacing="1.5">YOU</text></g>
</svg>`;
}

export function nmeaLine() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0'), mm = String(now.getUTCMinutes()).padStart(2, '0'), ss = String(now.getUTCSeconds()).padStart(2, '0');
  const lat = (1045.6 + Math.random() * 0.09).toFixed(4), lon = (10640.0 + Math.random() * 0.09).toFixed(4);
  const kinds = [
    `$GPGGA,${hh}${mm}${ss}.00,${lat},N,${lon},E,1,07,0.9,12.${(Math.random() * 9) | 0},M,,,,*4${(Math.random() * 9) | 0}`,
    `$GPRMC,${hh}${mm}${ss}.00,A,${lat},N,${lon},E,0.${(Math.random() * 9) | 0},${(Math.random() * 360).toFixed(1)},181126,,,A*6${(Math.random() * 9) | 0}`,
    `$GPGSV,3,1,11,07,${(Math.random() * 80) | 0},${(Math.random() * 360) | 0},4${(Math.random() * 9) | 0},09,${(Math.random() * 80) | 0},${(Math.random() * 360) | 0},3${(Math.random() * 9) | 0}*7A`
  ];
  return kinds[(Math.random() * kinds.length) | 0];
}
