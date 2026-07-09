/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      colors: {
        hud: {
          bg: '#050f1e',
          border: '#1a3558',
          accent: '#00d4ff',
          danger: '#ff4444',
          warn: '#ffaa00',
          success: '#00ff88',
        },
      },
      fontFamily: {
        mono: ['"Courier New"', 'Courier', 'monospace'],
      },
    },
  },
  plugins: [],
}
