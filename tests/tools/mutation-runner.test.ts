// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { enumerateMutants, applyMutant } from '../../tools/mutation/mutants.ts';
import { MUTATION_TEST_OPTIONS } from '../../tools/mutation/vitest-options.ts';

/**
 * A varredura de mutação mede "se esta linha fizesse outra coisa, a suíte
 * perceberia?". A resposta depende inteiramente de o mutante **entrar** na
 * execução; se ele não entra, a suíte passa e o veredito é `survived`, que é
 * mentira com a forma certa.
 *
 * Já aconteceu: o `fsModuleCache` do Vitest (ligado por padrão) guarda o módulo
 * transformado em `node_modules/.vitest-cache`, indexado pelo id do arquivo. A
 * chave não enxerga o mutante que o plugin injeta, então o cache deixado pelo
 * mutante anterior era revalidado como válido. Na prática só o primeiro mutante
 * de cada arquivo era medido de verdade, e `src/main/unlock.ts` caía de 78% para
 * 18% conforme a varredura avançava, sem nenhuma alteração no código sob teste.
 *
 * Os testes abaixo travam as duas metades: o splicing aplica a troca no texto, e
 * a config desliga o cache que faria a troca ser ignorada.
 */

const ALVO = 'src/main/unlock.ts';

describe('splicing do mutante', () => {
  it('troca o trecho do mutante e só ele', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(ALVO, 'utf8');
    const mutante = enumerateMutants(ALVO, ALVO, code)[0];
    expect(mutante).toBeDefined();
    if (mutante === undefined) return;

    const mutado = applyMutant(code, mutante);

    // O splicing é `antes + troca + depois`: o que vem antes do mutante fica
    // intacto, e o que vem depois continua igual, deslocado pelo tamanho da
    // substituição.
    expect(mutado).not.toBe(code);
    expect(mutado.slice(0, mutante.start)).toBe(code.slice(0, mutante.start));
    expect(mutado.slice(mutante.start + mutante.replacement.length)).toBe(code.slice(mutante.end));
  });

  it('cada mutante aponta para um trecho diferente do arquivo', () => {
    const mutantes = enumerateMutants(ALVO, ALVO, 'const a = 1;\nconst b = 2;\n');
    const inicios = new Set(mutantes.map((m) => m.start));
    expect(inicios.size).toBe(mutantes.length);
  });
});

describe('config da varredura', () => {
  it('desliga o cache de módulo do Vitest', () => {
    // Sem isto, o cache revalida o texto do mutante anterior e este veredito
    // inteiro (o `survived` falso) volta. Ver o comentário do topo do arquivo.
    expect(MUTATION_TEST_OPTIONS.fsModuleCache).toBe(false);
  });

  it('zera os limiares de cobertura, que são os da suíte inteira', () => {
    // A varredura liga a cobertura só para montar a matriz de linhas. Um arquivo
    // de teste sozinho nunca bate 90%, então manter o limiar reprovaria tudo.
    expect(MUTATION_TEST_OPTIONS.coverage.enabled).toBe(false);
    expect(MUTATION_TEST_OPTIONS.coverage.thresholds).toEqual({
      lines: 0,
      statements: 0,
      functions: 0,
      branches: 0,
    });
  });
});
