import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MessagesProvider } from '@zero/renderer/i18n';
import { Authenticator } from '@zero/renderer/components/Authenticator';
import { AuthTokenModal } from '@zero/renderer/components/AuthTokenModal';
import { installApi } from '../mocks/api.ts';
import type { AuthCode, AuthToken } from '@zero/types';

const GITHUB_URI =
  'otpauth://totp/GitHub:alice@github.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub';

function token(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    issuer: 'GitHub',
    account: 'alice@github.com',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function code(id: string, value = '071271', remainingMs = 25_000): AuthCode {
  return { id, code: value, remainingMs };
}

/**
 * O botão de exclusão do card tem `title="Excluir"` e o do diálogo de
 * confirmação também se chama "Excluir": dois elementos, mesmo nome acessível.
 * O do diálogo é o que está no cartão de confirmação, então é o último.
 */
function confirmDelete(): HTMLElement {
  const all = screen.getAllByRole('button', { name: 'Excluir' });
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('diálogo de confirmação não aberto');
  return last;
}

function renderScreen(tokens: AuthToken[], codes: AuthCode[] = []): void {
  const api = installApi({ tokens });
  api.authenticator.codes = () => Promise.resolve(codes);
  render(
    <MessagesProvider language="pt-BR">
      <Authenticator onToast={() => undefined} />
    </MessagesProvider>,
  );
}

describe('tela do verificador 2FA', () => {
  it('mostra o serviço e a conta de cada token', async () => {
    renderScreen([token()], [code('aaaaaaaa-1111-4111-8111-111111111111')]);

    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('alice@github.com')).toBeInTheDocument();
  });

  it('mostra o código que o main calculou, nunca o segredo', async () => {
    renderScreen([token()], [code('aaaaaaaa-1111-4111-8111-111111111111')]);

    expect(await screen.findByText('071271')).toBeInTheDocument();
    expect(screen.queryByText(/GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/)).not.toBeInTheDocument();
  });

  it('mostra o estado vazio com a instrução de como adicionar', async () => {
    renderScreen([]);

    expect(await screen.findByText('Nenhum token ainda')).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\//)).toBeInTheDocument();
  });

  it('nomeia o token sem emissor em vez de deixar a linha em branco', async () => {
    renderScreen([token({ issuer: '', account: 'conta@example.com' })], []);

    expect(await screen.findByText('Sem serviço')).toBeInTheDocument();
    expect(screen.getByText('conta@example.com')).toBeInTheDocument();
  });

  it('pede o código enquanto o token ainda não chegou do main', async () => {
    renderScreen([token()], []);

    expect(await screen.findByText('······')).toBeInTheDocument();
  });

  it('copia o código com limpeza e avisa que ele expira', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [token()] });
    api.authenticator.codes = () => Promise.resolve([code('aaaaaaaa-1111-4111-8111-111111111111')]);
    const copy = vi.fn().mockResolvedValue(undefined);
    api.clipboard.copy = copy;
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('071271')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Copiar'));

    expect(copy).toHaveBeenCalledWith('071271');
    expect(onToast).toHaveBeenCalledWith('Código copiado. Ele expira em poucos segundos.');
  });

  it('avisa quando a cópia falha', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [token()] });
    api.authenticator.codes = () => Promise.resolve([code('aaaaaaaa-1111-4111-8111-111111111111')]);
    api.clipboard.copy = vi.fn().mockRejectedValue(new Error('sem área de transferência'));
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('071271')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Copiar'));

    expect(onToast).toHaveBeenCalledWith('sem área de transferência');
  });

  it('desabilita a cópia enquanto não há código', async () => {
    renderScreen([token()], []);
    await screen.findByText('······');
    expect(screen.getByTitle('Copiar')).toBeDisabled();
  });

  it('exclui o token depois de confirmar, e some da lista', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [token()] });
    const remove = vi.fn().mockResolvedValue([]);
    api.authenticator.remove = remove;
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );
    await screen.findByText('GitHub');

    await user.click(screen.getByTitle('Excluir'));
    expect(screen.getByText(/Esta ação não pode ser desfeita/)).toBeInTheDocument();

    await user.click(confirmDelete());

    expect(remove).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-111111111111');
    await waitFor(() => {
      expect(screen.getByText('Nenhum token ainda')).toBeInTheDocument();
    });
    expect(onToast).toHaveBeenCalledWith('Token removido.');
  });

  it('cancela a exclusão sem chamar o cofre', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [token()] });
    const remove = vi.fn();
    api.authenticator.remove = remove;
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={vi.fn()} />
      </MessagesProvider>,
    );
    await screen.findByText('GitHub');

    await user.click(screen.getByTitle('Excluir'));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('mostra o erro quando a exclusão falha', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [token()] });
    api.authenticator.remove = vi.fn().mockRejectedValue(new Error('Cofre bloqueado.'));
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );
    await screen.findByText('GitHub');

    await user.click(screen.getByTitle('Excluir'));
    await user.click(confirmDelete());

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('Cofre bloqueado.');
    });
  });

  it('avisa quando os tokens não carregam', async () => {
    const api = installApi({ tokens: [] });
    api.authenticator.list = vi.fn().mockRejectedValue(new Error('O cofre está incompleto.'));
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('O cofre está incompleto.');
    });
  });

  it('abre o formulário para criar e para editar', async () => {
    const user = userEvent.setup();
    renderScreen([token()], []);
    await screen.findByText('GitHub');

    await user.click(screen.getByRole('button', { name: 'Adicionar token' }));
    expect(screen.getByText('Novo token de 2FA')).toBeInTheDocument();

    await user.click(screen.getByTitle('Salvar'));
    expect(screen.getByText('Editar token de 2FA')).toBeInTheDocument();
  });

  it('avisa e recarrega depois de salvar pelo formulário', async () => {
    const user = userEvent.setup();
    const api = installApi({ tokens: [] });
    api.authenticator.saveUri = vi.fn().mockResolvedValue([]);
    const onToast = vi.fn();
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={onToast} />
      </MessagesProvider>,
    );
    await screen.findByText('Nenhum token ainda');

    await user.click(screen.getByRole('button', { name: 'Adicionar token' }));
    await user.type(screen.getByRole('textbox'), GITHUB_URI);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith('Token salvo.');
    });
  });

  // O tique é o `setInterval` real de 1 s do componente. Os testes abaixo
  // usam o relógio real em vez de timer falso porque `waitFor` depende de
  // timer para sondar: com o relógio parado, a sondagem nunca acontece e o
  // worker fica pendurado. 1 s por teste é preço justo por um teste que cobre
  // a rotação do código.
  it('pede os códigos de novo quando o período vira', async () => {
    const api = installApi({ tokens: [token()] });
    const codes = vi
      .fn()
      .mockResolvedValueOnce([{ id: token().id, code: '111111', remainingMs: 0 }])
      .mockResolvedValue([{ id: token().id, code: '222222', remainingMs: 30_000 }]);
    api.authenticator.codes = codes;
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={vi.fn()} />
      </MessagesProvider>,
    );

    expect(await screen.findByText('111111')).toBeInTheDocument();

    // o tique de 1 s percebe o código vencido e pede o próximo
    expect(await screen.findByText('222222', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(codes.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('não pede os códigos de novo enquanto o período não vira', async () => {
    const api = installApi({ tokens: [token()] });
    const codes = vi
      .fn()
      .mockResolvedValue([{ id: token().id, code: '111111', remainingMs: 25_000 }]);
    api.authenticator.codes = codes;
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={vi.fn()} />
      </MessagesProvider>,
    );

    expect(await screen.findByText('111111')).toBeInTheDocument();
    const callsAfterMount = codes.mock.calls.length;

    // três tiques passam e o código continua válido: nada de novo é pedido
    await new Promise((resolve) => {
      setTimeout(resolve, 2200);
    });

    expect(codes).toHaveBeenCalledTimes(callsAfterMount);
    expect(screen.getByText('111111')).toBeInTheDocument();
  });

  it('conta o tempo restante no rótulo', async () => {
    const api = installApi({ tokens: [token()] });
    api.authenticator.codes = vi
      .fn()
      .mockResolvedValue([{ id: token().id, code: '111111', remainingMs: 30_000 }]);
    render(
      <MessagesProvider language="pt-BR">
        <Authenticator onToast={vi.fn()} />
      </MessagesProvider>,
    );

    expect(await screen.findByText('expira em 30s')).toBeInTheDocument();
    // o tique de 1 s desconta um segundo do rótulo, sem pedir código novo
    expect(
      await screen.findByText('expira em 29s', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});

describe('modal de token', () => {
  it('prévia o endereço colado antes de salvar, sem gravar nada', async () => {
    const saved = vi.fn();
    const api = installApi();
    api.authenticator.saveUri = saved;
    const user = userEvent.setup();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    await user.type(screen.getByRole('textbox'), GITHUB_URI);

    expect(
      await screen.findByText(/GitHub · alice@github.com · SHA1 · 6 · 30s/),
    ).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
  });

  it('avisa na hora que o endereço colado não serve', async () => {
    // antes só descobria o erro no botão "Salvar"; colar metade do endereço e
    // esperar era o único jeito de perceber que faltava o segredo
    const user = userEvent.setup();
    installApi();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    const field = screen.getByRole('textbox');
    await user.type(field, 'otpauth://totp/GitHub:eu');

    expect(await screen.findByText(/Endereço inválido ou sem segredo/)).toBeInTheDocument();
    // endereço inteiro, sem segredo, também é recusado com a mesma mensagem
    await user.clear(field);
    await user.type(field, 'otpauth://totp/GitHub:eu?issuer=GitHub');
    expect(await screen.findByText(/Endereço inválido ou sem segredo/)).toBeInTheDocument();
  });

  it('não reclama enquanto o campo está vazio', () => {
    installApi();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tira o aviso assim que o endereço fica válido', async () => {
    const user = userEvent.setup();
    installApi();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    const field = screen.getByRole('textbox');
    await user.type(field, 'lixo');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, GITHUB_URI);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('manda o endereço inteiro para o main e não monta o segredo na tela', async () => {
    const saved = vi.fn();
    const api = installApi();
    api.authenticator.saveUri = saved.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    await user.type(screen.getByRole('textbox'), GITHUB_URI);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(saved).toHaveBeenCalledWith(GITHUB_URI);
    });
  });

  it('avisa quando o main recusa o endereço, sem fechar o formulário', async () => {
    const api = installApi();
    api.authenticator.saveUri = vi
      .fn()
      .mockRejectedValue(new Error('Endereço `otpauth://` inválido.'));
    const user = userEvent.setup();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    await user.type(screen.getByRole('textbox'), 'https://exemplo.com');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Endereço `otpauth://` inválido.')).toBeInTheDocument();
  });

  it('na aba dos campos, edita manda o segredo e preserva o id', async () => {
    const saved = vi.fn();
    const api = installApi();
    api.authenticator.save = saved.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={token()}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    // abrir para editar já vem nos campos, com o serviço preenchido
    expect(screen.getByDisplayValue('GitHub')).toBeInTheDocument();
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await user.type(screen.getByPlaceholderText('JBSW Y3DP EHPK 3PXP'), secret);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          issuer: 'GitHub',
          secret,
        }),
      );
    });
  });

  it('oferece SHA256 e SHA512, porque alguns serviços não usam SHA1', async () => {
    const user = userEvent.setup();
    render(
      <MessagesProvider language="pt-BR">
        <AuthTokenModal
          token={null}
          onClose={() => undefined}
          onSaved={() => undefined}
          onError={() => undefined}
        />
      </MessagesProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Digitar a chave' }));

    // o campo é o listbox do app, então as opções só existem com o menu aberto
    await user.click(screen.getByRole('button', { name: 'Algoritmo' }));

    expect(screen.getByRole('option', { name: 'SHA1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SHA256' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SHA512' })).toBeInTheDocument();
  });

  /**
   * As dicas usam os marcadores `**negrito**` e `` `código` ``, e saem por
   * `richText`. Renderizadas como texto puro elas mostravam os asteriscos e as
   * crases para o usuário, então o teste olha os elementos, não a string.
   */
  describe('marcadores ricos nas dicas', () => {
    it('destaque e código viram elementos na aba do endereço', () => {
      render(
        <MessagesProvider language="pt-BR">
          <AuthTokenModal
            token={null}
            onClose={() => undefined}
            onSaved={() => undefined}
            onError={() => undefined}
          />
        </MessagesProvider>,
      );

      expect(screen.getByText('dentro do cofre', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('destaque e código viram elementos na aba dos campos', async () => {
      const user = userEvent.setup();
      render(
        <MessagesProvider language="pt-BR">
          <AuthTokenModal
            token={null}
            onClose={() => undefined}
            onSaved={() => undefined}
            onError={() => undefined}
          />
        </MessagesProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Digitar a chave' }));

      // "SHA1" também é o valor que o campo do algoritmo mostra, daí o selector
      expect(screen.getByText('SHA1', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('o aviso de endereço inválido também formata o trecho de código', async () => {
      const user = userEvent.setup();
      installApi();
      render(
        <MessagesProvider language="pt-BR">
          <AuthTokenModal
            token={null}
            onClose={() => undefined}
            onSaved={() => undefined}
            onError={() => undefined}
          />
        </MessagesProvider>,
      );

      await user.type(screen.getByRole('textbox'), 'otpauth://totp/GitHub:eu');

      expect(await screen.findByText('otpauth://totp/', { selector: 'code' })).toBeInTheDocument();
    });

    it('o estado vazio do 2FA formata o endereço', async () => {
      renderScreen([]);
      expect(await screen.findByText('otpauth://', { selector: 'code' })).toBeInTheDocument();
    });
  });
});
