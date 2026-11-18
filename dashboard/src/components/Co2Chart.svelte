<script lang="ts">
  import { barModel, peak, thresholdPct } from '../lib/co2';
  import { fmtInt, pad2 } from '../lib/format';
  import type { Co2Series } from '../lib/types';

  let { series, size }: { series: Co2Series; size: 'sm' | 'lg' } = $props();

  const bars = $derived(barModel(series));
  const thr = $derived(thresholdPct(series));
  const pk = $derived(peak(series));
  const glow = $derived(size === 'lg' ? 6 : 0);
</script>

<div
  class="chart {size}"
  role="img"
  data-testid="co2-chart-{size}"
  aria-label="Biểu đồ CO₂ 24 giờ{pk ? `, đỉnh ${fmtInt(pk.ppm)} ppm lúc ${pad2(pk.hour)}:00` : ''}, ngưỡng ${fmtInt(series.thresholdPpm)} ppm"
>
  <div class="thr" data-testid="co2-threshold" style="bottom:{thr.toFixed(2)}%"></div>
  {#if size === 'lg'}
    <span class="thr-label" style="bottom:calc({thr.toFixed(2)}% + 6px)">Ngưỡng {fmtInt(series.thresholdPpm)} ppm</span>
  {/if}
  {#each bars as b (b.hour)}
    <div
      class="col bar"
      data-testid="co2-bar"
      data-hour={b.hour}
      data-ppm={b.ppm}
      data-over={b.over}
      title="{pad2(b.hour)}:00 · {fmtInt(b.ppm)} ppm"
      style="height:{b.heightPct.toFixed(1)}%;background:{b.over ? '#ffc266' : '#f2f8ff'};box-shadow:0 0 {glow}px rgba(159,214,255,.35);animation-delay:{(0.25 + b.hour * 0.03).toFixed(2)}s"
    ></div>
  {/each}
</div>
