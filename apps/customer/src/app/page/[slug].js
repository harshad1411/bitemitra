// A published CMS page (terms, privacy, refunds…). Legal texts stay unpublished until counsel writes them (Q-12).
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { EmptyState, ErrorState, Header, LoadingState, Screen, Text } from '@jamzo/mobile-ui';

export default function CmsPage() {
  const { slug } = useLocalSearchParams();
  const { api } = useJamzo();
  const q = useQuery({
    queryKey: ['cms-page', slug],
    queryFn: () => api.get(`/v1/cms/pages/${slug}`),
    retry: false,
  });
  if (q.isPending) return <LoadingState label="Loading" />;
  if (q.isError)
    return (
      <Screen header={<Header />}>
        {q.error?.code === 'NOT_FOUND' ? (
          <EmptyState title="Not published yet" message="This page will be available soon." />
        ) : (
          <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />
        )}
      </Screen>
    );
  // Plain text rendering of the Markdown body; a Markdown renderer is a later polish item.
  return (
    <Screen header={<Header />}>
      <Text variant="title">{q.data.title}</Text>
      {q.data.body.split(/\n{2,}/).map((para, i) => (
        <Text key={i}>{para.replace(/^#+\s*/, '').replace(/\*\*/g, '')}</Text>
      ))}
      <Text variant="small">Last updated {new Date(q.data.updatedAt).toLocaleDateString('en-IN')}</Text>
    </Screen>
  );
}
