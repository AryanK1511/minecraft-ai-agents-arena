// Run only while the app service is stopped. This narrowly reconciles a key that
// OpenRouter confirms has never incurred a charge; it cannot clear nonzero usage.
import { Store } from '../dist/src/core/store.js';
const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(10000) });
const body = await response.json();
if (!response.ok || body.data?.usage !== 0) throw new Error('Cannot prove zero lifetime key usage; reservations retained');
const store = new Store();
if (store.state.spent !== 0) throw new Error('Local ledger has nonzero spending; manual reconciliation required');
for (const id of Object.keys(store.state.reservations)) store.settle(id, 0, 'agent1');
store.pause('OpenRouter confirmed zero lifetime key usage; rejected requests reconciled at $0. Ready to resume.');
store.save('zero-usage-reconciliation', { observedAt: new Date().toISOString(), keyLifetimeUsage: 0 });
store.db.close();
console.log('Confirmed zero key usage; rejected request reservations reconciled.');
