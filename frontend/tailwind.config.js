const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

/** Colours are CSS variables (index.css) so light/dark themes swap without touching components. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: c("canvas"), surface: c("surface"), sunken: c("sunken"), line: c("line"),
        ink: c("ink"), ink2: c("ink2"), ink3: c("ink3"),
        brand: c("brand"), solid: c("solid"), "solid-hover": c("solid-hover"), tint: c("tint"),
        ai: c("ai"), "ai-tint": c("ai-tint"),
        ok: c("ok"), "ok-tint": c("ok-tint"), warn: c("warn"), "warn-tint": c("warn-tint"),
        risk: c("risk"), "risk-tint": c("risk-tint"), bad: c("bad"), "bad-tint": c("bad-tint"),
        "bar-ok": c("bar-ok"), "bar-warn": c("bar-warn"), "bar-risk": c("bar-risk"), "bar-bad": c("bar-bad"),
      },
      fontFamily: { sans: ["Figtree Variable", "Noto Sans", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
      boxShadow: { pop: "0 12px 32px -8px rgb(var(--shadow) / 0.28), 0 2px 6px rgb(var(--shadow) / 0.12)", lift: "0 1px 2px rgb(var(--shadow) / 0.08)" },
      keyframes: {
        rise: { from: { opacity: 0, transform: "translateY(6px) scale(.985)" }, to: { opacity: 1, transform: "none" } },
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { rise: "rise .16s ease-out", fade: "fade .14s ease-out" },
    },
  },
  plugins: [],
};
