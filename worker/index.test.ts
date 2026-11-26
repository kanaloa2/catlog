import { describe, expect, it } from 'vitest';
import { mailText } from './index';

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
