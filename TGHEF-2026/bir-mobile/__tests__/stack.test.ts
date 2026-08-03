import { cdnUrl, getStack, jwksUrl, restOrigin, restUrl } from '@/config/stack';

describe('stack contract accessor', () => {
  it('exposes the contract regions and endpoints', () => {
    const stack = getStack();
    expect(stack.region).toBeTruthy();
    expect(stack.api.graphqlEndpoint).toMatch(/^https:\/\//);
    expect(stack.api.graphqlRealtime).toMatch(/^wss:\/\//);
    expect(stack.passes.alg).toBe('ES256');
  });

  it('derives the REST origin by stripping the base path', () => {
    expect(restOrigin()).toMatch(/^https:\/\/[^/]+$/);
    expect(restUrl('/pay/order')).toBe(`${getStack().api.restBase}/pay/order`);
  });

  it('resolves the JWKS path against the REST origin', () => {
    expect(jwksUrl()).toBe(`${restOrigin()}${getStack().passes.jwksPath}`);
  });

  it('builds CDN URLs from the contract domain', () => {
    expect(cdnUrl('/media/hero.jpg')).toBe(
      `https://${getStack().storage.cdnDomain}/media/hero.jpg`,
    );
    expect(cdnUrl('media/hero.jpg')).toBe(`https://${getStack().storage.cdnDomain}/media/hero.jpg`);
  });
});
