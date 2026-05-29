/**
 * Minimal ambient declaration for the `ws` package.
 * This file can be removed once `@types/ws` is installed via:
 *   npm i --save-dev @types/ws
 *
 * Place this file at: server/ws.d.ts
 */
declare module "ws" {
  import { EventEmitter } from "events";
  import { IncomingMessage } from "http";
  import { Server as HttpServer } from "http";
  import { Duplex } from "stream";

  class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    readonly readyState: 0 | 1 | 2 | 3;
    readonly url: string;
    readonly protocol: string;
    readonly extensions: Record<string, unknown>;

    binaryType: "nodebuffer" | "arraybuffer" | "fragments";

    constructor(address: string, options?: WebSocket.ClientOptions);

    send(data: unknown, cb?: (err?: Error) => void): void;
    send(data: unknown, options: { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean }, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string | Buffer): void;
    terminate(): void;
    ping(data?: unknown, mask?: boolean, cb?: (err: Error) => void): void;
    pong(data?: unknown, mask?: boolean, cb?: (err: Error) => void): void;

    on(event: "open", listener: () => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "ping" | "pong", listener: (data: Buffer) => void): this;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  }

  namespace WebSocket {
    interface ClientOptions {
      protocol?: string;
      handshakeTimeout?: number;
      perMessageDeflate?: boolean | PerMessageDeflateOptions;
      localAddress?: string;
      protocolVersion?: number;
      headers?: Record<string, string>;
      origin?: string;
      agent?: unknown;
      host?: string;
      family?: number;
      checkServerIdentity?: (servername: string, cert: unknown) => boolean | undefined;
      rejectUnauthorized?: boolean;
      maxPayload?: number;
      skipUTF8Validation?: boolean;
      auth?: string;
    }

    interface PerMessageDeflateOptions {
      serverNoContextTakeover?: boolean;
      clientNoContextTakeover?: boolean;
      serverMaxWindowBits?: number;
      clientMaxWindowBits?: number;
      zlibDeflateOptions?: Record<string, unknown>;
      zlibInflateOptions?: Record<string, unknown>;
      threshold?: number;
      concurrencyLimit?: number;
    }

    interface ServerOptions {
      host?: string;
      port?: number;
      backlog?: number;
      server?: HttpServer;
      verifyClient?: VerifyClientCallbackAsync | VerifyClientCallbackSync;
      handleProtocols?: (protocols: Set<string>, request: IncomingMessage) => string | false;
      path?: string;
      noServer?: boolean;
      clientTracking?: boolean;
      perMessageDeflate?: boolean | PerMessageDeflateOptions;
      maxPayload?: number;
      skipUTF8Validation?: boolean;
      allowSynchronousEvents?: boolean;
    }

    type VerifyClientCallbackAsync = (info: { origin: string; secure: boolean; req: IncomingMessage }, callback: (res: boolean, code?: number, message?: string) => void) => void;
    type VerifyClientCallbackSync = (info: { origin: string; secure: boolean; req: IncomingMessage }) => boolean;
  }

  class WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>;
    readonly options: WebSocket.ServerOptions;

    constructor(options?: WebSocket.ServerOptions, callback?: () => void);

    close(cb?: (err?: Error) => void): void;
    handleUpgrade(request: IncomingMessage, socket: Duplex, upgradeHead: Buffer, callback: (client: WebSocket, request: IncomingMessage) => void): void;
    shouldHandle(request: IncomingMessage): boolean | Promise<boolean>;

    on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "headers", listener: (headers: string[], request: IncomingMessage) => void): this;
    on(event: "close" | "listening", listener: () => void): this;
    on(event: string | symbol, listener: (...args: unknown[]) => void): this;
  }

  export { WebSocket, WebSocketServer };
  export default WebSocket;
}