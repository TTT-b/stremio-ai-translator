/** Tailwind is built locally (npm run build:css); the config page loads no external CSS. */
export default {
  content: ['./src/web/html.ts'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
