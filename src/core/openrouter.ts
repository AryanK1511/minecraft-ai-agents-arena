import { Store } from './store.js';
import type { AgentId } from './types.js';
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Message = { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string };
type Model = { id: string; supported_parameters: string[]; pricing: { prompt: string; completion: string } };
export class OpenRouter {
  models = new Map<string, Model>();
  pending = new Set<AgentId>();
  constructor(private store: Store, private apiKey: string, private fetcher: typeof fetch = fetch) {}
  async validate() {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is missing from .env');
    const response = await this.fetcher('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Cannot validate model catalog: HTTP ${response.status}`);
    const catalog = await response.json() as { data: Model[] };
    for (const model of Object.values(this.store.state.agents).map(a => a.model)) {
      const entry = catalog.data.find(m => m.id === model);
      if (!entry || !entry.supported_parameters.includes('tools')) throw new Error(`${model} is unavailable or lacks tool support`);
      const prompt = Number(entry.pricing.prompt), completion = Number(entry.pricing.completion);
      if (![prompt, completion].every(p => Number.isFinite(p) && p >= 0) || prompt > 1 / 1e6 || completion > 2 / 1e6) throw new Error(`${model} pricing exceeds configured ceilings ($1 input / $2 output per million tokens)`);
      this.models.set(model, entry);
    }
  }
  async decide(agent: AgentId, messages: Message[], tools: ToolSpec[]) {
    if (this.pending.has(agent)) throw new Error('Agent already has a pending model request');
    const model = this.store.state.agents[agent].model;
    if (!this.models.has(model)) throw new Error('Model configuration has not been validated');
    // UTF-8 bytes bound ordinary text token counts. Include schema and framing headroom.
    const inputUpperBound = Buffer.byteLength(JSON.stringify({ messages, tools }), 'utf8') + 4096;
    const maxTokens = 1200;
    const reservation = this.store.reserve(Math.ceil((inputUpperBound * 1e-6 + maxTokens * 2e-6) * 1e9));
    this.pending.add(agent);
    try {
      const response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ model, messages, tools, tool_choice: 'required', max_tokens: maxTokens, stream: false, provider: { require_parameters: true, max_price: { prompt: 1, completion: 2, request: 0 } }, usage: { include: true } })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: number } };
        const message = String(body.error?.message ?? 'Unknown routing error').replaceAll(this.apiKey, '[redacted]').slice(0,1000);
        this.store.save('provider-error', { reservation, agent, status: response.status, message });
        if (response.status === 404 && message.startsWith('No endpoints found')) this.store.settle(reservation, 0, agent);
        throw new Error(`OpenRouter HTTP ${response.status}: ${message}`);
      }
      const result = await response.json() as { id?: string; usage?: { cost?: number }; choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
      this.store.save('provider-response', { reservation, generationId: result.id, usage: result.usage, agent });
      let cost = result.usage?.cost;
      if (typeof cost !== 'number' && result.id) {
        // Read-only billing reconciliation: never repeat the completion request.
        for (let attempt = 0; attempt < 3 && typeof cost !== 'number'; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          const usageResponse = await this.fetcher(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(result.id)}`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(10000) });
          if (usageResponse.ok) cost = ((await usageResponse.json()) as { data?: { total_cost?: number } }).data?.total_cost;
        }
      }
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw new Error('Provider billing is unresolved; reservation retained');
      this.store.settle(reservation, Math.ceil(cost * 1e9), agent);
      const message = result.choices?.[0]?.message;
      if (!message?.tool_calls?.length) throw new Error('Expected at least one tool call');
      if (message.tool_calls.length > 1) this.store.save('extra-tool-calls-skipped', { agent, count: message.tool_calls.length - 1 });
      return message.tool_calls[0];
    } catch (error) {
      if (this.store.state.reservations[reservation] !== undefined) this.store.pause(error instanceof Error ? error.message : String(error));
      throw error;
    } finally { this.pending.delete(agent); }
  }
}
