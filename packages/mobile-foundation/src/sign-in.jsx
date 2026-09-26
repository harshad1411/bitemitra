// Phone OTP sign-in (D-20). Shared because authentication is a foundation, not a product flow; each app
// supplies its own title and explanation. OTP delivery in development is the console provider (D-21).
import { useEffect, useState } from 'react';
import { normalizeIndianMobile } from '@jamzo/validation';
import { Button, Screen, Text, TextField } from '@jamzo/mobile-ui';
import { retryAfterSec, userMessage } from './core/index.js';
import { useJamzo } from './provider.jsx';

export function PhoneSignIn({ title, subtitle, header, logo }) {
  const { session } = useJamzo();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function request() {
    const normalized = normalizeIndianMobile(phone);
    if (!normalized) return setError('Enter a valid 10-digit mobile number.');
    setBusy(true);
    setError(null);
    try {
      const res = await session.requestOtp(normalized);
      setChallenge({ ...res, phone: normalized });
      setWait(res.resendAfterSec);
      setCode('');
    } catch (err) {
      setError(userMessage(err));
      const after = retryAfterSec(err);
      if (after) setWait(after);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await session.verifyOtp(challenge.challengeId, code);
    } catch (err) {
      const remaining = err?.details?.attemptsRemaining;
      setError(`${userMessage(err)}${Number.isInteger(remaining) ? ` ${remaining} attempts left.` : ''}`);
      if (err?.code === 'OTP_EXPIRED' || err?.code === 'OTP_ATTEMPTS_EXCEEDED') setChallenge(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={header}>
      {logo}
      <Text variant="title">{title}</Text>
      <Text variant="muted">{subtitle}</Text>
      {!challenge ? (
        <>
          <TextField
            label="Mobile number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="98765 43210"
            error={error}
            returnKeyType="send"
            onSubmitEditing={request}
          />
          <Button
            title={wait > 0 ? `Send code (${wait}s)` : 'Send code'}
            onPress={request}
            busy={busy}
            disabled={wait > 0}
          />
        </>
      ) : (
        <>
          <Text variant="muted">Enter the 6-digit code sent to {challenge.phone}.</Text>
          <TextField
            label="Verification code"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            error={error}
            onSubmitEditing={verify}
          />
          <Button title="Verify and continue" onPress={verify} busy={busy} disabled={code.length !== 6} />
          <Button
            title={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            variant="secondary"
            onPress={request}
            disabled={wait > 0 || busy}
          />
          <Button
            title="Use a different number"
            variant="secondary"
            onPress={() => (setChallenge(null), setError(null))}
          />
        </>
      )}
    </Screen>
  );
}
