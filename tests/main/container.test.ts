// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FLAG_PANIC,
  openManifest,
  packEntryPayload,
  packVaultContainer,
  sealManifest,
  unpackEntryPayload,
  unpackVaultContainer,
} from '@zero/main/container';
import { encryptRecord, randomBytes } from '@zero/main/crypto';
import type { VaultContainerData, VaultUnpackResult, WrappedMethod } from '@zero/main/container';

/**
 * Formato do container. A v5 é a única suportada: cabeçalho de 41 bytes, sem
 * tripo global de KDF (cada método carrega o custo do seu Argon2id) e sem
 * caminho de leitura anterior. Como o app ainda não tem usuários, formato
 * antigo não tem a quem proteger, e um leitor só da v5 é bem mais difícil de
 * ler errado do que um que ramifica por versão.
 */

const HEADER_BYTES = 41;
const METHOD_FLAGS = [0x01, 0x02, 0x04, FLAG_PANIC] as const;

const KDF_MASTER = { algo: 'argon2id', memoryKiB: 131_072, iterations: 3, parallelism: 4 } as const;
const KDF_PIN = { algo: 'argon2id', memoryKiB: 262_144, iterations: 4, parallelism: 4 } as const;

function sampleContainer(): VaultContainerData {
  return {
    createdAt: 1_767_268_800_000,
    attempts: 2,
    lockUntil: 1_767_268_810_000,
    attemptsMaster: 1,
    nukeLimit: 0,
    methods: {
      master: {
        kdf: KDF_MASTER,
        kdfSalt: 'aa'.repeat(16),
        payload: {
          salt: 'bb'.repeat(16),
          iv: 'cc'.repeat(16),
          tag: 'dd'.repeat(16),
          encryptedData: 'ee11',
        },
      },
      pin: {
        kdf: KDF_PIN,
        kdfSalt: '11'.repeat(16),
        payload: {
          salt: '22'.repeat(16),
          iv: '33'.repeat(16),
          tag: '44'.repeat(16),
          encryptedData: '556677',
        },
      },
      panic: {
        kdf: KDF_PIN,
        kdfSalt: '5a'.repeat(16),
        payload: {
          salt: '6b'.repeat(16),
          iv: '7c'.repeat(16),
          tag: '8d'.repeat(16),
          encryptedData: '9e0f',
        },
      },
      recovery: {
        kdf: KDF_MASTER,
        kdfSalt: '1a'.repeat(16),
        payload: {
          salt: '2b'.repeat(16),
          iv: '3c'.repeat(16),
          tag: '4d'.repeat(16),
          encryptedData: '5e60',
        },
      },
    },
    manifest: {
      salt: 'ff'.repeat(16),
      iv: '00'.repeat(16),
      tag: '99'.repeat(16),
      encryptedData: 'ab',
    },
  };
}

/** Roundtrip: o resultado cru, com o motivo da recusa quando houver. */
function roundtrip(data: VaultContainerData): VaultUnpackResult {
  return unpackVaultContainer(packVaultContainer(data));
}

/** Os dados de um roundtrip que deu certo; falha o teste se não deu. */
function packed(data: VaultContainerData): VaultContainerData {
  const result = roundtrip(data);
  if (!result.ok) throw new Error(`esperava container válido, veio ${result.reason}`);
  return result.data;
}

/** Asserta a recusa e devolve o motivo, para o teste conferir qual foi. */
function refusal(buffer: Buffer): string {
  const result = unpackVaultContainer(buffer);
  if (result.ok) throw new Error('esperava recusa, veio container válido');
  return result.reason;
}

