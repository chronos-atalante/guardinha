// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateHighEntropyPassword, passwordCharSet } from '@zero/main/generator';
import type { GeneratorOptions } from '@zero/types';

describe('generateHighEntropyPassword', () => {
  /** Atalho: só as categorias que interessam ao teste, o resto desligado. */
  function options(over: Partial<GeneratorOptions> = {}): GeneratorOptions {
    return {
      length: 24,
      useLower: false,
      useUpper: false,
      useNumbers: false,
      useSymbols: false,
      customEntropyWords: [],
      ...over,
    };
  }

  it('respeita o tamanho e o conjunto de caracteres', () => {
    const password = generateHighEntropyPassword(
      options({
        length: 32,
        useLower: true,
        useUpper: true,
        useNumbers: true,
        useSymbols: true,
        customEntropyWords: ['fusca', '77'],
      }),
    );
    expect(password).toHaveLength(32);
    expect(password).toMatch(/^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/);
  });

  it('só maiúsculas sai só com maiúsculas', () => {
    const password = generateHighEntropyPassword(options({ length: 40, useUpper: true }));
    expect(password).toHaveLength(40);
    expect(password).toMatch(/^[A-Z]+$/);
  });

  it('só minúsculas sai só com minúsculas', () => {
    const password = generateHighEntropyPassword(options({ length: 40, useLower: true }));
    expect(password).toHaveLength(40);
    expect(password).toMatch(/^[a-z]+$/);
  });

  it('só números sai só com números', () => {
    const password = generateHighEntropyPassword(options({ length: 40, useNumbers: true }));
    expect(password).toHaveLength(40);
    expect(password).toMatch(/^[0-9]+$/);
  });

  it('só símbolos sai só com símbolos', () => {
    const password = generateHighEntropyPassword(options({ length: 40, useSymbols: true }));
    expect(password).toHaveLength(40);
    expect(password).toMatch(/^[!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/);
  });

  it('nenhuma categoria marcada não gera senha', () => {
    expect(generateHighEntropyPassword(options({ length: 16 }))).toBe('');
  });

  it('comprimento 0 devolve vazio', () => {
    expect(generateHighEntropyPassword(options({ length: 0, useUpper: true }))).toBe('');
  });

  it('comprimento 1 devolve um caractere, e não vazio', () => {
    // A guarda é `length <= 0`: em 1 o gerador tem de sortear, senão o medidor
    // de força da tela mostra uma senha que não existe.
    const senha = generateHighEntropyPassword(options({ length: 1, useLower: true }));
    expect(senha).toHaveLength(1);
    expect(senha).toMatch(/^[a-z]$/);
  });

  it('palavras pessoais mudam a distribuição sem quebrar o formato', () => {
    const withWords = generateHighEntropyPassword(
      options({
        length: 40,
        useLower: true,
        useUpper: true,
        useNumbers: true,
        useSymbols: true,
        customEntropyWords: ['violao', 'sofa'],
      }),
    );
    const withoutWords = generateHighEntropyPassword(
      options({ length: 40, useLower: true, useUpper: true, useNumbers: true, useSymbols: true }),
    );
    expect(withWords).toHaveLength(40);
    expect(withoutWords).toHaveLength(40);
    expect(withWords).toMatch(/^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/);
    expect(withoutWords).toMatch(/^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/);
  });
});

describe('passwordCharSet', () => {
  it('junta só as categorias marcadas', () => {
    const base: GeneratorOptions = {
      length: 8,
      useLower: false,
      useUpper: false,
      useNumbers: false,
      useSymbols: false,
      customEntropyWords: [],
    };
    expect(passwordCharSet(base)).toBe('');
    expect(passwordCharSet({ ...base, useNumbers: true })).toBe('0123456789');
    expect(passwordCharSet({ ...base, useUpper: true, useNumbers: true })).toBe(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    );
  });
});
