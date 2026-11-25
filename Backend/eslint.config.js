import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Las reglas de modularidad del documento se hacen cumplir con herramientas,
 * no solo con disciplina: lo que esta abajo falla el CI cuando un modulo cruza
 * un limite que no deberia.
 *
 * Lo que se vigila:
 *
 *  1. El cliente Prisma no se usa fuera de shared/db. Si alguien consultara por
 *     fuera de withTenant(), RLS devolveria un error en vez de datos de otro
 *     local, pero conviene que falle en el CI y no en produccion.
 *  2. Un modulo usa solo la interfaz publica (index.ts) de otro, nunca sus
 *     servicios ni sus repositorios.
 *
 * La deteccion de ciclos entre modulos (dependency-cruiser) queda pendiente;
 * con los pocos modulos de la Fase 0 no aporta todavia.
 *
 * docs/Backend: "Reglas de modularidad" y "Prisma y el contexto de tenant".
 */

const PRISMA_OUTSIDE_DB = {
  group: ['**/db/client.js', '**/generated/prisma', '**/generated/prisma/**'],
  message:
    'El cliente Prisma solo se usa dentro de shared/db. Pedi la transaccion (Tx) de withTenant() y pasala como parametro.',
};

const CROSS_MODULE_INTERNALS = {
  // Ojo con el orden y con `*`: en estos patrones `*` tambien matchea `..`, asi
  // que `../*/**` atrapa de paso a `../../shared/...`. La ultima negacion
  // vuelve a permitir todo lo que sale de modules/ (shared, config), que no es
  // lo que esta regla cuida.
  group: ['../*/**', '!../*/index.js', '!../../**'],
  message:
    'Un modulo usa solo la interfaz publica (index.js) de otro, nunca sus servicios ni sus repositorios.',
};

export default tseslint.config(
  {
    // Codigo generado y compilado: no se revisa ni se formatea.
    ignores: ['dist/**', 'src/generated/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // En ESM los imports internos llevan extension .js, incluso apuntando a
      // un .ts. Es la fricción conocida de Prisma 7 + ESM: que falle en el
      // editor y no al compilar para produccion.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      // Un `await` olvidado en una transaccion es un bug silencioso.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Preferir `unknown` antes que `any` en los catch.
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
    },
  },

  // Todo src salvo shared/db: sin acceso al cliente Prisma.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/shared/db/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PRISMA_OUTSIDE_DB] }],
    },
  },

  // Dentro de los modulos se suma el limite entre modulos.
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [PRISMA_OUTSIDE_DB, CROSS_MODULE_INTERNALS] },
      ],
    },
  },

  // Las pruebas necesitan margen: aserciones sobre datos sin tipar y acceso a
  // la base para preparar escenarios.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Archivos de configuracion: fuera del proyecto de TypeScript con tipos.
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Va ultimo: apaga las reglas de estilo que chocan con Prettier.
  prettier,
);
