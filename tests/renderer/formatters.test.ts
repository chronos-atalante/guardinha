import { describe, expect, it } from 'vitest';
import { countWords, errorMessage, normalizePhrase } from '@zero/renderer/formatters';

/**
 * Utilitários de texto usados por várias telas. `normalizePhrase` precisa
 * concordar com `normalizeRecoveryPhrase` do main: as duas implementações
 * calculam a mesma frase de recuperação e divergir entre elas abriria falha
 * no reset do PIN.
 */

describe('countWords', () => {
  it('conta as palavras de uma frase', () => {
    expect(countWords('o cavalo comeu cenoura na feira')).toBe(6);
  });

  it('ignora espaços extras nas pontas e entre palavras', () => {
    expect(countWords('   o    cavalo   comeu  ')).toBe(3);
    expect(countWords('\n\to cavalo\n\ncomeu\t')).toBe(3);
  });

  it('trata texto vazio ou só com espaços como zero palavras', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('\n\t ')).toBe(0);
  });
});

describe('normalizePhrase', () => {
  it('minúsculas e espaços simples, como a do main', () => {
    expect(normalizePhrase('  Na  FEIRA   de Hoje  ')).toBe('na feira de hoje');
  });

  it('aceita quebras de linha e tabulação como separador', () => {
    expect(normalizePhrase('o\ncavalo\tcomeu')).toBe('o cavalo comeu');
  });

  it('devolve string vazia para entrada vazia', () => {
    expect(normalizePhrase('')).toBe('');
    expect(normalizePhrase('   \n  ')).toBe('');
  });

  it('mantém acentos, que fazem parte da frase do usuário', () => {
    expect(normalizePhrase('  Café  com  Pão  ')).toBe('café com pão');
  });
});

describe('errorMessage', () => {
  it('usa a mensagem do erro quando ela existe', () => {
    expect(errorMessage(new Error('Cofre bloqueado.'), 'padrão')).toBe('Cofre bloqueado.');
  });

  it('cai no padrão quando o erro é vazio', () => {
    expect(errorMessage(new Error(''), 'padrão')).toBe('padrão');
  });

  it('cai no padrão quando não é Error', () => {
    // rejeição de IPC chega como string, objeto ou undefined
    expect(errorMessage('texto solto', 'padrão')).toBe('padrão');
    expect(errorMessage(undefined, 'padrão')).toBe('padrão');
    expect(errorMessage(null, 'padrão')).toBe('padrão');
    expect(errorMessage({ message: 'objeto' }, 'padrão')).toBe('padrão');
  });
});
