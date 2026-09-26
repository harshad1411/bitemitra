// MSG91 against a fake MSG91 server, SMTP against a real local SMTP server (smtp-server). Neither is the real
// service: MSG91 needs the owner's account and DLT template (D-104, Q-6b).
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { createMsg91SmsProvider, createSmsProvider, createSmtpEmailProvider } from './index.js';

/** @param {(req: any, body: any) => { status: number, json: any }} reply */
async function fakeMsg91(reply) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      calls.push({ headers: req.headers, url: req.url, body });
      const r = reply(req, body);
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { calls, endpoint: `http://127.0.0.1:${port}/api/v5/flow`, close: () => server.close() };
}

describe('MSG91 SMS provider', () => {
  it('sends the DLT template with the code as a variable, never free text', async () => {
    const fake = await fakeMsg91(() => ({ status: 200, json: { type: 'success', message: 'req-123' } }));
    const sms = createMsg91SmsProvider({
      authKey: 'auth-key-1234',
      templates: { LOGIN_OTP: 'tmpl-otp' },
      endpoint: fake.endpoint,
    });
    const out = await sms.send({
      to: '+919876543210',
      text: '123456 is your code',
      vars: { code: '123456' },
      purpose: 'LOGIN_OTP',
    });
    expect(out.providerRef).toBe('req-123');
    expect(fake.calls[0].headers.authkey).toBe('auth-key-1234');
    expect(fake.calls[0].body).toEqual({
      template_id: 'tmpl-otp',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '123456' }],
    });
    fake.close();
  });

  it('treats MSG91 errors as not sent, and refuses purposes without a template', async () => {
    const fake = await fakeMsg91(() => ({
      status: 200,
      json: { type: 'error', message: 'Invalid template' },
    }));
    const sms = createSmsProvider('msg91', {
      env: { MSG91_AUTH_KEY: 'auth-key-1234', MSG91_OTP_TEMPLATE_ID: 'tmpl-otp', MSG91_OTP_VAR: 'OTP' },
    });
    // The factory wires the admin code to the same template; point a direct instance at the fake.
    const direct = createMsg91SmsProvider({
      authKey: 'k-12345678',
      templates: { ADMIN_LOGIN_OTP: 't' },
      otpVar: 'OTP',
      endpoint: fake.endpoint,
    });
    await expect(
      direct.send({ to: '+919876543210', text: 'x', vars: { code: '1' }, purpose: 'ADMIN_LOGIN_OTP' }),
    ).rejects.toThrow(/Invalid template/);
    expect(fake.calls[0].body.recipients[0]).toEqual({ mobiles: '919876543210', OTP: '1' });
    await expect(sms.send({ to: '+919876543210', text: 'x', purpose: 'MARKETING' })).rejects.toThrow(
      /No MSG91 template/,
    );
    await expect(
      direct.send({ to: '9876543210', text: 'x', vars: { code: '1' }, purpose: 'ADMIN_LOGIN_OTP' }),
    ).rejects.toThrow(/E\.164/);
    fake.close();
  });

  it('an HTTP failure is an error', async () => {
    const fake = await fakeMsg91(() => ({ status: 401, json: { message: 'Unauthorized' } }));
    const sms = createMsg91SmsProvider({
      authKey: 'bad-key-1',
      templates: { LOGIN_OTP: 't' },
      endpoint: fake.endpoint,
    });
    await expect(
      sms.send({ to: '+919876543210', text: 'x', vars: { code: '1' }, purpose: 'LOGIN_OTP' }),
    ).rejects.toThrow(/HTTP 401/);
    fake.close();
  });
});

describe('SMTP email provider', () => {
  const received = [];
  let server;
  let port;
  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: false,
      disabledCommands: ['STARTTLS'],
      onAuth(auth, _session, cb) {
        if (auth.username === 'mailer' && auth.password === 'mail-pass') cb(null, { user: 'mailer' });
        else cb(new Error('Invalid username or password'));
      },
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (c) => (raw += c));
        stream.on('end', () => {
          received.push({ from: session.envelope.mailFrom.address, to: session.envelope.rcptTo, raw });
          cb();
        });
      },
      allowInsecureAuth: true,
      logger: false,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('delivers a plain-text message with the configured sender', async () => {
    const email = createSmtpEmailProvider({
      host: '127.0.0.1',
      port,
      user: 'mailer',
      pass: 'mail-pass',
      from: 'Jamzo <no-reply@jamzo.test>',
      requireTls: false,
    });
    const out = await email.send({
      to: 'admin@jamzo.test',
      subject: 'Your Jamzo code',
      text: '123456 is your Jamzo verification code.',
      purpose: 'LOGIN_OTP',
    });
    expect(out.providerRef).toMatch(/@/);
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe('no-reply@jamzo.test');
    expect(received[0].to.map((t) => t.address)).toEqual(['admin@jamzo.test']);
    expect(received[0].raw).toContain('Subject: Your Jamzo code');
    expect(received[0].raw).toContain('123456 is your Jamzo verification code.');
    email.close();
  });

  it('wrong credentials are an error, not a silent drop', async () => {
    const email = createSmtpEmailProvider({
      host: '127.0.0.1',
      port,
      user: 'mailer',
      pass: 'wrong',
      from: 'no-reply@jamzo.test',
      requireTls: false,
    });
    await expect(
      email.send({ to: 'admin@jamzo.test', subject: 's', text: 't', purpose: 'LOGIN_OTP' }),
    ).rejects.toThrow();
    email.close();
  });

  it('refuses to send without TLS unless explicitly allowed (real servers)', async () => {
    const email = createSmtpEmailProvider({
      host: '127.0.0.1',
      port,
      user: 'mailer',
      pass: 'mail-pass',
      from: 'no-reply@jamzo.test',
      timeoutMs: 3000,
    });
    await expect(
      email.send({ to: 'admin@jamzo.test', subject: 's', text: 't', purpose: 'LOGIN_OTP' }),
    ).rejects.toThrow();
    email.close();
  });
});
