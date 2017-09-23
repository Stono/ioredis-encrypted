'use strict';
const key = 'bfa6220e845a8248f65ebbddf753d6bcdbaab404693890f920c663adce2d7ede';
const hmacKey = 'fdc6de8b925c8e4a120edac298139648e22c31f45d5ab5469ab0d696229338ad';

const EncryptedRedis = require('../')(key, hmacKey);
const should = require('should');

describe('Pipeline', () => {
  let redis;
  before(done => {
    redis = new EncryptedRedis();
    redis.once('ready', done);
  });
  beforeEach(done => {
    redis.flushall(done);
  });
  afterEach(done => {
    redis.flushall(done);
  });

  it('should work with multiple pipelines', done => {
    let pipelined = false;
    let go = pipeline => {
      const shouldBePipelined = () => {
        should(pipelined).eql(true, 'Request was not pipelined');
      };
      pipeline.rpush('list1', 'item1', err => {
        should.ifError(err);
        shouldBePipelined();
      });
      pipeline.lpop('list1', (err, item) => {
        should.ifError(err);
        should(item).eql('item1');
        shouldBePipelined();
      });
    };
    let pipeline = redis.pipeline();
    go(pipeline);
    pipeline.exec(err => {
      should.ifError(err);
      pipelined = true;
      redis.flushall(() => {
        pipelined = false;
        let pipeline = redis.pipeline();
        go(pipeline);
        pipeline.exec(err => {
          should.ifError(err);
          pipelined = true;
          done();
        });
      });
    });
  });

  it('should pipeline requests', done => {
    const pipeline = redis.pipeline();
    let pipelined = false;
    const shouldBePipelined = () => {
      should(pipelined).eql(true, 'Request was not pipelined');
    };
    pipeline.rpush('list2', 'item1', err => {
      should.ifError(err);
      shouldBePipelined();
    });
    pipeline.rpush('list2', 'item2', err => {
      should.ifError(err);
      shouldBePipelined();
    });
    pipeline.lpop('list2', (err, item) => {
      should.ifError(err);
      should(item).eql('item1');
      shouldBePipelined();
      done();
    });
    pipeline.exec((err, results) => {
      should(results[2]).eql([null, 'item1']);
      should.ifError(err);
      pipelined = true;
    });
  });

  it('should work with callback-less pipeline steps', done => {
    const pipeline = redis.pipeline();
    pipeline.rpush('list2', 'item1');
    pipeline.rpush('list2', 'item2');
    pipeline.lpop('list2');
    pipeline.exec((err, results) => {
      should(results[2]).eql([null, 'item1']);
      should.ifError(err);
      done();
    });
  });

});
