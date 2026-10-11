import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MessagesProvider } from '@zero/renderer/i18n';
import { Authenticator } from '@zero/renderer/components/Authenticator';
import { AuthTokenModal } from '@zero/renderer/components/AuthTokenModal';
import { installApi } from '../mocks/api.ts';
import type { AuthCode, AuthToken } from '@zero/types';

const GITHUB_URI = 'otpauth://totp/GitHub:alice@github.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub';

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
    expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).not.toBeInTheDocument();
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
    await user.type(screen.getByPlaceholderText('JBSW Y3DP EHPK 3PXP'), 'MZXW6YTBOI');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          issuer: 'GitHub',
          secret: 'MZXW6YTBOI',
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

    expect(screen.getByRole('option', { name: 'SHA1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SHA256' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SHA512' })).toBeInTheDocument();
  });
});
