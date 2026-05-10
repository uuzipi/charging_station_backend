/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        primary: {
          light: '#60A5FA',
          dark: '#3B82F6',
        },
        secondary: {
          light: '#10B981',
          dark: '#059669',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-in': 'slideIn 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-100%)'},
          '100%': { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
} 