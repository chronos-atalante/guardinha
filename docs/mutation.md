# Testes de mutação

Cobertura de linha responde "esta linha foi executada?". Teste de mutação
responde uma pergunta mais forte: "se esta linha fizesse outra coisa, a suíte
perceberia?". Cada mutante é uma troca pequena e deliberada no código de `src/`
(um `<` vira `<=`, um `&&` vira `||`, uma guarda de `if` some). O mutante é
aplicado, a suíte roda, e o veredito é binário: algum teste quebrou (o mutante
morreu) ou a suíte continua verde (o mutante sobreviveu, e existe um buraco de
teste). O **score** é a porcentagem de mutantes mortos.

Cobertura alta com score baixo é o caso comum de uma suíte que passa por cima da
lógica sem conferir as decisões. Neste repositório os dois números são
complementares: o limiar de 90% de cobertura é o piso, o score de mutação é o
que diz se esse piso significa alguma coisa.

## Como rodar

```bash
npm run test:mutation          # varredura completa
npm run test:mutation:plan     # só monta o plano e imprime, não executa
node tools/mutation/run.ts --help
```

O runner guarda os resultados em `mutation/results.json` e pula o que já foi
medido, então uma varredura interrompida continua de onde parou. Para remedir
um arquivo depois de escrever teste novo:

```bash
node tools/mutation/run.ts --file src/main/vault.ts --fresh
```

`--fresh` descarta só os resultados dos arquivos selecionados, não os da
varredura inteira.

## Escopo

Entra todo arquivo `.ts`/`.tsx` de `src/` que tenha linha alcançada por algum
teste. Ficam de fora, cada um com o motivo em `tools/mutation/scope.ts`:

- `src/types/**`: só `interface`, `type` e união. Com
  `verbatimModuleSyntax` não emitem runtime, então não existe mutante.
- `src/messages/{pt-BR,en,ja,ko,zh-CN}.ts`: traduções são dado, e a paridade
  entre bundles já é garantida por `tests/messages/parity.test.ts`.
- `src/shared/index.ts` e `src/renderer/src/attributions.ts`: barrel puro e
  texto de licença.
- `src/node.loader.ts`: roda só em processo filho, e o v8 não mede cobertura
  entre processos.

Mutante em linha que nenhum teste alcança também fica fora do denominador, e
aparece separado no relatório: esse é buraco de **cobertura**, não de teste, e
misturar os dois só faria o número cair sem dizer onde está o problema.

## Operadores

Doze operadores, escolhidos por mudarem uma decisão observável do código.
Mutante que só atrapalha leitura, ou que o TypeScript já rejeitaria, é ruído e
não entra.

| Operador            | Troca                                                 |
| ------------------- | ----------------------------------------------------- |
| `arithmetic`        | `+` ↔ `-`, `*` ↔ `/`                                  |
| `boundary`          | `<` ↔ `<=`, `>` ↔ `>=`                                |
| `equality`          | `===` ↔ `!==`                                         |
| `logical`           | `&&` ↔ `\|\|`                                         |
| `negation`          | `!x` → `x`, `-x` → `x`, `+x` → `x`                    |
| `boolean`           | `true` ↔ `false`                                      |
| `ternary-swap`      | `c ? a : b` → `c ? b : a`                             |
| `if-remove`         | `if (t) { corpo }` → `{ corpo }`                      |
| `if-swap`           | `if (t) { a } else { b }` → `if (t) { b } else { a }` |
| `numeric`           | inteiro de 0 a 1024 → `n + 1`                         |
| `string-empty`      | `'hex'` → `''`                                        |
| `optional-chaining` | `a?.b` → `a.b`                                        |

O operador `string-empty` não mexe em elemento de tabela com cinco ou mais
entradas (`LEVELS`, `COMMON_WORDS`, `OTP_ALGORITHMS`): mutar uma entrada mede se
a suíte confere item por item o conjunto que o código carrega, e não se o código
que consome o conjunto funciona.

## Como a varredura fica barata

