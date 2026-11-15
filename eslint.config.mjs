// Config plana de ESLint. Next 16 saco el comando `next lint`, asi que el lint ahora
// lo corre eslint directo (ver el script "lint" del package.json) y la config vive
// acá en vez de en .eslintrc.json.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      // Cliente de Prisma: codigo generado, no se lintea ni se edita a mano.
      "src/generated/**",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
];

export default config;
