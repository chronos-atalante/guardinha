import { mergeConfig, defineConfig } from 'vitest/config';
import base from './vitest.config.mts';
import { mutationPlugin } from './tools/mutation/plugin.ts';

/**
 * Configuração da varredura de mutação. Nasce da do `npm test` e só troca três
 * coisas:
 *
 * - o plugin que injeta o mutante no módulo alvo;
 * - `hash-wasm` apontado para um doppelgänger barato, porque a suíte de cofre
 *   deriva chaves com Argon2id de produção (128 MiB e 256 MiB) e um mutante
 *   que roda a suíte inteira custaria minutos.
 *
 * `isolate` continua `true`: `tests/setup-env.ts` cria um diretório temporário
 * por processo de teste e os arquivos de teste do main dependem disso para não
 * enxergar o cofre um do outro.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [mutationPlugin()],
    resolve: {
      alias: {
        'hash-wasm': new URL('./tools/mutation/hash-wasm-stub.ts', import.meta.url).pathname,
      },
    },
    test: {
      coverage: {
        // A varredura só liga a cobertura para montar a matriz arquivo de
        // teste → linhas de `src/` que ele toca (ver `matrix.ts`). Um arquivo
        // de teste sozinho nunca bate o limiar de 90%, que é da suíte inteira,
        // então os limiares vão a zero aqui.
        enabled: false,
        thresholds: { lines: 0, statements: 0, functions: 0, branches: 0 },
      },
    },
  }),
);