Uma execução da suíte inteira custa 84 s. Multiplicada por 2.560 mutantes, a
varredura seria de dias. O que reduz isso:

- **Seleção por linha.** Uma matriz arquivo de teste → linhas de `src/`
  (`tools/mutation/matrix.ts`) diz quais testes passam pela linha mutada. Sem
  ela a seleção é por arquivo inteiro e `src/main/auth.ts` puxa 16 arquivos de
  teste; com ela a média cai de 15 para 7. A matriz é montada com uma execução
  da suíte por arquivo de teste (cerca de 5 min) e fica em cache, invalidada
  por uma impressão digital de `src/` e `tests/`.
- **Barreiras nos barrels.** O grafo de módulos (`tools/mutation/graph.ts`)
  segue o nome importado até o arquivo que define a função. Quase todo mundo
  importa de `@zero/shared`, então um grafo que para no barrel diria que
  `base32.ts` é alcançado pelos 45 arquivos de teste.
- **`--bail=1` e ordem.** A execução para no primeiro teste que falha, e os
  testes saem na ordem do mais barato para o mais caro. O mutante morre no
  primeiro ou no segundo teste, não no último.
- **Doppelgänger do Argon2id.** A suíte de cofre deriva chaves com os perfis de
  produção (128 MiB e 256 MiB), e `unlock.test.ts`, `panic.test.ts` e
  `vault.test.ts` passam de dois minutos cada. Na config de mutação
  (`vitest.mutation.config.mts`), `hash-wasm` aponta para
  `tools/mutation/hash-wasm-stub.ts`, que troca a derivação por uma cadeia de
  HMAC: continua determinística e sensível à senha, ao salt e aos parâmetros, que
  é tudo que `tests/main/crypto.test.ts` verifica, e some em microssegundos. O
  stub só existe na varredura; o `npm test` continua usando o Argon2id de
  verdade, e nenhum teste compara a saída com um vetor do Argon2id.

## Garantias

Duas, e as duas importam:

- **Baseline verde.** Antes de medir qualquer coisa, o runner roda a suíte sem
  mutante e aborta se ela ficar vermelha. Com o doppelgänger no lugar, um teste
  que passasse com a derivação real e falhasse com a de mentira não pode
  contaminar o placar. Use `--skip-baseline` só para depurar.
- **Cobertura da linha de base nova.** O passo zero do runner é `vitest run
--coverage`. Medir contra um `coverage/coverage-final.json` velho é medir
  errado, porque a linha pode ter saído do alcance de qualquer teste. Use
  `--skip-coverage` para reaproveitar o arquivo existente.
- **O mutante precisa entrar na execução.** Um veredito só significa alguma coisa
  se o texto mutado tiver rodado. O `fsModuleCache` do Vitest (ligado por
  padrão) quebrava essa garantia: ele guarda o módulo transformado em
  `node_modules/.vitest-cache`, indexado pelo id do arquivo, e essa chave não
  conhece o mutante injetado pelo plugin. O cache do mutante anterior era
  revalidado como válido, o mutante atual não entrava, a suíte passava rodando
  contra o texto errado e o veredito saía `survived`. Como só o primeiro mutante
  de cada arquivo era medido de verdade, o score caía sozinho conforme a
  varredura avançava: `src/main/unlock.ts` marcava 18% e, com o cache desligado,
  78%, sem nenhuma alteração no código sob teste. Por isso
  `fsModuleCache: false` está em `tools/mutation/vitest-options.ts` (e na flag
  do runner), e `tests/tools/mutation-runner.test.ts` trava a garantia.

## No CI

A varredura completa roda no `quality.yml`, no job **Testes de mutação**, mas
fora do gate de PR: ela leva cerca de 90 min na máquina de quem escreveu e bem
mais nos 2 núcleos de um runner. Dispara por `schedule` (domingo de madrugada) e
por `workflow_dispatch`, com dois inputs:

