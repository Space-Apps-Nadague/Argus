/** @type {import('tailwindcss').Config} */
// Design tokens: specs/02-ui-dashboard.md §4 + AGENTS.md §3 visual language.
// Add new colors/fonts here (design-system skill), never as raw hex in components.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['Orbitron', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        hud: {
          bg: '#020617',      // slate-950 canvas
          panel: '#0f172a',   // slate-900 surfaces
          line: '#1e293b',    // slate-800 borders
          text: '#f1f5f9',    // slate-100
          muted: '#94a3b8',   // slate-400 (≥ 4.5:1 on panel)
          accent: '#22d3ee',  // cyan-400 primary
          drift: '#a78bfa',   // violet-400: personal-baseline drift & links only
        },
        status: {
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
        },
        // Cognition games: categorical stimulus palette (specs/02-ui-dashboard.md §2.8). Not status colors.
        game: {
          1: '#22d3ee',
          2: '#f472b6',
          3: '#a3e635',
          4: '#fb923c',
          5: '#a78bfa',
          6: '#facc15',
        },
        argus: {
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
        },
      },
    },
  },
  plugins: [],
};
