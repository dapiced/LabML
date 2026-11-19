import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColumnCard } from '@/features/ml/components/ColumnCard';
import { activeTwins, useLabStore } from '@/features/ml/lab-store';
import type { ColumnProfile, ColumnRedundancy } from '@/features/ml/data/types';
import i18n from '@/lib/i18n';

// V70: a twin is flagged on its card, and excluded by nobody but the user.

const profile = (name: string): ColumnProfile =>
  ({ name, type: 'categorical', rowCount: 891, missingCount: 0, cardinality: 3 }) as ColumnProfile;

const redundancies: ColumnRedundancy[] = [
  { column: 'pclass', of: 'class', relation: 'same' },
  { column: 'class', of: 'pclass', relation: 'same' },
  { column: 'adult_male', of: 'who', relation: 'determined' },
  { column: 'survived', of: 'alive', relation: 'same' },
  { column: 'alive', of: 'survived', relation: 'same' },
];

describe('ColumnCard twins', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useLabStore.setState({
      target: 'survived',
      baseline: [],
      leaks: [{ column: 'alive', reason: 'leak' }],
      overrides: {},
      redundancies,
      trainStatus: 'idle',
    });
  });

  it('says a column says the same thing as another, and leaves it in', () => {
    render(<ColumnCard profile={profile('pclass')} />);
    expect(screen.getByTestId('redundant-pclass')).toHaveTextContent(
      'Says the same thing as "class". Keeping both splits their weight between them; excluding one loses nothing.',
    );
    // Flagged, not excluded: the button still offers to exclude it.
    expect(screen.getByRole('button', { name: 'Exclude' })).toBeInTheDocument();
    expect(screen.getByTestId('column-card-pclass')).not.toHaveClass('opacity-70');
  });

  it('says which way it goes when only one column can be read off the other', () => {
    const { unmount } = render(<ColumnCard profile={profile('adult_male')} />);
    expect(screen.getByTestId('redundant-adult_male')).toHaveTextContent('Can be read off "who".');
    unmount();
    render(<ColumnCard profile={profile('who')} />);
    expect(screen.queryByTestId('redundant-who')).toBeNull();
  });

  it('drops the flag once one of the two is excluded', () => {
    useLabStore.setState({ overrides: { class: 'exclude' } });
    const { unmount } = render(<ColumnCard profile={profile('pclass')} />);
    expect(screen.queryByTestId('redundant-pclass')).toBeNull();
    unmount();
    render(<ColumnCard profile={profile('class')} />);
    expect(screen.queryByTestId('redundant-class')).toBeNull();
  });

  it('leaves the twin of the target to the leak flag', () => {
    render(<ColumnCard profile={profile('alive')} />);
    expect(screen.queryByTestId('redundant-alive')).toBeNull();
    const state = useLabStore.getState();
    expect(activeTwins(state, 'survived')).toEqual([]);
    expect(activeTwins(state, 'alive')).toEqual([]);
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    render(<ColumnCard profile={profile('pclass')} />);
    expect(screen.getByTestId('redundant-pclass')).toHaveTextContent(
      'Dit la même chose que « class ».',
    );
  });
});
