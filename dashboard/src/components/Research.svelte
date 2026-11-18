<script lang="ts">
  import type { AppStore } from '../lib/app.svelte';
  import Co2Chart from './Co2Chart.svelte';
  import { hoursOver } from '../lib/co2';
  import { fmtInt } from '../lib/format';

  let { store }: { store: AppStore } = $props();
  const s = $derived(store.session);
  const co2 = $derived(store.snap.co2);
  const mock = $derived(store.snap.isMock);
  const toneClass = { good: 'good', warn: 'warn', plain: '' } as const;
</script>

<main class="rs" data-testid="view-research">
  {#if !s}
    <div class="empty">Chưa có phiên nghiên cứu nào. Gõ một lệnh ở thanh bên dưới, ví dụ “nghiên cứu cảm biến CO₂”.</div>
  {:else}
    <div class="rs-head fin">
      <h1>{s.title}</h1>
      <span class="eyebrow">bước {s.stepNo}/{s.stepCount} · {s.phase}<span class="caret">▍</span></span>
    </div>
    <div class="grid">
      <section class="panel fp pin" style="animation-delay:.05s" aria-label="Số nguồn đã đọc">
        <span class="sweep" style="animation-delay:.05s"></span>
        <span class="eyebrow">Stat // nguồn đã đọc</span>
        <span class="big">{s.sources}</span>
        <span class="copy">{s.sourcesDesc}</span>
        <span class="small">{s.ref}{mock ? ' · dữ liệu mẫu' : ''}</span>
      </section>

      <section class="panel fp pin" style="animation-delay:.18s" aria-label="Biểu đồ CO₂">
        <span class="sweep" style="animation-delay:.18s"></span>
        <div class="chart-head"><span class="eyebrow">Chart // CO₂ trong phòng · 24h</span>{#if mock}<span class="tag">dữ liệu mẫu</span>{/if}</div>
        {#if co2}
          <Co2Chart series={co2} size="sm" />
          <div class="row-between">
            <span class="copy">Vượt ngưỡng {fmtInt(co2.thresholdPpm)} ppm trong {hoursOver(co2)} giờ</span>
            <button type="button" class="btn" onclick={() => store.dispatch({ type: 'expand' })}>Mở rộng ⤢</button>
          </div>
        {:else}
          <div class="empty">Chưa có dữ liệu CO₂</div>
        {/if}
      </section>

      <section class="panel fp pin" style="animation-delay:.31s" aria-label="Tiến trình">
        <span class="sweep" style="animation-delay:.31s"></span>
        <span class="eyebrow">Process // tiến trình</span>
        <div class="steps">
          {#each s.steps as st, i (i)}
            <div class="step {st.state}">
              <span class:tw={st.state === 'active'}>{st.state === 'done' ? '[✓]' : st.state === 'active' ? '[●]' : '[ ]'}</span>
              <span>{st.label}{st.detail ? ` · ${st.detail}` : ''}</span>
            </div>
            {#if st.state === 'active' && st.progress !== undefined}
              <div class="progress"><div style="width:{(st.progress * 100).toFixed(0)}%"></div></div>
            {/if}
          {/each}
        </div>
      </section>

      <section class="panel fp pin" style="animation-delay:.44s" aria-label="Nguồn">
        <span class="sweep" style="animation-delay:.44s"></span>
        <span class="eyebrow">Source // datasheet</span>
        <div class="ph" aria-hidden="true">[ ẢNH TỪ NGUỒN ]</div>
        <span class="cap">{s.sourceCaption}</span>
      </section>

      <section class="panel fp pin" style="animation-delay:.57s" aria-label="So sánh">
        <span class="sweep" style="animation-delay:.57s"></span>
        <span class="eyebrow">Compare // {s.compare.title}</span>
        <div class="table-wrap" data-testid="compare-wrap">
          <table>
            <thead><tr>{#each s.compare.columns as c, i (i)}<th scope="col">{c}</th>{/each}</tr></thead>
            <tbody>
              {#each s.compare.rows as r, i (i)}
                <tr>
                  <td class="lab">{r.label}</td>
                  {#each r.cells as c, j (j)}<td class={toneClass[c.tone]}>{c.text}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel fp pin" style="animation-delay:.7s" aria-label="Kết luận sơ bộ">
        <span class="sweep" style="animation-delay:.7s"></span>
        <span class="eyebrow">Note // kết luận sơ bộ</span>
        <p class="note-text">{s.note}</p>
        <span class="small">{s.noteRefs}</span>
      </section>
    </div>

    <div class="working fin">
      <span class="eyebrow">VEGA đang nghiên cứu…</span>
      <div aria-hidden="true" style="position:relative;width:64px;height:64px">
        <div class="abs spin-d" style="inset:0;border:2px solid transparent;border-top-color:#4fc3ff;border-left-color:#4fc3ff;filter:drop-shadow(0 0 6px #4fc3ff)"></div>
        <div class="abs breathe" style="left:16px;top:16px;width:32px;height:32px;border:2px solid #4fc3ff;background:rgba(79,195,255,.18)"></div>
      </div>
    </div>
  {/if}
</main>
