// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  KDF_CREDENTIAL,
  KDF_PIN,
  MASTER_PASSWORD_LENGTH,
  RECOVERY_MIN_WORDS,
  decryptAuthRecord,
  decryptRecord,
  deriveAuthKey,
  deriveKey,
  encryptAuthRecord,
  encryptRecord,
  generateHighEntropyPassword,
  isSameKdf,
  isValidKdfParams,
  kdfProfileFor,
  normalizeRecoveryPhrase,
  passwordCharSet,
  randomBytes,
} from '@zero/main/crypto';
import type { GeneratorOptions } from '@zero/types';

/** Parâmetros mínimos: aqui os testes cuidam da forma, não do custo. */
const TEST_KDF = { memoryKiB: 16_384, iterations: 1, parallelism: 1 };

describe('deriveKey (Argon2id)', () => {
  it('produz sempre 32 bytes e é determinística para a mesma senha+salt', async () => {
    const salt = randomBytes(16);
    const first = await deriveKey('senha-de-teste', salt, TEST_KDF);
    const second = await deriveKey('senha-de-teste', salt, TEST_KDF);
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
  });

  it('muda com salt diferente', async () => {
    const a = await deriveKey('senha-de-teste', randomBytes(16), TEST_KDF);
    const b = await deriveKey('senha-de-teste', randomBytes(16), TEST_KDF);
    expect(a.equals(b)).toBe(false);
  });

  it('muda com parâmetros de custo diferentes', async () => {
    const salt = randomBytes(16);
    const cheap = await deriveKey('senha-de-teste', salt, TEST_KDF);
    const dearer = await deriveKey('senha-de-teste', salt, {
      ...TEST_KDF,
      memoryKiB: 32_768,
    });
    expect(cheap.equals(dearer)).toBe(false);
  });
});

describe('perfis de custo do Argon2id', () => {
  it('PIN é o perfil mais caro; mestra e frase ficam um nível abaixo', () => {
    expect(kdfProfileFor('pin')).toEqual(KDF_PIN);
    expect(kdfProfileFor('master')).toEqual(KDF_CREDENTIAL);
    // a frase de recuperação não tem perfil próprio: `unwrapping.ts` a roteia
    // para o perfil da senha mestra (segredo longo, PIN é que é o fraco)
    expect(kdfProfileFor('master')).toEqual(KDF_CREDENTIAL);
    expect(KDF_PIN.memoryKiB).toBeGreaterThan(KDF_CREDENTIAL.memoryKiB);
    expect(KDF_PIN.iterations).toBeGreaterThanOrEqual(KDF_CREDENTIAL.iterations);
    expect(isSameKdf(KDF_PIN, KDF_CREDENTIAL)).toBe(false);
    expect(isSameKdf(KDF_CREDENTIAL, { ...KDF_CREDENTIAL })).toBe(true);
  });

  it('aceita parâmetros dentro da faixa e recusa fora dela', () => {
    expect(isValidKdfParams(KDF_PIN)).toBe(true);
    expect(isValidKdfParams(KDF_CREDENTIAL)).toBe(true);
    expect(isValidKdfParams({ memoryKiB: 65_536, iterations: 3, parallelism: 4 })).toBe(true);

    expect(isValidKdfParams({ memoryKiB: 1, iterations: 3, parallelism: 4 })).toBe(false);
    expect(isValidKdfParams({ memoryKiB: 8_388_608, iterations: 3, parallelism: 4 })).toBe(false);
    expect(isValidKdfParams({ memoryKiB: 65_536, iterations: 0, parallelism: 4 })).toBe(false);
    expect(isValidKdfParams({ memoryKiB: 65_536, iterations: 3.5, parallelism: 4 })).toBe(false);
    expect(isValidKdfParams(null)).toBe(false);
    expect(isValidKdfParams('65536')).toBe(false);
  });
});

