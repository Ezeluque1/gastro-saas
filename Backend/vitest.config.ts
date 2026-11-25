import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas corren con NODE_ENV=test, asi que src/config carga .env.test
    // y apuntan a la base gastro_test, nunca a la de desarrollo.
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.ts'],
    // Las pruebas de integracion comparten una base real: si corrieran en
    // paralelo se pisarian entre si. La Fase 1, con datos de dos tenants, es
    // justo donde esto importa.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/server.ts'],
    },
  },
});
