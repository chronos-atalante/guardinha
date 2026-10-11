// @vitest-environment node
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { authDir, vaultDir } from '@zero/main/layout';
import {
  currentCodes,
  listTokens,
  removeToken,
  saveToken,
  saveTokenFromUri,
} from '@zero/main/authenticator';
import { encryptAuthRecord } from '@zero/main/crypto';
import { writeAuthPayload } from '@zero/main/auth-store';
import { currentMessages } from '@zero/main/i18n';
import { vaultStorage } from '@zero/main/facade';
import { createVault, requireSessionKey } from '@zero/main/vault';

const MASTER = 'senha-mestra-guardinha24';
const PIN = '49201733';
const PHRASE = 'Na feira de hoje o cavalo branco comeu exatamente doze cenouras gigantes';

const TAMPERED = currentMessages().errors.vaultTampered;
const STRONG_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const GITHUB_URI = `otpauth://totp/GitHub:alice@github.com?secret=${STRONG_SECRET}&issuer=GitHub`;

function draft(overrides: Record<string, unknown> = {}): {
  issuer: string;
  account: string;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  secret: string;
} {
  return {
    issuer: 'GitHub',
    account: 'alice',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: STRONG_SECRET,
    ...overrides,
  };
}

describe('tokens de 2FA', () => {
  beforeAll(async () => {
    const result = await createVault({
      masterPassword: MASTER,
      pin: PIN,
      recoveryPhrase: PHRASE,
    });
    expect(result.ok).toBe(true);
  }, 120_000);

  it('a pasta dos tokens fica dentro do cofre, com modo 0700', () => {
    expect(authDir().startsWith(vaultDir())).toBe(true);
    expect(authDir().endsWith('.auth')).toBe(true);
    expect(fs.statSync(authDir()).mode & 0o777).toBe(0o700);
  });

  it('salva a partir do endereço otpauth:// e devolve os metadados', () => {
    const tokens = saveTokenFromUri(GITHUB_URI);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      issuer: 'GitHub',
      account: 'alice@github.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('NENHUM retorno carrega o segredo: só id, rótulo e parâmetros', () => {
    const [token] = saveTokenFromUri(GITHUB_URI);
    const serialized = JSON.stringify([token, listTokens(), currentCodes()]);
    expect(serialized).not.toContain(STRONG_SECRET);
    expect(token).not.toHaveProperty('secret');
  });

  it('o segredo fica cifrado em arquivo próprio, em 0600, sem o texto em claro', () => {
    const [token] = saveTokenFromUri(GITHUB_URI);
    const file = `${authDir()}/${token?.id}.zka`;
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const raw = fs.readFileSync(file).toString('latin1');
    expect(raw).not.toContain(STRONG_SECRET);
    expect(raw).not.toContain('GitHub');
  });

  it('um token por arquivo, como as credenciais', () => {
    saveTokenFromUri(GITHUB_URI);
    const second = saveToken(draft({ issuer: 'Discord', account: 'morgan#4321' }));
    const files = fs.readdirSync(authDir()).filter((name) => name.endsWith('.zka'));
    expect(files.length).toBe(second.length);
  });

  it('o código gerado bate com o cálculo de referência', () => {
    const [token] = saveTokenFromUri(GITHUB_URI);
    // vetor RFC 6238: a chave "12345678901234567890" em Base32
    const codes = currentCodes(1111111109 * 1000);
    expect(codes.find((item) => item.id === token?.id)?.code).toBe('081804');
  });

  it('devolve o tempo restante do período, para a barra da tela', () => {
    saveTokenFromUri(GITHUB_URI);
    const [code] = currentCodes(1111111109 * 1000);
    expect(code?.remainingMs).toBeGreaterThan(0);
    expect(code?.remainingMs).toBeLessThanOrEqual(30_000);
  });

  it('recusa segredo fora do alfabeto base32 ou menor que 128 bits', () => {
    expect(() => saveToken(draft({ secret: 'JBSWY3DP1EHPK3PXP' }))).toThrow(
      currentMessages().errors.invalidAuthSecret,
    );
    expect(() => saveToken(draft({ secret: 'JBSWY3DPEHPK3PXP' }))).toThrow(
      currentMessages().errors.invalidAuthSecret,
    );
    expect(() => saveToken(draft({ secret: 'A'.repeat(25) }))).toThrow(
      currentMessages().errors.invalidAuthSecret,
    );
    expect(() => saveToken(draft({ secret: 'AA' }))).toThrow(
      currentMessages().errors.invalidAuthSecret,
    );
    expect(() => saveToken(draft({ secret: '' }))).toThrow(
      currentMessages().errors.invalidAuthSecret,
    );
  });

  it('recusa parâmetros fora da faixa', () => {
    expect(() => saveToken(draft({ digits: 7 }))).toThrow(
      currentMessages().errors.invalidAuthToken,
    );
    expect(() => saveToken(draft({ period: 0 }))).toThrow(
      currentMessages().errors.invalidAuthToken,
    );
  });

  it('recusa endereço otpauth:// inválido com a mensagem do formato', () => {
    expect(() => saveTokenFromUri('https://exemplo.com')).toThrow(
      currentMessages().errors.invalidAuthTokenUri,
    );
    expect(() => saveTokenFromUri('otpauth://hotp/Banco:eu?secret=JBSWY3DPEHPK3PXP')).toThrow(
      currentMessages().errors.invalidAuthTokenUri,
    );
  });

  it('responde adulteração quando o registro decifrado não tem a forma', () => {
    const key = requireSessionKey();
    const id = vaultStorage.newId();
    writeAuthPayload(id, encryptAuthRecord({ id, issuer: 'X', digits: 'seis' }, key));
    expect(() => vaultStorage.readAuthSecret(id, key)).toThrow(TAMPERED);
    removeToken(id);
  });

  it('recusa id que não é UUID, para não virar rota de path traversal', () => {
    expect(() => removeToken('../../etc/passwd')).toThrow(currentMessages().errors.invalidId);
    // UUID bem formado, porém de um token que não existe
    expect(() => removeToken('00000000-0000-4000-8000-000000000000')).toThrow(
      currentMessages().errors.authTokenNotFound,
    );
  });

  it('responde adulteração quando alguém planta um arquivo fora do app', () => {
    const key = requireSessionKey();
    // o caso que o manifesto existe para fechar: um `.zka` plantado que o cofre
    // nunca gravou passaria como token legítimo se o manifesto não contasse
    const id = vaultStorage.newId();
    writeAuthPayload(id, {
      ...encryptAuthRecord(
        {
          id,
          issuer: 'Planta',
          account: 'atacante',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: STRONG_SECRET,
          createdAt: 1,
          updatedAt: 1,
        },
        key,
      ),
    });
    expect(() => listTokens()).toThrow(TAMPERED);
    // devolvido ao manifesto, o token plantado passa a ser um token normal
    vaultStorage.updateManifest(key);
    expect(listTokens().some((token) => token.id === id)).toBe(true);
    removeToken(id);
    expect(() => listTokens()).not.toThrow();
  });

  it('responde adulteração quando o registro decifrado está incompleto', () => {
    const key = requireSessionKey();
    const id = vaultStorage.newId();
    // falta createdAt/updatedAt: `asAuthSecret` recusa (fail-closed)
    writeAuthPayload(id, encryptAuthRecord({ id, issuer: 'X', digits: 6 }, key));
    vaultStorage.updateManifest(key);
    expect(() => listTokens()).toThrow(TAMPERED);
    removeToken(id);
  });

  it('remove o arquivo e re-sela o manifesto', () => {
    const [token] = saveTokenFromUri(GITHUB_URI);
    const id = token?.id ?? '';
    const file = `${authDir()}/${id}.zka`;
    removeToken(id);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => listTokens()).not.toThrow();
  });

  it('atualizar preserva o id e a data de criação', () => {
    const [created] = saveToken(draft({ account: 'antes' }));
    const id = created?.id ?? '';
    const updated = saveToken({ ...draft({ account: 'depois' }), id });
    expect(updated[0]?.id).toBe(id);
    expect(updated[0]?.account).toBe('depois');
    expect(updated[0]?.createdAt).toBe(created?.createdAt);
    removeToken(id);
  });
});
