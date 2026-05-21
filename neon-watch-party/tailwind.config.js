/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        neon: {
          red: "var(--neon-primary)",
          pink: "var(--neon-light)",
          dim: "var(--neon-dim)",
        },
      },
      fontFamily: {
        display: ["Orbitron", "system-ui", "sans-serif"],
        body: ["Exo 2", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
