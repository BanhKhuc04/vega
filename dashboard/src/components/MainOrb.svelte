<script lang="ts">
  let { lite }: { lite: boolean } = $props();

  // Golden-angle particle ring from the design (18 sparks). Not rendered in Lite mode.
  const particles = Array.from({ length: 18 }, (_, i) => {
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 36 + (i % 5) * 3;
    const s = 2 + (i % 3);
    return {
      x: 50 + r * Math.cos(a),
      y: 50 + r * Math.sin(a),
      s,
      delay: (i * 0.37) % 2.6,
    };
  });
</script>

<div class="orb" role="img" aria-label="Lõi VEGA đang ở trạng thái chờ" data-testid="main-orb">
  <div aria-hidden="true" class="abs" style="left:0;right:0;top:50%;height:1px;border-radius:0;background:linear-gradient(90deg,transparent,rgba(79,195,255,.35),transparent)"></div>
  <div aria-hidden="true" class="abs" style="top:0;bottom:0;left:50%;width:1px;border-radius:0;background:linear-gradient(180deg,transparent,rgba(79,195,255,.35),transparent)"></div>
  {#if !lite}
    <div class="abs spin-c" style="left:4%;top:4%;width:92%;height:92%;border:1px dashed rgba(79,195,255,.28)"></div>
  {/if}
  <div class="abs spin-b" style="left:10%;top:10%;width:80%;height:80%;background:repeating-conic-gradient(rgba(159,214,255,.7) 0deg 1deg,transparent 1deg 6deg);-webkit-mask:radial-gradient(circle,transparent 64%,#000 65%,#000 69%,transparent 70%);mask:radial-gradient(circle,transparent 64%,#000 65%,#000 69%,transparent 70%)"></div>
  <div class="abs spin-a" style="left:15%;top:15%;width:70%;height:70%;border:3px solid transparent;border-top-color:#4fc3ff;border-bottom-color:#4fc3ff;filter:drop-shadow(0 0 8px #4fc3ff)"></div>
  {#if !lite}
    <div class="abs spin-b" style="left:19%;top:19%;width:62%;height:62%;border:2px solid transparent;border-right-color:#2f8bff;border-left-color:rgba(47,139,255,.35);filter:drop-shadow(0 0 6px #2f8bff)"></div>
    <div class="abs ping" style="left:31%;top:31%;width:38%;height:38%;border:1px solid rgba(79,195,255,.6)"></div>
  {/if}
  <div class="abs breathe" style="left:31%;top:31%;width:38%;height:38%;border:3px solid #4fc3ff;background:radial-gradient(circle,rgba(79,195,255,.28),rgba(5,7,13,.92) 70%);display:flex;align-items:center;justify-content:center">
    <span class="flick display" style="font-weight:700;font-size:32px;letter-spacing:.3em;margin-right:-.3em;color:#f2f8ff;text-shadow:0 0 18px #4fc3ff,0 0 4px #fff">VEGA</span>
  </div>
  {#if !lite}
    {#each particles as p, i (i)}
      <span class="tw" data-testid="particle" style="position:absolute;left:{p.x.toFixed(2)}%;top:{p.y.toFixed(2)}%;width:{p.s}px;height:{p.s}px;border-radius:50%;background:#bfe6ff;box-shadow:0 0 6px #4fc3ff;animation-delay:{p.delay.toFixed(2)}s"></span>
    {/each}
  {/if}
  <span class="orb-label" style="top:0;left:50%;transform:translateX(-50%)">000</span>
  <span class="orb-label" style="right:0;top:50%;transform:translateY(-140%)">090</span>
  <span class="orb-label" style="bottom:0;left:50%;transform:translateX(-50%)">180</span>
  <span class="orb-label" style="left:0;top:50%;transform:translateY(-140%)">270</span>
</div>
