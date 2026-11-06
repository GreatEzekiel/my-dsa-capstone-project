// Asks the server's own /health and shows the answer. Plain JavaScript: no build step, no library.
const dot = document.getElementById('dot');
const text = document.getElementById('status-text');

fetch('/health')
  .then((response) => response.json())
  .then((data) => {
    const ok = data.status === 'ok';
    dot.className = ok ? 'dot ok' : 'dot down';
    text.textContent = ok ? 'Health check: ok' : 'Health check: not ok';
  })
  .catch(() => {
    dot.className = 'dot down';
    text.textContent = 'Could not reach /health';
  });
