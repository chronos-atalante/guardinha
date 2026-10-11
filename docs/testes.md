# Testes

Suíte Vitest com 51 arquivos `*.test.ts` e `*.test.tsx`, agrupados por domínio.
O ambiente padrão é jsdom; a maioria dos testes do processo main declara
`@vitest-environment node`, e os testes do renderer usam jsdom. O teste do
carregador de módulos também inicia o Node real em um processo filho. Os testes
de cofre executam Argon2id com os perfis de produção (128 e 256 MiB), por isso
têm timeout de 120 s.

## Como rodar

```bash
npm test               # execução única (o que o CI espera)
npm run test:watch     # modo watch
npm run test:coverage  # cobertura em coverage/ (limiar de 90%)
```

O `npm run check` **não** roda os testes; ele cobre tipos, lint, formato,
auditoria de dependências e shellcheck. Rode os dois antes de concluir.

## Arquivos

| Arquivo                                     | O que cobre                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `tests/main/activity.test.ts`               | Temporizador de inatividade e assinaturas do `ActivityMonitor`.             |
| `tests/main/auth-store.test.ts`             | Persistência dos tokens TOTP.                                               |
| `tests/main/auth.test.ts`                   | Trava exponencial, validações de formato e contadores de falha.             |
| `tests/main/authenticator.test.ts`          | Regras dos tokens, segredo e integração com o manifesto.                    |
| `tests/main/clipboard.test.ts`              | Limpeza programada do clipboard e descarte do proxy.                        |
| `tests/main/container.test.ts`              | Formatos do container e payload, versão 5, cabeçalho e flags.               |
| `tests/main/create-permission.test.ts`      | Cancelamento da criação quando a autorização de diretório falha.            |
| `tests/main/crypto.test.ts`                 | Argon2id, cifragem de registros, gerador e frase de recuperação.            |
| `tests/main/entries.rules.test.ts`          | Validações das credenciais salvas.                                          |
| `tests/main/entrypoint.test.ts`             | Inicialização e registro dos canais do processo principal.                  |
| `tests/main/erase.test.ts`                  | Cryptographic Erase, temporários e prevenção contra recriação do container. |
| `tests/main/facade.test.ts`                 | Operações de persistência pela fachada.                                     |
| `tests/main/layout.test.ts`                 | Resolução dos caminhos do cofre e overrides de ambiente.                    |
| `tests/main/logging.test.ts`                | Supressão e filtragem dos logs do Chromium.                                 |
| `tests/main/node-loader.test.ts`            | Resolução dos aliases ao executar TypeScript no Node real.                  |
| `tests/main/panic.test.ts`                  | PIN de coação, trava e limite de tentativas da senha mestra.                |
| `tests/main/preload.test.ts`                | Contrato e encaminhamento IPC do preload.                                   |
| `tests/main/privilege.test.ts`              | Invocação segura do helper PolicyKit.                                       |
| `tests/main/session.test.ts`                | Ciclo de vida da chave, sessão decoy e ligação ao auto-lock.                |
| `tests/main/settings.test.ts`               | Leitura, normalização e gravação das preferências.                          |
| `tests/main/shred.test.ts`                  | Sobrescrita, remoção, `O_NOFOLLOW` e diretórios.                            |
| `tests/main/storage.test.ts`                | Container, manifesto, permissões e validação dos ids.                       |
| `tests/main/totp.test.ts`                   | Vetores oficiais e cálculo HOTP/TOTP.                                       |
| `tests/main/unlock.test.ts`                 | Cadeia de desbloqueio, formato, tentativas e ordem da trava.                |
| `tests/main/unwrapping.test.ts`             | Embrulho e desembrulho por método de credencial.                            |
| `tests/main/vault.guardrails.test.ts`       | Guardas e condições de borda do ciclo de vida do cofre.                     |
| `tests/main/vault.test.ts`                  | Criação, desbloqueio, redefinição e estado do cofre.                        |
| `tests/main/window.test.ts`                 | Navegação, permissões, IPC, eventos e política da janela.                   |
| `tests/renderer/App.tabs.test.tsx`          | Navegação entre abas e estado geral do app.                                 |
| `tests/renderer/App.test.tsx`               | Fluxos gerais de criação, desbloqueio e uso do app.                         |
| `tests/renderer/AuthModal.test.tsx`         | Formulários de criação, desbloqueio e redefinição de PIN.                   |
| `tests/renderer/Authenticator.test.tsx`     | Lista de tokens, códigos e ações do autenticador.                           |
| `tests/renderer/Credits.test.tsx`           | Créditos e lista de dependências.                                           |
| `tests/renderer/DestroyModal.test.tsx`      | Confirmação em duas etapas da destruição.                                   |
| `tests/renderer/EntryModal.test.tsx`        | Formulário de credencial e validação visual.                                |
| `tests/renderer/Generator.test.tsx`         | Opções, geração, cópia e apresentação de senha.                             |
| `tests/renderer/Home.test.tsx`              | Lista, busca e ações das credenciais.                                       |
| `tests/renderer/LanguageSelect.test.tsx`    | Seletor e persistência de idioma.                                           |
| `tests/renderer/SensitivitySlider.test.tsx` | Interação acessível com o slider do gerador.                                |
| `tests/renderer/Settings.nuke.test.tsx`     | Configuração do limite de autodestruição.                                   |
| `tests/renderer/Settings.test.tsx`          | Configuração do PIN de coação e comportamento de Settings.                  |
| `tests/renderer/Sidebar.test.tsx`           | Navegação, idioma e ações da barra lateral.                                 |
| `tests/renderer/clipboard.test.ts`          | Encaminhamento da cópia pelo canal IPC do main.                             |
| `tests/renderer/formatters.test.ts`         | Formatação de mensagens e contagem regressiva.                              |
| `tests/renderer/i18n.test.tsx`              | Provider, hooks e renderização de mensagens localizadas.                    |
| `tests/shared/base32.test.ts`               | Normalização e decodificação Base32.                                        |
| `tests/shared/otpauth.test.ts`              | Parse de URIs `otpauth://`.                                                 |
| `tests/shared/strategy.test.ts`             | Estratégia de avaliação de força por tipo.                                  |
| `tests/shared/strength.test.ts`             | Pontuação, motivos e bloqueios da checagem de força.                        |
| `tests/messages/functions.test.ts`          | Forma e comportamento das funções de mensagem.                              |
| `tests/messages/parity.test.ts`             | Paridade de chaves, tipos e idiomas entre os bundles.                       |

