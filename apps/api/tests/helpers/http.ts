import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import type { Express } from 'express';

type Result = {
  status: number;
  headers: Record<string, string | string[]>;
  body: Record<string, unknown>;
};
// Exercise Express middleware and JSON parsing without network sockets/listen().
export function request(
  app: Express,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    let wire = '';
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        wire += String(chunk);
        callback();
      },
    });
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    const req = new IncomingMessage(socket as never);
    req.method = method;
    req.url = path;
    req.httpVersion = '1.1';
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    const payload = body === undefined ? '' : JSON.stringify(body);
    req.headers = {
      host: 'localhost',
      ...headers,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(payload)),
          }),
    };
    const res = new ServerResponse(req);
    res.assignSocket(socket as never);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`HTTP harness timed out: ${method} ${path}`));
    }, 15_000);
    res.on('finish', () => {
      clearTimeout(timeout);
      const raw = wire.slice(wire.indexOf('\r\n\r\n') + 4);
      const resultHeaders: Result['headers'] = {};
      for (const [key, value] of Object.entries(res.getHeaders()))
        if (value !== undefined)
          resultHeaders[key] =
            key === 'set-cookie' && typeof value === 'string'
              ? [value]
              : typeof value === 'number'
                ? String(value)
                : value;
      try {
        resolve({
          status: res.statusCode,
          headers: resultHeaders,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
      } catch (error) {
        reject(error);
      }
      socket.destroy();
    });
    req.complete = true;
    app(req, res);
    if (payload) req.push(payload);
    req.push(null);
  });
}

export function cookieJar() {
  const values = new Map<string, string>();
  return {
    header: () =>
      [...values].map(([key, value]) => `${key}=${value}`).join('; '),
    update(headers: Result['headers']) {
      const set = headers['set-cookie'];
      for (const line of typeof set === 'string' ? [set] : (set ?? [])) {
        const pair = line.split(';')[0]!;
        const separator = pair.indexOf('=');
        values.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    },
  };
}
