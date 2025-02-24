const assert = require('node:assert');
const { once } = require('node:events');
const { createSecureServer } = require('node:http2');
const mm = require('egg-mock');
const urllib = require('urllib');
const pem = require('https-pem');
const Httpclient = require('../../../lib/core/httpclient');
const HttpclientNext = require('../../../lib/core/httpclient_next');
const utils = require('../../utils');

describe('test/lib/core/httpclient.test.js', () => {
  let client;
  let clientNext;
  let url;

  before(() => {
    client = new Httpclient({
      deprecate: () => {},
      config: {
        httpclient: {
          request: {},
          httpAgent: {},
          httpsAgent: {},
        },
      },
    });
    client.on('request', info => {
      info.args.headers = info.args.headers || {};
      info.args.headers['mock-traceid'] = 'mock-traceid';
      info.args.headers['mock-rpcid'] = 'mock-rpcid';
    });

    clientNext = new HttpclientNext({
      config: {
        httpclient: {
          request: {},
        },
      },
    });
    clientNext.on('request', info => {
      info.args.headers = info.args.headers || {};
      info.args.headers['mock-traceid'] = 'mock-traceid';
      info.args.headers['mock-rpcid'] = 'mock-rpcid';
    });
  });
  before(async () => {
    url = await utils.startLocalServer();
  });

  afterEach(mm.restore);

  it('should request ok with log', done => {
    const args = {
      dataType: 'text',
    };
    client.once('response', info => {
      assert(info.req.options.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.options.headers['mock-rpcid'] === 'mock-rpcid');
      done();
    });

    client.request(url, args);
  });

  it('should curl ok with log', done => {
    const args = {
      dataType: 'text',
    };
    client.once('response', info => {
      assert(info.req.options.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.options.headers['mock-rpcid'] === 'mock-rpcid');
      done();
    });

    client.curl(url, args);
  });

  it('should mock ENETUNREACH error', async () => {
    mm(urllib.HttpClient2.prototype, 'request', () => {
      const err = new Error('connect ENETUNREACH 1.1.1.1:80 - Local (127.0.0.1)');
      err.code = 'ENETUNREACH';
      return Promise.reject(err);
    });
    await assert.rejects(async () => {
      await client.request(url);
    }, err => {
      assert(err.name === 'HttpClientError');
      assert(err.code === 'httpclient_ENETUNREACH');
      assert(err.message === 'connect ENETUNREACH 1.1.1.1:80 - Local (127.0.0.1) [ https://eggjs.org/zh-cn/faq/httpclient_ENETUNREACH ]');
      return true;
    });
  });

  it('should handle timeout error', async () => {
    await assert.rejects(async () => {
      await client.request(url + '/timeout', { timeout: 100 });
    }, err => {
      assert(err.name === 'ResponseTimeoutError');
      return true;
    });
  });

  it('should support safeCurl', async () => {
    let ip;
    let family;
    let host;
    mm(client.app.config, 'security', {
      ssrf: {
        checkAddress(aIp, aFamilay, aHost) {
          ip = aIp;
          family = aFamilay;
          host = aHost;
          return true;
        },
      },
    });
    await client.safeCurl(url);
    assert(ip);
    assert(family);
    assert(host);
  });

  describe('HttpClientNext', () => {
    it('should request ok with log', async () => {
      const args = {
        dataType: 'text',
      };
      let info;
      clientNext.once('response', meta => {
        info = meta;
      });
      const { status } = await clientNext.request(url, args);
      assert(status === 200);
      assert(info.req.options.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.options.headers['mock-rpcid'] === 'mock-rpcid');
      assert(info.req.args.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.args.headers['mock-rpcid'] === 'mock-rpcid');
    });

    it('should curl ok with log', async () => {
      const args = {
        dataType: 'text',
      };
      let info;
      clientNext.once('response', meta => {
        info = meta;
      });
      const { status } = await clientNext.curl(url, args);
      assert(status === 200);
      assert(info.req.options.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.options.headers['mock-rpcid'] === 'mock-rpcid');
      assert(info.req.args.headers['mock-traceid'] === 'mock-traceid');
      assert(info.req.args.headers['mock-rpcid'] === 'mock-rpcid');
    });

    it('should request with error', async () => {
      await assert.rejects(async () => {
        const response = await clientNext.request(url + '/error', {
          dataType: 'json',
        });
        console.log(response);
      }, err => {
        assert.equal(err.name, 'JSONResponseFormatError');
        assert.match(err.message, /this is an error/);
        assert(err.res);
        assert.equal(err.res.status, 500);
        return true;
      });
    });

    it('should support safeCurl', async () => {
      let ip;
      let family;
      let host;
      mm(clientNext.app.config, 'security', {
        ssrf: {
          checkAddress(aIp, aFamilay, aHost) {
            ip = aIp;
            family = aFamilay;
            host = aHost;
            return true;
          },
        },
      });
      await clientNext.safeCurl(url);
      assert(ip);
      assert(family);
      assert(host);
    });
  });

  describe('httpclient.httpAgent.timeout < 30000', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-agent-timeout-3000');
      return app.ready();
    });
    after(() => app.close());

    it('should auto reset httpAgent.timeout to 30000', () => {
      // should access httpclient first
      assert(app.httpclient);
      assert(app.config.httpclient.timeout === 3000);
      assert(app.config.httpclient.httpAgent.timeout === 30000);
      assert(app.config.httpclient.httpsAgent.timeout === 30000);
    });

    it('should set request default global timeout to 10s', () => {
      // should access httpclient first
      assert(app.httpclient);
      assert(app.config.httpclient.request.timeout === 10000);
    });

    it('should convert compatibility options to agent options', () => {
      // should access httpclient first
      assert(app.httpclient);
      assert(app.config.httpclient.httpAgent.freeSocketTimeout === 2000);
      assert(app.config.httpclient.httpsAgent.freeSocketTimeout === 2000);

      assert(app.config.httpclient.httpAgent.maxSockets === 100);
      assert(app.config.httpclient.httpsAgent.maxSockets === 100);

      assert(app.config.httpclient.httpAgent.maxFreeSockets === 100);
      assert(app.config.httpclient.httpsAgent.maxFreeSockets === 100);

      assert(app.config.httpclient.httpAgent.keepAlive === false);
      assert(app.config.httpclient.httpsAgent.keepAlive === false);
    });
  });

  describe('httpclient.request.timeout = 100', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-request-timeout-100');
      return app.ready();
    });
    after(() => app.close());

    it('should set request default global timeout to 100ms', () => {
      return app.httpclient.curl(`${url}/timeout`)
        .catch(err => {
          assert(err);
          assert(err.name === 'ResponseTimeoutError');
          assert(err.message.includes('Response timeout for 100ms'));
        });
    });
  });

  describe('overwrite httpclient', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-overwrite');
      return app.ready();
    });
    after(() => app.close());

    it('should set request default global timeout to 100ms', () => {
      return app.httpclient.curl(`${url}/timeout`)
        .catch(err => {
          assert(err);
          assert(err.name === 'ResponseTimeoutError');
          assert(err.message.includes('Response timeout for 100ms'));
        });
    });

    it('should assert url', () => {
      return app.httpclient.curl('unknown url')
        .catch(err => {
          assert(err);
          assert(err.message.includes('url should start with http, but got unknown url'));
        });
    });
  });

  describe('overwrite httpclient support useHttpClientNext=true', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-next-overwrite');
      return app.ready();
    });
    after(() => app.close());

    it('should work', async () => {
      const res = await app.httpclient.request(url);
      assert.equal(res.status, 200);
      assert.equal(res.data.toString(), 'GET /');
    });

    it('should set request default global timeout to 99ms', () => {
      return app.httpclient.curl(`${url}/timeout`)
        .catch(err => {
          assert(err);
          assert(err.name === 'HttpClientRequestTimeoutError');
          assert(err.message.includes('Request timeout for 99 ms'));
        });
    });

    it('should assert url', () => {
      return app.httpclient.curl('unknown url')
        .catch(err => {
          assert(err);
          assert(err.message.includes('url should start with http, but got unknown url'));
        });
    });
  });

  describe('overwrite httpclient support allowH2=true', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-allowH2');
      return app.ready();
    });
    after(() => app.close());

    it('should work on http2', async () => {
      const res = await app.httpclient.request(url, {
        timeout: 5000,
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.toString(), 'GET /');
      // assert.equal(sensitiveHeaders in res.headers, false);
      const res2 = await app.httpclient.request('https://registry.npmmirror.com/urllib/latest', {
        dataType: 'json',
        timeout: 5000,
      });
      assert.equal(res2.status, 200);
      assert.equal(res2.data.name, 'urllib');
      // assert.equal(sensitiveHeaders in res2.headers, true);
    });

    it('should work on http2.server with self-signed certificate', async () => {
      const server = createSecureServer(pem);
      server.on('stream', (stream, headers) => {
        assert.equal(headers[':method'], 'GET');
        stream.respond({
          'content-type': 'text/plain; charset=utf-8',
          'x-custom-h2': 'hello',
          ':status': 200,
        });
        stream.end('hello h2!');
        // console.log(headers);
        const mainNodejsVersion = parseInt(process.versions.node.split('.')[0]);
        if (mainNodejsVersion >= 18) {
          assert.match(headers['user-agent'], /node\-urllib\/4\.\d+\.\d+/);
        } else {
          assert.match(headers['user-agent'], /node\-urllib\/3\.\d+\.\d+/);
        }
      });
      server.listen(0);
      await once(server, 'listening');
      const response = await app.httpclient.request(`https://localhost:${server.address().port}`, {
        dataType: 'text',
        headers: {
          'x-my-header': 'foo',
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers['x-custom-h2'], 'hello');
      assert.equal(response.data, 'hello h2!');
      server.close();
    });

    it('should set request default global timeout to 99ms', async () => {
      await assert.rejects(async () => {
        await app.httpclient.curl(`${url}/timeout`);
      }, err => {
        assert.equal(err.name, 'HttpClientRequestTimeoutError');
        assert.match(err.message, /timeout for 99 ms/);
        return true;
      });
    });

    it('should request http1.1 success', async () => {
      const result = await app.httpclient.curl(`${url}`, {
        dataType: 'text',
      });
      assert.equal(result.status, 200);
      assert.equal(result.data, 'GET /');
    });

    it('should request http2 success', async () => {
      for (let i = 0; i < 10; i++) {
        const result = await app.httpclient.curl('https://registry.npmmirror.com', {
          dataType: 'json',
          timeout: 5000,
        });
        assert.equal(result.status, 200);
        assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
        assert.equal(result.data.sync_model, 'all');
      }
    });

    it('should assert url', async () => {
      await assert.rejects(async () => {
        await app.httpclient.curl('unknown url');
      }, err => {
        assert.match(err.message, /url should start with http, but got unknown url/);
        return true;
      });
    });
  });

  describe('httpclient tracer', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-tracer');
      return app.ready();
    });

    after(() => app.close());

    it('should app request auto set tracer', async () => {
      const httpclient = app.httpclient;
      // httpClient alias to httpclient
      assert(app.httpClient);
      assert.equal(app.httpClient, app.httpclient);

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      let res = await httpclient.request(url, {
        method: 'GET',
      });

      assert(res.status === 200);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);

      reqTracer = null;
      resTracer = null;

      res = await httpclient.request(url);

      assert(res.status === 200);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);
    });

    it('should agent request auto set tracer', async () => {
      const httpclient = app.agent.httpclient;

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      const res = await httpclient.request(url, {
        method: 'GET',
      });

      assert(res.status === 200);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);
    });

    it('should app request with ctx and tracer', async () => {
      const httpclient = app.httpclient;

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      let res = await httpclient.request(url, {
        method: 'GET',
      });

      assert(res.status === 200);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);

      reqTracer = null;
      resTracer = null;
      res = await httpclient.request(url, {
        method: 'GET',
        ctx: {},
        tracer: {
          id: '1234',
        },
      });

      assert(res.status === 200);
      assert(reqTracer.id === resTracer.id);
      assert(reqTracer.id === '1234');

      reqTracer = null;
      resTracer = null;
      res = await httpclient.request(url, {
        method: 'GET',
        ctx: {
          tracer: {
            id: '5678',
          },
        },
      });

      assert(res.status === 200);
      assert(reqTracer.id === resTracer.id);
      assert(reqTracer.id === '5678');
    });
  });

  describe('httpclient next with tracer', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-next-with-tracer');
      return app.ready();
    });

    after(() => app.close());

    it('should app request auto set tracer', async () => {
      const httpclient = app.httpclient;

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      const opaque = { now: Date.now() };
      let res = await httpclient.request(url, {
        method: 'GET',
        dataType: 'text',
        opaque,
      });
      assert(res.opaque === opaque);

      assert(res.status === 200);
      assert(reqTracer);
      assert(resTracer);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);

      reqTracer = null;
      resTracer = null;

      res = await httpclient.request(url);

      assert(res.status === 200);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);
    });

    it('should agent request auto set tracer', async () => {
      const httpclient = app.agent.httpclient;

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      const res = await httpclient.request(url, {
        method: 'GET',
      });

      assert(res.status === 200);
      assert(reqTracer === resTracer);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);
    });

    it('should app request with ctx and tracer', async () => {
      const httpclient = app.httpclient;

      let reqTracer;
      let resTracer;

      httpclient.on('request', function(options) {
        reqTracer = options.args.tracer;
      });

      httpclient.on('response', function(options) {
        resTracer = options.req.args.tracer;
      });

      let res = await httpclient.request(url, {
        method: 'GET',
      });

      assert(res.status === 200);

      assert(reqTracer.traceId);
      assert(reqTracer.traceId === resTracer.traceId);

      reqTracer = null;
      resTracer = null;
      res = await httpclient.request(url, {
        method: 'GET',
        ctx: {},
        tracer: {
          id: '1234',
        },
      });

      assert(res.status === 200);
      assert(reqTracer.id === resTracer.id);
      assert(reqTracer.id === '1234');

      reqTracer = null;
      resTracer = null;
      res = await httpclient.request(url, {
        method: 'GET',
        ctx: {
          tracer: {
            id: '5678',
          },
        },
      });

      assert(res.status === 200);
      assert(reqTracer.id === resTracer.id);
      assert(reqTracer.id === '5678');
    });
  });

  describe('before app ready multi httpclient request tracer', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-tracer');
      return app.ready();
    });

    after(() => app.close());

    it('should app request before ready use same tracer', async () => {

      const httpclient = app.httpclient;
      const reqTracers = [];
      const resTracers = [];

      httpclient.on('request', function(options) {
        reqTracers.push(options.args.tracer);
      });

      httpclient.on('response', function(options) {
        resTracers.push(options.req.args.tracer);
      });

      let res = await httpclient.request(url, {
        method: 'GET',
        timeout: 20000,
      });
      assert(res.status === 200);

      res = await httpclient.request('https://registry.npmmirror.com', {
        method: 'GET',
        timeout: 20000,
      });
      assert(res.status === 200);

      res = await httpclient.request('https://npmmirror.com', {
        method: 'GET',
        timeout: 20000,
      });
      assert(res.status === 200);

      assert(reqTracers.length === 3);
      assert(resTracers.length === 3);

      assert(reqTracers[0] !== reqTracers[1]);
      assert(reqTracers[1] !== reqTracers[2]);

      assert(resTracers[0] !== reqTracers[2]);
      assert(resTracers[1] !== resTracers[0]);
      assert(resTracers[2] !== resTracers[1]);

      assert(reqTracers[0].traceId);
    });
  });

  describe('compatibility freeSocketKeepAliveTimeout', () => {
    it('should convert freeSocketKeepAliveTimeout to freeSocketTimeout', () => {
      let mockApp = {
        config: {
          httpclient: {
            request: {},
            freeSocketKeepAliveTimeout: 1000,
            httpAgent: {},
            httpsAgent: {},
          },
        },
      };
      let client = new Httpclient(mockApp);
      assert(client);
      assert(mockApp.config.httpclient.freeSocketTimeout === 1000);
      assert(!mockApp.config.httpclient.freeSocketKeepAliveTimeout);
      assert(mockApp.config.httpclient.httpAgent.freeSocketTimeout === 1000);
      assert(mockApp.config.httpclient.httpsAgent.freeSocketTimeout === 1000);

      mockApp = {
        config: {
          httpclient: {
            request: {},
            httpAgent: {
              freeSocketKeepAliveTimeout: 1001,
            },
            httpsAgent: {
              freeSocketKeepAliveTimeout: 1002,
            },
          },
        },
      };
      client = new Httpclient(mockApp);
      assert(client);
      assert(mockApp.config.httpclient.httpAgent.freeSocketTimeout === 1001);
      assert(!mockApp.config.httpclient.httpAgent.freeSocketKeepAliveTimeout);
      assert(mockApp.config.httpclient.httpsAgent.freeSocketTimeout === 1002);
      assert(!mockApp.config.httpclient.httpsAgent.freeSocketKeepAliveTimeout);
    });
  });

  describe('httpclient retry', () => {
    let app;
    before(() => {
      app = utils.app('apps/httpclient-retry');
      return app.ready();
    });
    after(() => app.close());

    it('should retry when httpclient fail', async () => {
      let hasRetry = false;
      const res = await app.httpclient.curl(`${url}/retry`, {
        retry: 1,
        retryDelay: 100,
        isRetry(res) {
          const shouldRetry = res.status >= 500;
          if (shouldRetry) {
            hasRetry = true;
          }
          return shouldRetry;
        },
      });

      assert(hasRetry);
      assert(res.status === 200);
    });

    it('should retry when httpclient fail', async () => {
      let hasRetry = false;
      const res = await app.httpclient.curl(`${url}/retry`, {
        retry: 1,
        retryDelay: 100,
        isRetry(res) {
          const shouldRetry = res.status >= 500;
          if (shouldRetry) {
            hasRetry = true;
          }
          return shouldRetry;
        },
      });

      assert(hasRetry);
      assert(res.status === 200);
    });
  });
});