| Input           | Efeito                                                               |
| --------------- | -------------------------------------------------------------------- |
| `min_score`     | reprova a execução se o score ficar abaixo (padrão `0`, não reprova) |
| `mutation_file` | mede só esses arquivos de `src/`, separados por vírgula              |

O score vai para o resumo da execução e a lista de sobreviventes para o
artefato `mutacao-relatorio`. Reprovar por score é opt-in porque o número é
sensive à máquina e ao que está em medição; comparar com a execução anterior é
mais útil do que um piso fixo.

## Arquivos

| Arquivo                            | O que é                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `tools/mutation/run.ts`            | Runner: plano, paralelismo, veredito e relatório.               |
| `tools/mutation/vitest-options.ts` | Opções de Vitest da varredura, com o `fsModuleCache` desligado. |
| `tools/mutation/operators.ts`      | Os doze operadores, em cima da AST do Babel.                    |
| `tools/mutation/mutants.ts`        | Enumeração estável e aplicação por splicing de texto.           |
| `tools/mutation/ast.ts`            | Parser e percurso com pai, que é o que separa dado de valor.    |
| `tools/mutation/graph.ts`          | Grafo de módulos sensível a nomes, para escolher testes.        |
| `tools/mutation/matrix.ts`         | Matriz de linhas por arquivo de teste, com cache.               |
| `tools/mutation/coverage.ts`       | Leitura do relatório do v8 e filtro de linha alcançada.         |
| `tools/mutation/plugin.ts`         | Plugin do Vite que injeta o mutante no módulo alvo.             |
| `tools/mutation/scope.ts`          | O que entra e o que sai, com o motivo de cada exclusão.         |
| `tools/mutation/hash-wasm-stub.ts` | Doppelgänger barato do Argon2id para a varredura.               |
| `vitest.mutation.config.mts`       | Config de Vitest da varredura.                                  |

Artefatos em `mutation/` (fora do git): `results.json` com o veredito de cada
mutante, `matrix.json` com a matriz de linhas, `cov/` com os relatórios
individuais e `report.md` com o resumo e a lista de sobreviventes.

## Limites conhecidos

- Mutante que não compila é contado como `compileError` e fica fora do score.
  São raros, porque a troca é só de texto.
- Mutante que estoura o tempo (240 s por padrão) fica `timeout`, também fora do
  score. Vale subir com `--timeout` antes de culpar a suíte.
- O operador `optional-chaining` gera mutante que estoura em `TypeError` quando
  o valor realmente é nulo. A suíte mata, e a mutação está certa, mas é um sinal
  mais fraco que os outros.
- O grafo de módulos é estático e **não segue `import()` dinâmico**, nem com
  especificador literal. `tests/main/preload.test.ts` carrega o preload com
  `await import('@zero/preload/index')` para poder rodar `vi.resetModules()`, e
  isso tira `src/preload/index.ts` do grafo inteiro: ele não aparece no plano e
  **não é medido**. É a ponte entre a interface e o main, então a lacuna não é
  pequena. Hoje é o único caso assim, mas o grafo deveria aceitar `import()` de
  especificador literal antes que isso mude.

## Números da varredura

Medidos em `src/` inteiro depois da correção do `fsModuleCache` (ver a garantia
em "O mutante precisa entrar na execução"): 2.530 mutantes em 820 testes. No
denominador ficaram 2.293: 1.583 mortos e 710 sobreviventes. Ficaram fora 143
`timeout` e 94 `compileError`, que não são veredito da suíte.

| Área                    | Score | Mortos | Sobreviv. | Observação                                    |
| ----------------------- | ----- | ------ | --------- | --------------------------------------------- |
| `src/messages/index.ts` | 100%  | 1      | 0         | o registro de idiomas                         |
| `src/main/*`            | 89,6% | 941    | 109       | o núcleo de segurança                         |
| `src/shared/*`          | 69,8% | 217    | 94        | `otpauth` 86%, `strength` 56%                 |
| `src/renderer/*`        | 45,6% | 425    | 507       | a tela é verificada por fluxo, não por estado |

