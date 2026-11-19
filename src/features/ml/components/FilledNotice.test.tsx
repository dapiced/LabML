import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FilledNotice } from '@/features/ml/components/FilledNotice';
import i18n from '@/lib/i18n';

const filled = [
  { column: 'age', rows: 891, empty: 177, unreadable: 0, fill: '28.5' },
  { column: 'deck', rows: 891, empty: 688, unreadable: 0, fill: 'C' },
];

describe('FilledNotice', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says nothing when nothing was filled, or when the value is not what the lab writes', () => {
    const { container, rerender } = render(<FilledNotice filled={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FilledNotice filled={[{ column: 'x' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each filled column, and marks the one that is mostly its fill value', () => {
    render(<FilledNotice filled={filled} />);
    expect(screen.getByTestId('filled-notice')).toHaveTextContent(
      'Cells the lab filled in before training',
    );
    expect(screen.getByTestId('filled-deck')).toHaveAttribute('data-mostly', 'true');
    expect(screen.getByTestId('filled-deck')).toHaveTextContent(
      '688 cells were empty of 891 (77 %)',
    );
    expect(screen.getByTestId('filled-age')).toHaveAttribute('data-mostly', 'false');
    expect(screen.getByTestId('filled-notice')).toHaveTextContent(
      'A missing number becomes the median of the training rows',
    );
  });

  it('names a scored file for what it is, in French too', async () => {
    await i18n.changeLanguage('fr');
    render(<FilledNotice filled={filled} scope="batch" />);
    expect(screen.getByTestId('filled-notice')).toHaveTextContent(
      'Cellules que le labo a remplies avant de scorer ce fichier',
    );
  });
});
