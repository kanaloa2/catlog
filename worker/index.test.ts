import { describe, expect, it } from 'vitest';
import { fromAddress, mailText, senderVerified } from './index';

describe('email text', () => {
  it('reads the plain part and drops the quoted reply', () => {
    const raw = [
      'Subject: kitties',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Stormy pooed by the door =F0=9F=92=A9',
      '',
      'On Tue, Nov 25, Sam wrote:',
      '> Bandit barfed',
      '--b1',
      'Content-Type: text/html',
      '',
      '<p>Stormy pooed</p>',
      '--b1--',
    ].join('\r\n');
    expect(mailText(raw)).toBe('Stormy pooed by the door 💩');
  });
  it('falls back to HTML', () => {
    const raw = 'Content-Type: text/html\r\n\r\n<div>Luna barfed</div><div>Thanks</div>';
    expect(mailText(raw)).toContain('Luna barfed');
  });
});

describe('email sender', () => {
  const head = (auth: string[], from = '"Chris B" <Chris@Example.com>') =>
    [...auth.map((a) => `Authentication-Results: ${a}`), `From: ${from}`, 'Subject: Stormy pooed'].join('\r\n');

  it('reads the address out of the From header', () => {
    expect(fromAddress(head([]))).toBe('chris@example.com');
    expect(fromAddress('From: sam@outlook.com')).toBe('sam@outlook.com');
  });
  it('trusts a DKIM, SPF or DMARC pass for the From domain', () => {
    expect(senderVerified(head(['mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1']), 'chris@example.com')).toBe(true);
    expect(senderVerified(head(['mx.cloudflare.net; spf=pass smtp.mailfrom=bounce@mail.example.com']), 'chris@example.com')).toBe(true);
    expect(senderVerified(head(['mx.cloudflare.net; dmarc=pass header.from=example.com']), 'chris@example.com')).toBe(true);
  });
  it('refuses a failed check, another domain or no check at all', () => {
    expect(senderVerified(head(['mx.cloudflare.net; dkim=fail header.d=example.com; spf=softfail smtp.mailfrom=example.com']), 'chris@example.com')).toBe(false);
    expect(senderVerified(head(['mx.cloudflare.net; dkim=pass header.d=attacker.net']), 'chris@example.com')).toBe(false);
    expect(senderVerified(head([]), 'chris@example.com')).toBe(false);
  });
  it('only reads the top Authentication-Results, which the receiving server added', () => {
    const forged = head(['mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=example.com', 'evil; dkim=pass header.d=example.com']);
    expect(senderVerified(forged, 'chris@example.com')).toBe(false);
  });
});
