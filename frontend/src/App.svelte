<script lang="ts">
  type AppInfo = { name: string; version: string };

  let info: AppInfo = { name: 'KeyboarDeer', version: 'starting…' };
  let loadError = '';

  async function loadInfo() {
    try {
      const module = await import('../wailsjs/go/main/App');
      info = await module.Info();
    } catch {
      // Browser development keeps a useful shell even when Wails bindings are absent.
      info = { name: 'KeyboarDeer', version: 'browser development' };
      loadError = 'Desktop bindings are unavailable in this browser preview.';
    }
  }

  loadInfo();
</script>

<svelte:head><title>{info.name}</title></svelte:head>

<div class="app-shell">
  <header>
    <div class="brand">
      <img src="/appicon.png" alt="" width="48" height="48" />
      <span><strong>KeyboarDeer</strong><small>A LITTLE WILD. A LITTLE WIRED.</small></span>
    </div>
    <span class="phase">FOUNDATION · {info.version}</span>
  </header>

  <main>
    <p class="eyebrow">DESKTOP APP FOUNDATION</p>
    <h1>Your keyboard, second nature.</h1>
    <p class="lede">
      The desktop shell is ready. Connection, device inventory, and identification arrive in the next milestones.
    </p>

    <section aria-labelledby="manager-title" class="status-card">
      <div class="status-mark" aria-hidden="true">○</div>
      <div>
        <h2 id="manager-title">Manager connection is not configured yet.</h2>
        <p>This build does not access devices, input paths, KMonad, or manager-private files.</p>
      </div>
    </section>

    <section aria-label="Unavailable workspace controls" class="next-card">
      <div>
        <p class="eyebrow">COMING NEXT</p>
        <h2>Keyboard inventory</h2>
        <p>Once the manager bridge is connected, available keyboards will appear here.</p>
      </div>
      <button disabled title="Device inventory is not implemented yet">Find keyboards</button>
    </section>

    {#if loadError}<p class="development-note" role="status">{loadError}</p>{/if}
  </main>

  <footer>
    The manager remains responsible for device access, validation, and KMonad supervision.
  </footer>
</div>
