import { evaluateStaffScan } from '../evaluate';

// The ES256 crypto (verifyPass) is covered by the verifier suite; here we mock it
// to exercise the staff checkpoint/entitlement branching in isolation.
jest.mock('@/offline/verifier', () => ({ verifyPass: jest.fn() }));
import { verifyPass } from '@/offline/verifier';

const mock = verifyPass as unknown as jest.Mock;
const CLAIMS = {
  jti: 'master-u1-12345678',
  typ: 'master',
  sub: 'u1',
  name: 'Priya Sharma',
  ageBand: 'adult',
  evt: 'bir-festival-2026',
  zones: ['festival'],
  nbf: 0,
  exp: 9e9,
};
const base = {
  jwks: [],
  nowSec: 1000,
  isRevoked: () => false,
  isEntitled: (sub: string, cp: string) => sub === 'u1' && cp === 'item:him-queen-2026',
};

describe('evaluateStaffScan', () => {
  beforeEach(() => mock.mockReset());

  it('grants any valid pass at a gate checkpoint, with identity', () => {
    mock.mockReturnValue({ ok: true, claims: CLAIMS });
    const r = evaluateStaffScan('tok', { ...base, checkpointId: 'gate:main' });
    expect(r.verdict).toBe('valid');
    expect(r.identity).toEqual({
      name: 'Priya Sharma',
      ageBand: 'adult',
      passId: 'PASS-12345678',
      sub: 'u1',
    });
  });

  it('grants an event checkpoint only when the holder is entitled', () => {
    mock.mockReturnValue({ ok: true, claims: CLAIMS });
    expect(evaluateStaffScan('tok', { ...base, checkpointId: 'item:him-queen-2026' }).verdict).toBe(
      'valid',
    );
    expect(evaluateStaffScan('tok', { ...base, checkpointId: 'item:paragliding' }).verdict).toBe(
      'not-entitled',
    );
  });

  it('rejects a revoked pass even if otherwise valid', () => {
    mock.mockReturnValue({ ok: true, claims: CLAIMS });
    const r = evaluateStaffScan('tok', {
      ...base,
      checkpointId: 'gate:main',
      isRevoked: () => true,
    });
    expect(r.verdict).toBe('revoked');
    expect(r.identity?.name).toBe('Priya Sharma');
  });

  it('maps verify failures to verdicts', () => {
    mock.mockReturnValue({ ok: false, reason: 'expired' });
    expect(evaluateStaffScan('t', { ...base, checkpointId: 'gate:main' }).verdict).toBe('expired');
    mock.mockReturnValue({ ok: false, reason: 'bad-signature' });
    expect(evaluateStaffScan('t', { ...base, checkpointId: 'gate:main' }).verdict).toBe(
      'bad-signature',
    );
    mock.mockReturnValue({ ok: false, reason: 'bad-kid' });
    expect(evaluateStaffScan('t', { ...base, checkpointId: 'gate:main' }).verdict).toBe(
      'bad-signature',
    );
    mock.mockReturnValue({ ok: false, reason: 'malformed' });
    expect(evaluateStaffScan('t', { ...base, checkpointId: 'gate:main' }).verdict).toBe(
      'malformed',
    );
  });
});
