/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy player palette (used by DebugControls).
        vis: {
          red: '#c73e3e',
          blue: '#3a76c2',
          green: '#3aa055',
          yellow: '#d8b13a',
          purple: '#8a4ec0',
        },
        // "Starfall Academy" design system (docs/UI_DESIGN.md).
        night: { 600: '#383170', 700: '#2a2554', 800: '#1f1b3f', 900: '#171430' },
        parchment: { 50: '#fdf8ec', 200: '#f3e8cd', 400: '#e0cda0' },
        ink: { 900: '#2b2438' },
        starlight: '#ffe9a8',
        leyline: '#7ee8fa',
        dept: {
          sorcery: '#ff5d5d',
          divinity: '#ffd166',
          natural: '#5fd068',
          mysticism: '#b16cea',
          planar: '#5aa9e6',
          techno: '#ff9f43',
        },
        player: {
          red: '#ff6b6b',
          blue: '#4d96ff',
          green: '#6bcb77',
          gold: '#ffd93d',
          violet: '#b388eb',
          orange: '#ff9f43',
        },
      },
      fontFamily: {
        display: ['Grandstander', 'cursive'],
        body: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
        arcane: ['"Cinzel Decorative"', 'serif'],
      },
      borderRadius: { card: '14px', slot: '9999px' },
      boxShadow: {
        'glow-sm': '0 0 8px 2px var(--glow, #7ee8fa66)',
        glow: '0 0 16px 4px var(--glow, #7ee8fa88)',
        card: '0 6px 16px -6px #00000066',
        'card-lift': '0 16px 32px -8px #00000088',
      },
      keyframes: {
        breathe: { '0%,100%': { opacity: '.55' }, '50%': { opacity: '1' } },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        pop: {
          '0%': { transform: 'scale(.55)', opacity: '0' },
          '70%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
        floaty: 'floaty 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        pop: 'pop .4s cubic-bezier(.34,1.56,.64,1) both',
        shimmer: 'shimmer 2.5s linear infinite',
      },
    },
  },
  plugins: [],
};
