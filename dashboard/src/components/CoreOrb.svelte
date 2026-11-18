<script lang="ts">
  import type { CoreState } from '../lib/types';

  // Reference rendering of the 240x240 round screen (GC9A01). Everything is relative to the
  // screen size, so the same markup works at 240px (true size) and in the 6-up gallery.
  let { state, size = 240 }: { state: CoreState; size?: number } = $props();
  const u = $derived(size / 240);
</script>

<div class="core-screen" data-testid="core-screen" data-state={state} style="width:{size}px;height:{size}px;--u:{u}">
  {#if state === 'idle'}
    <div class="abs spin-c" style="left:6%;top:6%;width:88%;height:88%;border:1px dashed rgba(79,195,255,.3)"></div>
    <div class="abs spin-a" style="left:18%;top:18%;width:64%;height:64%;border:3px solid transparent;border-top-color:#4fc3ff;border-bottom-color:#4fc3ff;filter:drop-shadow(0 0 6px #4fc3ff)"></div>
    <div class="abs breathe" style="left:33%;top:33%;width:34%;height:34%;border:2px solid #4fc3ff;background:radial-gradient(circle,rgba(79,195,255,.3),rgba(2,4,10,.95) 70%)"></div>
  {:else if state === 'listening'}
    {#each [0, 0.6, 1.2] as d (d)}
      <div class="abs ping" style="left:25%;top:25%;width:50%;height:50%;border:2px solid #4fc3ff;animation-delay:{d}s;animation-duration:1.8s"></div>
    {/each}
    <div class="abs" style="left:30%;top:30%;width:40%;height:40%;border:3px solid #9fd6ff;background:rgba(79,195,255,.22);box-shadow:0 0 36px rgba(79,195,255,.9);display:flex;align-items:center;justify-content:center;gap:calc(4px*var(--u))">
      {#each [0, 0.15, 0.3, 0.45, 0.6] as d (d)}
        <span class="eq" style="width:calc(4px*var(--u));height:calc(26px*var(--u));background:#f2f8ff;animation-delay:{d}s"></span>
      {/each}
    </div>
  {:else if state === 'thinking'}
    <div class="abs" style="left:14%;top:14%;width:72%;height:72%;border:3px solid transparent;border-top-color:#4fc3ff;filter:drop-shadow(0 0 8px #4fc3ff);animation:spin 1.6s linear infinite"></div>
    <div class="abs" style="left:22%;top:22%;width:56%;height:56%;border:2px solid transparent;border-left-color:#2f8bff;border-right-color:#2f8bff;animation:spin 2.4s linear infinite reverse"></div>
    <div class="abs" style="left:36%;top:36%;width:28%;height:28%;border:2px solid rgba(79,195,255,.6);background:rgba(79,195,255,.12);display:flex;align-items:center;justify-content:center;gap:calc(4px*var(--u))">
      {#each [0, 0.3, 0.6] as d (d)}
        <span class="tw" style="width:calc(5px*var(--u));height:calc(5px*var(--u));border-radius:50%;background:#bfe6ff;animation-delay:{d}s"></span>
      {/each}
    </div>
  {:else if state === 'speaking'}
    <div class="abs spin-a" style="left:12%;top:12%;width:76%;height:76%;border:2px solid transparent;border-top-color:rgba(79,195,255,.6);border-bottom-color:rgba(79,195,255,.6)"></div>
    <div class="abs breathe" style="left:24%;top:24%;width:52%;height:52%;border:2px solid #4fc3ff;background:radial-gradient(circle,rgba(79,195,255,.35),rgba(2,4,10,.95) 72%);display:flex;align-items:center;justify-content:center;gap:calc(5px*var(--u))">
      {#each [0.7, 0.5, 0.8, 0.6, 0.75] as dur, i (i)}
        <span class="eq" style="width:calc(5px*var(--u));height:calc(44px*var(--u));background:{i === 2 ? '#f2f8ff' : '#4fc3ff'};animation-duration:{dur}s;animation-delay:{(i * 0.07).toFixed(2)}s"></span>
      {/each}
    </div>
  {:else if state === 'alert'}
    <div class="abs" style="left:12%;top:12%;width:76%;height:76%;background:repeating-conic-gradient(#ffc266 0deg 8deg,transparent 8deg 20deg);-webkit-mask:radial-gradient(circle,transparent 64%,#000 65%,#000 70%,transparent 71%);mask:radial-gradient(circle,transparent 64%,#000 65%,#000 70%,transparent 71%);animation:spin 6s linear infinite"></div>
    <div class="abs flick" style="left:30%;top:30%;width:40%;height:40%;border:3px solid #ff7a90;background:rgba(255,122,144,.16);box-shadow:0 0 34px rgba(255,122,144,.75);display:flex;align-items:center;justify-content:center;animation-duration:2.2s">
      <span class="display" style="font-weight:700;font-size:calc(38px*var(--u));color:#ffe1e6">!</span>
    </div>
  {:else}
    <div class="abs" style="left:18%;top:18%;width:64%;height:64%;border:1px solid rgba(79,195,255,.18)"></div>
    <div class="abs" style="left:34%;top:34%;width:32%;height:32%;border:2px solid rgba(79,195,255,.35);background:rgba(79,195,255,.05)"></div>
    <span class="drift display" style="position:absolute;left:60%;top:30%;font-weight:600;font-size:calc(16px*var(--u));color:rgba(159,214,255,.7)">z</span>
    <span class="drift display" style="position:absolute;left:66%;top:24%;font-weight:600;font-size:calc(12px*var(--u));color:rgba(159,214,255,.7);animation-delay:1.2s">z</span>
  {/if}
</div>
