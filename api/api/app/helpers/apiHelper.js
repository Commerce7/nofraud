// import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import Sequelize from 'sequelize';

// import { ddbDocClient3 } from '../../../dynamodb3';
import { sequelize } from '../../models.js';

import CustomError from './error.js';

// export const sleep = async (ms) => {
//   await new Promise((resolve) => setTimeout(resolve, ms));
// };

const parameterSetup = (params, req) => {
  const inputParams = params;
  const op = Sequelize.Op;
  let newParams = {
    where: { [op.and]: [] }
  };
  validateParameters(params, req);
  // Handling limit and offset - params override input
  newParams = handlePaging(newParams, inputParams, req);
  delete inputParams.page;
  delete inputParams.limit;
  delete inputParams.cursor;
  // Handle order by - input override params
  // newParams = handleSorting(newParams, inputParams, req);
  // delete inputParams.order;
  const keys = Object.keys(inputParams);
  for (let i = 0; i < keys.length; i += 1) {
    const inputParam = inputParams[keys[i]];
    const key = keys[i];
    const column = inputParam.column || key;
    if (inputParam.required && !inputParam.value) {
      throw422Error(`Query field:${key} is required`);
    }
    if (typeof inputParam.value !== 'undefined') {
      if (key === 'searchText') {
        newParams.where[op.and].push(
          handleSearchText(req.securityObj, key, inputParam)
        );
      } else if (!inputParam.remove) {
        if (!inputParam.operators) {
          if (inputParam.type && inputParam.type === 'boolean') {
            newParams.where[op.and].push({
              [column]: inputParam.value === 'true'
            });
          } else if (inputParam.type && inputParam.type === 'null') {
            if (inputParam.value === 'null') {
              newParams.where[op.and].push({
                [column]: null
              });
            }
            if (inputParam.value === 'not null') {
              newParams.where[op.and].push({
                [column]: { [op.ne]: null }
              });
            }
          } else {
            newParams.where[op.and].push({ [column]: inputParam.value });
          }
        }
        if (inputParam.operators) {
          const opTest = inputParam.value.split(':');
          if (opTest.length === 1) {
            if (inputParam.enumConvert) {
              inputParam.value = inputParam.enumConvert[inputParam.value];
            }
            newParams.where[op.and].push({ [column]: inputParam.value });
          }
          if (opTest.length > 1) {
            const [operator] = opTest;
            const value = inputParam.value.replace(`${operator}:`, '');
            if (!inputParam.operators.find((ope) => ope === operator)) {
              throw422Error(`Invalid operator ${operator}`);
            }
            switch (operator) {
              case 'in': {
                let valueArray = value.split(',');
                if (inputParam.enumConvert) {
                  valueArray = valueArray.map((v) => inputParam.enumConvert[v]);
                }
                newParams.where[op.and].push({
                  [column]: { [op.in]: valueArray }
                });
                break;
              }
              case 'nin': {
                let valueArray = value.split(',');
                if (inputParam.enumConvert) {
                  valueArray = valueArray.map((v) => inputParam.enumConvert[v]);
                }
                newParams.where[op.and].push({
                  [column]: { [op.notIn]: valueArray }
                });
                break;
              }
              case 'like': {
                newParams.where[op.and].push(handleLike(column, value));
                break;
              }
              case 'btw': {
                const [firstValue, secondValue] = value.split('|');
                newParams.where[op.and].push({
                  [column]: { [op.gte]: firstValue }
                });
                newParams.where[op.and].push({
                  [column]: { [op.lte]: secondValue }
                });
                break;
              }
              case 'gte': {
                newParams.where[op.and].push({ [column]: { [op.gte]: value } });
                break;
              }
              case 'gt': {
                newParams.where[op.and].push({ [column]: { [op.gt]: value } });
                break;
              }
              case 'lte': {
                newParams.where[op.and].push({ [column]: { [op.lte]: value } });
                break;
              }
              case 'lt': {
                newParams.where[op.and].push({ [column]: { [op.lt]: value } });
                break;
              }
              case 'ne': {
                newParams.where[op.and].push({ [column]: { [op.ne]: value } });
                break;
              }
              default: {
                throw422Error(
                  `Operator valid but not programmed yet ${operator}`
                );
                break;
              }
            }
          }
        }
      }
    }
  }
  return newParams;
};

