/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        glow: {
          '0%, 100%': { textShadow: '0 0 12px rgba(255,255,255,0.6)' },
          '50%': { textShadow: '0 0 28px rgba(255,255,255,0.9)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 2.5s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        glow: 'glow 2.8s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
      },
      boxShadow: {
        '3xl': '0 24px 48px -12px rgba(0,0,0,0.28)',
      },
    },
  },
  plugins: [],
};
