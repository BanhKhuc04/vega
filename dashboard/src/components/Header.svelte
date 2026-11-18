<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import type { Mode } from '../lib/types';

  let { store }: { store: AppStore } = $props();

  const items: { mode: Mode; label: string }[] = [
    { mode: 'idle', label: 'Chờ' },
    { mode: 'research', label: 'Nghiên cứu' },
    { mode: 'focus', label: 'Tập trung' },
    { mode: 'history', label: 'Lịch sử' },
  ];

  const offline = $derived(store.snap.connection !== 'connected');
  const statusText = $derived.by(() => {
    const c = store.snap.connection;
    if (c === 'disconnected') return 'mất kết nối · đang thử lại';
    if (c === 'connecting') return 'đang kết nối…';
    if (store.view === 'core') return 'xem trước lõi tròn';
    switch (store.mode) {
      case 'idle':
        return 'hệ thống ổn · đang chờ';
      case 'research': {
        const s = store.session;
        return s ? `đang nghiên cứu · ${s.stepNo}/${s.stepCount}` : 'đang nghiên cứu';
      }
      case 'focus':
        return 'chế độ tập trung';
      default:
        return 'lịch sử lệnh';
    }
  });
</script>

<header class="hdr">
  <div class="hdr-left">
    <span class="brand flick">VEGA</span>
    <span class="tag">// v0.1 · raspberry pi 3</span>
    <span class="status" class:bad={offline} role="status">
      <i class:tw={!offline}></i>{statusText}
    </span>
    {#if store.snap.isMock}
      <span class="warn" data-testid="mock-badge">dữ liệu mẫu</span>
    {/if}
  </div>
  <nav class="nav" aria-label="Chế độ hiển thị">
    {#each items as it (it.mode)}
      <button
        type="button"
        class="btn"
        aria-pressed={store.view === 'main' && store.mode === it.mode}
        onclick={() => {
          if (location.hash.startsWith('#/core')) history.replaceState(null, '', location.pathname + location.search);
          store.view = 'main';
          store.go(it.mode);
        }}>{it.label}</button
      >
    {/each}
    <a class="btn" href="#/core" aria-current={store.view === 'core' ? 'page' : undefined}>Lõi tròn</a>
    <button
      type="button"
      class="btn lite-switch"
      aria-pressed={store.lite}
      title="Chế độ Lite: tắt blur, bóng sáng động, hạt sáng; chỉ giữ 2 vòng xoay"
      onclick={() => store.toggleLite()}>Lite {store.lite ? 'bật' : 'tắt'}</button
    >
  </nav>
</header>
