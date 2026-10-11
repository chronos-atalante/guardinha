// @vitest-environment node
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vaultDir, entriesDir, legacyVaultDir } from '@zero/main/layout';
import {
  isPermissionError,
  isVaultDirUnavailable,
  migrateHiddenLayout,
  vaultFiles,
  vaultPath,
} from '@zero/main/structure';
import { currentMessages } from '@zero/main/i18n';

/**
 * Utilitários de caminho e de pasta. São a base de toda a segurança de arquivo:
 * se `vaultDir()` ou `authDir()` apontassem para o lugar errado por causa de uma
 * variável de ambiente, o app passaria a cifrar ou apagar no lugar errado.
 */

const ENV_KEYS = ['GUARDINHA_VAULT_DIR', 'GUARDINHA_VAR_LIB', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME'];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  fs.removeSync(vaultDir());
});

afterEach(() => {
  for (const [key, value] of saved) {
    // `undefined` significa "não estava definido"; atribuir string vazia
    // mudaria a leitura de quem checa `!== ''` no `layout.ts`
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

describe('layout:GUARDINHA_VAULT_DIR sobrepõe o caminho completo', () => {
  it('usa o caminho exato quando a variável está de pé', () => {
    process.env.GUARDINHA_VAULT_DIR = '/tmp/cofre-de-teste';
    expect(vaultDir()).toBe('/tmp/cofre-de-teste');
    expect(entriesDir()).toBe(path.join('/tmp/cofre-de-teste', '.entries'));
  });

  it('ignora a variável vazia e volta para /var/lib', () => {
    process.env.GUARDINHA_VAULT_DIR = '';
    delete process.env.GUARDINHA_VAR_LIB;
    expect(vaultDir()).toBe('/var/lib/.guardinha/.vault');
  });

  it('GUARDINHA_VAR_LIB redireciona só a raiz', () => {
    delete process.env.GUARDINHA_VAULT_DIR;
    process.env.GUARDINHA_VAR_LIB = '/tmp/var-lib-de-teste';
    expect(vaultDir()).toBe(path.join('/tmp/var-lib-de-teste', '.guardinha', '.vault'));
  });

  it('o caminho do cofre para o navegador é o mesmo que o do disco', () => {
    process.env.GUARDINHA_VAULT_DIR = '/tmp/cofre-de-teste';
    expect(vaultPath()).toBe(vaultDir());
  });

  it('o cofre legado fica sempre na pasta do usuário', () => {
    expect(legacyVaultDir()).toBe(path.join(process.env.HOME ?? '', '.guardinha-vault'));
  });
});

describe('structure:migração do layout visível para o oculto', () => {
  it('renomeia entries/ para .entries/ quando só o antigo existe', () => {
    fs.ensureDirSync(path.join(vaultDir(), 'entries'));
    fs.writeFileSync(path.join(vaultDir(), 'entries', 'a.zke'), 'x');

    migrateHiddenLayout();

    expect(fs.existsSync(path.join(vaultDir(), '.entries', 'a.zke'))).toBe(true);
    expect(fs.existsSync(path.join(vaultDir(), 'entries'))).toBe(false);
  });

  it('não renomeia quando os dois lados existem (o novo manda)', () => {
    fs.ensureDirSync(path.join(vaultDir(), 'entries'));
    fs.ensureDirSync(path.join(vaultDir(), '.entries'));
    fs.writeFileSync(path.join(vaultDir(), '.entries', 'nova.zke'), 'y');

    migrateHiddenLayout();

    expect(fs.readdirSync(path.join(vaultDir(), '.entries'))).toEqual(['nova.zke']);
  });

  it('não faz nada quando não existe layout antigo', () => {
    expect(() => {
      migrateHiddenLayout();
    }).not.toThrow();
  });
});

describe('structure:erro de permissão', () => {
  it.each(['EACCES', 'EPERM', 'EROFS'])('reconhece %s como falta de permissão', (code) => {
    expect(isPermissionError({ code })).toBe(true);
  });

  it('não confunde outro erro com falta de permissão', () => {
    expect(isPermissionError({ code: 'ENOENT' })).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError(undefined)).toBe(false);
    expect(isPermissionError('texto')).toBe(false);
  });

  it('reconhece o erro de diretório indisponível pela mensagem', () => {
    const m = currentMessages();
    expect(isVaultDirUnavailable(new Error(m.errors.vaultDirUnavailable))).toBe(true);
    expect(isVaultDirUnavailable(new Error('outro erro'))).toBe(false);
    expect(isVaultDirUnavailable('texto')).toBe(false);
  });
});

describe('structure:varredura de arquivos', () => {
  it('vê o container, as entradas e os tokens na mesma lista', () => {
    // o Cryptographic Erase usa esta lista: um diretório esquecido aqui é um
    // segredo que sobra depois da autodestruição
    process.env.GUARDINHA_VAULT_DIR = fs.mkdtempSync(path.join(process.env.HOME ?? '/tmp', 'gv-'));
    fs.ensureDirSync(vaultDir());
    fs.ensureDirSync(entriesDir());
    fs.ensureDirSync(path.join(vaultDir(), '.auth'));
    fs.writeFileSync(path.join(vaultDir(), 'vault.zkv'), 'c');
    fs.writeFileSync(path.join(entriesDir(), 'a.zke'), 'c');
    fs.writeFileSync(path.join(vaultDir(), '.auth', 'b.zka'), 'c');

    const files = vaultFiles().map((file) => path.relative(vaultDir(), file));

    expect(files).toContain('vault.zkv');
    expect(files).toContain(path.join('.entries', 'a.zke'));
    expect(files).toContain(path.join('.auth', 'b.zka'));
  });

  it('ignora diretório que não existe, sem lançar', () => {
    process.env.GUARDINHA_VAULT_DIR = fs.mkdtempSync(path.join(process.env.HOME ?? '/tmp', 'gv-'));
    fs.ensureDirSync(vaultDir());
    expect(() => vaultFiles()).not.toThrow();
    expect(vaultFiles()).toEqual([]);
  });

  it('ignora subpasta, que não é arquivo regular', () => {
    process.env.GUARDINHA_VAULT_DIR = fs.mkdtempSync(path.join(process.env.HOME ?? '/tmp', 'gv-'));
    fs.ensureDirSync(path.join(vaultDir(), '.entries', 'sub'));
    expect(vaultFiles()).toEqual([]);
  });
});