const handleSearchText = (securityObj, key, inputParam) => {
  const op = Sequelize.Op;
  switch (inputParam.strategy) {
    case 'searchTable': {
      const tenantId = inputParam.tenantId || securityObj.tenantId;
      const escapedTenantId = sequelize.escape(tenantId);
      const searchTextArray = inputParam.value.trim().split(' ');
      const escapedSearchText = sequelize.escape(`${searchTextArray[0]}%`);
      searchTextArray.splice(0, 1);
      // Only use search text greater than 2 characters
      const newSearchTextArray = searchTextArray.filter(
        (text) => text.length >= 2
      );
      // Only search for 3 terms plus the initial term
      newSearchTextArray.splice(3);
      let additionalWhere = ``;
      newSearchTextArray.forEach((term) => {
        if (term.length >= 2) {
          const escapedText = sequelize.escape(`${term}%`);
          additionalWhere = `${additionalWhere}
              AND ${inputParam.foreignKeyId} IN (
                SELECT ${inputParam.foreignKeyId}
                FROM ${inputParam.model}
                WHERE searchText like ${escapedText})
            `;
        }
      });
      const localKeyId = inputParam.localKeyId || 'id';
      const where = {
        [localKeyId]: {
          [op.in]: sequelize.literal(`(
          SELECT ${inputParam.foreignKeyId}
          FROM ${inputParam.model}
          WHERE tenantId = ${escapedTenantId}
            AND searchText LIKE ${escapedSearchText}
            ${additionalWhere}
          )`)
        }
      };
      return where;
    }
    case 'searchText': {
      return handleLike(key, inputParam.value, inputParam.table);
    }
    case 'searchTextFull': {
      return handleLike(key, inputParam.value, inputParam.table, true);
    }
    default: {
      return handleLike(key, inputParam.value, inputParam.table, false);
    }
  }
};

const validateParameters = (params, req) => {
  const globalKeys = ['q', 'page', 'limit', 'populate', 'cursor'];

  if (req.query) {
    Object.keys(req.query).forEach((key) => {
      if (!params[key] && !globalKeys.includes(key)) {
        throw422Error(`Invalid query param: ${key}`);
      }
      if (typeof req.query[key] !== 'string') {
        throw422Error(`Invalid query param: ${key}`);
      }
    });
  }
  if (req.query.page && req.query.cursor) {
    throw422Error(
      `Can not use both page and cursor for paging.  Must use one or the other.`
    );
  }
};

const handleLike = (column, value, table, isFullLike) => {
  // isFullLike means that its both left and right side.  Otherwise it's just right side.
  let leftSide = '';
  if (isFullLike) {
    leftSide = '%';
  }
  const op = Sequelize.Op;
  if (table) {
    const lowerCase = sequelize.where(
      sequelize.fn('lower', sequelize.col(`${table}.${column}`)),
      {
        [op.like]: `${leftSide}${value.toLowerCase()}%`
      }
    );
    return lowerCase;
  }
  const lowerCase = sequelize.where(
    sequelize.fn('lower', sequelize.col(column)),
    {
      [op.like]: `${leftSide}${value.toLowerCase()}%`
    }
  );

  return lowerCase;
};

const throw422Error = (message) => {
  throw new CustomError(422, message, 'validationError');
};

const handlePaging = (structure, params, req) => {
  const op = Sequelize.Op;
  const newStructure = structure;
  if (params.limit) {
    newStructure.limit = params.limit;
  } else if (req.query.limit && Math.round(parseFloat(req.query.limit))) {
    newStructure.limit = Math.round(parseFloat(req.query.limit));
  } else {
    newStructure.limit = 50;
  }
  if (newStructure.limit < 1 || newStructure.limit > 50) {
    newStructure.limit = 50;
  }
  if (params.page) {
    newStructure.page = params.page;
  } else if (req.query.page && Math.round(parseFloat(req.query.page))) {
    newStructure.page = Math.round(parseFloat(req.query.page));
  }
  if (newStructure.page) {
    newStructure.offset =
      newStructure.page * newStructure.limit - newStructure.limit;
    delete newStructure.page;
  }
  if (req.query.cursor) {
    if (req.query.cursor !== 'start') {
      newStructure.where.id = { [op.gte]: req.query.cursor };
    }
    newStructure.limit += 1;
    newStructure.cursor = true;
  }
  return newStructure;
};

const handleCursorResponse = async (Model, newParams) => {
  newParams.order = [['id', 'ASC']];
  const cursorData = await Model.findAll(newParams);
  let cursor;
  if (cursorData.length > newParams.limit - 1) {
    cursor = cursorData[newParams.limit - 1].id;
    // remove 51st record
    cursorData.pop();
  }
  const response = {
    data: cursorData,
    cursor
  };
  response.data = response.data.map((o) => o.toJSON());
  return response;
};

