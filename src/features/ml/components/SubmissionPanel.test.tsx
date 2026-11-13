import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionPanel } from '@/features/ml/components/SubmissionPanel';
import { useLabStore } from '@/features/ml/lab-store';
import type { ColumnProfile } from '@/features/ml/data/types';
import type { BatchScore } from '@/features/ml/train/score';
import type { Submission } from '@/features/ml/train/submission';
import i18n from '@/lib/i18n';

// V65: the panel lets the user name everything, proposes without choosing,
// and says which model predicted the file.

const batch = (over: Partial<BatchScore> = {}) =>
  ({
    fileName: 'test.csv',
    model: 'forest',
    rowCount: 418,
    header: ['PassengerId', 'Pclass', 'Sex'],
    hasProbabilities: true,
    classCount: 2,
    isClassification: true,
    positiveClass: '1',
    ...over,
  }) as BatchScore;

const submission = (over: Partial<Submission> = {}): Submission => ({
  csv: 'PassengerId,Survived\n892,0\n',
  header: ['PassengerId', 'Survived'],
  rows: 418,
  missingIds: 0,
  duplicateIds: 0,
  counts: [
    { label: '0', count: 266 },
    { label: '1', count: 152 },
  ],
  preview: ['PassengerId,Survived', '892,0'],
  fileName: 'test-submission.csv',
  model: 'forest',
  form: 'label',
  refit: null,
  ...over,
});

const build = vi.fn();

