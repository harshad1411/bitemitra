// Delete my account (D-120; required by the app stores): what it means for restaurant owners and staff. The
// restaurant itself stays; the only owner of a restaurant is asked to contact Jamzo partner support first.
import { AccountDeletion } from '@jamzo/mobile-foundation';

export default function DeleteAccount() {
  return (
    <AccountDeletion
      points={[
        'You leave your restaurants in Jamzo and are signed out on every phone.',
        'The restaurant itself, its menu, orders and payouts stay. If you are its only owner, Jamzo partner support first adds another owner or closes the restaurant.',
        'After 30 days we erase your name, mobile number and email.',
        'Until then you can sign in again and keep your account.',
      ]}
    />
  );
}
