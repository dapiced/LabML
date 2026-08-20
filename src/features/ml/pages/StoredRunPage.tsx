import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { RunView } from '@/features/ml/components/RunView';
import { db } from '@/features/ml/projects/db';
import { cn } from '@/lib/utils';

export function StoredRunPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const record = useLiveQuery(async () => (await db.runs.get(Number(id))) ?? null, [id]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to="/ml" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'mb-6')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('ml.lab.runs.backToLab')}
      </Link>
      {record === undefined && null}
      {record === null && <p className="text-muted">{t('ml.lab.runs.notFound')}</p>}
      {record && <RunView record={record} />}
    </div>
  );
}

export default StoredRunPage;
