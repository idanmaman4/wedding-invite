export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:          '#FDFAF7',
        text:        '#1A0A0A',
        red:         '#B22222',
        'red-light': '#D4394A',
        'red-pale':  '#F5D5D5',
        gold:        '#C9A96E',
        'gold-dark': '#8B6347',
        cream:       '#FDFAF7',
      },
      fontFamily: {
        serif: ['Frank Ruhl Libre', 'Cormorant Garamond', 'serif'],
        sans:  ['Heebo', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
