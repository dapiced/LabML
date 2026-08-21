import { ArrowRight, MessagesSquare, ScanEye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';

/** Hub for the AI modules: vision is live, chat is deliberately gated. */
export function AiPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <Eyebrow>{t('ai.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('ai.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('ai.lede')}</p>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <ScanEye className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/ai/vision" className="hover:underline">
              {t('ai.hub.vision.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('ai.hub.vision.description')}</p>
          <Link
            to="/ai/vision"
            className="mt-auto inline-flex w-fit items-center gap-2 text-sm font-medium text-accent-strong hover:underline"
          >
            {t('ai.hub.vision.cta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>

        <Card className="flex flex-col gap-3">
          <MessagesSquare className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/ai/chat" className="hover:underline">
              {t('ai.hub.chat.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('ai.hub.chat.description')}</p>
          <Link
            to="/ai/chat"
            className="mt-auto inline-flex w-fit items-center gap-2 text-sm font-medium text-accent-strong hover:underline"
          >
            {t('ai.hub.chat.cta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>
      </section>
    </div>
  );
}

export default AiPage;
