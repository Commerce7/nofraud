import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { sendToFifoQueue } from '../../helpers/sqsHelper.js';
import { TenantManager } from '../tenant/manager.js';

import { DAO } from './dao.js';
import { Gateway } from './gateway.js';

export const get = async (securityObj, id) => {
  const orderSync = await DAO.get(securityObj, id);
  return orderSync;
};

export const sync = async (securityObj, id) => {
  // Get order at C7
  const c7order = await getCommerce7Order(securityObj.tenantId, id);
  // Attempt to sync order
  const attempt = await attemptSyncWithNoFraud(securityObj, c7order);
  // Is order in our database

  try {
    let orderSync = await DAO.get(securityObj, id);
    orderSync = updateFromSync(securityObj, id, attempt);
    return orderSync;
  } catch (err) {
    if (err.statusCode === 404) {
      const orderSync = createFromSync(securityObj, id, attempt);
      return orderSync;
    }
    throw err;
  }
};

export const checkStatus = async (securityObj, id) => {
  // Get order at C7
  const c7order = await getCommerce7Order(securityObj.tenantId, id);
  // Attempt to sync order
  const settings = await TenantManager.get(securityObj);
  const attempt = await checkStatusWithNoFraud(securityObj, settings, c7order);
  // Is order in our database

  try {
    let orderSync = await DAO.get(securityObj, id);
    orderSync = updateFromSync(securityObj, id, attempt);
    return orderSync;
  } catch (err) {
    if (err.statusCode === 404) {
      const orderSync = createFromSync(securityObj, id, attempt);
      return orderSync;
    }
    throw err;
  }
};

export const cancelAtNoFraud = async (securityObj, id) => {
  let orderSync = await DAO.get(securityObj, id);

  const attemptWithTransactionId = orderSync.attempts.find(
    (attempt) => attempt.transactionId !== null
  );

  const { transactionId } = attemptWithTransactionId;

  // Attempt to sync order
  const attempt = await cancelWithNoFraud(securityObj, transactionId);
  // Is order in our database

  try {
    orderSync = updateFromSync(securityObj, id, attempt);
    return orderSync;
  } catch (err) {
    if (err.statusCode === 404) {
      orderSync = createFromSync(securityObj, id, attempt);
      return orderSync;
    }
    throw err;
  }
};

export const webhook = async (params) => {
  const message = {
    tenantId: params.tenantId,
    orderId: params.payload.id,
    messageId: uuidv4()
  };
  await sendToFifoQueue('orderSync', 'webhookFromSQS', message);
};

export const webhookFromSQS = async (message) => {
  const { tenantId, orderId } = message;
  const securityObj = { tenantId };
  await sync(securityObj, orderId);
};

export const fraudStatusWebhook = async (noFraudApiKey, params) => {
  console.log('----------------------------3', noFraudApiKey, params);
  const message = {
    noFraudApiKey,
    params,
    messageId: uuidv4()
  };
  await sendToFifoQueue('orderSync', 'fraudStatusWebhookFromSQS', message);
};

export const fraudStatusWebhookFromSQS = async (message) => {
  console.log('----------------------------4', message);
  // Get tenantId from noFraudApiKey
  const { noFraudApiKey, params } = message;
  const tenant = await TenantManager.getTenantIdByNoFraudApiKey(noFraudApiKey);
  const securityObj = { tenantId: tenant.id };
  console.log('----------------------------5', tenant, securityObj);

  // Get C7 OrderId based on NoFraud transactionId
  const c7Order = await DAO.getC7OrderIdByNoFraudTransactionId(
    securityObj,
    params.id
  );
  const { id } = c7Order;
  const c7OrderId = c7Order.attempts[0].orderSyncId;
  console.log('----------------------------6', c7OrderId);

  // Get order at C7
  const c7order = await getCommerce7Order(securityObj.tenantId, c7OrderId);
  // Attempt to sync order
  const settings = await TenantManager.get(securityObj);
  console.log('----------------------------7', settings);

  const attempt = await checkStatusWithNoFraud(securityObj, settings, c7order);
  // Is order in our database
  console.log('----------------------------8', attempt);

  try {
    let orderSync = await DAO.get(securityObj, id);
    orderSync = updateFromSync(securityObj, id, attempt);
    return orderSync;
  } catch (err) {
    if (err.statusCode === 404) {
      const orderSync = createFromSync(securityObj, id, attempt);
      return orderSync;
    }
    throw err;
  }
};

