import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { formsFor, type SubmissionForm } from '@/features/ml/train/submission';
import { downloadFile } from '@/lib/download';

/** The select value that numbers the rows instead of reading a column. */
const ROW_NUMBER = '\u0000row-number';

const fieldClass =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none';

/**
 * V65: the last scored file as a file a competition platform accepts. The
 * user names everything; the lab only keeps the rows, in their order, and
 * says which model predicted them.
 */
export function SubmissionPanel() {
  const { t, i18n } = useTranslation();
  const batch = useLabStore((s) => s.batchResult);
  const target = useLabStore((s) => s.target);
  const profiles = useLabStore((s) => s.profiles);
  const status = useLabStore((s) => s.submissionStatus);
  const submission = useLabStore((s) => s.submission);
  const error = useLabStore((s) => s.submissionError);
  const build = useLabStore((s) => s.buildSubmission);

  const [idColumn, setIdColumn] = useState('');
  const [idName, setIdName] = useState('');
  const [predictionName, setPredictionName] = useState(target ?? '');
  const [form, setForm] = useState<SubmissionForm | null>(null);
  const [refit, setRefit] = useState(false);

  if (!batch?.header || batch.isClassification === undefined) return null;
  const lang = i18n.resolvedLanguage ?? 'en';
  const forms = formsFor(
    batch.isClassification,
    batch.classCount ?? 0,
    batch.hasProbabilities ?? false,
  );
  const chosenForm = form !== null && forms.includes(form) ? form : forms[0];
  const needsName = chosenForm !== 'probabilities';

  // The lab proposes, and does not choose: a single column of the scored file
  // that the training file read as an identifier.
  const idLike = batch.header.filter((name) =>
    profiles.some((profile) => profile.name === name && profile.type === 'id'),
  );
  const suggestion = idLike.length === 1 ? idLike[0] : null;

  const trimmedId = idName.trim();
  const trimmedPrediction = predictionName.trim();
  const clash = needsName && trimmedId !== '' && trimmedId === trimmedPrediction;
  const ready =
    idColumn !== '' && trimmedId !== '' && (!needsName || trimmedPrediction !== '') && !clash;
  const num = (value: number, digits: number) =>
    value.toLocaleString(lang, { maximumFractionDigits: digits });
  const positive = batch.positiveClass;
  // A blend is built from models picked on the validation rows: fitted on
  // everything, it would have nothing left to pick its members with.
  const canRefit = batch.model !== 'ensemble';

  return (
    <section
      data-testid="submission-panel"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.submission.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.submission.hint')}</p>
      </div>

      <div className="grid gap-3 text-xs sm:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">{t('ml.lab.submission.idColumn')}</span>
          <select
            value={idColumn}
            data-testid="submission-id-column"
            className={fieldClass}
            onChange={(event) => {
              const value = event.target.value;
              setIdColumn(value);
              // The name follows the column until the user types another one.
              if (value !== '' && value !== ROW_NUMBER) setIdName(value);
            }}
          >
            <option value="">{t('ml.lab.submission.idChoose')}</option>
            {batch.header.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={ROW_NUMBER}>{t('ml.lab.submission.idRowNumber')}</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">{t('ml.lab.submission.idName')}</span>
          <input
            value={idName}
            data-testid="submission-id-name"
            className={fieldClass}
            onChange={(event) => setIdName(event.target.value)}
          />
        </label>
        {needsName && (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold">{t('ml.lab.submission.predictionName')}</span>
            <input
              value={predictionName}
              data-testid="submission-prediction-name"
              className={fieldClass}
              onChange={(event) => setPredictionName(event.target.value)}
            />
          </label>
        )}
      </div>
      {suggestion !== null && idColumn === '' && (
        <p className="text-xs text-muted" data-testid="submission-suggestion">
          {t('ml.lab.submission.suggestion', { column: suggestion })}
        </p>
      )}
      {clash && (
        <p className="text-xs text-copper" data-testid="submission-clash">
          {t('ml.lab.submission.clash')}
        </p>
      )}

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="mb-1 font-semibold">{t('ml.lab.submission.formTitle')}</legend>
        {forms.map((option) => (
          <label key={option} className="flex items-start gap-2">
            <input
              type="radio"
              name="submission-form"
              className="mt-0.5"
              data-testid={`submission-form-${option}`}
              checked={chosenForm === option}
              onChange={() => setForm(option)}
            />
            <span>{t(`ml.lab.submission.form.${option}`, { positive: positive ?? '' })}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="mb-1 font-semibold">{t('ml.lab.submission.modelTitle')}</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="submission-model"
            className="mt-0.5"
            data-testid="submission-model-measured"
            checked={!refit}
            onChange={() => setRefit(false)}
          />
          <span>
            {t('ml.lab.submission.model.measured', { model: t(`ml.lab.models.${batch.model}`) })}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="submission-model"
            className="mt-0.5"
            data-testid="submission-model-refit"
            disabled={!canRefit}
            checked={refit}
            onChange={() => setRefit(true)}
          />
          <span>{t('ml.lab.submission.model.refit')}</span>
        </label>
        <p className="mt-1 max-w-3xl text-muted" data-testid="submission-refit-note">
          {t(canRefit ? 'ml.lab.submission.refitNote' : 'ml.lab.submission.refitUnavailable')}
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          data-testid="submission-build"
          disabled={!ready || status === 'building'}
          onClick={() =>
            build({
              idColumn: idColumn === ROW_NUMBER ? null : idColumn,
              idName: trimmedId,
              predictionName: trimmedPrediction,
              form: chosenForm,
              refit,
            })
          }
        >
          {t('ml.lab.submission.build')}
        </Button>
        {status === 'building' && (
          <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t(refit ? 'ml.lab.submission.refitting' : 'ml.lab.submission.building')}
          </span>
        )}
      </div>

      {status === 'error' && (
        <p className="text-xs text-copper" data-testid="submission-error">
          {t('ml.lab.submission.error', { detail: error ?? '' })}
        </p>
      )}

      {status === 'done' && submission && (
        <div
          className="flex flex-col gap-2 text-xs"
          data-testid="submission-result"
          data-model={submission.refit ? 'refit' : 'measured'}
        >
          <p className="text-sm" data-testid="submission-summary">
            {t('ml.lab.submission.summary', {
              count: submission.rows,
              rows: submission.rows.toLocaleString(lang),
              columns: submission.header.join(', '),
            })}
          </p>
          <p data-testid="submission-model">
            {submission.refit
              ? t(
                  submission.refit.fittedRows < submission.refit.rows
                    ? 'ml.lab.submission.byRefitCapped'
                    : 'ml.lab.submission.byRefit',
                  {
                    model: t(`ml.lab.models.${submission.model}`),
                    rows: submission.refit.rows.toLocaleString(lang),
                    fitted: submission.refit.fittedRows.toLocaleString(lang),
                  },
                )
              : t('ml.lab.submission.byMeasured', {
                  model: t(`ml.lab.models.${submission.model}`),
                })}
          </p>
          {(submission.missingIds > 0 || submission.duplicateIds > 0) && (
            <p className="text-copper" data-testid="submission-ids">
              {[
                submission.missingIds > 0 &&
                  t('ml.lab.submission.missingIds', { count: submission.missingIds }),
                submission.duplicateIds > 0 &&
                  t('ml.lab.submission.duplicateIds', { count: submission.duplicateIds }),
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
          {submission.counts && (
            <p className="text-muted" data-testid="submission-counts">
              {submission.counts
                .slice(0, 6)
                .map((item) => `${item.label}: ${item.count.toLocaleString(lang)}`)
                .join(' · ')}
              {submission.counts.length > 6 ? ' · …' : ''}
            </p>
          )}
          {submission.range && (
            <p className="text-muted" data-testid="submission-range">
              {t('ml.lab.submission.range', {
                min: num(submission.range.min, 4),
                max: num(submission.range.max, 4),
                mean: num(submission.range.mean, 4),
              })}
            </p>
          )}
          <pre
            className="max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-2 font-mono text-[0.7rem]"
            data-testid="submission-preview"
          >
            {submission.preview.join('\n')}
            {submission.rows + 1 > submission.preview.length ? '\n…' : ''}
          </pre>
          <div>
            <Button
              variant="outline"
              size="sm"
              data-testid="submission-download"
              onClick={() => downloadFile(submission.fileName, submission.csv, 'text/csv')}
            >
              {t('ml.lab.submission.download')}
            </Button>
          </div>
          <p className="max-w-3xl text-muted">{t('ml.lab.submission.note')}</p>
        </div>
      )}
    </section>
  );
}
