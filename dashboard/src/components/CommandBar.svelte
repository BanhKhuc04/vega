<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';

  let { store }: { store: AppStore } = $props();
  let text = $state('');

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (store.submit(text)) text = '';
  }
</script>

<form class="cmd" {onsubmit} aria-label="Thanh ra lệnh">
  <span class="prompt" aria-hidden="true">&gt;</span>
  <label for="cmd" class="sr">Ra lệnh cho VEGA</label>
  <input
    id="cmd"
    type="text"
    autocomplete="off"
    bind:value={text}
    placeholder="ra lệnh cho VEGA… vd: nghiên cứu cảm biến CO₂, tắt đèn, sao CI lỗi?"
  />
  <button type="button" class="btn mic" disabled aria-label="Nói bằng giọng — có ở Phase 6" title="Có ở Phase 6">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>
  </button>
  <button type="submit" class="btn primary" style="letter-spacing:.14em;font-size:12px;padding:0 16px">Gửi</button>
</form>
