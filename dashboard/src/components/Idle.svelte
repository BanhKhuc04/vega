<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import MainOrb from './MainOrb.svelte';
  import { fmtAgo, fmtClock, fmtInt, fmtRemaining, fmtTemp } from '../lib/format';
  import { DEVICE_KINDS } from '../lib/types';

  let { store }: { store: AppStore } = $props();

  const s = $derived(store.snap);
  const threshold = $derived(s.co2?.thresholdPpm ?? 1000);
  const online = $derived(s.devices.filter((d) => d.online).length);
  const offlineIds = $derived(s.devices.filter((d) => !d.online).map((d) => d.id));
  const kinds = $derived(
    DEVICE_KINDS.map((k) => ({ k, n: s.devices.filter((d) => d.kind === k).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.k} ×${x.n}`)
      .join(' · '),
  );
</script>

<main class="idle fin" data-testid="view-idle">
  <div class="stats">
    <section class="stat tl" aria-label="Môi trường phòng">
      <span>{s.env?.roomName ?? 'Môi trường'}</span>
      {#if s.env}
        <b>{s.env.tempC === null ? '—' : fmtTemp(s.env.tempC)}°C · {s.env.humidity === null ? '—' : Math.round(s.env.humidity)}%</b>
        {#if s.env.co2Ppm !== null}
          <span class:warn={s.env.co2Ppm > threshold}>CO₂ {fmtInt(s.env.co2Ppm)} ppm{s.env.co2Ppm > threshold ? ' ▲' : ''}</span>
        {:else}
          <span>CO₂ —</span>
        {/if}
      {:else}
        <b>—</b><span>chưa có dữ liệu</span>
      {/if}
    </section>
    <section class="stat tr" aria-label="Mạng thiết bị">
      <span>Mạng thiết bị</span>
      <b>MQTT {online}/{s.devices.length}</b>
      <span>{kinds || 'chưa có thiết bị'}</span>
      {#if offlineIds.length}<span class="bad" data-testid="offline-list">offline: {offlineIds.join(', ')}</span>{/if}
    </section>
    <section class="stat bl" aria-label="CI/CD">
      <span>CI/CD</span>
      {#if s.ci}
        <b class={s.ci.failed > 0 ? 'bad' : 'good'}>{s.ci.failed > 0 ? `${s.ci.failed} lỗi build` : 'build ổn'}</b>
        <span>{s.ci.repo} · {fmtAgo(store.now - s.ci.ts)}</span>
      {:else}
        <b>—</b><span>chưa có dữ liệu</span>
      {/if}
    </section>
    <section class="stat br" aria-label="Sự kiện kế tiếp">
      <span>Kế tiếp</span>
      {#if s.next}
        <b>{fmtClock(s.next.at)} {s.next.title}</b>
        <span>{fmtRemaining(s.next.at - store.now)}</span>
      {:else}
        <b>—</b><span>không có lịch</span>
      {/if}
    </section>
  </div>

  <MainOrb lite={store.lite} />

  <p class="ready">Sẵn sàng · nói “Hey Vega” hoặc gõ lệnh bên dưới</p>
</main>
