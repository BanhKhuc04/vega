<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import CoreOrb from './CoreOrb.svelte';
  import { CORE_STATES } from '../lib/types';
  import type { CoreState } from '../lib/types';

  let { store }: { store: AppStore } = $props();

  const INFO: Record<CoreState, { n: string; label: string; desc: string }> = {
    idle: { n: '01', label: 'Chờ', desc: 'Vòng xoay chậm, lõi “thở” đều' },
    listening: { n: '02', label: 'Đang nghe', desc: 'Sau câu “Hey Vega”, sóng lan theo giọng' },
    thinking: { n: '03', label: 'Đang nghĩ', desc: 'Vòng quay nhanh khi chờ AI trả lời' },
    speaking: { n: '04', label: 'Đang nói', desc: 'Cột sóng nhảy theo giọng đọc' },
    alert: { n: '05', label: 'Cảnh báo', desc: 'CI lỗi, thiết bị offline, CO₂ quá cao' },
    sleep: { n: '06', label: 'Ngủ', desc: 'Sau 23:00 hoặc phòng tối, gần như tắt' },
  };

  let selected = $state<CoreState>('idle');
</script>

<main class="core-page" data-testid="view-core">
  <div>
    <span class="eyebrow">Thiết bị // vega desk core</span>
    <h1>Lõi VEGA trên bàn: màn tròn 240×240, sáu trạng thái</h1>
    <p class="copy" style="max-width:720px">
      Bản xem trước làm mẫu tham chiếu cho firmware LVGL (ESP32-S3 + GC9A01). Trạng thái thật đến từ MQTT topic
      <span style="color:var(--cyan)">vega/desk/core/state</span>; hiện tại: <strong data-testid="live-core">{INFO[store.snap.core].label}</strong>.
    </p>
  </div>

  <div class="core-main">
    <div class="core-device">
      <CoreOrb state={selected} size={240} />
      <div class="chips" role="group" aria-label="Chọn trạng thái lõi">
        {#each CORE_STATES as st (st)}
          <button type="button" class="btn" aria-pressed={selected === st} onclick={() => (selected = st)}>{INFO[st].label}</button>
        {/each}
      </div>
      <span class="eyebrow" data-testid="core-selected">{INFO[selected].n} · {INFO[selected].label}</span>
    </div>

    <div class="core-grid">
      {#each CORE_STATES as st (st)}
        <section class="core-cell" aria-label="Trạng thái {INFO[st].label}">
          <div role="img" aria-label="Trạng thái {INFO[st].label}"><CoreOrb state={st} size={150} /></div>
          <h2 style:color={st === 'alert' ? '#ffc2cc' : undefined}>{INFO[st].n} · {INFO[st].label}</h2>
          <p>{INFO[st].desc}</p>
        </section>
      {/each}
    </div>
  </div>
</main>
