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
        navy:        '#1A3A6B',
        'navy-light':'#2C5F8A',
        cream:       '#FDFAF7',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'serif'],
        sans:  ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
