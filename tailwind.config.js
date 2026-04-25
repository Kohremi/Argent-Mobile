/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vis: {
          red: '#c73e3e',
          blue: '#3a76c2',
          green: '#3aa055',
          yellow: '#d8b13a',
          purple: '#8a4ec0',
        },
      },
    },
  },
  plugins: [],
};
