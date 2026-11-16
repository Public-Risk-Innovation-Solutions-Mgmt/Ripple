/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ⚠ PRISM'S PRIMARY BRAND COLOR, FROM THE PRISM STYLE GUIDE
        // (Confluence: PRISM Style Guide, "Quick Reference Rules") —
        // "#75328B — use for primary buttons, links, and headline accents."
        // Scoped here to LINKS and PRIMARY ACTION BUTTONS only, per an
        // explicit decision: status colors (locked/complete/error — red,
        // green, amber), selection/toggle states, focus rings, section-icon
        // accents, and the chart/allocation-bar palette (separately
        // validated for colorblind-safe contrast) all stay as they were —
        // this is a brand color, not a wholesale re-theme.
        //
        // ⚠ 600 IS THE GUIDE'S EXACT HEX; EVERY OTHER SHADE IS COMPUTED, NOT
        // GUESSED — the same hue (≈285°) and saturation (≈47%) #75328B itself
        // resolves to, at lightness steps matching Tailwind's own blue ramp,
        // so a mechanical "blue-NNN" -> "brand-NNN" rename lands on a shade
        // that actually exists. Verify 600 against the guide before changing
        // it; the rest follow algebraically from whatever 600 is.
        brand: {
          50: '#F9F4FB',
          100: '#F1E5F6',
          200: '#E2C7EB',
          300: '#CEA1DD',
          400: '#B571CC',
          500: '#9D44BB',
          600: '#75328B',
          700: '#5B276D',
          800: '#481F56',
          900: '#361740',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};