**69,0%** no geral depois da primeira leva de testes novos (era 67,8% na leitura
bruta). O que rendeu: `src/main/shred.ts` foi de 43% para 95%, e `clipboard.ts`,
`activity.ts` e `format.ts` chegaram a 100%. O padrão que matou mais foi contar
coisas em vez de só conferir o resultado: o número de passadas da sobrescrita, o
tamanho e a posição de cada escrita, e se `clearTimeout` foi chamado com um
temporizador de verdade. O que sobrou em `shred.ts` são mutantes equivalentes de
verdade: o `&&` do laço de diretório não muda o resultado porque o `rmdir` falha
de qualquer jeito quando sobrou arquivo.

O quadro é desigual de propósito, e vale ler assim: o `src/main/*` é a parte em
que a mutação carrega argumento, e o `src/renderer/*` é a parte em que ela
confirma o que já se sabia, que tela se prova por fluxo e não por estado. O
`src/shared/strength.ts` fica no meio porque muito sobrevivente dele é constante
de tabela: a suíte fixa o comportamento e não cada palavra da tabela.

Por operador, os melhores são `ternary-swap` (100%, mas com um único mutante),
`negation` (95%), `equality` (94%) e `if-remove` (89%): os quatro medem decisão,
que é o que a suíte costuma fixar. Os piores são `string-empty` (44%), que mede
se a suíte trava cada constante do código, `boundary` (59%), `numeric` (64%) e
`optional-chaining` (53%). Os três primeiros têm a mesma origem, que é a mesma do
primeiro: buracos de verdade, mas de baixo risco quando o valor só muda de 3
para 4; a exceção é quando a constante é de segurança, e aí o teste tem que fixar
o número (foi o que passou nos perfis de Argon2id, no período ocioso e no número
de passadas do shred).

**Ler esse número antes do anterior importa:** a varredura anterior media o
mutante errado a partir do segundo mutante de cada arquivo, então os placares
antigos estavam subindo sozinhos conforme a varredura avançava. Os números de
`src/main/unlock.ts` exemplifiesem: 18% na leitura errada, 78% agora, sem nenhuma
mudança no código sob teste.

## O que a varredura encontrou

Lista do que os testes novos fecharam depois da primeira passada, porque são os
achados que valem registro:

- `erasure-state.ts` marca o Cryptographic Erase com um `destroyed = true` que
  nenhum teste lia. Um `false` ali deixaria o `writeVaultContainer` recriando o
  `vault.zkv` pela metade depois da destruição.
- `container.ts` devolvia `{ ok: false }` para buffer truncado sem nenhum teste
  de truncamento; um `{ ok: true }` ali abriria um cofre pela metade.
- `facade.ts` confere a forma do registro campo a campo com `||`, e o teste
  antigo só quebrava o `title`. Com o `&&` no primeiro operando, o registro
  continuava passando.
- Os perfis de Argon2id eram comparados com eles mesmos, então baixar o custo do
  PIN de 256 MiB para 128 MiB passava a suíte inteira.
- `crypto.ts` derivava entrada e token de 2FA com rótulos de domínio cuja
  colisão ninguém checava: dois registros com a mesma senha e o mesmo salt, em
  domínios diferentes, podiam sair com a mesma chave.
- `authenticator.ts` aceitava emissor e conta vazios juntos por causa de um
  `&&` que virava `||`, e aceitatea segredo um byte abaixo do mínimo.
- `structure.ts` criava as pastas com 0700 sem teste que conferisse o modo, e
  `settings.ts` gravava `settings.json` com 0600 pelo mesmo motivo.
- `entries.ts` ordenava a lista por `b.updatedAt - a.updatedAt`, e a suíte só
  conferia que as ids estavam na lista, nunca a ordem.
- `shred.ts` sobrescrevia com 3 passadas sem teste que conferisse o número.

O padrão é sempre o mesmo: o teste antigo cobria o caminho feliz e o código tem
ramas de borda que ninguém exercita. É o que a mutação enxerga e a cobertura de
linha, sozinha, não.
