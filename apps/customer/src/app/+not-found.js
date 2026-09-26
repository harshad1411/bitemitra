import { Link } from 'expo-router';
import { EmptyState, Header, Screen } from '@jamzo/mobile-ui';

/** Unknown deep links land here instead of crashing. */
export default function NotFound() {
  return (
    <Screen scroll={false} header={<Header />}>
      <EmptyState
        title="This page isn't available"
        message="The link may be for a feature that is not in this version yet."
        action={<Link href="/">Go home</Link>}
      />
    </Screen>
  );
}
