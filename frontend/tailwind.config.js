/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        leaf: { 50: '#f1f8ec', 100: '#dff0d3', 200: '#bfe1a9', 300: '#93cb72', 400: '#6db148', 500: '#4f9530', 600: '#3c7724', 700: '#305d20', 800: '#284a1e', 900: '#1d3517', 950: '#0f1f0b' },
        soil: { 50: '#faf6f0', 100: '#f2eadc', 200: '#e5d4b8' },
        tomato: { 400: '#f2704f', 500: '#e5502d', 600: '#c63b1d' },
      },
      boxShadow: { card: '0 1px 2px rgba(16,32,10,.06), 0 8px 24px -12px rgba(16,32,10,.18)' },
    },
  },
  plugins: [],
}
