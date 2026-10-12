// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as privilege from '@zero/main/privilege';
import { vaultStorage } from '@zero/main/facade';
import { currentMessages } from '@zero/main/i18n';
import { createVault } from '@zero/main/vault';

const INPUT = {
  masterPassword: 'senha-mestra-guardinha24',
  pin: '49201733',
  recoveryPhrase: 'Na feira de hoje o cavalo branco comeu exatamente doze cenouras gigantes',
};

describe('retentativa de criação após setup privilegiado', () => {
  it('devolve a causa explícita de uma falha não relacionada a permissão', async () => {
    vi.spyOn(vaultStorage, 'exists').mockReturnValue(false);
    vi.spyOn(vaultStorage, 'ensureStructure').mockImplementationOnce(() => {
      throw new Error('disco indisponível');
    });

    await expect(createVault(INPUT)).resolves.toMatchObject({
      ok: false,
      error: 'disco indisponível',
    });
  });

  it('usa erro interno se o setup privilegiado falha com valor não Error', async () => {
    const m = currentMessages();
    vi.spyOn(vaultStorage, 'exists').mockReturnValue(false);
    vi.spyOn(vaultStorage, 'ensureStructure')
      .mockImplementationOnce(() => {
        throw new Error(m.errors.vaultDirUnavailable);
      })
      .mockImplementationOnce(() => {
        throw 'falha sem Error';
      });
    vi.spyOn(privilege, 'setupVaultDirectory').mockReturnValue(true);

    await expect(createVault(INPUT)).resolves.toMatchObject({
      ok: false,
      error: m.errors.internal,
    });
  });

  it('recusa se o cofre aparecer durante a retentativa privilegiada', async () => {
    const m = currentMessages();
    vi.spyOn(vaultStorage, 'exists').mockReturnValueOnce(false).mockReturnValue(true);
    vi.spyOn(vaultStorage, 'ensureStructure').mockImplementationOnce(() => {
      throw new Error(m.errors.vaultDirUnavailable);
    });
    vi.spyOn(privilege, 'setupVaultDirectory').mockReturnValue(true);

    await expect(createVault(INPUT)).resolves.toMatchObject({
      ok: false,
      error: m.errors.vaultExists,
    });
  });
});
