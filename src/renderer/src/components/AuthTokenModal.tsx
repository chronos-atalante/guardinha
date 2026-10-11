import { useState } from 'react';
import type { JSX } from 'react';
import { X } from 'lucide-react';
import { useMessages } from '@zero/renderer/i18n';
import { OTP_ALGORITHMS, OTP_DIGIT_CHOICES, OTP_PERIOD_RANGE, parseOtpAuthUri } from '@zero/shared';
import type { OtpAlgorithm } from '@zero/shared';
import type { AuthToken, AuthTokenDraft } from '@zero/types';

/**
 * Formulário de token de 2FA, com duas entradas para o mesmo segredo:
 *
 * - `otpauth://`, que é o que o serviço entrega quando você escolhe "não posso
 *   escanear agora"; o endereço já traz emissor, conta e parâmetros certos;
 * - a chave em Base32 e os campos à mão, para quem copiou os 32 caracteres de
 *   um serviço que não oferece link.
 *
 * Criar começa na aba do endereço (é o caminho mais comum); editar começa na
 * aba dos campos, que já vêm preenchidos com o que o cofre guardou. A
 * validação do endereço roda com o mesmo `parseOtpAuthUri` do processo main,
 * então a tela não oferece algo que o cofre recusaria depois.
 */

interface AuthTokenModalProps {
  /** `null` cria um token novo. */
  token: AuthToken | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

export function AuthTokenModal({
  token,
  onClose,
  onSaved,
  onError,
}: AuthTokenModalProps): JSX.Element {
  const m = useMessages();
  const isEdit = token !== null;
  const [tab, setTab] = useState<'uri' | 'manual'>(isEdit ? 'manual' : 'uri');

  const [uri, setUri] = useState('');
  const [secret, setSecret] = useState('');
  const [issuer, setIssuer] = useState(token?.issuer ?? '');
  const [account, setAccount] = useState(token?.account ?? '');
  const [algorithm, setAlgorithm] = useState<OtpAlgorithm>(token?.algorithm ?? 'SHA1');
  const [digits, setDigits] = useState<number>(token?.digits ?? 6);
  const [period, setPeriod] = useState<number>(token?.period ?? 30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fieldClass =
    'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 outline-none';

  const handleSave = (): void => {
    setError(null);
    // A URI carrega todos os campos, então na aba dela o save inteiro passa
    // pelo main sem a tela remontar nada. Na aba dos campos, cada um viaja.
    if (tab === 'uri') {
      setBusy(true);
      void window.api.authenticator
        .saveUri(uri)
        .then(() => {
          onSaved();
        })
        .catch((caught: unknown) => {
          const message = errorMessage(caught, m.authenticator.saveError);
          setError(message);
          onError(message);
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }

    // `exactOptionalPropertyTypes`: id ausente não é o mesmo que id vazio
    const base = { issuer, account, algorithm, digits, period, secret: secret.trim() };
    const draft: AuthTokenDraft = token === null ? base : { ...base, id: token.id };
    setBusy(true);
    void window.api.authenticator
      .save(draft)
      .then(() => {
        onSaved();
      })
      .catch((caught: unknown) => {
        const message = errorMessage(caught, m.authenticator.saveError);
        setError(message);
        onError(message);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  /** Prévia do que o endereço colado resolve, antes de salvar. */
  const preview = tab === 'uri' ? parseOtpAuthUri(uri) : null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-100">
            {isEdit ? m.authenticator.modalEdit : m.authenticator.modalNew}
          </h3>
          <button
            type="button"
            onClick={onClose}
            title={m.common.close}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          {(['uri', 'manual'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === key
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-400 bg-slate-800/50 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {key === 'uri' ? m.authenticator.tabUri : m.authenticator.tabManual}
            </button>
          ))}
        </div>

        {tab === 'uri' ? (
          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">{m.authenticator.uriLabel}</span>
              <textarea
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder={m.authenticator.uriPlaceholder}
                rows={3}
                className={`${fieldClass} resize-none font-mono text-xs`}
              />
            </label>
            {uri.trim() !== '' && preview === null && (
              // sem isto, colar um endereço pela metade e esperar o botão "Salvar"
              // para descobrir que faltava o segredo é a única forma de saber
              <p role="alert" className="text-xs text-rose-400">
                {m.authenticator.uriInvalid}
              </p>
            )}
            {preview !== null && (
              <p className="text-xs text-emerald-400">
                {preview.issuer !== '' ? preview.issuer : m.authenticator.issuerFallback}
                {preview.account !== '' && ` · ${preview.account}`}
                {` · ${preview.algorithm} · ${preview.digits} · ${preview.period}s`}
              </p>
            )}
            <p className="text-xs text-slate-500">{m.authenticator.uriHint}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">
                {m.authenticator.secretLabel}
              </span>
              <input
                type="text"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={m.authenticator.secretPlaceholder}
                className={`${fieldClass} font-mono`}
              />
              <span className="text-xs text-slate-500">{m.authenticator.secretHint}</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  {m.authenticator.issuerLabel}
                </span>
                <input
                  type="text"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder={m.authenticator.issuerPlaceholder}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  {m.authenticator.accountLabel}
                </span>
                <input
                  type="text"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder={m.authenticator.accountPlaceholder}
                  className={fieldClass}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  {m.authenticator.algorithmLabel}
                </span>
                <select
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as OtpAlgorithm)}
                  className={fieldClass}
                >
                  {OTP_ALGORITHMS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  {m.authenticator.digitsLabel}
                </span>
                <select
                  value={digits}
                  onChange={(e) => setDigits(Number(e.target.value))}
                  className={fieldClass}
                >
                  {OTP_DIGIT_CHOICES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  {m.authenticator.periodLabel}
                </span>
                <input
                  type="number"
                  min={OTP_PERIOD_RANGE[0]}
                  max={OTP_PERIOD_RANGE[1]}
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                  className={fieldClass}
                />
              </label>
            </div>
            <p className="text-xs text-slate-500">{m.authenticator.algorithmHint}</p>
          </div>
        )}

        {error !== null && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            {m.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 disabled:opacity-60"
          >
            {busy ? m.common.saving : m.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}
