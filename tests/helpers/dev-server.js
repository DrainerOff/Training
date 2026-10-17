// npm run serve — the app on http://127.0.0.1:5173 and a fake Google backend on :5174.
import { startStatic, startFakeGas } from './servers.js';

const app = await startStatic({ port: Number(process.env.PORT || 5173) });
const gas = await startFakeGas({ port: Number(process.env.GAS_PORT || 5174) });
console.log(`App:            http://127.0.0.1:${app.address().port}/`);
console.log(`Fake Apps Script: ${gas.url}`);
console.log(`Access key:     ${gas.token}`);
console.log('The fake backend keeps data in memory only (for local testing).');
