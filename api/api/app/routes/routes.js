import { match } from 'path-to-regexp';

import { orderCardController as orderCard } from '../main/orderCard/controller.js';
import { orderSyncController as orderSync } from '../main/orderSync/controller.js';
import { scheduledTaskController as scheduledTask } from '../main/scheduledTask/controller.js';
import { tenantController as tenant } from '../main/tenant/controller.js';
import { apiError } from '../helpers/apiError.js';
import { rollbarError } from '../helpers/rollbar.js';

// eslint-disable-next-line import/prefer-default-export
export const urlSwitch = async (message) => {
  const { httpMethod, path } = message;
  console.log('------------------------1', httpMethod, path);
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        Allow: 'GET,POST,OPTIONS',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,tenant,tenantId'
      }
    };
  }
  let { body } = message;
  if (body) {
    body = Buffer.from(body, 'base64').toString('utf8');
    body = JSON.parse(body);
  }

  const routes = {};

  const route = (method, pth, func) => {
    if (!routes[pth]) {
      routes[pth] = {};
    }
    routes[pth][method] = func;
  };

  route('GET', 'favicon.ico', '() => null');
  route('GET', '/', () => ({ App: 'NoFraud Integration App API - v2' }));

  // Order Operations
  route('GET', '/beta/order-sync/:orderId', orderSync.get);
  route('PUT', '/beta/order-sync/:orderId', orderSync.create);
  route('PUT', '/beta/order-sync/:orderId/status', orderSync.checkStatus);
  route('PUT', '/beta/order-sync/:orderId/cancel', orderSync.cancelAtNoFraud);
  route('POST', '/beta/order-sync/webhook', orderSync.webhook);
  route(
    'POST',
    '/beta/order-sync/:noFraudApiKey/webhook',
    orderSync.fraudStatusWebhook
  );

  // card for admin //
  route('GET', '/beta/order-card', orderCard.get);

  // Tenant - install, uninstall, update
  route('GET', '/beta/tenant', tenant.get);
  route('PUT', '/beta/tenant', tenant.update);
  route('POST', '/beta/tenant', tenant.install);
  route('POST', '/beta/tenant/uninstall', tenant.uninstall);

  //   /* scheduled tasks */
  route('GET', '/beta/scheduled-task/sync', scheduledTask.sync);
  route('GET', '/beta/scheduled-task/monitor', scheduledTask.monitor);

  const pathTest = (pathToTest) => {
    if (match(pathToTest)(path) !== false) {
      return true;
    }
    return false;
  };

  const reply = (results, statusCode = 200) => {
    const response = {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Content-type': 'application/json'
      },
      body: JSON.stringify(results),
      isBase64Encoded: false
    };
    return response;
  };

  const routeArray = Object.keys(routes);

  for (const rPath of routeArray) {
    if (pathTest(rPath, path)) {
      if (routes[rPath][httpMethod]) {
        const requestObj = {
          securityObj: {}
        };

        // if tenantId is in the query string
        if (message.queryStringParameters?.tenantId) {
          requestObj.securityObj.tenantId =
            message.queryStringParameters.tenantId;
        }

        if (message.headers?.tenantId) {
          requestObj.securityObj.tenantId = message.headers.tenantId;
        }

        if (message.headers?.tenant) {
          requestObj.securityObj.tenantId = message.headers.tenant;
        }

        // Add parameters to request object
        const pathResults = match(rPath)(path);
        requestObj.params = pathResults.params;

        if (message.body) {
          let messageBody = Buffer.from(message.body, 'base64').toString(
            'utf8'
          );
          messageBody = JSON.parse(messageBody);
          requestObj.body = messageBody;
        }
        if (message.queryStringParameters) {
          requestObj.query = message.queryStringParameters;
        }

        // TODO - add query string //

        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await routes[rPath][httpMethod](requestObj);
          return reply(response);
        } catch (err) {
          // eslint-disable-next-line no-await-in-loop
          await rollbarError(err, {
            path,
            httpMethod,
            tenantId: requestObj.securityObj.tenantId
          });
          const { statusCode, apiError: apiErrorBody } = apiError(err);
          return reply(apiErrorBody, statusCode);
        }
      }
    }
  }

  throw new Error(`Invalid path: ${path}. ${httpMethod}`);
};
