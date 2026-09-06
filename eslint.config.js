// Configuración de ESLint (flat config). El servidor MCP ejecuta el ESLint de
// este repositorio con `npx --no-install`, así que estas son las reglas que
// verá el paso de análisis.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Sin esto ESLint entra en el compilado y llena la revisión de hallazgos
    // sobre código generado.
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // El código ya usa `noUncheckedIndexedAccess`; avisar de lo no usado
      // aquí cubre el hueco que tsconfig deja abierto.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
