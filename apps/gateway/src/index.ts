import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { RunManager } from './run-manager.js';
import { createApp } from './server.js';

const port = Number(process.env.PORT ?? 4400);
const manager = new RunManager();
const app = createApp(manager);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`OAS gateway listening on http://localhost:${info.port}`);
  console.log(`Live viewer:           http://localhost:${info.port}/`);
}) as Server;

// WebSocket: replay buffered run events, then stream live ones.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const match = /^\/api\/runs\/([\w-]+)\/events$/.exec(req.url ?? '');
  if (!match) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const record = manager.get(match[1]!);
    if (!record) {
      ws.close(4004, 'run not found');
      return;
    }
    for (const event of record.events) ws.send(JSON.stringify(event));
    const unsubscribe = manager.subscribe(record.id, (event) => ws.send(JSON.stringify(event)));
    ws.on('close', unsubscribe);
  });
});
