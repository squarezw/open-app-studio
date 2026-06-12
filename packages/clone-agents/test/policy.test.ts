import { describe, expect, it } from 'vitest';
import { domainPriority, scoreCandidate, signatureOf } from '../src/policy.js';

describe('domainPriority', () => {
  it('boosts core commerce/auth flows', () => {
    expect(domainPriority('com.x:id/btn_checkout')).toBe(3);
    expect(domainPriority('add to cart')).toBe(3);
    expect(domainPriority('sign up')).toBe(3);
    expect(domainPriority('category list')).toBe(3);
  });

  it('penalizes utility / dead-end surfaces incl. promo engagement', () => {
    expect(domainPriority('iCLTopBarScanner barcode')).toBe(-3);
    expect(domainPriority('share and earn')).toBe(-3);
    expect(domainPriority('notifications')).toBe(-3);
    expect(domainPriority('settings')).toBe(-3);
    expect(domainPriority('Take a quick survey')).toBe(-3);
    expect(domainPriority('Rate us')).toBe(-3);
  });

  it('prefers promo-dismiss affordances (close the interstitial, keep exploring)', () => {
    expect(domainPriority("Don't show again")).toBe(2);
    expect(domainPriority('No thanks')).toBe(2);
    expect(domainPriority('Not now')).toBe(2);
    expect(domainPriority('Skip')).toBe(2);
    // a promo-dismiss beats engaging the survey
    expect(domainPriority("Don't show again")).toBeGreaterThan(domainPriority('Take a quick survey'));
  });

  it('penalizes generic close/cancel and stays neutral otherwise', () => {
    expect(domainPriority('cancel')).toBe(-2);
    expect(domainPriority('some random label')).toBe(0);
  });
});

describe('signatureOf', () => {
  it('prefers resourceId so a recurring button matches across screens', () => {
    expect(signatureOf({ resourceId: 'com.x:id/scan', text: 'Scan' })).toBe('com.x:id/scan');
    expect(signatureOf({ text: 'Buy' })).toBe('Buy');
    expect(signatureOf({ xpath: '/0/1' })).toBe('/0/1');
  });
});

describe('scoreCandidate', () => {
  const base = { yFraction: 0.5, destinationVisits: 0, onHome: false };

  it('ranks core > neutral, and rewards unseen destinations', () => {
    const core = scoreCandidate({ ...base, hint: 'checkout', signature: 'a', knownDestination: undefined });
    const neutral = scoreCandidate({ ...base, hint: 'foo', signature: 'b', knownDestination: undefined });
    expect(core).toBeGreaterThan(neutral);
  });

  it('suppresses a button known to lead to an already-visited node (the scanner trap)', () => {
    const fresh = scoreCandidate({ ...base, hint: 'iCLTopBarScanner', signature: 'scan', knownDestination: undefined });
    const seen = scoreCandidate({ ...base, hint: 'iCLTopBarScanner', signature: 'scan', knownDestination: 'n_scan', destinationVisits: 2 });
    expect(seen).toBeLessThan(fresh);
    // a fresh core action should always beat re-opening a seen utility screen
    const coreFresh = scoreCandidate({ ...base, hint: 'cart', signature: 'cart', knownDestination: undefined });
    expect(coreFresh).toBeGreaterThan(seen);
  });

  it('gives bottom-nav items a breadth bonus on the home screen', () => {
    const bottomHome = scoreCandidate({ hint: 'me', signature: 'me', yFraction: 0.95, destinationVisits: 0, onHome: true });
    const bottomDeep = scoreCandidate({ hint: 'me', signature: 'me', yFraction: 0.95, destinationVisits: 0, onHome: false });
    expect(bottomHome).toBeGreaterThan(bottomDeep);
  });
});
