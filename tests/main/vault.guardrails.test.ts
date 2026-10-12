// @vitest-environment node
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentMessages } from '@zero/main/i18n';
import { clearDestroyedFlag } from '@zero/main/erasure-state';
import { vaultSession } from '@zero/main/session';
import * as unwrapping from '@zero/main/unwrapping';
import {
  createVault,
  getStatus,
  panicStatus,
  resetPin,
  setNukeLimit,
  setPanicPin,
  unlock,
} from '@zero/main/vault';
import { readAuthState, writeAuthState } from '@zero/main/storage';
import { containerFile } from '@zero/main/layout';
import type { PersistedAuthState } from '@zero/main/storage';

/**
 * Ramas de decisão do cofre que os testes de fluxo não alcançam: estados
 * ausentes, limites fora da faixa e a autodestruição por tentativas. São os
 * caminhos que decidem se o cofre sobrevive, então cada um ganha teste próprio.
 */

const MASTER = 'senha-mestra-guardinha24';
const PIN = '49201733';
const OTHER_PIN = '73918264';
const PHRASE = 'Na feira de hoje o cavalo branco comeu exatamente doze cenouras gigantes';

const NEUTRAL: PersistedAuthState = {
  attempts: 0,
  lockUntil: null,
  attemptsMaster: 0,
  nukeLimit: 0,
};

// um cofre só para os três blocos: `createVault` recusa a segunda vez, e
// derivar Argon2id de novo a cada bloco tornaria a suíte lenta sem ganho
beforeAll(async () => {
  const result = await createVault({
    masterPassword: MASTER,
    pin: PIN,
    recoveryPhrase: PHRASE,
  });
  expect(result.ok).toBe(true);
}, 120_000);

describe('limite estrito de tentativas', () => {
  it('recusa limite que não é inteiro ou é negativo', () => {
    const m = currentMessages();
    expect(setNukeLimit(12.5)).toEqual(
      expect.objectContaining({ ok: false, error: m.errors.invalidNukeLimit }),
    );
    expect(setNukeLimit(Number.NaN)).toEqual(
      expect.objectContaining({ ok: false, error: m.errors.invalidNukeLimit }),
    );
    expect(setNukeLimit(-1)).toEqual(
      expect.objectContaining({ ok: false, error: m.errors.invalidNukeLimit }),
    );
  });

  it('recusa limite ligado abaixo do piso, para não confundir com erro de digitação', () => {
    const m = currentMessages();
    expect(setNukeLimit(10)).toEqual(
      expect.objectContaining({ ok: false, error: m.errors.nukeLimitTooLow }),
    );
  });

  it('aceita desligar com 0 e qualquer valor no piso ou acima', () => {
    expect(setNukeLimit(0).ok).toBe(true);
    expect(setNukeLimit(50).ok).toBe(true);
  });

  it('recomeça a contagem quando o limite muda de valor', () => {
    setNukeLimit(80);
    // a contagem anterior foi medida contra outro teto e não vale para o novo
    const state = readAuthState();
    expect(state.nukeLimit).toBe(80);
    expect(state.attemptsMaster).toBe(0);
    setNukeLimit(0);
  });

  it('o limite sobrevive ao reset da trava, por ser configuração do cofre', () => {
    setNukeLimit(60);
    writeAuthState({ ...NEUTRAL, nukeLimit: 60 });
    expect(readAuthState().nukeLimit).toBe(60);
    setNukeLimit(0);
  });

  it('o estado das proteções reflete o limite gravado', () => {
    setNukeLimit(70);
    expect(panicStatus().nukeLimit).toBe(70);
    setNukeLimit(0);
    expect(panicStatus().nukeLimit).toBe(0);
  });
});

