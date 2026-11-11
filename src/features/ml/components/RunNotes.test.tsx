import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RunNotes } from '@/features/ml/components/RunNotes';
import { buildReportHtml } from '@/features/ml/projects/report';
import type { RunRecord } from '@/features/ml/projects/types';
import type { RunNote } from '@/features/ml/train/journal';
import i18n from '@/lib/i18n';
import { readFileSync } from 'node:fs';

// V55: the journal is shown next to the result it affects, in both languages,
// and a run with nothing to say looks exactly as it did before.

const notes: RunNote[] = [
  { code: 'ensemble-failed', detail: 'ensemble exploded' },
  { code: 'fold-failed', model: 'knn', count: 4 },
];

describe('RunNotes', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing for a run where nothing happened', () => {
    const { container } = render(<RunNotes notes={undefined} />);
    expect(container).toBeEmptyDOMElement();
    render(<RunNotes notes={[]} />);
    expect(screen.queryByTestId('run-notes')).toBeNull();
  });

  it('renders nothing when a shared run carries something that is not a list', () => {
    const damaged = 'not a list' as unknown as RunNote[];
    const { container } = render(<RunNotes notes={damaged} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says what the run fell back from, with the cause and the family', () => {
    render(<RunNotes notes={notes} />);
    const block = screen.getByTestId('run-notes');
    expect(block).toHaveTextContent('Run journal');
    expect(block).toHaveTextContent('The ensemble could not be built');
    expect(block).toHaveTextContent('(ensemble exploded)');
    expect(block).toHaveTextContent('k-nearest neighbors');
    expect(block).toHaveTextContent('4 fold(s)');
  });

  it('says it in French too', async () => {
    await i18n.changeLanguage('fr');
    render(<RunNotes notes={notes} />);
    expect(screen.getByTestId('run-notes')).toHaveTextContent('Journal du run');
    expect(screen.getByTestId('run-notes')).toHaveTextContent('4 pli(s)');
  });
});

describe('the HTML report (V55)', () => {
  const record = JSON.parse(readFileSync('tests/share-links/titanic.json', 'utf8')) as RunRecord;
  const t = i18n.getFixedT('en');

  it('carries the journal, escaped', () => {
    const withNotes: RunRecord = {
      ...record,
      summary: {
        ...record.summary,
        notes: [{ code: 'ensemble-failed', detail: '<img src=x onerror=alert(1)>' }],
      },
    };
    const html = buildReportHtml(withNotes, t, 'en');
    expect(html).toContain('Run journal');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('is unchanged for a run with no journal', () => {
    expect(buildReportHtml(record, t, 'en')).not.toContain('Run journal');
  });
});
