import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, maskEmail, maskPhone } from './index.js';

function capture() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, logger: createLogger({ name: 'test', destination }) };
}

describe('logger', () => {
  it('redacts secrets at any nesting level we configure', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        body: { password: 'hunter2', otp: '123456', refreshToken: 'abc' },
        accessToken: 'jwt',
        req: { headers: { authorization: 'Bearer x' } },
      },
      'login',
    );
    const out = JSON.stringify(lines[0]);
    for (const secret of ['hunter2', '123456', '"abc"', '"jwt"', 'Bearer x'])
      expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it('masks phone numbers and emails', () => {
    expect(maskPhone('+919876543210')).toBe('+91987•••••10');
    expect(maskEmail('owner@example.com')).toBe('o•••@example.com');
    expect(maskPhone(null)).toBeNull();
  });
});