describe('PIN de coação', () => {
  it('exige cofre desbloqueado', async () => {
    vaultSession().wipe();
    const result = await setPanicPin({ pin: OTHER_PIN });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: currentMessages().errors.vaultLocked }),
    );
  });

  it('exige 8 dígitos e recusa PIN previsível, com o cofre aberto', async () => {
    const m = currentMessages();
    await unlock({ credential: PIN, kind: 'pin' });

    expect((await setPanicPin({ pin: '1234' })).error).toBe(m.errors.invalidPin);
    expect((await setPanicPin({ pin: '12345678' })).error).toBe(m.errors.trivialPin);
  });

  it('recusa o PIN de coação igual ao PIN que abre o cofre', async () => {
    const m = currentMessages();
    await unlock({ credential: PIN, kind: 'pin' });
    const result = await setPanicPin({ pin: PIN });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: m.errors.panicPinSame }));
  });

  it('recusa PIN de coação previsível mesmo depois de um válido', async () => {
    const m = currentMessages();
    await unlock({ credential: PIN, kind: 'pin' });
    await setPanicPin({ pin: OTHER_PIN });
    expect(panicStatus().hasPanicPin).toBe(true);
    expect((await setPanicPin({ pin: '00000000' })).error).toBe(m.errors.trivialPin);
  });
});

describe('redefinição de PIN', () => {
  it('recusa frase curta mesmo com formato válido', async () => {
    const m = currentMessages();
    vaultSession().wipe();
    writeAuthState(NEUTRAL);
    const result = await resetPin({ phrase: 'poucas palavras', newPin: OTHER_PIN });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(m.errors.wrongRecovery);
  });

  it('recusa PIN malformado antes de gastar a derivação', async () => {
    const m = currentMessages();
    writeAuthState(NEUTRAL);
    expect((await resetPin({ phrase: PHRASE, newPin: '1234' })).error).toBe(m.errors.invalidPin);
    expect((await resetPin({ phrase: PHRASE, newPin: '12345678' })).error).toBe(
      m.errors.trivialPin,
    );
  });

  it('recusa enquanto a trava exponencial está de pé', async () => {
    writeAuthState({ ...NEUTRAL, attempts: 3, lockUntil: Date.now() + 60_000 });
    const result = await resetPin({ phrase: PHRASE, newPin: OTHER_PIN });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Muitas tentativas');
    writeAuthState(NEUTRAL);
  });

  it('recusa frase que não é a do usuário', async () => {
    writeAuthState(NEUTRAL);
    const result = await resetPin({
      phrase: 'outra frase completamente diferente escrita aqui agora',
      newPin: OTHER_PIN,
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: currentMessages().errors.wrongRecovery }),
    );
  });

  it('reembrulha a frase quando o perfil de custo está desatualizado', async () => {
    writeAuthState(NEUTRAL);
    const recovery = unwrapping.keyUnwrapperFor('recovery');
    const checkKdf = vi.spyOn(unwrapping, 'isKdfUpToDate').mockReturnValue(false);
    const wrap = vi.spyOn(recovery, 'wrap');

    const result = await resetPin({ phrase: PHRASE, newPin: OTHER_PIN });

    expect(result.ok).toBe(true);
    expect(checkKdf).toHaveBeenCalledWith('recovery', expect.any(Object));
    expect(wrap).toHaveBeenCalledOnce();
  });
});

describe('cofre ausente', () => {
  // diretório próprio e vazio: nada de `vault.zkv` para as funções acharem
  let previousDir: string | undefined;

  beforeEach(() => {
    previousDir = process.env.GUARDINHA_VAULT_DIR;
    process.env.GUARDINHA_VAULT_DIR = fs.mkdtempSync(
      path.join(process.env.HOME ?? '/tmp', 'sem-cofre-'),
    );
  });

  afterEach(() => {
    clearDestroyedFlag();
    if (previousDir === undefined) delete process.env.GUARDINHA_VAULT_DIR;
    else process.env.GUARDINHA_VAULT_DIR = previousDir;
  });

  it('o estado de trava devolve o neutro, sem estourar', () => {
    // sem `vault.zkv`, ler o estado precisa dar zero em vez de lançar: é o
    // que `vault:status` responde no primeiro start
    expect(readAuthState()).toEqual(NEUTRAL);
  });

  it('as proteções de pânico aparecem desligadas', () => {
    expect(panicStatus()).toEqual({ hasPanicPin: false, nukeLimit: 0, attemptsMaster: 0 });
  });

  it('escrever estado de trava não recria o cofre do nada', () => {
    writeAuthState({ ...NEUTRAL, attempts: 2, lockUntil: Date.now() + 1000 });
    expect(getStatus().exists).toBe(false);
    expect(fs.existsSync(containerFile())).toBe(false);
  });
});
