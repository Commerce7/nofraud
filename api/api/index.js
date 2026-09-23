/* eslint-disable import/prefer-default-export */
/* eslint-disable max-len */

import env from 'dotenv';

import { urlSwitch } from './app/routes/routes.js';
import { OrderSyncManager as orderSync } from './app/main/orderSync/manager.js'
import { rollbarError } from './app/helpers/rollbar.js';

env.config({ path: './.env' });

export const app = async (message) => {
  let sqsContext;
  try {
    if (message.resource) {
      const results = await urlSwitch(message);
      return results;
    }
    if (message.Records) {
      const source = message.Records[0].eventSource;
      switch (source) {
        case 'aws:sqs': {
          const sqsBody = JSON.parse(message.Records[0].body);
          sqsContext = {
            messageType: sqsBody.messageType,
            messageAction: sqsBody.messageAction
          };
          const results = await sqsSwitch(sqsBody);
          return results;
        }
        default:
          throw Error('Invalid Source');
      }
    }
    throw Error('No idea where this came from');
  } catch (err) {
    await rollbarError(err, {
      source: message.resource ? 'api' : 'sqs',
      httpMethod: message.httpMethod,
      path: message.path,
      ...sqsContext
    });
    throw err;
  }
};

const sqsSwitch = async (message) => {
  switch (message.messageType) {
    case 'orderSync': {
      await orderSync[message.messageAction](message);
      break;
    }
    default:
      throw Error('Invalid Message Type');
  }
};