const getCommerce7Order = async (tenantId, id) => {
  const url = `${process.env.C7_API_URL}/v1/order/${id}`;
  const response = await axios.get(url, axiosHeader(tenantId));
  const order = response.data;
  return order;
};

const getCommerce7Settings = async (tenantId) => {
  const url = `${process.env.C7_API_URL}/v1/setting/for-web?version=V2`;
  const response = await axios.get(url, axiosHeaderNoAuth(tenantId));
  const settings = response.data;
  return settings;
};

// export const attemptSyncInTest = async (securityObj, c7order) => {
//   // Unit test just for testing
//   if (process.env.NODE_ENV !== 'test') {
//     throw new Error('Not allowed in non-test environment');
//   }
//   const attempt = await attemptSyncWithNoFraud(securityObj, c7order);
//   return attempt;
// };

// eslint-disable-next-line no-unused-vars
const attemptSyncWithNoFraud = async (securityObj, c7order) => {
  // TODO - write this whole function
  if (c7order.channel !== 'Web') {
    const response = invalidChannel();
    return response;
  }

  if (!c7order.connectionInformation?.customerIpAddress) {
    const response = invalidIPAddress();
    return response;
  }

  if (!c7order.customer) {
    const response = invalidCustomer();
    return response;
  }

  if (successfulCreditCardAttemptCount(c7order) === 0) {
    const response = invalidTender();
    return response;
  }

  const settings = await TenantManager.get(securityObj);
  const payload = await noFraudPayload(securityObj, settings, c7order);

  const url = process.env.NOFRAUD_API_URL;
  let response;
  try {
    const axiosResponse = await axios.post(url, payload);
    response = processNoFraudResponse(axiosResponse);
  } catch (err) {
    response = processNoFraudErrorResponse(err.response);
  }

  return response;
};

const checkStatusWithNoFraud = async (securityObj, settings, c7order) => {
  const url = `${process.env.NOFRAUD_API_URL}/status_by_invoice/${settings.noFraudAPIToken}/${c7order.orderNumber}`;
  let response;
  try {
    const axiosResponse = await axios.get(url);
    response = processNoFraudResponse(axiosResponse);
  } catch (err) {
    response = processNoFraudErrorResponse(err.response);
  }

  return response;
};

const cancelWithNoFraud = async (securityObj, transactionId) => {
  const now = new Date();

  const settings = await TenantManager.get(securityObj);

  const payload = {
    nf_token: settings.noFraudAPIToken,
    transaction_id: transactionId
  };

  const url = `${process.env.NOFRAUD_PORTAL_API_URL}/api/v1/transaction-update/cancel-transaction`;
  let response;
  try {
    await axios.post(url, payload);
    response = {
      attemptDate: now.toISOString(),
      type: 'Cancelled'
    };
  } catch (err) {
    response = processNoFraudErrorResponse(err.response);
  }

  return response;
};

const processNoFraudResponse = (axiosResponse) => {
  const now = new Date();
  if (axiosResponse.data.decision === 'pass') {
    const response = {
      attemptDate: now.toISOString(),
      type: 'Pass',
      transactionId: axiosResponse.data.id
    };
    return response;
  }
  if (axiosResponse.data.decision === 'fail') {
    const response = {
      attemptDate: now.toISOString(),
      type: 'Fail',
      transactionId: axiosResponse.data.id,
      errors: [
        {
          message:
            axiosResponse.data?.message ||
            axiosResponse.data?.note ||
            'No detail available'
        }
      ]
    };
    return response;
  }
  if (axiosResponse.data.decision === 'review') {
    const response = {
      attemptDate: now.toISOString(),
      type: 'Needs Review',
      transactionId: axiosResponse.data.id,
      errors: [
        {
          message:
            axiosResponse.data?.message ||
            axiosResponse.data?.note ||
            'No detail available'
        }
      ]
    };
    return response;
  }

  throw new Error('Unknown error');
};

