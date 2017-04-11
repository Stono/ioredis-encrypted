'use strict';
const Redis = require('ioredis');
const util = require('./util');
const Crypto = require('node-crypt');

module.exports = function EncryptedRedis(key, algorithm) {
  return function(...args) {
    util.enforceNotEmpty(key, 'You must specify an encryption key');

    const crypto = new Crypto({
      key: key,
      algorithm: algorithm
    });

    const client = new Redis(...args);
    const encryptCommand = (methodName, item) => {
      const method = client[methodName].bind(client);
      client[methodName] = function(...args) {
        args[item] = crypto.encrypt(args[item]);
        method(...args);
      };
    };

    const decrypt = result => {
      return crypto.decrypt(result);
    };
    const decryptKvp = result => {
      Object.keys(result).map(key => {
        result[key] = decrypt(result[key]);
      });
      return result;
    };
    const decryptArray = result => {
      return result.map(decrypt);
    };

    const decryptResult = (methodName, type) => {
      const method = client[methodName].bind(client);
      client[methodName] = function(...args) {
        let done = args.pop();
        method(...args, (err, result) => {
          /* jshint maxcomplexity: 6 */
          if(err) { return done(err); }
          if(util.isEmpty(result)) { return done(null, result); }
          switch(type) {
            case 'object':
              result = decryptKvp(result);
            break;
            case 'array':
              result = decryptArray(result);
            break;
            default:
              result = decrypt(result);
          }
          done(null, result);
        });
      };
    };

    const method = client.on.bind(client);
    client.on = function(...args) {
      const event = args[0];
      const handler = args[1];
      if(event === 'message') {
        return method(event, (channel, msg) => {
          msg = crypto.decrypt(msg);
          handler(channel, msg);
        });
      }
      if(event === 'pmessage') {
        return method(event, (filter, channel, msg) => {
          msg = crypto.decrypt(msg);
          handler(filter, channel, msg);
        });
      }
      method(...args);
    };


    encryptCommand('set', 1);
    decryptResult('get');

    encryptCommand('lpush', 1);
    decryptResult('lpop');
    decryptResult('lrange', 'array');

    encryptCommand('rpush', 1);
    decryptResult('rpop');

    encryptCommand('hset', 2);
    decryptResult('hget');

    encryptCommand('publish', 1);
    decryptResult('hgetall', 'object');

    return client;
  };
};