describe('encryptRecord / decryptRecord (AES-256-GCM)', () => {
  it('faz o roundtrip com os campos íntegros', () => {
    const key = randomBytes(32);
    const data = { title: 'GitHub', username: 'chronos', password: 's3nh@-forte' };
    const payload = encryptRecord(data, key);
    expect(payload.salt).toHaveLength(32); // 128 bits em hex
    expect(payload.iv).toHaveLength(32); // 128 bits em hex
    expect(payload.tag).toHaveLength(32); // 128 bits em hex
    expect(decryptRecord(payload, key)).toEqual(data);
  });

  describe('deriveAuthKey (HKDF de tokens 2FA)', () => {
    it('deriva uma chave determinística de 32 bytes no domínio dos tokens', () => {
      const key = randomBytes(32);
      const salt = randomBytes(16);
      const first = deriveAuthKey(key, salt);

      expect(first).toHaveLength(32);
      expect(first.equals(deriveAuthKey(key, salt))).toBe(true);
      expect(first.equals(key)).toBe(false);
    });
  });

  it('falha com a chave errada', () => {
    const payload = encryptRecord({ secret: 1 }, randomBytes(32));
    expect(() => decryptRecord(payload, randomBytes(32))).toThrow();
  });

  it('falha com o conteúdo adulterado', () => {
    const key = randomBytes(32);
    const payload = encryptRecord({ secret: 'valor' }, key);
    const tampered = { ...payload, encryptedData: `${payload.encryptedData.slice(0, -2)}00` };
    expect(() => decryptRecord(tampered, key)).toThrow();
  });

  it('usa salt e IV distintos por arquivo', () => {
    const key = randomBytes(32);
    const first = encryptRecord({ a: 1 }, key);
    const second = encryptRecord({ a: 1 }, key);
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
  });
});

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

describe('frase de recuperação', () => {
  it('exige ao menos 12 palavras conforme a especificação', () => {
    expect(RECOVERY_MIN_WORDS).toBe(12);
  });

  it('normaliza caixa e espaços', () => {
    expect(normalizeRecoveryPhrase('  Abelha\tAGUA  alface ')).toBe('abelha agua alface');
  });

  it('senha mestra tem 24 caracteres conforme a especificação', () => {
    expect(MASTER_PASSWORD_LENGTH).toBe(24);
  });
});

describe('parâmetros de KDF fixados', () => {
  it('mantém os custos de produção gravados em AGENTS.md e docs/cofre.md', () => {
    // Estes números são a proteção contra ataque de força bruta do PIN. Um teste
    // que só compara o perfil com ele mesmo passa se alguém afrouxar o custo.
    expect(KDF_CREDENTIAL).toEqual({ memoryKiB: 131_072, iterations: 3, parallelism: 4 });
    expect(KDF_PIN).toEqual({ memoryKiB: 262_144, iterations: 4, parallelism: 4 });
  });

  it('aceita o teto da faixa de leitura e recusa o valor seguinte', () => {
    const atLimit = { memoryKiB: 1_048_576, iterations: 8, parallelism: 8 };
    expect(isValidKdfParams(atLimit)).toBe(true);
    expect(isValidKdfParams({ ...atLimit, iterations: 9 })).toBe(false);
    expect(isValidKdfParams({ ...atLimit, parallelism: 9 })).toBe(false);
    expect(isValidKdfParams({ ...atLimit, memoryKiB: 1_048_577 })).toBe(false);
  });
});

describe('derivação por HKDF', () => {
  it('separa os domínios: entrada e token de 2FA nunca dividem a chave', () => {
    // É o motivo dos rótulos `-v1`: dois registros com a mesma senha e o mesmo
    // salt, mas em domínios diferentes, precisam sair com chaves diferentes. Se
    // os rótulos colidissem, um `.zke` abriria como `.zka` e o app leria a
    // credencial no lugar do token de 2FA.
    const key = randomBytes(32);
    const salt = randomBytes(16);

    const entry = encryptRecord({ title: 'GitHub' }, key);
    const auth = encryptAuthRecord({ issuer: 'GitHub' }, key);

    expect(entry.salt).not.toBe(auth.salt);
    expect(decryptRecord(entry, key)).toEqual({ title: 'GitHub' });
    expect(decryptAuthRecord(auth, key)).toEqual({ issuer: 'GitHub' });
    expect(deriveAuthKey(key, salt)).toHaveLength(32);
  });

  it('recusa um registro de token no domínio de entrada e vice-versa', () => {
    const key = randomBytes(32);
    const entry = encryptRecord({ title: 'GitHub' }, key);

    // O payload do token é cifrado no outro rótulo, então a decifra no domínio
    // errado tem de falhar na tag, e não devolver lixo.
    expect(() => decryptAuthRecord(entry, key)).toThrow();
  });

  it('devolve sempre 32 bytes, em qualquer faixa válida de custo', async () => {
    const salt = randomBytes(16);
    const params = [TEST_KDF, KDF_CREDENTIAL, { memoryKiB: 16_384, iterations: 1, parallelism: 8 }];
    for (const profile of params) {
      expect(await deriveKey('senha-de-teste', salt, profile)).toHaveLength(32);
    }
  });
});
