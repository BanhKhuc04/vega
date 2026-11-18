<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import Co2Chart from './Co2Chart.svelte';
  import { peak } from '../lib/co2';
  import { fmtInt, pad2 } from '../lib/format';

  let { store }: { store: AppStore } = $props();
  const co2 = $derived(store.snap.co2);
  const pk = $derived(co2 ? peak(co2) : null);
</script>

<main class="focus" data-testid="view-focus">
  <div class="focus-bg" aria-hidden="true">
    <div style="height:180px"><i style="height:80%"></i><i style="height:55%"></i><i style="height:30%"></i></div>
    <div style="height:120px;margin-top:60px"></div>
    <div style="height:220px"><i style="height:40%"></i><i style="height:70%"></i><i style="height:90%"></i><i style="height:50%"></i></div>
    <div style="height:160px;margin-top:30px"></div>
    <div style="height:140px"><i style="height:60%"></i><i style="height:35%"></i></div>
  </div>
  <section class="focus-card fp zin" aria-label="Biểu đồ CO₂ mở rộng">
    <span class="sweep" style="animation-delay:.2s"></span>
    <div class="row-between">
      <span class="eyebrow">Chart // CO₂ trong phòng · 24 giờ qua{#if store.snap.isMock} <span class="tag">· dữ liệu mẫu</span>{/if}</span>
      <button type="button" class="btn close" aria-label="Đóng chế độ tập trung" onclick={() => store.dispatch({ type: 'close' })}>×</button>
    </div>
    {#if co2}
      <div style="display:flex;gap:10px">
        <div class="axis" aria-hidden="true"><span>1.500</span><span>1.000</span><span>500</span><span>0</span></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
          <Co2Chart series={co2} size="lg" />
          <div class="xaxis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        </div>
      </div>
      {#if pk}
        <p class="note-text" data-testid="focus-peak">
          Đỉnh <strong class="warn">{fmtInt(pk.ppm)} ppm lúc {pad2(pk.hour)}:00</strong> khi đóng cửa ngủ. Gợi ý: mở hé cửa sổ hoặc hẹn giờ quạt hút trước khi ngủ.
        </p>
      {/if}
    {:else}
      <div class="empty">Chưa có dữ liệu CO₂</div>
    {/if}
    <div class="actions">
      <button type="button" class="btn primary" disabled title="Có ở phase sau">Tạo luật tự động</button>
      <button type="button" class="btn" disabled title="Có ở phase sau">Lưu vào ghi chú</button>
    </div>
  </section>
</main>
