// @vitest-environment node
import fs from 'node:fs';
import fsExtra from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TEMP_SUFFIX, writeSecretFile } from '@zero/main/structure';

/**
 * A escrita atômica do cofre mora em um lugar só. Ela foi copiada quatro vezes
 * (container, credencial, token de 2FA e preferências) e as cópias já tinham
 * divergido. Os testes fixam o que a primitiva promete, que é o que nenhuma das
 * cópias garantia sozinha.
 */

let dir: string;
let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardinha-structure-'));
  dir = path.join(root, 'cofre');
  fs.mkdirSync(dir);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function mode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

describe('writeSecretFile', () => {
  it('grava o conteúdo no destino', () => {
    const file = path.join(dir, 'conteudo.zkv');
    writeSecretFile(file, Buffer.from('conteudo cifrado', 'utf8'));
    expect(fs.readFileSync(file, 'utf8')).toBe('conteudo cifrado');
  });

  it('aceita texto, como o `settings.json` grava', () => {
    const file = path.join(dir, 'settings.json');
    writeSecretFile(file, JSON.stringify({ language: 'pt-BR' }, null, 2));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ language: 'pt-BR' });
  });

  it('deixa o arquivo em 0600', () => {
    const file = path.join(dir, 'novo.zke');
    writeSecretFile(file, 'segredo');
    expect(mode(file)).toBe(0o600);
  });

  it('deixa o arquivo em 0600 mesmo com umask permissivo', () => {
    // O `mode` do `writeFileSync` é a primeira linha de defesa; com umask 0 o
    // padrão do sistema seria 0666. Este é o teste que pega a cópia que esqueceu
    // do `{ mode }`: sem ele, e com umask frouxo, o segredo nascia legível.
    const before = process.umask(0o000);
    try {
      const file = path.join(dir, 'umask.zke');
      writeSecretFile(file, 'segredo');
      expect(mode(file)).toBe(0o600);
    } finally {
      process.umask(before);
    }
  });

  it('cria o temporário em 0600, antes do rename', () => {
    // O `chmod` só alcança o destino. A janela em que o `.tmp` existe em disco
    // é coberta só pelo `mode` do `writeFileSync`, então é ela que se inspeciona.
    const file = path.join(dir, 'janela.zka');
    const seen: number[] = [];
    const original = fsExtra.renameSync;
    vi.spyOn(fsExtra, 'renameSync').mockImplementation((from, to) => {
      seen.push(fs.statSync(from).mode & 0o777);
      original(from, to);
    });
    try {
      writeSecretFile(file, 'segredo');
    } finally {
      vi.restoreAllMocks();
    }
    expect(seen).toEqual([0o600]);
    expect(fs.existsSync(`${file}${TEMP_SUFFIX}`)).toBe(false);
  });

  it('sobrescreve sem deixar o temporário para trás', () => {
    // Deixar `.tmp` em disco é o que a varredura de órfãos limpa depois; a
    // escrita normal não pode produzir um.
    const file = path.join(dir, 'sobrescrito.zka');
    writeSecretFile(file, 'primeira');
    writeSecretFile(file, 'segunda');
    expect(fs.readFileSync(file, 'utf8')).toBe('segunda');
    expect(fs.existsSync(`${file}${TEMP_SUFFIX}`)).toBe(false);
  });

  it('não mexe no destino quando o rename falha', () => {
    // A garantia real do `.tmp` + `rename`: um erro depois de gravar o
    // temporário e antes de trocar o inode deixa o destino como estava, em vez
    // de um arquivo pela metade. Sem o `rename`, esta escrita destrói o anterior.
    const file = path.join(dir, 'intacto.zkv');
    writeSecretFile(file, 'bom');
    vi.spyOn(fsExtra, 'renameSync').mockImplementation(() => {
      throw new Error('disco cheio');
    });
    try {
      expect(() => writeSecretFile(file, 'novo')).toThrow('disco cheio');
    } finally {
      vi.restoreAllMocks();
    }
    expect(fs.readFileSync(file, 'utf8')).toBe('bom');
  });

  it('propaga o erro quando o destino não é gravável', () => {
    const file = path.join(dir, 'sem-pasta', 'sub.zkv');
    expect(() => writeSecretFile(file, 'falha')).toThrow();
  });
});
