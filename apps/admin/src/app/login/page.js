'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ADMIN_APP } from '@jamzo/config/apps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormField } from '@/components/jamzo/form-field';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';

function LoginForm() {
  const { status, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div
          className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-lg font-bold text-primary-foreground"
          aria-hidden
        >
          J
        </div>
        <CardTitle className="text-xl">Sign in to {ADMIN_APP.displayName}</CardTitle>
        <CardDescription>For Jamzo staff only. Every action is recorded.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {errorMessage(error)}
                {error.code === 'ACCOUNT_LOCKED' && error.details?.lockedUntil
                  ? ` (until ${new Date(error.details.lockedUntil).toLocaleTimeString('en-IN')})`
                  : ''}
              </AlertDescription>
            </Alert>
          ) : null}
          <FormField id="email" label="Email" errors={error?.fieldErrors?.email}>
            {(a) => (
              <Input
                {...a}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </FormField>
          <FormField id="password" label="Password" errors={error?.fieldErrors?.password}>
            {(a) => (
              <Input
                {...a}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Two-factor authentication is not enabled yet (required before production — DECISIONS Q-15).
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