const handlePageResponse = async (Model, newParams) => {
  const countParams = { ...newParams };
  delete countParams.include;
  delete countParams.distinct;
  delete countParams.order;
  delete countParams.limit;
  delete countParams.offset;

  const [data, count] = await Promise.all([
    Model.findAll(newParams),
    Model.count(countParams)
  ]);
  const response = {
    data,
    total: count
  };
  response.data = response.data.map((o) => o.toJSON());
  return response;
};

export const handleListResponse = (Model, newParams) => {
  if (newParams.cursor) {
    return handleCursorResponse(Model, newParams);
  }
  return handlePageResponse(Model, newParams);
};

export const handleToJSON = (seqeulizeQuery, includeTenantId = false) => {
  const jsonQuery = seqeulizeQuery.map((o) => {
    const object = o.toJSON();
    if (includeTenantId) {
      object.tenantId = o.tenantId;
    }
    return object;
  });
  return jsonQuery;
};

const apiHelper = {
  parameterSetup
};

// export const getClientIpAddress = (req) => {
//   let ipArray = [];
//   if (req?.headers['x-forwarded-for']) {
//     ipArray = req.headers['x-forwarded-for'].split(',');
//   }
//   if (ipArray.length > 1) {
//     return ipArray[ipArray.length - 2].trim(); // Cloufront IP is right most IP, 2nd from right is Client IP.
//   }
//   return ipArray[0] || '::ffff:127.0.0.1';
// };

// export const isTransactionIdempotent = async (
//   securityObj,
//   object,
//   objectId
// ) => {
//   // Attempt a conditional put to Dynamo, return error if fails
//   const tableName = 'IdempotentTransactions';
//   const { tenantId } = securityObj;
//   const objectKeyAndId = `${object}-${objectId}`;
//   const createdAt = new Date().toISOString();
//   const putParams = {
//     TableName: tableName,
//     Item: {
//       tenantId,
//       objectKeyAndId,
//       createdAt
//     },
//     ConditionExpression: 'attribute_not_exists(objectKeyAndId)'
//   };
//   try {
//     await ddbDocClient3(process.env.AWS_REGION).send(new PutCommand(putParams));
//   } catch (err) {
//     if (err.code === 'ConditionalCheckFailedException') {
//       return false;
//     }
//     if (process.env.NODE_ENV === 'production') {
//       rollbar.error('Unexpected error in isTransactionIdempotent()', err, {
//         tenantId,
//         objectKeyAndId
//       });
//     }
//   }

//   return true;
// };

// export const deleteIdempotentTransaction = async (
//   securityObj,
//   object,
//   objectId
// ) => {
//   // Attempt a conditional put to Dynamo, return error if fails
//   const tableName = 'IdempotentTransactions';
//   const { tenantId } = securityObj;
//   const objectKeyAndId = `${object}-${objectId}`;
//   const deleteParams = {
//     TableName: tableName,
//     Key: {
//       tenantId,
//       objectKeyAndId
//     }
//   };
//   await ddbDocClient3(process.env.AWS_REGION).send(
//     new DeleteCommand(deleteParams)
//   );
// };

// export const addTagQueryParams = (securityObj, tagId, key = 'id') => {
//   const op = Sequelize.Op;
//   const escapedTenantId = sequelize.escape(securityObj.tenantId);
//   if (tagId.substring(0, 3) === 'in:') {
//     const tagList = tagId.substring(3, tagId.length);
//     const escapedTagId = sequelize.escape(tagList.split(','));
//     return {
//       [key]: {
//         [op.in]: sequelize.literal(`(
//         SELECT objectId
//         FROM TagsXObjects
//         WHERE tenantId = ${escapedTenantId}
//           AND tagId IN (${escapedTagId})
//         )`)
//       }
//     };
//   }
//   const escapedTagId = sequelize.escape(tagId);
//   return {
//     [key]: {
//       [op.in]: sequelize.literal(`(
//         SELECT objectId
//         FROM TagsXObjects
//         WHERE tenantId = ${escapedTenantId}
//           AND tagId = ${escapedTagId}
//         )`)
//     }
//   };
// };

// export const logInProduction = (msg, ...args) => {
//   if (process.env.NODE_ENV === 'production') {
//     // eslint-disable-next-line no-console
//     console.log(msg, ...args);
//   }
// };

export default apiHelper;
