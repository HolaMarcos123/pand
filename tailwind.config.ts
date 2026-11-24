import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Design system de Pand ──────────────────────────────
        pand: {
          celeste: "#7BE1FF", // fondos de icono, destacados
          azul: "#006AFF", // botones, links, estados activos
          contorno: "#2A2A35", // texto principal, isologo
          gris: "#6E6E78", // texto secundario, etiquetas
          coral: "#F4707C", // mora y alertas (solo texto/icono)
          bg: "#F6F8FB", // fondo de la app
          border: "#E6E9EE", // bordes y separadores
        },

        // ── Tokens semanticos de shadcn/ui, mapeados a Pand ────
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
          "6": "hsl(var(--chart-6))",
          grid: "hsl(var(--chart-grid))",
          axis: "hsl(var(--chart-axis))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        // Las cargan next/font en src/app/layout.tsx. La lista de respaldo es la
        // del sistema y no "sans-serif" pelado: si la fuente tarda, el texto se
        // dibuja con la del sistema operativo y no con la serif del navegador.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // `rounded-card` y `rounded-badge` se usan en una veintena de archivos
        // desde el primer dia, pero nunca estuvieron definidos: Tailwind no
        // emite nada para una clase que no existe, asi que todas esas cards
        // venian con las esquinas cuadradas. Lo mismo `shadow-card`.
        card: "var(--radius)",
        badge: "9999px",
      },
      boxShadow: {
        // Un hairline + una sombra minima, no una sombra difusa: en un panel de
        // datos las cards se separan del fondo por el borde, no por la altura.
        // Es lo que hace Power BI y es lo que mantiene legible una pantalla con
        // ocho visuales.
        // "panel" y no "card", que seria el nombre natural: `colors.card` existe
        // como token semantico de shadcn, y de cada color Tailwind genera tambien
        // una utilidad de COLOR de sombra. O sea que `shadow-card` ya estaba
        // tomado —pintaba la sombra de blanco— y ganaba por orden de aparicion.
        // Esa colision es la razon por la que `shadow-card` nunca se vio.
        panel: "0 0 0 1px rgba(230, 233, 238, 0.9), 0 1px 2px 0 rgba(42, 42, 53, 0.04)",
        "panel-hover":
          "0 0 0 1px rgba(123, 225, 255, 0.9), 0 2px 8px 0 rgba(42, 42, 53, 0.06)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
