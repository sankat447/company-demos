import en from '@/i18n/en.json';
import hi from '@/i18n/hi.json';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('hi.json parity (CLAUDE.md rule 3)', () => {
  it('has exactly the same key set as en.json', () => {
    expect(flattenKeys(hi).sort()).toEqual(flattenKeys(en).sort());
  });

  it('has no empty Hindi values', () => {
    const walk = (obj: Record<string, unknown>): void => {
      for (const v of Object.values(obj)) {
        if (typeof v === 'object' && v !== null) walk(v as Record<string, unknown>);
        else expect(String(v).trim()).not.toBe('');
      }
    };
    walk(hi);
  });
});
