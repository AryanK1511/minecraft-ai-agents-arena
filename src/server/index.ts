import express from 'express';
import { resolve } from 'node:path';
import { Engine } from './engine.js';
const app = express();
const engine = new Engine();
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const origin = req.get('origin');
    if (origin && !['http://localhost:3000','http://127.0.0.1:3000'].includes(origin)) { res.status(403).json({ error: 'Local dashboard controls only' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON body required' }); return; }
  }
  next();
});
app.get('/api/state', (_req, res) => res.json(engine.store.state));
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify(engine.store.state)}\n\n`);
  send(); engine.listeners.add(send);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
  req.on('close', () => { engine.listeners.delete(send); clearInterval(keepalive); });
});
app.post('/api/control/:action', async (req, res) => {
  try {
    switch (req.params.action) {
      case 'start': case 'resume': await engine.start(); break;
      case 'pause': await engine.pause(); break;
      case 'reset': if (req.body?.confirm !== true) throw new Error('Reset confirmation required'); await engine.reset(req.body.runId); break;
      case 'overview': await engine.world.command('overview'); break;
      default: res.status(404).json({ error: 'Unknown control' }); return;
    }
    res.json(engine.store.state);
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.use(express.static(resolve('dashboard/dist')));
app.listen(3000, '0.0.0.0', () => console.log('Arena dashboard listening on port 3000; run starts paused.'));
engine.initialize().catch(error => { engine.store.pause(`Initialization: ${error.message}`); engine.publish(); });
process.once('SIGTERM', async () => {
  try { await engine.pause('Application stopped'); }
  finally { for (const bot of engine.world.bots.values()) bot.quit(); process.exit(0); }
});
