#!/usr/bin/env node
/**
 * DEMO distribution page (evaluation builds only — the production channel is
 * DISTRIBUTION.md §3 on the backend's appDistBucket, still pending ASK #1).
 *
 * Publishes to a public S3 bucket in YOUR AWS account over https:
 *   https://<bucket>.s3.<region>.amazonaws.com/index.html   (branded QR page)
 *   https://<bucket>.s3.<region>.amazonaws.com/bir-festival-demo.apk
 *
 * Usage:
 *   node scripts/publish-demo-page.mjs --apk <path> --profile rhoai-demo \
 *        [--region ap-south-1] [--bucket <name>] [--version 0.1.0-demo]
 *
 * Uses the AWS CLI (SSO-aware). Creates the bucket on first run and opens
 * public read for these two objects only.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import QRCode from 'qrcode';

function arg(flag, fallback) {
  const i = process.argv.indexOf(`--${flag}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`missing --${flag}`);
  process.exit(1);
}

const apkPath = arg('apk');
const profile = arg('profile');
const region = arg('region', 'ap-south-1');
const version = arg('version', '0.1.0-demo');

function aws(...args) {
  return execFileSync('aws', [...args, '--profile', profile, '--region', region], {
    encoding: 'utf8',
  }).trim();
}

const account = aws('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text');
const bucket = arg('bucket', `bir-festival-2026-demo-${account}`);
const base = `https://${bucket}.s3.${region}.amazonaws.com`;
const apkUrl = `${base}/bir-festival-demo.apk`;
const pageUrl = `${base}/index.html`;
const guideUrl = `${base}/test-guide.html`;

// 1. bucket (idempotent)
try {
  aws('s3api', 'head-bucket', '--bucket', bucket);
  console.log(`bucket exists: ${bucket}`);
} catch {
  const createArgs = ['s3api', 'create-bucket', '--bucket', bucket];
  if (region !== 'us-east-1') {
    createArgs.push('--create-bucket-configuration', `LocationConstraint=${region}`);
  }
  aws(...createArgs);
  console.log(`bucket created: ${bucket}`);
}
aws(
  's3api',
  'put-public-access-block',
  '--bucket',
  bucket,
  '--public-access-block-configuration',
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false',
);
aws(
  's3api',
  'put-bucket-policy',
  '--bucket',
  bucket,
  '--policy',
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadDemoArtifacts',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: [
          `arn:aws:s3:::${bucket}/index.html`,
          `arn:aws:s3:::${bucket}/test-guide.html`,
          `arn:aws:s3:::${bucket}/bir-festival-demo.apk`,
          `arn:aws:s3:::${bucket}/qr-android.png`,
          `arn:aws:s3:::${bucket}/qr-page.png`,
        ],
      },
    ],
  }),
);

// 2. artifact facts
const apkBytes = readFileSync(apkPath);
const sha256 = createHash('sha256').update(apkBytes).digest('hex');
const sizeMb = (apkBytes.length / (1024 * 1024)).toFixed(1);

// 3. QR codes (embedded in the page as data URIs + standalone PNGs for print)
const qrAndroidData = await QRCode.toDataURL(apkUrl, {
  width: 480,
  margin: 2,
  color: { dark: '#17232B' },
});
const qrPageData = await QRCode.toDataURL(pageUrl, {
  width: 480,
  margin: 2,
  color: { dark: '#17232B' },
});
const tmp = mkdtempSync(join(tmpdir(), 'bir-qr-'));
writeFileSync(
  join(tmp, 'qr-android.png'),
  await QRCode.toBuffer(apkUrl, { width: 640, margin: 2 }),
);
writeFileSync(join(tmp, 'qr-page.png'), await QRCode.toBuffer(pageUrl, { width: 640, margin: 2 }));

// 4. branded page (BRAND.md palette + flight-line motif)
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bir Festival 2026 — Demo App</title>
<style>
  :root{--ink:#17232B;--pine:#2E5E4E;--slate:#3E6B8C;--marigold:#E8A13D;--red:#B4482B;--paper:#F7F8F5}
  *{box-sizing:border-box} body{font-family:Georgia,'Times New Roman',serif;margin:0;background:var(--paper);color:var(--ink)}
  .sans{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif}
  main{max-width:680px;margin:0 auto;padding:28px 20px 60px}
  header{text-align:center;padding:28px 0 10px}
  h1{font-size:2rem;margin:8px 0 2px;letter-spacing:.5px}
  .tagline{color:var(--slate);font-size:.95rem;margin:0}
  .dates{display:inline-block;margin-top:10px;background:var(--ink);color:var(--paper);border-radius:999px;padding:6px 18px;font-size:.85rem}
  .glider{width:64px;height:64px;margin:0 auto;display:block}
  .flightline{display:block;margin:14px auto 0;width:260px}
  .demo{background:var(--ink);color:var(--paper);border-radius:12px;padding:14px 18px;margin:22px 0;font-size:.9rem;text-align:center}
  .demo b{color:var(--marigold);font-size:1.1rem;letter-spacing:2px}
  .card{background:#fff;border:1px solid #DDE2DC;border-radius:16px;padding:22px;margin:18px 0}
  .card h2{margin:0 0 4px;font-size:1.2rem}
  .os{color:var(--slate);font-size:.8rem;text-transform:uppercase;letter-spacing:1.5px}
  .qr{display:block;width:220px;height:220px;margin:14px auto;border:1px solid #DDE2DC;border-radius:12px}
  .btn{display:block;text-align:center;background:var(--pine);color:#fff;padding:15px;border-radius:12px;text-decoration:none;font-weight:700;font-size:1.05rem}
  .guide{display:block;text-align:center;background:var(--marigold);color:var(--ink);padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:1rem;margin:0 0 4px}
  .whatsin{background:#fff;border:1px dashed var(--marigold);border-radius:12px;padding:12px 16px;margin:14px 0;font-size:.86rem;color:#3c4a52}
  .steps{font-size:.9rem;line-height:1.6;color:#3c4a52;padding-left:18px}
  .hi{color:var(--slate)}
  .meta{font-size:.75rem;color:#5B6B75;word-break:break-all}
  .ios-note{background:#FCF3E3;border-radius:10px;padding:12px 14px;font-size:.88rem}
  footer{text-align:center;font-size:.75rem;color:#5B6B75;margin-top:26px}
</style>
</head>
<body><main>
<header>
  <svg class="glider" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 14 C 16 4, 32 4, 44 14 C 34 12, 14 12, 4 14 Z" fill="#E8A13D" stroke="#17232B" stroke-width="1.2"/>
    <path d="M8 14 L 23 32 M40 14 L 25 32" stroke="#17232B" stroke-width="1.2"/>
    <path d="M22 32 a 3 4 0 1 0 6 0 a 3 4 0 1 0 -6 0" fill="#3E6B8C"/>
  </svg>
  <h1>Bir Festival 2026</h1>
  <p class="tagline">बीड़ महोत्सव 2026 · The festival app, in your pocket</p>
  <span class="dates sans">21–23 November 2026 · Bir–Billing, Himachal Pradesh</span>
  <svg class="flightline" viewBox="0 0 280 50" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 8 C 90 4, 190 18, 274 44" stroke="#E8A13D" stroke-width="2.5" stroke-dasharray="7 6" stroke-linecap="round" fill="none"/>
    <path d="M268 36 L 276 45 L 264 45 Z" fill="#E8A13D"/>
  </svg>
</header>

<div class="demo sans">EVALUATION BUILD · Sign in with any 10-digit number, OTP <b>123456</b> · डेमो: कोई भी नंबर, OTP <b>123456</b> · Sample data, payments disabled</div>

<a class="guide sans" href="${guideUrl}">📋 Read the testing guide first / पहले टेस्टिंग गाइड पढ़ें</a>

<p class="whatsin sans"><b>What’s inside this build:</b> passes &amp; offline QR, tickets, cultural nights + voting, the Highlights hub (competitions, yoga, adventure…), volunteer scanner/roster/incident, organiser ops + fly-status, admin lodging &amp; badges, and partner stall/hospitality consoles — all with sample data. All six roles are unlocked so one login can test everything.</p>

<section class="card">
  <p class="os sans">Android</p>
  <h2>Point your camera here / यहाँ कैमरा करें</h2>
  <img class="qr" src="${qrAndroidData}" alt="QR: download the Android APK">
  <a class="btn sans" href="${apkUrl}">Download APK (${sizeMb} MB) / APK डाउनलोड करें</a>
  <ol class="steps sans">
    <li><b>Already have an older “Bir” demo? Uninstall it first</b> (Settings → Apps → Bir), then continue.</li>
    <li>Scan the QR (or tap the button) → the app downloads.</li>
    <li>Open the file → allow <b>“Install from this source”</b> when asked → Install.</li>
    <li class="hi">पुराना डेमो अनइंस्टॉल करें → QR स्कैन करें → फ़ाइल खोलें → <b>“इस स्रोत से इंस्टॉल की अनुमति दें”</b> → इंस्टॉल।</li>
  </ol>
  <p class="meta sans">v${version} · Android 8.0+ · SHA-256 ${sha256}</p>
</section>

<section class="card">
  <p class="os sans">iPhone</p>
  <h2>iOS install / iOS इंस्टॉल</h2>
  <div class="ios-note sans">
    Apple does not allow direct install outside the App Store. The iPhone build arrives via
    <b>TestFlight</b> — share your e-mail with the festival IT desk to get the invite.
    <span class="hi">Apple ऐप स्टोर के बाहर सीधा इंस्टॉल नहीं होने देता। iPhone बिल्ड <b>TestFlight</b> से मिलेगा — इनवाइट के लिए फ़ेस्टिवल IT डेस्क को अपना ई-मेल दें।</span>
  </div>
</section>

<footer class="sans">
  Bir Festival 2026 demo distribution · share this page: <a href="${pageUrl}">${pageUrl}</a><br>
  Published ${new Date().toISOString().slice(0, 10)} · not the released app · production channel: get.bir.example (pending)
</footer>
</main></body></html>`;

// 5. upload
function put(key, body, contentType, filePath) {
  const args = [
    's3api',
    'put-object',
    '--bucket',
    bucket,
    '--key',
    key,
    '--content-type',
    contentType,
    '--cache-control',
    'max-age=60',
  ];
  if (filePath) args.push('--body', filePath);
  else {
    const f = join(tmp, key.replace(/\//g, '_'));
    writeFileSync(f, body);
    args.push('--body', f);
  }
  aws(...args);
}
put('bir-festival-demo.apk', null, 'application/vnd.android.package-archive', apkPath);
put('index.html', html, 'text/html; charset=utf-8');
// Standalone tester's guide (authored in scripts/demo-assets/test-guide.html).
const guideHtml = readFileSync(new URL('./demo-assets/test-guide.html', import.meta.url));
put('test-guide.html', guideHtml, 'text/html; charset=utf-8');
put('qr-android.png', null, 'image/png', join(tmp, 'qr-android.png'));
put('qr-page.png', null, 'image/png', join(tmp, 'qr-page.png'));

console.log('\n✔ published');
console.log(`  page:  ${pageUrl}`);
console.log(`  guide: ${guideUrl}`);
console.log(`  apk:   ${apkUrl}`);
console.log(`  poster QRs: ${base}/qr-android.png  ${base}/qr-page.png`);
console.log(`  sha256: ${sha256}`);
