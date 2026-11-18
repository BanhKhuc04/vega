<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import { fmtAgo, fmtClock } from '../lib/format';

  let { store }: { store: AppStore } = $props();
</script>

<main class="hist fin" data-testid="view-history">
  <div class="rs-head">
    <h1>Lịch sử lệnh</h1>
    <span class="eyebrow">{store.snap.history.length} lệnh{#if store.snap.isMock} <span class="tag">· dữ liệu mẫu</span>{/if}</span>
  </div>
  {#if store.snap.history.length === 0}
    <div class="empty">Chưa có lệnh nào. Gõ một lệnh ở thanh bên dưới.</div>
  {:else}
    <ul>
      {#each store.snap.history as h (h.id)}
        <li>
          <button type="button" class="hist-item" data-testid="history-item" onclick={() => store.openHistory(h)}>
            <span class="meta"><span>{h.id}</span><span>{fmtClock(h.ts)}</span><span>{fmtAgo(store.now - h.ts)}</span></span>
            <span class="txt">{h.text}</span>
            <span class="res">{h.result}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</main>
