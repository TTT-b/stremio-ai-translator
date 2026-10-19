/** Tailwind is built locally (npm run build:css); the config page loads no external CSS. */
export default {
  content: ['./src/web/html.ts'],
  darkMode: 'class',
  theme: {
    extend: {
      // Warm dark palette of the "Focus" design (1B): canvas, surface, line, text, muted, accent.
      colors: {
        warm: {
          bg: '#15120e',
          sf: '#1e1a15',
          ln: '#352e25',
          tx: '#f3ece1',
          mu: '#a3998c',
          ac: '#e8b25c',
          on: '#1a1408',
          ok: '#4cc38a',
        },
      },
    },
  },
  plugins: [],
};
