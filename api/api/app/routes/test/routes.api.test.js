/* globals createRequest */

import { expect } from 'chai';
import '../../test/common';

import { app } from '../../../index.js';

describe('routes.api.test.js - Error response handling', () => {
  it('should return a structured 404 apiError response, not a swallowed/mislabeled error, when a route handler throws', async () => {
    const message = createRequest(
      global.headers,
      'GET',
      '/beta/order-sync/does-not-exist'
    );
    const response = await app(message);

    expect(response.statusCode).to.equal(404);

    const payload = JSON.parse(response.body);
    expect(payload.type).to.equal('notFound');
    expect(payload.message).to.equal('Order Sync does not exist');
  });

  it('should still throw for a genuinely invalid path', async () => {
    const message = createRequest(global.headers, 'GET', '/beta/not-a-route');

    let thrown;
    try {
      await app(message);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.exist;
    expect(thrown.message).to.include('Invalid path');
  });
});
