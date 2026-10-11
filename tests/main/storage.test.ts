// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packEntryPayload, packVaultContainer } from '@zero/main/container';
import { currentMessages } from '@zero/main/i18n';
import {
  deleteEntry,
  listEntryIds,
  readEntryPayload,
  writeEntryPayload,
} from '@zero/main/entries-store';
import { ensureVaultStructure } from '@zero/main/structure';
import { readVaultContainer, vaultExists, writeVaultContainer } from '@zero/main/storage';
import type { VaultContainerData } from '@zero/main/container';

/**
 * Container e arquivos de credencial no layout atual. O formato do cofre não
 * tem mais caminho de leitura legado: o que o app grava é o que ele lê.
 */

const ENTRY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENTRY_PAYLOAD = {
  salt: 'ff'.repeat(16),
  iv: '00'.repeat(16),
  tag: '99'.repeat(16),
  encryptedData: 'ab',
};

const KDF = { algo: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 4 } as const;

function container(): VaultContainerData {
  return {
    createdAt: 1_770_000_000_000,
    attempts: 1,
    lockUntil: null,
    attemptsMaster: 0,
    nukeLimit: 0,
    methods: {
      master: {
        kdf: KDF,
        kdfSalt: 'ab'.repeat(16),
        payload: {
          salt: 'cd'.repeat(16),
          iv: 'ef'.repeat(16),
          tag: '12'.repeat(16),
          encryptedData: '34',
        },
      },
    },
    manifest: null,
  };
}

interface SavedEnv {
  HOME: string | undefined;
  GUARDINHA_VAULT_DIR: string | undefined;
  GUARDINHA_VAR_LIB: string | undefined;
}

let savedEnv: SavedEnv;
const tempRoots: string[] = [];

function targetVaultDir(): string {
  return path.join(process.env.GUARDINHA_VAR_LIB ?? '', '.guardinha', '.vault');
}

beforeAll(() => {
  savedEnv = {
    HOME: process.env.HOME,
    GUARDINHA_VAULT_DIR: process.env.GUARDINHA_VAULT_DIR,
    GUARDINHA_VAR_LIB: process.env.GUARDINHA_VAR_LIB,
  };
  const varLib = fs.mkdtempSync(path.join(os.tmpdir(), 'guardinha-storage-'));
  tempRoots.push(varLib);
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'guardinha-storage-home-'));
  process.env.GUARDINHA_VAR_LIB = varLib;
  delete process.env.GUARDINHA_VAULT_DIR;
});

afterAll(() => {
  process.env.HOME = savedEnv.HOME;
  if (savedEnv.GUARDINHA_VAULT_DIR === undefined) delete process.env.GUARDINHA_VAULT_DIR;
  else process.env.GUARDINHA_VAULT_DIR = savedEnv.GUARDINHA_VAULT_DIR;
  if (savedEnv.GUARDINHA_VAR_LIB === undefined) delete process.env.GUARDINHA_VAR_LIB;
  else process.env.GUARDINHA_VAR_LIB = savedEnv.GUARDINHA_VAR_LIB;
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('container do cofre no layout atual', () => {
  beforeAll(() => {
    ensureVaultStructure();
    writeVaultContainer(container());
  });

  it('grava e lê o container', () => {
    expect(vaultExists()).toBe(true);
    const read = readVaultContainer();
    expect(read?.createdAt).toBe(1_770_000_000_000);
    expect(read?.methods.master?.kdfSalt).toBe('ab'.repeat(16));
    expect(read?.attempts).toBe(1);
  });

  it('usa permissões restritas (0700 nas pastas, 0600 nos arquivos)', () => {
    ensureVaultStructure();
    writeEntryPayload(ENTRY_ID, ENTRY_PAYLOAD);
    expect(fs.statSync(targetVaultDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(targetVaultDir(), '.entries')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(targetVaultDir(), 'vault.zkv')).mode & 0o777).toBe(0o600);
    expect(
      fs.statSync(path.join(targetVaultDir(), '.entries', `${ENTRY_ID}.zke`)).mode & 0o777,
    ).toBe(0o600);
  });

  it('é idempotente (rodar de novo não altera o container)', () => {
    const containerPath = path.join(targetVaultDir(), 'vault.zkv');
    const before = fs.readFileSync(containerPath);
    expect(vaultExists()).toBe(true);
    expect(readVaultContainer()).not.toBeNull();
    expect(fs.readFileSync(containerPath).equals(before)).toBe(true);
  });

  it('grava a credencial em .entries/ e a lê de volta', () => {
    expect(listEntryIds()).toContain(ENTRY_ID);
    expect(readEntryPayload(ENTRY_ID)).toEqual(ENTRY_PAYLOAD);
    expect(fs.existsSync(path.join(targetVaultDir(), '.entries', `${ENTRY_ID}.zke`))).toBe(true);
  });

  it('não existe mais layout visível nem extensão legada', () => {
    const entries = path.join(targetVaultDir(), '.entries');
    expect(fs.existsSync(path.join(targetVaultDir(), 'entries'))).toBe(false);
    // `.enc` foi o payload em JSON de uma versão que não existe mais
    expect(fs.existsSync(path.join(entries, `${ENTRY_ID}.enc`))).toBe(false);
  });

  it('empacota o container com o magic esperado', () => {
    const raw = packVaultContainer(container());
    expect(raw.subarray(0, 8).toString('ascii')).toBe('ZKVAULT1');
    expect(packEntryPayload(ENTRY_PAYLOAD).subarray(0, 8).toString('ascii')).toBe('ZENTRY01');
  });
});

describe('path traversal bloqueado na camada de storage (CVE-2026-21589)', () => {
  it('recusa id com separador, nulo ou vazio antes de montar o caminho', () => {
    expect(() => readEntryPayload('../../vault.zkv')).toThrow(currentMessages().errors.invalidId);
    expect(() => writeEntryPayload('..\\..\\fora', ENTRY_PAYLOAD)).toThrow(
      currentMessages().errors.invalidId,
    );
    expect(() => deleteEntry('/etc/passwd')).toThrow(currentMessages().errors.invalidId);
    expect(() => deleteEntry('')).toThrow(currentMessages().errors.invalidId);
    expect(() => deleteEntry(String.fromCharCode(0))).toThrow(currentMessages().errors.invalidId);
  });
});
