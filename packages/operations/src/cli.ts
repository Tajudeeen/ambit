import { runProductionVerification } from './index.js';

const apiUrl = process.env.PRODUCTION_API_URL;
const webUrl = process.env.PRODUCTION_WEB_URL;
const expectedReleaseId = process.env.EXPECTED_AMBIT_RELEASE_ID;
const timeoutValue = process.env.PRODUCTION_VERIFY_TIMEOUT_MS;

if (!apiUrl || !webUrl || !expectedReleaseId) {
  console.error(
    'production verification requires PRODUCTION_API_URL, PRODUCTION_WEB_URL, and EXPECTED_AMBIT_RELEASE_ID',
  );
  process.exitCode = 1;
} else {
  try {
    const timeoutMs = timeoutValue === undefined ? undefined : Number(timeoutValue);
    const report = await runProductionVerification({
      apiUrl,
      webUrl,
      expectedReleaseId,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  } catch {
    console.error('production verification configuration is invalid');
    process.exitCode = 1;
  }
}
