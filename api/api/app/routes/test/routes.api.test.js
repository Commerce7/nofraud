/* globals createRequest */

import { expect } from 'chai';
import nock from 'nock';
import '../../test/common';

import { app } from '../../../index.js';

describe('routes.api.test.js - Rollbar reporting', () => {
  let originalNodeEnv;
  let originalToken;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalToken = process.env.ROLLBAR_ACCESS_TOKEN;
    process.env.NODE_ENV = 'production';
    process.env.ROLLBAR_ACCESS_TOKEN =
      process.env.ROLLBAR_ACCESS_TOKEN || 'fake-token-for-mock-test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ROLLBAR_ACCESS_TOKEN = originalToken;
    nock.cleanAll();
  });

  it('reports API-path errors to Rollbar with the expected context before responding', async () => {
    let capturedBody;
    const rollbarScope = nock('https://api.rollbar.com')
      .post('/api/1/item/', (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, { err: 0, result: { uuid: 'test-uuid' } });

    const message = createRequest(
      global.headers,
      'GET',
      '/beta/order-sync/does-not-exist'
    );
    const response = await app(message);

    expect(rollbarScope.isDone()).to.equal(true);
    expect(capturedBody.data.body.trace_chain[0].exception.message).to.equal(
      'Order Sync does not exist'
    );
    expect(capturedBody.data.custom.path).to.equal(
      '/beta/order-sync/does-not-exist'
    );
    expect(capturedBody.data.custom.httpMethod).to.equal('GET');
    expect(capturedBody.data.custom.tenantId).to.equal(global.tenantId);
    expect(response.statusCode).to.equal(404);
  });

  it('reports SQS-path errors to Rollbar and still rethrows the original error', async () => {
    let capturedBody;
    const rollbarScope = nock('https://api.rollbar.com')
      .post('/api/1/item/', (body) => {
        capturedBody = body;
        return true;
      })
      .reply(200, { err: 0, result: { uuid: 'test-uuid-2' } });

    const sqsMessage = {
      Records: [
        {
          eventSource: 'aws:sqs',
          body: JSON.stringify({ messageType: 'notARealType' })
        }
      ]
    };

    let thrown;
    try {
      await app(sqsMessage);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.exist;
    expect(thrown.message).to.equal('Invalid Message Type');
    expect(rollbarScope.isDone()).to.equal(true);
    expect(capturedBody.data.body.trace_chain[0].exception.message).to.equal(
      'Invalid Message Type'
    );
    expect(capturedBody.data.custom.source).to.equal('sqs');
    expect(capturedBody.data.custom.messageType).to.equal('notARealType');
  });
});

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
