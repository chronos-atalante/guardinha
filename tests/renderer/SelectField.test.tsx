import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectField } from '@zero/renderer/components/SelectField';

/**
 * O seletor tem menu próprio porque o `<select>` nativo entrega o popup do
 * sistema. Isso significa que a navegação é código nosso: setas, Home, End,
 * Escape, Tab e clique fora, mais o foco, que precisa voltar ao gatilho quando
 * o menu fecha. É a única parte da tela em que o teclado é o caminho principal.
 */

const OPCOES = [
  { value: 'a', label: 'Opção A' },
  { value: 'b', label: 'Opção B' },
  { value: 'c', label: 'Opção C' },
] as const;

function setup(value = 'b'): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn<(next: string) => void>();
  render(<SelectField label="Tamanho" options={OPCOES} value={value} onChange={onChange} />);
  return { onChange };
}

function gatilho(): HTMLElement {
  return screen.getByRole('button', { name: 'Tamanho' });
}

function abrir(): void {
  fireEvent.click(gatilho());
  expect(screen.getByRole('listbox')).toBeInTheDocument();
}

function opcoes(): HTMLElement[] {
  return screen.getAllByRole('option');
}

/**
 * Item do menu por índice, com guarda em vez de assertion: `noUncheckedIndexedAccess`
 * devolve `HTMLElement | undefined`, e aqui nem `!` (proibido) nem `as HTMLElement`
 * (exigido pela regra que proíbe o `!`) passam. A guarda também transforma um
 * índice errado em erro legível, em vez de um clique em `undefined`.
 */
function opcao(indice: number): HTMLElement {
  const achada = opcoes()[indice];
  if (achada === undefined) throw new Error(`a opção ${indice} não apareceu no menu`);
  return achada;
}

describe('SelectField: abrir e fechar', () => {
  it('mostra a opção corrente no gatilho', () => {
    setup('c');
    expect(gatilho()).toHaveTextContent('Opção C');
  });

  it('o gatilho se anuncia como lista para a tecnologia assistiva', () => {
    setup();
    expect(gatilho()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(gatilho()).toHaveAttribute('aria-expanded', 'false');
  });

  it('o gatilho abre e fecha o menu', () => {
    setup();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    abrir();
    expect(gatilho()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(gatilho());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('marca a opção selecionada e põe o check só nela', () => {
    setup('b');
    abrir();

    const marcadas = opcoes().filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toHaveTextContent('Opção B');
    // o check é o único filho extra do item selecionado
    expect(marcadas[0]?.querySelectorAll('svg')).toHaveLength(1);
    expect(opcoes()[0]?.querySelectorAll('svg')).toHaveLength(0);
  });

  it('escolher uma opção avisa e devolve o foco ao gatilho', () => {
    const { onChange } = setup('b');
    abrir();

    fireEvent.click(opcoes()[2]?.querySelector('button') as HTMLElement);

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(gatilho()).toHaveFocus();
  });

  it('escolher o valor que já estava não grava nada', () => {
    // campo controlado: realimentar o mesmo valor reescreveria o arquivo à toa
    const { onChange } = setup('b');
    abrir();

    fireEvent.click(opcoes()[1]?.querySelector('button') as HTMLElement);

    expect(onChange).not.toHaveBeenCalled();
    expect(gatilho()).toHaveFocus();
  });

  it('clicar fora fecha o menu, e clicar dentro não', () => {
    setup();
    abrir();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    abrir();
    fireEvent.mouseDown(opcao(0));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('SelectField: teclado', () => {
  it('seta para baixo e para cima abrem o menu pelo gatilho', () => {
    setup();
    fireEvent.keyDown(gatilho(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(gatilho(), { key: 'ArrowUp' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('outra tecla no gatilho não abre nada', () => {
    setup();
    fireEvent.keyDown(gatilho(), { key: 'a' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('as setas andam pelo menu e dão a volta nas pontas', () => {
    setup('b');
    abrir();
    const [a, b, c] = opcoes();
    // abrir já põe o foco na opção corrente
    expect(b?.querySelector('button')).toHaveFocus();

    fireEvent.keyDown(b?.querySelector('button') as HTMLElement, { key: 'ArrowDown' });
    expect(c?.querySelector('button')).toHaveFocus();
    fireEvent.keyDown(c?.querySelector('button') as HTMLElement, { key: 'ArrowDown' });
    expect(a?.querySelector('button')).toHaveFocus();
    fireEvent.keyDown(a?.querySelector('button') as HTMLElement, { key: 'ArrowUp' });
    expect(c?.querySelector('button')).toHaveFocus();
  });

  it('Home e End vão às pontas', () => {
    setup('b');
    abrir();
    const [a, , c] = opcoes();

    fireEvent.keyDown(opcoes()[1]?.querySelector('button') as HTMLElement, { key: 'End' });
    expect(c?.querySelector('button')).toHaveFocus();
    fireEvent.keyDown(opcoes()[2]?.querySelector('button') as HTMLElement, { key: 'Home' });
    expect(a?.querySelector('button')).toHaveFocus();
  });

  it('Escape fecha e devolve o foco ao gatilho', () => {
    setup();
    abrir();

    fireEvent.keyDown(opcoes()[1]?.querySelector('button') as HTMLElement, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(gatilho()).toHaveFocus();
  });

  it('Tab fecha o menu sem tratar como movimento', () => {
    setup();
    abrir();

    fireEvent.keyDown(opcoes()[1]?.querySelector('button') as HTMLElement, { key: 'Tab' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('tecla sem efeito no item não mexe o foco nem o menu', () => {
    setup();
    abrir();
    const antes = opcoes()[1]?.querySelector('button');

    fireEvent.keyDown(antes as HTMLElement, { key: 'x' });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(antes).toHaveFocus();

    // e o índice interno continua no lugar: a seta seguinte desce um degrau,
    // não fica presa. Sem a guarda de `next !== null`, a tecla sem efeito
    // gravaria `null` no índice e o próximo passo viraria `null + 1`.
    fireEvent.keyDown(antes as HTMLElement, { key: 'ArrowDown' });
    expect(opcoes()[2]?.querySelector('button')).toHaveFocus();
  });
});

describe('SelectField: valor fora da lista', () => {
  it('não quebra quando o valor atual não está entre as opções', () => {
    // O campo é controlado por outro componente; se o valor não estiver na lista,
    // o rótulo tem de virar texto vazio em vez de estourar o índice.
    expect(() => setup('inexistente')).not.toThrow();
    expect(gatilho().textContent).not.toContain('undefined');
  });

  it('lista vazia não quebra nem deixa "undefined" na tela', () => {
    // `options[activeIndex]` é `undefined` sem nenhuma opção, e é o único caso em
    // que o rótulo corrente não tem o que mostrar.
    const onChange = vi.fn();
    const { container } = render(
      <SelectField label="Tamanho" options={[]} value={'a'} onChange={onChange} />,
    );

    expect(container.textContent).not.toContain('undefined');
    expect(() => fireEvent.click(gatilho())).not.toThrow();
  });
});