Apoios: `tests/mocks/electron.ts` (stub do `electron` aplicado por alias),
`tests/mocks/api.ts` (contrato completo de `window.api` para os testes de
renderer; o que o arquivo não exercita rejeita, para um canal chamado por
engano aparecer como falha), `tests/setup-env.ts` (cria um `HOME` temporário
por processo e aponta o cofre para lá) e `tests/setup.ts` (limpa o DOM e
restaura timers e mocks a cada teste).

## Convenções

- Correção de bug vem com teste que reproduz o problema antes da correção.
- Teste novo de domínio fica perto dos pares (`tests/main/`, `tests/renderer/`,
  `tests/shared/`).
- Arquivo de teste abaixo de ~500 linhas: extraia helpers quando passar.
- Temporizadores: use `vi.useFakeTimers()` para a trava exponencial e
  `vi.useRealTimers()` no fim do teste (o `setup.ts` já restaura, mas o teste
  que muda o relógio deve devolver).
- Argon2id real: testes que criam cofre (`createVault`, `makeContainer`)
  derivam 128 e 256 MB; herdam o teto global de 120 s do `vitest.config.mts`
  e não devem baixá-lo, sob pena de flake sob carga do desktop.
- Cofre e arquivos sempre em diretório temporário: nunca escreva em
  `/var/lib` em teste (o `setup-env.ts` já isola; `create-permission` e
  `privilege` cobrem o caminho sem permissão).
- Teste que exercita o erase precisa chamar `clearDestroyedFlag()` antes de
  semear um cofre novo: a guarda que impede o container de ressuscitar é
  intencional e vai recusar a escrita enquanto durar o processo de teste.
- Teste com vários cenários de cofre **não** cria um cofre por cenário
  (`createVault` custa três derivações Argon2id, uns 45 s). Crie uma vez,
  fotografe o `vault.zkv` e restaure a foto antes de cada cenário; é o que
  `tests/main/panic.test.ts` faz.

## Cobertura

`vitest.config.mts` mede `src/**/*.{ts,tsx}` com o provedor v8, relatório em
texto e HTML, e limiar de **90%** para linhas, comandos, funções e ramos. Abaixo
disso o `npm run test:coverage` reprova, e o job "Testes e cobertura" do
workflow `quality.yml` fica vermelho junto.

Ficam de fora do denominador, com justificativa no próprio config:

- `src/types/**` e `src/shared/index.ts`: com `verbatimModuleSyntax`,
  `interface`, `type` e `export type {...} from` não emitem nada. São 0
  comandos e 0 funções, então o 0% deles é artefato de medição e nenhum teste
  os cobriria.
- `src/node.loader.ts`: hook de resolução do `.ts` sem bundler. É verificado
  por `tests/main/node-loader.test.ts`, que roda o Node de verdade em processo
  filho, mas o v8 não mede cobertura entre processos.
- `global.d.ts` e `index.html`: sem código executável.
