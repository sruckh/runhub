<script lang="ts">
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign in — RHUB</title>
</svelte:head>

<div class="page">
  <div class="card">
    <div class="logo-wrap">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <rect width="36" height="36" rx="10" fill="#2563eb"/>
        <path d="M10 26V10h9.5a6 6 0 0 1 0 12H10M19.5 22l5.5 4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="logo-text">RHUB</span>
    </div>

    <h1>Sign in</h1>
    <p class="subtitle">Enter your password to continue</p>

    <form method="POST" onsubmit={() => (loading = true)}>
      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          required
          autofocus
        />
      </div>

      {#if form?.error}
        <p class="error" role="alert">{form.error}</p>
      {/if}

      <button type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  </div>
</div>

<style>
  :global(:root) {
    --color-bg: #f7faff;
    --color-bg-accent: #ecf4ff;
    --color-surface: #fbfdff;
    --color-outline: #d8e1ec;
    --color-text: #172033;
    --color-text-muted: #5c6b80;
    --color-primary: #2563eb;
    --color-primary-hover: #1d4ed8;
    --color-danger: #dc2626;
    --color-danger-soft: #fee8e8;
    --radius-md: 12px;
    --radius-sm: 8px;
    --elevation-2: 0 10px 28px rgba(15, 23, 42, 0.09);
    --transition-fast: 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  :global(*, *::before, *::after) { box-sizing: border-box; }

  :global(body) {
    margin: 0;
    font-family: 'Inter', system-ui, sans-serif;
    background:
      radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 28%),
      radial-gradient(circle at top right, rgba(15, 118, 110, 0.14), transparent 24%),
      linear-gradient(180deg, var(--color-bg-accent) 0%, var(--color-bg) 32%, var(--color-bg) 100%);
    color: var(--color-text);
    min-height: 100dvh;
  }

  .page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-md);
    box-shadow: var(--elevation-2);
    padding: 2.5rem 2rem;
    width: 100%;
    max-width: 380px;
  }

  .logo-wrap {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1.5rem;
  }

  .logo-text {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .subtitle {
    margin: 0 0 1.75rem;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
  }

  label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.01em;
  }

  input[type="password"] {
    width: 100%;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--color-outline);
    border-radius: var(--radius-sm);
    font-size: 1rem;
    background: #fff;
    color: var(--color-text);
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  input[type="password"]:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
  }

  .error {
    margin: 0 0 0.75rem;
    padding: 0.55rem 0.85rem;
    background: var(--color-danger-soft);
    border: 1px solid #fca5a5;
    border-radius: var(--radius-sm);
    color: var(--color-danger);
    font-size: 0.85rem;
  }

  button[type="submit"] {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.7rem 1rem;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast), opacity var(--transition-fast);
    min-height: 44px;
  }

  button[type="submit"]:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  button[type="submit"]:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
</style>
