// vite.config.js: configures Vite, the dev server and bundler for the React UI.
// `npm run dev` starts it with instant reload; `npm run build` makes the production files in dist/.

// `defineConfig` from vitest/config is the same as Vite's, but it also understands the `test` section.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react'; // lets Vite understand JSX and enables React fast refresh
import tailwindcss from '@tailwindcss/vite'; // Tailwind v4 plugin: generates only the CSS classes the code uses

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom', // a fake browser inside Node, so React can render and be clicked in tests
    include: ['test/ui/**/*.test.jsx'], // only UI tests; the domain tests use node:test instead
  },
});