const processNoFraudErrorResponse = (axiosResponse) => {
  const now = new Date();
  if ([400, 403, 404, 500].includes(axiosResponse.status)) {
    let error = 'Unknown server error';
    if (axiosResponse.status === 403) {
      error = 'Authentication failed to NoFraud';
    }
    if (axiosResponse.status === 404) {
      error = 'Transaction Not Found';
    }
    if (axiosResponse.status === 400) {
      error = axiosResponse.data.Errors?.[0];
    }
    if (axiosResponse.status === 500) {
      error = axiosResponse.data.Errors?.[0];
    }
    if (!error) {
      error = 'Unknown error';
    }

    const response = {
      attemptDate: now.toISOString(),
      type: 'Fail',
      errors: [{ message: error }]
    };
    return response;
  }

  throw new Error('Unknown error');
};

const decimalFormat = (number, noScale) => {
  if (Number.isNaN(number)) {
    throw new Error('Invalid Number');
  }
  if (noScale) {
    const results = parseFloat(number);
    return results.toFixed(2);
  }
  const results = parseFloat(number / 100);
  return results.toFixed(2);
};

const dateFormat = (date) => {
  date = new Date(date);
  const year = date.getFullYear();

  let month = (1 + date.getMonth()).toString();
  month = month.length > 1 ? month : `0${month}`;

  let day = date.getDate().toString();
  day = day.length > 1 ? day : `0${day}`;

  return `${month}/${day}/${year}`;
};

const expiryNumberFormat = (creditCard) => {
  const year = creditCard.expiryYr.toString().slice(-2);
  const month = creditCard.expiryMo.toString();
  if (month.length === 1) {
    return `0${month}/${year}`;
  }
  return `${month}/${year}`;
};

const creditCardAttemptCount = (c7order) => {
  let count = 0;
  if (c7order.tenders) {
    c7order.tenders.forEach((tender) => {
      if (tender.tenderType === 'Credit Card') {
        count += 1;
      }
    });
  }
  return count;
};

const successfulCreditCardAttemptCount = (c7order) => {
  let count = 0;
  if (c7order.tenders) {
    c7order.tenders.forEach((tender) => {
      if (
        tender.tenderType === 'Credit Card' &&
        tender.chargeStatus === 'Success'
      ) {
        count += 1;
      }
    });
  }
  return count;
};

const noFraudPayload = async (securityObj, settings, c7order) => {
  const c7Settings = await getCommerce7Settings(securityObj.tenantId);

  const { shipTo } = c7order;
  let { billTo } = c7order;
  if (!billTo) {
    billTo = shipTo;
  }

  const payload = {
    nfToken: settings.noFraudAPIToken,
    amount: decimalFormat(c7order.total),
    gatewayName: getGateway(c7Settings),
    gatewayStatus: 'pass',
    cardAttempts: creditCardAttemptCount(c7order),
    customerIP: c7order.connectionInformation.customerIpAddress,
    avsResultCode: 'U', // TODO - what is this
    cvvResultCode: '1', // TODO - what is this
    currencyCode: c7Settings.currency,
    order: {
      invoiceNumber: c7order.orderNumber,
      orderType: 'one-time'
    },
    billTo: {
      firstName: billTo.firstName || '',
      lastName: billTo.lastName || '',
      company: billTo.company || '',
      address: billTo.address,
      city: billTo.city || '',
      state: billTo.stateCode || '',
      zip: billTo.zipCode,
      country: billTo.countryCode || '',
      phoneNumber: billTo.phone || ''
    },
    shipTo: {
      firstName: shipTo.firstName || '',
      lastName: shipTo.lastName || '',
      company: shipTo.company || '',
      address: shipTo.address,
      city: shipTo.city || '',
      state: shipTo.stateCode || '',
      zip: shipTo.zipCode || '',
      country: shipTo.countryCode || ''
    }
  };

  const firstCreditCard = c7order.tenders.find(
    (t) => t.tenderType === 'Credit Card' && t.chargeStatus === 'Success'
  );

  /*
      discountPrice: '5.00', // TODO - figure out
    discountPercentage: '5%', // TODO - figure out
*/

  payload.payment = {
    method: 'Credit Card',
    creditCard: {
      last4: firstCreditCard.creditCard.maskedCardNumber.slice(-4),
      cardType: firstCreditCard.creditCard.cardBrand,
      expirationDate: expiryNumberFormat(firstCreditCard.creditCard)
    }
  };

  if (c7order.customer) {
    payload.customer = {
      id: c7order.customer.id,
      email: c7order.customer.emails[0].email,
      joinedOn: dateFormat(c7order.customer.createdAt),
      lastPurchaseDate:
        c7order.customer.orderInformation.lastOrderDate &&
        dateFormat(c7order.customer.orderInformation.lastOrderDate),
      totalPreviousPurchases: c7order.customer.orderInformation.orderCount,
      totalPurchaseValue: decimalFormat(
        c7order.customer.orderInformation.lifetimeValue
      )
    };
  }

  if (c7order?.shipping?.length === 1) {
    payload.shippingAmount = decimalFormat(c7order.shipping[0].price);
    payload.shippingMethod = decimalFormat(c7order.shipping[0].title);
  }

  payload.lineItems = c7order.items.map((item) => ({
    sku: item.sku,
    name: item.productTitle,
    price: decimalFormat(item.price),
    quantity: item.quantity
  }));

  return payload;
};

