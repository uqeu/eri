import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Chrome — dark-only neutrals
        bg: "var(--bg)",
        "bg-card": "var(--bg-card)",
        "bg-card-2": "var(--bg-card-2)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-sec": "var(--text-sec)",
        "text-ter": "var(--text-ter)",
        // Engine-only lime — used inside HeroBig/PromptPipeline/EngineRoom/EriDemo
        "demo-accent": "var(--demo-accent)",
        // Legacy aliases — pinned to dark engine colors so old demos still render
        ink: "#0A0A0A",
        paper: "#F5F2EC",
        accent: "var(--demo-accent)",
        "accent-bright": "var(--demo-accent)",
        muted: "rgba(245, 242, 236, 0.6)",
        "bg-1": "#0A0A0A",
        "bg-2": "#131311",
        "bg-3": "#1A1A18",
        "bg-4": "#1F1F1D",
      },
      gridTemplateColumns: {
        "24": "repeat(24, minmax(0, 1fr))",
      },
      fontFamily: {
        display: ["Funnel Display", "system-ui", "sans-serif"],
        sans: ["var(--font-grotesk)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",
        "in-out-soft": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      animation: {
        "fade-up": "fadeUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "fade-in": "fadeIn 1.2s ease-out forwards",
        "wave": "wave 1.4s ease-in-out infinite",
        "pulse-dot": "pulseDot 1.4s ease-in-out infinite",
        "grain": "grain 8s steps(10) infinite",
        "shimmer": "shimmer 6s linear infinite",
        "denoise": "denoise 3.2s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
        pulseDot: {
          "0%, 80%, 100%": { opacity: "0.2", transform: "scale(0.7)" },
          "40%": { opacity: "1", transform: "scale(1)" },
        },
        grain: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "10%": { transform: "translate(-5%, -5%)" },
          "30%": { transform: "translate(3%, -10%)" },
          "50%": { transform: "translate(-10%, 5%)" },
          "70%": { transform: "translate(10%, -3%)" },
          "90%": { transform: "translate(-3%, 10%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
        denoise: {
          "0%, 100%": { filter: "blur(6px)", opacity: "0.4" },
          "50%": { filter: "blur(0px)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