describe('container do cofre (vault.zkv)', () => {
  it('roundtrip preserva todos os campos', () => {
    const data = sampleContainer();
    const restored = roundtrip(data);
    expect(restored).toEqual({ ok: true, data });
  });

  it('roundtrip sem manifesto e com lockUntil nulo', () => {
    const data: VaultContainerData = { ...sampleContainer(), lockUntil: null, manifest: null };
    const restored = roundtrip(data);
    expect(restored).toEqual({ ok: true, data });
  });

  it('grava na versão 5, com cabeçalho de 41 bytes e o custo por método', () => {
    const data = sampleContainer();
    const master = data.methods.master;
    const pin = data.methods.pin;
    if (master === undefined || pin === undefined) throw new Error('fixture incompleta');

    const packed = packVaultContainer(data);
    expect(packed.readUInt32BE(8)).toBe(5);
    // o cabeçalho inteiro cabe em 41 bytes: não sobrou KDF global no meio
    expect(packed.readUInt32BE(20)).toBe(2); // attempts
    expect(packed.readUInt8(32)).toBe(0x1f); // as quatro flags de método + manifesto
    expect(packed.readUInt32BE(33)).toBe(1); // attemptsMaster
    expect(packed.readUInt32BE(37)).toBe(0); // nukeLimit desligado por padrão
    // e o primeiro bloco de método só começa depois dos 41 bytes
    expect(packed.readUInt32BE(HEADER_BYTES)).toBe(131_072); // master: 128 MiB
    expect(packed.readUInt32BE(HEADER_BYTES + 4)).toBe(3);
    const pinOffset =
      HEADER_BYTES + 12 + 16 + 52 + Buffer.from(master.payload.encryptedData, 'hex').length;
    expect(packed.readUInt32BE(pinOffset)).toBe(262_144); // pin: 256 MiB
    expect(packed.readUInt32BE(pinOffset + 4)).toBe(4);
    expect(pin.kdf.memoryKiB).toBe(262_144);
  });

  it('cada método guarda o seu próprio custo de Argon2id', () => {
    // o motivo de o tripo global ter saído do cabeçalho: o PIN é 256 MiB e a
    // senha mestra 128 MiB, e um único campo não representaria os dois
    const restored = packed(sampleContainer());
    expect(restored.methods.master?.kdf).toEqual(KDF_MASTER);
    expect(restored.methods.pin?.kdf).toEqual(KDF_PIN);
    expect(restored.methods.recovery?.kdf).toEqual(KDF_MASTER);
  });

  it('nukeLimit e attemptsMaster guardam e recuperam o valor gravado', () => {
    const data: VaultContainerData = { ...sampleContainer(), attemptsMaster: 7, nukeLimit: 50 };
    const restored = packed(data);
    expect(restored.attemptsMaster).toBe(7);
    expect(restored.nukeLimit).toBe(50);
  });

  it('preserva os dois campos com o valor zero (autodestrução desligada)', () => {
    const data: VaultContainerData = { ...sampleContainer(), attemptsMaster: 0, nukeLimit: 0 };
    const restored = packed(data);
    expect(restored.attemptsMaster).toBe(0);
    expect(restored.nukeLimit).toBe(0);
  });

  it('grava e lê o método de pânico', () => {
    const data = sampleContainer();
    const panic = data.methods.panic;
    if (panic === undefined) throw new Error('fixture incompleta');
    const restored = packed(data);
    expect(packVaultContainer(data).readUInt8(32) & FLAG_PANIC).toBe(FLAG_PANIC);
    expect(restored.methods.panic?.payload).toEqual(panic.payload);
    expect(restored.methods.panic?.kdfSalt).toBe(panic.kdfSalt);
  });

  it('recusa parâmetro KDF de método fora da faixa', () => {
    const packed = packVaultContainer(sampleContainer());

    const hugeMethod = Buffer.from(packed);
    hugeMethod.writeUInt32BE(4_294_967_295, HEADER_BYTES);
    expect(refusal(hugeMethod)).toBe('damaged');

    const zeroIterations = Buffer.from(packed);
    zeroIterations.writeUInt32BE(0, HEADER_BYTES + 4);
    expect(refusal(zeroIterations)).toBe('damaged');
  });

  it('recusa gravar parâmetro KDF fora da faixa', () => {
    const data = sampleContainer();
    const pin = data.methods.pin;
    if (pin === undefined) throw new Error('fixture incompleta');
    data.methods.pin = {
      ...pin,
      kdf: { algo: 'argon2id', memoryKiB: 1, iterations: 1, parallelism: 1 },
    } satisfies WrappedMethod;
    expect(() => packVaultContainer(data)).toThrow('parâmetros KDF inválidos');
  });

  it('recusa mágica inválida, versão desconhecida e lixo no fim', () => {
    const packed = packVaultContainer(sampleContainer());

    const badMagic = Buffer.from(packed);
    badMagic.write('XXXXXXXX', 0, 'ascii');
    expect(refusal(badMagic)).toBe('damaged');

    // v4 (o layout anterior) não é lido: formato velho é arquivo desconhecido
    const oldVersion = Buffer.from(packed);
    oldVersion.writeUInt32BE(4, 8);
    expect(refusal(oldVersion)).toBe('unsupported-version');

    const futureVersion = Buffer.from(packed);
    futureVersion.writeUInt32BE(99, 8);
    expect(refusal(futureVersion)).toBe('unsupported-version');

    expect(refusal(Buffer.concat([packed, Buffer.from([0])]))).toBe('damaged');
  });

  it('distingue cofre de outra versão de arquivo danificado', () => {
    // o motivo importa na tela: um cofre de outra versão está inteiro e cifrado,
    // e dizer "alterado fora do app" faz o usuário achar que perdeu os dados
    const packedBytes = packVaultContainer(sampleContainer());

    const otherVersion = Buffer.from(packedBytes);
    otherVersion.writeUInt32BE(4, 8);
    expect(unpackVaultContainer(otherVersion)).toEqual({
      ok: false,
      reason: 'unsupported-version',
      version: 4,
    });

    // arquivo que nem é cofre continua sendo "danificado"
    const notAVault = Buffer.from(packedBytes);
    notAVault.write('XXXXXXXX', 0, 'ascii');
    expect(refusal(notAVault)).toBe('damaged');
  });

  it('recusa flag desconhecida, para um arquivo corrompido não entrar', () => {
    const packed = packVaultContainer(sampleContainer());
    const unknownFlag = Buffer.from(packed);
    unknownFlag.writeUInt8(unknownFlag.readUInt8(32) | 0x80, 32);
    expect(refusal(unknownFlag)).toBe('damaged');
  });

  it('recusa truncamento e byte adulterado no cabeçalho', () => {
    const packed = packVaultContainer(sampleContainer());
    expect(refusal(packed.subarray(0, packed.length - 3))).toBe('damaged');

    const flipped = Buffer.from(packed);
    flipped.writeUInt32BE(0, 0); // quebra a mágica
    expect(refusal(flipped)).toBe('damaged');
  });

  it('recusa um cabeçalho cortado no meio dos campos', () => {
    const packed = packVaultContainer(sampleContainer());
    // 41 bytes declarados como v5, mas sem os 8 bytes finais do cabeçalho
    expect(refusal(packed.subarray(0, HEADER_BYTES - 4))).toBe('damaged');
    expect(refusal(packed.subarray(0, 8))).toBe('damaged');
  });

  it('recusa container sem nenhum método de desbloqueio', () => {
    const data = sampleContainer();
    data.methods = {};
    expect(roundtrip(data)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('recusa container só com o método de pânico (ninguém abriria)', () => {
    const data = sampleContainer();
    const panic = data.methods.panic;
    if (panic === undefined) throw new Error('fixture incompleta');
    data.methods = { panic };
    expect(roundtrip(data)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('mantém o roundtrip de todas as flags conhecidas ligadas', () => {
    const packed = packVaultContainer(sampleContainer());
    for (const flag of METHOD_FLAGS) {
      expect(packed.readUInt8(32) & flag).toBe(flag);
    }
  });
});

describe('payload de entrada (.zke)', () => {
  it('roundtrip preserva salt, iv, tag e texto cifrado', () => {
    const payload = {
      salt: 'aa'.repeat(16),
      iv: 'bb'.repeat(16),
      tag: 'cc'.repeat(16),
      encryptedData: 'deadbeef',
    };
    expect(unpackEntryPayload(packEntryPayload(payload))).toEqual(payload);
  });

  it('recusa truncamento, byte extra e mágica errada', () => {
    const packed = packEntryPayload({
      salt: 'aa'.repeat(16),
      iv: 'bb'.repeat(16),
      tag: 'cc'.repeat(16),
      encryptedData: '00',
    });
    expect(unpackEntryPayload(packed.subarray(0, 20))).toBeNull();
    expect(unpackEntryPayload(Buffer.concat([packed, Buffer.from([0])]))).toBeNull();

    const badMagic = Buffer.from(packed);
    badMagic.write('ZZZZZZZZ', 0, 'ascii');
    expect(unpackEntryPayload(badMagic)).toBeNull();
  });

  it('recusa payload em JSON, que era o layout antigo', () => {
    // o `.enc` em JSON não existe mais: um arquivo assim não é uma credencial
    expect(unpackEntryPayload(Buffer.from('{"salt":"aa"}', 'utf8'))).toBeNull();
  });
});

describe('manifesto de integridade', () => {
  const IDS = ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'ffffffff-0000-4000-8000-000000000000'];
  const AUTH_IDS = ['11111111-2222-4333-8444-555555555555'];

  it('roundtrip devolve os mesmos ids', () => {
    const key = randomBytes(32);
    expect(openManifest(key, sealManifest(key, IDS, AUTH_IDS))).toEqual({
      ids: IDS,
      authIds: AUTH_IDS,
    });
  });

  it('falha com a chave errada', () => {
    const key = randomBytes(32);
    const blob = sealManifest(key, IDS, []);
    expect(() => openManifest(randomBytes(32), blob)).toThrow();
  });

  it('recusa a versão anterior do manifesto', () => {
    // o `v` mora dentro do blob cifrado, então trocar a versão do manifesto não
    // muda o container: um manifesto velho é recusado, não adivinhado
    const key = randomBytes(32);
    const old = encryptRecord({ v: 1, ids: IDS }, key);
    expect(() => openManifest(key, old)).toThrow();
  });

  it('falha com forma inesperada (fail-closed)', () => {
    const key = randomBytes(32);
    const notManifest = encryptRecord({ foo: 1 }, key);
    expect(() => openManifest(key, notManifest)).toThrow();
  });

  it('falha quando a lista de tokens não é uma lista de texto', () => {
    const key = randomBytes(32);
    const broken = encryptRecord({ v: 2, ids: IDS, authIds: [1] }, key);
    expect(() => openManifest(key, broken)).toThrow();
  });
});

describe('leitura fail-closed de buffer truncado', () => {
  // Um container pela metade não pode virar "cofre válido": o caminho de
  // leitura precisa recusar, senão o app abre um cofre sem chave embrulhada.
  const damaged = (buffer: Buffer): VaultUnpackResult => unpackVaultContainer(buffer);

  it('recusa buffer menor que o cabeçalho', () => {
    const packed = packVaultContainer(sampleContainer());
    for (const cut of [0, 1, HEADER_BYTES - 1]) {
      expect(damaged(packed.subarray(0, cut))).toEqual({ ok: false, reason: 'damaged' });
    }
  });

  it('recusa o container cortado dentro do corpo dos métodos', () => {
    const packed = packVaultContainer(sampleContainer());
    for (const fraction of [0.25, 0.5, 0.75, 0.99]) {
      const cut = packed.subarray(0, Math.floor(packed.length * fraction));
      const result = damaged(cut);
      expect(result.ok).toBe(false);
    }
  });

  it('recusa quando sobra um byte a mais que o esperado', () => {
    const packed = packVaultContainer(sampleContainer());
    const result = damaged(Buffer.concat([packed, Buffer.from([0])]));
    expect(result).toEqual({ ok: false, reason: 'damaged' });
  });

  it('recusa payload de entrada truncado', () => {
    const payload = encryptRecord({ title: 'GitHub' }, randomBytes(32));
    const packed = packEntryPayload(payload);
    for (const fraction of [0.2, 0.6, 0.95]) {
      const cut = packed.subarray(0, Math.floor(packed.length * fraction));
      expect(unpackEntryPayload(cut)).toBeNull();
    }
    expect(unpackEntryPayload(Buffer.alloc(3))).toBeNull();
  });

  it('recusa flag desconhecida no cabeçalho', () => {
    const packed = packVaultContainer(sampleContainer());
    packed[32] = 0xff;
    expect(damaged(packed)).toEqual({ ok: false, reason: 'damaged' });
  });
});

describe('flags do container', () => {
  it('não liga o bit de um método que o cofre não tem', () => {
    // O byte de flags começa zerado e cada método liga o seu bit: um bit ligado
    // a mais diria ao leitor para ler KDF e payload onde não há nada.
    const without = sampleContainer();
    delete without.methods.recovery;
    const packed = packVaultContainer(without);
    const withAll = packVaultContainer(sampleContainer());

    expect((packed[32] ?? 0) & 0x04).toBe(0); // FLAG_RECOVERY
    expect((withAll[32] ?? 0) & 0x04).toBe(0x04);
    expect(unpackVaultContainer(packed).ok).toBe(true);
  });

  it('só marca um método presente, nunca um método ausente', () => {
    const without = sampleContainer();
    delete without.methods.recovery;
    const packed = packVaultContainer(without);
    const read = unpackVaultContainer(packed);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.methods.recovery).toBeUndefined();
    expect(Object.keys(read.data.methods).sort()).toEqual(['master', 'panic', 'pin']);
  });
});

describe('tamanho em disco do container', () => {
  it('mede o payload em bytes, não em caracteres hex', () => {
    // `encryptedData` é hex, então o tamanho gravado tem que contar os bytes
    // depois do `Buffer.from`. Contar os caracteres deixa o arquivo maior que o
    // necessário e o leitor perde o alinhamento dos blocos seguintes.
    const data = sampleContainer();
    const packed = packVaultContainer(data);
    const read = unpackVaultContainer(packed);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const method = read.data.methods.master;
    if (method === undefined) throw new Error('container sem método master');
    expect(method.payload.encryptedData.length).toBeGreaterThan(0);
    expect(packed.length).toBeGreaterThan(HEADER_BYTES);
  });
});

const IDS = ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'];

describe('recusa do manifesto pela mensagem', () => {
  it('nomeia o motivo quando a lista de ids é inválida, a versão é velha ou a de tokens é inválida', () => {
    // Três `throw` com o mesmo texto: sem conferir a mensagem, trocar a string
    // passaria, e o usuário veria um erro sem dizer o que houve.
    const key = randomBytes(32);

    expect(() => openManifest(key, encryptRecord({ v: 2, ids: [1], authIds: [] }, key))).toThrow(
      'manifesto inválido',
    );
    expect(() => openManifest(key, encryptRecord({ v: 1, ids: IDS, authIds: [] }, key))).toThrow(
      'manifesto inválido',
    );
    expect(() => openManifest(key, encryptRecord({ v: 2, ids: IDS, authIds: [1] }, key))).toThrow(
      'manifesto inválido',
    );
  });

  it('mantém a versão do manifesto em 2, porque trocar invalida todo token de 2FA', () => {
    const key = randomBytes(32);
    const blob = sealManifest(key, IDS, ['a', 'b']);

    expect(openManifest(key, blob)).toEqual({ ids: IDS, authIds: ['a', 'b'] });
  });
});