const invalidChannel = () => {
  const now = new Date();
  const response = {
    attemptDate: now.toISOString(),
    type: 'Not Required',
    errors: [
      {
        message: `Order Channel is not Web`
      }
    ]
  };
  return response;
};

const invalidIPAddress = () => {
  const now = new Date();
  const response = {
    attemptDate: now.toISOString(),
    type: 'Not Required',
    errors: [
      {
        message: `Order does not have a Customer IP Address`
      }
    ]
  };
  return response;
};

const invalidCustomer = () => {
  const now = new Date();
  const response = {
    attemptDate: now.toISOString(),
    type: 'Not Required',
    errors: [
      {
        message: `Order does not have a Customer`
      }
    ]
  };
  return response;
};

const invalidTender = () => {
  const now = new Date();
  const response = {
    attemptDate: now.toISOString(),
    type: 'Not Required',
    errors: [
      {
        message: `Order does not have a credit card processed`
      }
    ]
  };
  return response;
};

const axiosHeader = (tenant) => {
  const options = {
    auth: {
      username: process.env.C7_APP_ID,
      password: process.env.C7_APP_SECRET
    },
    headers: {
      tenant
    }
  };
  return options;
};

const axiosHeaderNoAuth = (tenant) => {
  const options = {
    headers: {
      tenant
    }
  };
  return options;
};

export const deleteAll = async (securityObj) => {
  await Gateway.deleteAll(securityObj);
};

const updateFromSync = async (securityObj, id, attempt) => {
  let orderSync = await DAO.get(securityObj, id);

  const attemptParams = attempt;
  attemptParams.id = uuidv4();
  attemptParams.orderSyncId = id;

  if (attemptParams.errors) {
    attemptParams.errors = attemptParams.errors.map((error) => {
      const newError = error;
      newError.id = uuidv4();
      return newError;
    });
  }

  await DAO.createAttempt(securityObj, attemptParams);

  const params = {
    id,
    lastSyncAttemptDate: attempt.attemptDate,
    type: attempt.type,
    transactionId: attempt.id
  };

  orderSync = await update(securityObj, params);

  return orderSync;
};

const createFromSync = (securityObj, id, attempt) => {
  const params = {
    id,
    lastSyncAttemptDate: attempt.attemptDate,
    type: attempt.type,
    attempts: [attempt]
  };
  const orderSync = create(securityObj, params);
  return orderSync;
};

export const create = async (securityObj, params) => {
  params.id = params.id || uuidv4();
  if (params.attempts) {
    params.attempts = params.attempts.map((item) => {
      const newItem = item;
      if (newItem.errors) {
        newItem.errors = newItem.errors.map((error) => {
          const newError = error;
          newError.id = uuidv4();
          return newError;
        });
      }
      newItem.id = uuidv4();
      return newItem;
    });
  }
  const orderSync = await DAO.create(securityObj, params);

  return orderSync;
};

const update = async (securityObj, params) => {
  // Does not update sub objects
  const orderSync = await DAO.update(securityObj, params.id, params);

  return orderSync;
};

export * as OrderSyncManager from './manager.js';

const getGateway = (settings) => {
  if (settings.commerce7Payments?.enabled) {
    return 'Commerce7Payments';
  }
  if (settings.paystack?.apiKey) {
    return 'Paystack';
  }
  if (settings.stripe?.accountId) {
    return 'Stripe';
  }
  return settings.payment.gateway;
};
