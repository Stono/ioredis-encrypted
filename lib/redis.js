'use strict';
const Redis = require('ioredis');
const util = require('./util');
const Crypto = require('node-crypt');

module.exports = function EncryptedRedis(key, hmacKey) {
  return function(...args) {
    util.enforceNotEmpty(key, 'You must specify an encryption key');
    util.enforceNotEmpty(hmacKey, 'You must specify a HMAC encryption key');

    const crypto = new Crypto({
      key: key,
      hmacKey: hmacKey
    });

    const redis = new Redis(...args);
    const encryptCommand = (client, methodName, item) => {
      const method = client[methodName].bind(client);
      client[methodName] = function(...args) {
        args[item] = crypto.encrypt(args[item]);
        method(...args);
      };
    };

    const decryptResult = (client, methodName, type) => {
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

    const wrapPubSub = client => {
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
    };
    wrapPubSub(redis);

    const wrapClient = client => {
      encryptCommand(client, 'set', 1);
      decryptResult(client, 'get');

      encryptCommand(client, 'lpush', 1);
      decryptResult(client, 'lpop');
      decryptResult(client, 'lrange', 'array');

      encryptCommand(client, 'rpush', 1);
      decryptResult(client, 'rpop');

      encryptCommand(client, 'hset', 2);
      decryptResult(client, 'hget');

      encryptCommand(client, 'publish', 1);
      decryptResult(client, 'hgetall', 'object');
    };
    wrapClient(redis);

    const wrapPipeline = client => {
      const pipeline = client.pipeline.bind(client);
      client.pipeline = function() {
        let pipe = pipeline();
        let handlers = [];
        let results = [];

        const exec = pipe.exec.bind(pipe);
        pipe.exec = function(done) {
          exec(err => {
            if(done) { done(err, results); }
            let result = results.pop();
            while(!util.isEmpty(result) && handlers.length > 0) {
              let original = handlers.pop();
              original(...result);
              result = results.pop();
            }
          });
        };

        const pipeWrap = methodName => {
          const method = pipe[methodName].bind(pipe);
          pipe[methodName] = function(...args) {
            let callback = args[args.length -1];
            let done;
            if(typeof callback === 'function') {
              done = args.pop();
            } else {
              done = () => {};
            }
            handlers.push(done);
            method(...args, (err, data) => {
              results.push([err, data]);
            });
          };
        };

        wrapClient(pipe);
        ['get', 'set', 'lpush', 'lpop', 'lrange', 'rpush', 'rpop', 'hset', 'hget', 'hgetall']
        .forEach(pipeWrap);
        return pipe;
      };
    };
    wrapPipeline(redis);

    return redis;
  };
};
