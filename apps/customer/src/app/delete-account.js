// Delete my account (D-117; required by the app stores): the shared screen with what it means for customers.
import { AccountDeletion } from '@jamzo/mobile-foundation';

export default function DeleteAccount() {
  return (
    <AccountDeletion
      signOutFirst
      points={[
        'You are signed out on every phone and no longer get notifications.',
        'After 30 days we erase your name, mobile number, email, saved addresses and favourites.',
        'Your past orders and payments are kept for tax records, without your name, number or address.',
        'Until then you can sign in again and keep your account. You cannot order while it is waiting.',
      ]}
    />
  );
}
