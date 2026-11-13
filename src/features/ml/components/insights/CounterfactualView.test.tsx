import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterfactualView } from '@/features/ml/components/insights/CounterfactualView';
import type { CounterfactualPayload } from '@/features/ml/train/counterfactual';
import i18n from '@/lib/i18n';

// V68: each change is shown with its two readings, and a search that found
// nothing says what it tried.

const payload = (over: Partial<CounterfactualPayload> = {}): CounterfactualPayload => ({
  model: 'forest',
  classes: ['no', 'yes'],
  current: 0,
  target: null,
  columnsChanged: 1,
  found: [
    {
      changes: [{ column: 'pclass', from: '3', to: '1' }],
      prediction: 1,
      probability: 0.6234,
      distance: 2.4,
      far: false,
      followed: { by: 4, of: 5 },
    },
    {
      changes: [{ column: 'fare', from: '7.25', to: '512.33' }],
      prediction: 1,
      distance: 9.1,
      far: true,
      followed: { by: 1, of: 5 },
    },
  ],
  tried: { columns: ['pclass', 'fare', 'age'], locked: ['sex'], rows: 131, pairs: false },
  untouched: ['name'],
  ...over,
});

describe('CounterfactualView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows each change with the answer it gives and how many other models follow', () => {
    render(<CounterfactualView payload={payload()} onApply={() => undefined} />);
    const box = screen.getByTestId('counterfactual');
    expect(box).toHaveAttribute('data-found', '2');
    expect(box).toHaveTextContent('What would have to change for the model to stop answering "no"');
    expect(screen.getByTestId('counterfactual-size')).toHaveTextContent('One column is enough');
    const items = screen.getAllByTestId('counterfactual-item');
    expect(items[0]).toHaveTextContent('pclass: 3 → 1');
    expect(items[0]).toHaveTextContent('The model then answers yes (62.3 %).');
    expect(items[0]).toHaveTextContent('4 of the 5 other models that agreed on this row follow.');
    expect(items[1]).toHaveTextContent('The model then answers yes.');
  });

  it('flags a changed row that looks like no training row, and a change few models follow', () => {
    render(<CounterfactualView payload={payload()} onApply={() => undefined} />);
    expect(screen.getAllByTestId('counterfactual-far')).toHaveLength(1);
    expect(screen.getByTestId('counterfactual-far')).toHaveTextContent(
      'the model is answering where it has seen nothing',
    );
    const followed = screen.getAllByTestId('counterfactual-followed');
    expect(followed[0]).not.toHaveClass('text-copper');
    expect(followed[1]).toHaveClass('text-copper');
  });

  it('says which columns were left alone, and that it speaks of the model', () => {
    render(<CounterfactualView payload={payload()} onApply={() => undefined} />);
    expect(screen.getByTestId('counterfactual-kept')).toHaveTextContent(
      'Left as they are because you locked them: sex. Never edited, being free text: name.',
    );
    expect(screen.getByTestId('counterfactual')).toHaveTextContent(
      'A counterfactual speaks of the model, not of the world',
    );
  });

  it('hands the changes back to load them into the form', () => {
    const apply = vi.fn();
    render(<CounterfactualView payload={payload()} onApply={apply} />);
    fireEvent.click(screen.getAllByTestId('counterfactual-apply')[0]);
    expect(apply).toHaveBeenCalledWith([{ column: 'pclass', from: '3', to: '1' }]);
  });

  it('says when two columns were needed, and names the class asked for', () => {
    render(
      <CounterfactualView
        payload={payload({
          classes: ['low', 'mid', 'high'],
          target: 2,
          columnsChanged: 2,
          found: [
            {
              changes: [
                { column: 'age', from: '', to: '40' },
                { column: 'city', from: 'paris', to: 'nice' },
              ],
              prediction: 2,
              distance: 3,
              followed: { by: 0, of: 0 },
            },
          ],
        })}
        onApply={() => undefined}
      />,
    );
    expect(screen.getByTestId('counterfactual')).toHaveTextContent(
      'for the model to answer "high" instead of "low"',
    );
    expect(screen.getByTestId('counterfactual-size')).toHaveTextContent(
      'No single column changes the answer. Two together do',
    );
    expect(screen.getByTestId('counterfactual-item')).toHaveTextContent(
      'age: ∅ → 40 · city: paris → nice',
    );
    expect(screen.queryByTestId('counterfactual-followed')).toBeNull();
    expect(screen.queryByTestId('counterfactual-far')).toBeNull();
  });

  it('says what was tried when nothing flips, and when everything is locked', () => {
    const { unmount } = render(
      <CounterfactualView
        payload={payload({
          found: [],
          columnsChanged: 0,
          tried: { columns: ['a', 'b', 'c'], locked: [], rows: 1204, pairs: true },
          untouched: [],
        })}
        onApply={() => undefined}
      />,
    );
    expect(screen.getByTestId('counterfactual-none')).toHaveTextContent(
      'Nothing changes the answer by editing one or two of the 3 columns left open. 1,204 rows built from values of the training file were tried.',
    );
    expect(screen.queryByTestId('counterfactual-kept')).toBeNull();
    unmount();
    render(
      <CounterfactualView
        payload={payload({
          found: [],
          columnsChanged: 0,
          tried: { columns: [], locked: ['a'], rows: 0, pairs: true },
        })}
        onApply={() => undefined}
      />,
    );
    expect(screen.getByTestId('counterfactual-none')).toHaveTextContent('Every column is locked');
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    render(<CounterfactualView payload={payload()} onApply={() => undefined} />);
    const box = screen.getByTestId('counterfactual');
    expect(box).toHaveTextContent('pour que le modèle cesse de répondre « no »');
    expect(screen.getAllByTestId('counterfactual-item')[0]).toHaveTextContent(
      "Le modèle répond alors yes (62,3 %). 4 des 5 autres modèles d'accord sur cette ligne suivent.",
    );
    expect(box).toHaveTextContent('Un contrefactuel parle du modèle, pas du monde');
  });
});
