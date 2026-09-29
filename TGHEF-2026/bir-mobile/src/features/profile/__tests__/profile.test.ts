import { ageBandFromDob, isProfileComplete } from '../ageBand';

const NOW = new Date('2026-11-21T00:00:00Z'); // festival day 1

describe('ageBandFromDob', () => {
  it('classifies child / minor / adult by the festival date', () => {
    expect(ageBandFromDob('2020-01-01', NOW)).toBe('child'); // 6
    expect(ageBandFromDob('2015-01-01', NOW)).toBe('child'); // 11
    expect(ageBandFromDob('2011-01-01', NOW)).toBe('minor'); // 15
    expect(ageBandFromDob('2010-01-01', NOW)).toBe('minor'); // 16
    expect(ageBandFromDob('2008-11-20', NOW)).toBe('adult'); // turned 18 the day before
    expect(ageBandFromDob('2000-05-15', NOW)).toBe('adult'); // 26
  });

  it('handles the exact-birthday boundary (18th birthday = adult)', () => {
    expect(ageBandFromDob('2008-11-21', NOW)).toBe('adult'); // exactly 18 today
    expect(ageBandFromDob('2008-11-22', NOW)).toBe('minor'); // 18 tomorrow → still 17
    expect(ageBandFromDob('2013-11-21', NOW)).toBe('minor'); // exactly 13 → minor
    expect(ageBandFromDob('2013-11-22', NOW)).toBe('child'); // 13 tomorrow → still 12
  });

  it('rejects malformed or absurd dates', () => {
    expect(ageBandFromDob('', NOW)).toBe('');
    expect(ageBandFromDob('15-05-2000', NOW)).toBe('');
    expect(ageBandFromDob('1800-01-01', NOW)).toBe(''); // >130
    expect(ageBandFromDob('2030-01-01', NOW)).toBe(''); // future
  });
});

describe('isProfileComplete', () => {
  it('requires name, a valid DOB and consent', () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete({ displayName: '', dob: '2000-05-15', consentDpdp: true })).toBe(
      false,
    );
    expect(isProfileComplete({ displayName: 'A', dob: '2000', consentDpdp: true })).toBe(false);
    expect(isProfileComplete({ displayName: 'A', dob: '2000-05-15', consentDpdp: false })).toBe(
      false,
    );
    expect(isProfileComplete({ displayName: 'A', dob: '2000-05-15', consentDpdp: true })).toBe(
      true,
    );
  });
});
