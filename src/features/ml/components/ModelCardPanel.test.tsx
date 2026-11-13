import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelCardPanel } from '@/features/ml/components/ModelCardPanel';
import { useLabStore } from '@/features/ml/lab-store';
import { MAX_FIELD_LENGTH } from '@/features/ml/projects/model-card';
import type { RunRecord } from '@/features/ml/projects/types';
import i18n from '@/lib/i18n';

// V58: the one thing a card cannot read from the run is asked here, and the
// panel says the card is incomplete until it is answered.

const record = JSON.parse(readFileSync('tests/share-links/titanic.json', 'utf8')) as RunRecord;

describe('ModelCardPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useLabStore.setState({ currentRun: { ...record } });
  });

  it('renders nothing when there is no run', () => {
    useLabStore.setState({ currentRun: null });
    const { container } = render(<ModelCardPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls the card incomplete until the intended use is typed', () => {
    render(<ModelCardPanel />);
    expect(screen.getByTestId('model-card-status')).toHaveTextContent('incomplete');
    fireEvent.change(screen.getByTestId('model-card-intendedUse'), {
      target: { value: 'Teaching example.' },
    });
    expect(useLabStore.getState().currentRun?.card).toEqual({ intendedUse: 'Teaching example.' });
    expect(screen.getByTestId('model-card-status')).toHaveTextContent('intended use stated');
  });

  it('does not count blanks, or another field, as an intended use', () => {
    render(<ModelCardPanel />);
    fireEvent.change(screen.getByTestId('model-card-intendedUse'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('model-card-owner'), { target: { value: 'D. D.' } });
    expect(screen.getByTestId('model-card-status')).toHaveTextContent('incomplete');
    expect(useLabStore.getState().currentRun?.card?.owner).toBe('D. D.');
  });

  it('keeps the other fields when one changes, and bounds each', () => {
    const { setCardField } = useLabStore.getState();
    setCardField('intendedUse', 'A');
    setCardField('outOfScope', 'x'.repeat(5000));
    const card = useLabStore.getState().currentRun?.card;
    expect(card?.intendedUse).toBe('A');
    expect(card?.outOfScope).toHaveLength(MAX_FIELD_LENGTH);
  });

  it('ignores a field typed when no run is on screen', () => {
    useLabStore.setState({ currentRun: null });
    useLabStore.getState().setCardField('intendedUse', 'A');
    expect(useLabStore.getState().currentRun).toBeNull();
  });

  it('offers both downloads, and asks in French too', async () => {
    await i18n.changeLanguage('fr');
    render(<ModelCardPanel />);
    expect(screen.getByTestId('model-card-html')).toHaveTextContent('Fiche (HTML)');
    expect(screen.getByTestId('model-card-markdown')).toHaveTextContent('Fiche (Markdown)');
    expect(screen.getByTestId('model-card-status')).toHaveTextContent('usage prévu absent');
    expect(screen.getByTestId('model-card-panel')).toHaveTextContent('Hors périmètre');
  });
});
