// Subtle code rain drawn on a 2D canvas behind the HUD.
const GLYPHS = '01ABCDEF<>/{}[]=+*#$%&ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ';
const WORDS = ['mqtt', 'esp32', 'vega', 'ok', 'ack', '0x3F', 'tx', 'rx', 'sync', 'ping'];

export function createRain(canvas) {
  const ctx = canvas.getContext('2d');
  let cols = [], W = 0, H = 0, step = 16, acc = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    step = W < 700 ? 14 : 16;
    const n = Math.ceil(W / step);
    cols = Array.from({ length: n }, () => ({ y: Math.random() * -H, v: 40 + Math.random() * 120, word: null, wi: 0 }));
    ctx.clearRect(0, 0, W, H);
  }
  function draw(dt, color, density) {
    acc += dt;
    if (acc < 1 / 30) return;
    const d = acc; acc = 0;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${step - 4}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (Math.random() > density) { c.y += c.v * d * 0.3; continue; }
      c.y += c.v * d;
      if (c.y > H + 40) { c.y = Math.random() * -200; c.v = 40 + Math.random() * 120; c.word = Math.random() < 0.08 ? WORDS[(Math.random() * WORDS.length) | 0] : null; c.wi = 0; }
      let ch;
      if (c.word) { ch = c.word[c.wi % c.word.length]; c.wi++; } else ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      ctx.fillStyle = Math.random() < 0.06 ? '#ffffff' : color;
      ctx.fillText(ch, i * step + step / 2, c.y);
    }
  }
  return { resize, draw };
}
