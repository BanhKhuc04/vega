<script lang="ts">
  import { onMount } from 'svelte';
  import { AppStore } from './lib/app.svelte';
  import type { VegaDataSource } from './lib/types';
  import Header from './components/Header.svelte';
  import Idle from './components/Idle.svelte';
  import Research from './components/Research.svelte';
  import Focus from './components/Focus.svelte';
  import History from './components/History.svelte';
  import CommandBar from './components/CommandBar.svelte';
  import CorePreview from './components/CorePreview.svelte';

  let { source }: { source: VegaDataSource } = $props();
  // The data source is chosen once at startup (VITE_DATA_SOURCE); it is not expected to change.
  // svelte-ignore state_referenced_locally
  const store = new AppStore(source);

  onMount(() => store.start());

  $effect(() => {
    if (store.lite) document.documentElement.setAttribute('data-lite', '');
    else document.documentElement.removeAttribute('data-lite');
  });
</script>

<div class="shell">
  <Header {store} />
  {#if store.view === 'core'}
    <CorePreview {store} />
  {:else}
    {#if store.mode === 'idle'}
      <Idle {store} />
    {:else if store.mode === 'research'}
      <Research {store} />
    {:else if store.mode === 'focus'}
      <Focus {store} />
    {:else}
      <History {store} />
    {/if}
    <CommandBar {store} />
  {/if}
</div>