describe('SubmissionPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    build.mockClear();
    useLabStore.setState({
      batchStatus: 'done',
      batchResult: batch(),
      target: 'Survived',
      profiles: [{ name: 'PassengerId', type: 'id' } as ColumnProfile],
      submissionStatus: 'idle',
      submission: null,
      submissionError: null,
      buildSubmission: build,
    });
  });

  it('says nothing without a scored file', () => {
    useLabStore.setState({ batchResult: null });
    const { container } = render(<SubmissionPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('proposes the identifier without choosing it, and waits for the choice', () => {
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-suggestion')).toHaveTextContent(
      '"PassengerId" reads as an identifier',
    );
    expect(screen.getByTestId('submission-id-column')).toHaveValue('');
    expect(screen.getByTestId('submission-build')).toBeDisabled();
    expect(screen.getByTestId('submission-prediction-name')).toHaveValue('Survived');
  });

  it('sends what the user named, with the measured model by default', () => {
    render(<SubmissionPanel />);
    fireEvent.change(screen.getByTestId('submission-id-column'), {
      target: { value: 'PassengerId' },
    });
    expect(screen.getByTestId('submission-id-name')).toHaveValue('PassengerId');
    expect(screen.getByTestId('submission-model-measured')).toBeChecked();
    fireEvent.click(screen.getByTestId('submission-build'));
    expect(build).toHaveBeenCalledWith({
      idColumn: 'PassengerId',
      idName: 'PassengerId',
      predictionName: 'Survived',
      form: 'label',
      refit: false,
    });
  });

  it('numbers the rows on request, under a name the user types, and can ask for the refit', () => {
    render(<SubmissionPanel />);
    const select = screen.getByTestId('submission-id-column') as HTMLSelectElement;
    const rowNumber = [...select.options].find((option) => option.text.startsWith('no column'))!;
    fireEvent.change(select, { target: { value: rowNumber.value } });
    expect(screen.getByTestId('submission-build')).toBeDisabled();
    fireEvent.change(screen.getByTestId('submission-id-name'), { target: { value: 'id' } });
    fireEvent.click(screen.getByTestId('submission-form-probability'));
    fireEvent.click(screen.getByTestId('submission-model-refit'));
    fireEvent.click(screen.getByTestId('submission-build'));
    expect(build).toHaveBeenCalledWith({
      idColumn: null,
      idName: 'id',
      predictionName: 'Survived',
      form: 'probability',
      refit: true,
    });
  });

  it('refuses two columns under one name', () => {
    render(<SubmissionPanel />);
    fireEvent.change(screen.getByTestId('submission-id-column'), {
      target: { value: 'PassengerId' },
    });
    fireEvent.change(screen.getByTestId('submission-prediction-name'), {
      target: { value: 'PassengerId' },
    });
    expect(screen.getByTestId('submission-clash')).toBeInTheDocument();
    expect(screen.getByTestId('submission-build')).toBeDisabled();
  });

  it('offers only the forms of the task', () => {
    useLabStore.setState({ batchResult: batch({ classCount: 3, positiveClass: undefined }) });
    const { unmount } = render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-form-probabilities')).toBeInTheDocument();
    expect(screen.queryByTestId('submission-form-probability')).toBeNull();
    fireEvent.click(screen.getByTestId('submission-form-probabilities'));
    expect(screen.queryByTestId('submission-prediction-name')).toBeNull();
    unmount();

    useLabStore.setState({
      batchResult: batch({ isClassification: false, classCount: 0, hasProbabilities: false }),
    });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-form-value')).toBeChecked();
    expect(screen.queryByTestId('submission-form-label')).toBeNull();
  });

  it('says the measured model predicted, and that a submission is not a score', () => {
    useLabStore.setState({ submissionStatus: 'done', submission: submission() });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-result')).toHaveAttribute('data-model', 'measured');
    expect(screen.getByTestId('submission-summary')).toHaveTextContent(
      '418 rows, the same as the scored file and in its order. Columns: PassengerId, Survived.',
    );
    expect(screen.getByTestId('submission-model')).toHaveTextContent(
      'the model the test set measured',
    );
    expect(screen.getByTestId('submission-counts')).toHaveTextContent('0: 266 · 1: 152');
    expect(screen.queryByTestId('submission-ids')).toBeNull();
    expect(screen.getByTestId('submission-result')).toHaveTextContent(
      'A submission is not a score',
    );
  });

  it('announces a refitted model as one nobody measured, and its cap', () => {
    useLabStore.setState({
      submissionStatus: 'done',
      submission: submission({ refit: { rows: 891, fittedRows: 891 } }),
    });
    const { unmount } = render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-result')).toHaveAttribute('data-model', 'refit');
    expect(screen.getByTestId('submission-model')).toHaveTextContent(
      'fitted again on the 891 labelled rows. Nobody measured this model',
    );
    unmount();
    useLabStore.setState({
      submission: submission({ refit: { rows: 9000, fittedRows: 5000 } }),
    });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-model')).toHaveTextContent(
      'on 5,000 of the 9,000 labelled rows, its announced cap',
    );
  });

  it('does not offer to refit a blend', () => {
    useLabStore.setState({ batchResult: batch({ model: 'ensemble' }) });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-model-refit')).toBeDisabled();
    expect(screen.getByTestId('submission-refit-note')).toHaveTextContent(
      'The blend cannot be fitted again',
    );
  });

  it('counts the identifiers a platform would refuse', () => {
    useLabStore.setState({
      submissionStatus: 'done',
      submission: submission({ missingIds: 2, duplicateIds: 1 }),
    });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-ids')).toHaveTextContent(
      '2 rows have no identifier: they are written with an empty one, and a platform will likely refuse them. 1 row repeats an identifier already used.',
    );
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    useLabStore.setState({
      submissionStatus: 'done',
      submission: submission({ refit: { rows: 891, fittedRows: 891 } }),
    });
    render(<SubmissionPanel />);
    expect(screen.getByTestId('submission-suggestion')).toHaveTextContent(
      '« PassengerId » se lit comme un identifiant',
    );
    expect(screen.getByTestId('submission-model')).toHaveTextContent(
      'Personne n’a mesuré ce modèle'.replace('’', "'"),
    );
    expect(screen.getByTestId('submission-result')).toHaveTextContent(
      "Une soumission n'est pas un score",
    );
  });
});
