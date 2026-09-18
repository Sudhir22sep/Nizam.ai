#!/usr/bin/env node
/**
 * Diagnoses the AWS SES configuration used by the server.
 *
 * Answers "why is email not sending?" by checking, in order:
 *   1. which SES/AWS values are present (and whether they are placeholders)
 *   2. whether AWS credentials can actually be resolved
 *   3. optionally, a real send
 *
 * Usage (run from the Nizam/ directory):
 *   node scripts/check-ses-credentials.cjs                      # config + credentials
 *   node scripts/check-ses-credentials.cjs --send-to you@x.com  # + a real test email
 *
 * Notes:
 *   - Reads .env the same way the server does; shell environment variables win,
 *     exactly like at runtime.
 *   - A "not authorized" reply still proves the credentials work: the request
 *     was signed successfully and the IAM user merely lacks ses:GetSendQuota.
 *     ses:SendEmail + ses:SendRawEmail are what actually matter for sending.
 */
const path = require('path');
const { SESClient, GetSendQuotaCommand, SendEmailCommand } = require('@aws-sdk/client-ses');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const PLACEHOLDERS = new Set([
  'your-email@example.com',
  'your-verified-email@example.com',
  'your_access_key_here',
  'your_secret_access_key_here',
  'your_aws_access_key_id',
  'your_aws_secret_access_key',
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
]);

const sendToIndex = process.argv.indexOf('--send-to');
const sendTo = sendToIndex !== -1 ? process.argv[sendToIndex + 1] : null;

const region = (process.env.SES_REGION || '').trim();
const sender = (process.env.SES_VERIFIED_SENDER || '').trim();
const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const profile = (process.env.AWS_PROFILE || '').trim();

const hasStaticCredentials =
  accessKeyId.length > 0 &&
  secretAccessKey.length > 0 &&
  !PLACEHOLDERS.has(accessKeyId) &&
  !PLACEHOLDERS.has(secretAccessKey);

function describe(label, value) {
  if (!value) {
    console.log(`  \u00b7 ${label}: NOT SET`);
    return;
  }
  if (PLACEHOLDERS.has(value)) {
    console.log(`  ! ${label}: still the placeholder value "${value}"`);
    return;
  }
  const shown = /KEY|SECRET/i.test(label) ? `${value.slice(0, 4)}\u2026(${value.length} chars)` : value;
  console.log(`  \u2713 ${label}: ${shown}`);
}

(async () => {
  console.log('SES configuration (as the server would read it)\n');
  describe('SES_REGION', region);
  describe('SES_VERIFIED_SENDER', sender);
  describe('AWS_ACCESS_KEY_ID', accessKeyId);
  describe('AWS_SECRET_ACCESS_KEY', secretAccessKey);
  console.log(`  \u00b7 AWS_PROFILE: ${profile || 'NOT SET'}`);

  if (!region) {
    console.log('\n\u2717 SES_REGION is missing, so the server never creates an SES client and never attempts a send.');
    process.exit(1);
  }
  if (!sender || PLACEHOLDERS.has(sender)) {
    console.log('\n! SES_VERIFIED_SENDER is missing or a placeholder; SES will reject the send.');
  }

  console.log(
    `\nCredential mode: ${hasStaticCredentials ? 'static keys from the environment/.env' : 'AWS SDK default credential chain (env, AWS_PROFILE/SSO, instance role, ~/.aws)'}\n`
  );

  const client = hasStaticCredentials
    ? new SESClient({ region, credentials: { accessKeyId, secretAccessKey } })
    : new SESClient({ region });

  // --- step 1: can credentials be resolved? (read-only call)
  try {
    const quota = await client.send(new GetSendQuotaCommand({}));
    console.log('\u2713 Credentials resolved and a signed AWS call succeeded.');
    console.log(
      `  SES quota: ${quota.Max24HourSend ?? '?'} per 24h, ${quota.MaxSendRate ?? '?'} per second, ${quota.SentLast24Hours ?? 0} sent recently.`
    );
    if (quota.Max24HourSend === 200 && (quota.SentLast24Hours ?? 0) === 0) {
      console.log('  NOTE: a 200/24h limit usually means this account is still in the SES sandbox, so');
      console.log('        every recipient address must also be verified until production access is granted.');
    }
  } catch (error) {
    const name = (error && error.name) || 'UnknownError';
    if (name === 'CredentialsProviderError') {
      console.log('\u2717 NO CREDENTIALS COULD BE RESOLVED - this is why email is failing.');
      console.log('  Fix: put the real AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the same pair set in');
      console.log('  the Render dashboard) into Nizam/.env, uncommented, then restart the server.');
      process.exit(1);
    }
    if (name === 'AccessDenied' || name === 'AccessDeniedException') {
      console.log('\u2713 Credentials ARE working: the request was signed successfully and the IAM user');
      console.log('  simply lacks ses:GetSendQuota, which is not needed for sending.');
    } else {
      console.log(`\u2717 Signed call failed: ${name}: ${error && error.message}`);
      console.log('  InvalidClientTokenId / SignatureDoesNotMatch means the key pair is wrong or disabled.');
      process.exit(1);
    }
  }

  // --- step 2: optional real send
  if (!sendTo) {
    console.log('\nTip: add --send-to you@example.com to send a real test email.');
    return;
  }
  try {
    await client.send(new SendEmailCommand({
      Source: sender,
      Destination: { ToAddresses: [sendTo] },
      Message: {
        Subject: { Data: 'SES test from Nizam' },
        Body: { Text: { Data: `SES is configured correctly. Sent from ${sender} via ${region}.` } }
      }
    }));
    console.log(`\n\u2713 Test email accepted by SES for delivery to ${sendTo}.`);
  } catch (error) {
    console.log(`\n\u2717 Send failed: ${error && error.name}: ${error && error.message}`);
    if (/not verified/i.test((error && error.message) || '')) {
      console.log(`  The identity "${sender}" (or the recipient, while in the sandbox) is not verified in ${region}.`);
      console.log('  Check AWS Console -> SES -> Verified identities, in that exact region.');
    }
    process.exit(1);
  }
})();

