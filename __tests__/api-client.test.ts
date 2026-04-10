import { makeApiCall } from '../api-client';

describe('makeApiCall', () => {
  it('should throw error for missing token', async () => {
    await expect(
      makeApiCall('https://example.com', '', 'GET', '/test')
    ).rejects.toThrow();
  });
  // Add more tests as needed, e.g., for path/query params, requestBody, etc.
});
