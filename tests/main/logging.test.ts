import { describe, expect, it } from 'vitest';
import { app } from '../mocks/electron.ts';
import { quietChromiumLog } from '@zero/main/logging';

/**
 * O `log-level=3` cala o log nativo do Chromium (o `atom_cache.cc` que reclama
 * dos MIME types do portal quando o clipboard do X11 é lido), e só ele: as
 * mensagens do app passam por `console`, e o driver de vídeo escreve direto no
 * stderr. Quem depura GPU/Vulkan sobe com `--log-level=0` na linha de comando e
 * o log volta inteiro, então o switch dado por fora tem de ganhar.
 */

function resetMocks(): void {
  app.commandLine.appendSwitch.mockClear();
  app.commandLine.hasSwitch.mockReset().mockReturnValue(false);
}

describe('log do Chromium', () => {
  it('rebaixa o log nativo para só FATAL', () => {
    resetMocks();

    quietChromiumLog();

    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('log-level', '3');
  });

  it('respeita o --log-level que veio na linha de comando', () => {
    resetMocks();
    app.commandLine.hasSwitch.mockReturnValue(true);

    quietChromiumLog();

    // quem chamou com `--log-level=0` está depurando de propósito
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
