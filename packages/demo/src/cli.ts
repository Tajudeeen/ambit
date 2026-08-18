import { runDemoRehearsal } from './index.js';

const apiUrl = process.env.DEMO_API_URL;
const webUrl = process.env.DEMO_WEB_URL;

if (!apiUrl || !webUrl) {
  console.error('demo rehearsal requires DEMO_API_URL and DEMO_WEB_URL');
  process.exitCode = 1;
} else {
  try {
    const report = await runDemoRehearsal({ apiUrl, webUrl });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } catch {
    console.error('demo rehearsal configuration is invalid');
    process.exitCode = 1;
  }
}
