import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Las reglas de arquitectura se hacen cumplir con herramientas, no solo con
 * disciplina: lo que esta abajo falla el CI cuando alguien cruza un limite.
 *
 * Tres cosas se vigilan:
 *
 *  1. El cliente Prisma no se usa fuera de shared/db. Si alguien consultara por
 *     fuera de withTenant(), RLS devolveria un error en vez de datos de otro
 *     local, pero conviene que falle en el CI y no en produccion.
 *  2. Un modulo usa solo la interfaz publica (index.ts) de otro, nunca sus
 *     capas internas.
 *  3. Las dependencias entre capas apuntan SIEMPRE hacia adentro:
 *     api -> application -> domain, e infrastructure -> domain. El centro
 *     (domain) no conoce a nadie.
 *
 * docs/Backend: "Capas dentro de cada modulo" y "Reglas de modularidad".
 *
 * Nota sobre los patrones: en no-restricted-imports, `*` tambien matchea `..`,
 * asi que un patron de dos segmentos atrapa de paso a `../../shared/...`. Por
 * eso cada grupo lleva una negacion final que vuelve a permitir lo que sale del
 * modulo.
 */

const PRISMA_OUTSIDE_DB = {
  group: ['**/db/client.js', '**/generated/prisma', '**/generated/prisma/**'],
  message:
    'El cliente Prisma solo se usa dentro de shared/db. Pedi la transaccion (Tx) de withTenant() y pasala como parametro.',
};

/**
 * Limite entre modulos, visto desde la raiz de un modulo
 * (index.ts, <nombre>.module.ts): otro modulo esta en `../<nombre>/`.
 */
const CROSS_MODULE_FROM_ROOT = {
  group: ['../*/**', '!../*/index.js', '!../../**'],
  message:
    'Un modulo usa solo la interfaz publica (index.js) de otro, nunca sus capas internas.',
};

/**
 * Lo mismo visto desde una capa (api/, application/, domain/,
 * infrastructure/, tests/): otro modulo esta dos niveles arriba.
 */
const CROSS_MODULE_FROM_LAYER = {
  group: ['../../*/**', '!../../*/index.js', '!../../../**'],
  message:
    'Un modulo usa solo la interfaz publica (index.js) de otro, nunca sus capas internas.',
};

/**
 * Limite entre modulos visto desde las pruebas transversales de `tests/`, que
 * estan fuera de `src/`: un modulo esta en `../../src/modules/<nombre>/`.
 *
 * Estas pruebas SI pueden importar de `src/shared/...`, porque prueban
 * justamente el pipeline y los helpers compartidos.
 */
const CROSS_MODULE_FROM_ROOT_TESTS = {
  group: ['../../src/modules/*/**', '!../../src/modules/*/index.js'],
  message:
    'Una prueba transversal usa solo la interfaz publica (index.js) de un modulo. Si necesita las piezas internas, la prueba va dentro del modulo, en src/modules/<nombre>/tests/.',
};

/** Capas que una capa dada no puede importar, por estar mas afuera. */
function hacia(capas) {
  return {
    group: capas.map((capa) => `../${capa}/**`),
    message:
      'Las dependencias entre capas apuntan hacia adentro: api -> application -> domain, infrastructure -> domain. Si hace falta una implementacion concreta, se inyecta desde <modulo>.module.ts.',
  };
}

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
      // un .ts. Es la friccion conocida de Prisma 7 + ESM: que falle en el
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

  // Raiz de un modulo: index.ts y <nombre>.module.ts.
  //
  // El archivo .module.ts es el UNICO del modulo que puede importar
  // infrastructure/, porque su trabajo es justamente inyectar las
  // implementaciones concretas en los casos de uso.
  {
    files: ['src/modules/*/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [PRISMA_OUTSIDE_DB, CROSS_MODULE_FROM_ROOT] },
      ],
    },
  },

  // domain/: el centro. No importa ninguna otra capa.
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PRISMA_OUTSIDE_DB,
            CROSS_MODULE_FROM_LAYER,
            hacia(['api', 'application', 'infrastructure']),
          ],
        },
      ],
    },
  },

  // application/: casos de uso. Solo domain. Las implementaciones se inyectan.
  {
    files: ['src/modules/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PRISMA_OUTSIDE_DB,
            CROSS_MODULE_FROM_LAYER,
            hacia(['api', 'infrastructure']),
          ],
        },
      ],
    },
  },

  // infrastructure/: implementa los puertos de domain. No conoce la entrada.
  {
    files: ['src/modules/*/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [PRISMA_OUTSIDE_DB, CROSS_MODULE_FROM_LAYER, hacia(['api'])] },
      ],
    },
  },

  // api/: entrada HTTP. Llama a los casos de uso, nunca a la infraestructura.
  {
    files: ['src/modules/*/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PRISMA_OUTSIDE_DB,
            CROSS_MODULE_FROM_LAYER,
            hacia(['infrastructure']),
          ],
        },
      ],
    },
  },

  // Las pruebas necesitan margen: aserciones sobre datos sin tipar, y poder
  // armar escenarios con las piezas internas del modulo que prueban.
  {
    files: ['tests/**/*.ts', 'src/modules/*/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Pruebas transversales (tests/): el pipeline HTTP, los helpers compartidos y
  // el aislamiento entre locales, que no es de ningun modulo.
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_MODULE_FROM_ROOT_TESTS] }],
    },
  },

  // Pruebas de un modulo: pueden usar sus propias capas internas, pero de otro
  // modulo solo su interfaz publica.
  {
    files: ['src/modules/*/tests/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CROSS_MODULE_FROM_LAYER] }],
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
