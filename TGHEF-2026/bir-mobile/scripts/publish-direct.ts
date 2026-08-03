/**
 * publish-direct (DISTRIBUTION.md §3): pushes a built APK/IPA to the existing
 * stack's app-distribution bucket, writes latest.json, regenerates the
 * bilingual download page + QR codes, and invalidates CloudFront.
 *
 * Runs in CI only (never on-device). AWS credentials come from the CI role —
 * the backend-exported `ci/appDistPublishRoleArn` (docs/BACKEND_ASKS.md #1),
 * scoped to appDistBucket + the distribution invalidation.
 *
 * Usage:
 *   tsx scripts/publish-direct.ts --apk path/to/app.apk --version 1.4.2 \
 *       --git-sha c1234abc --distribution-id EXXXXXXXX [--min-os 8.0]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import QRCode from 'qrcode';

import contract from '../config/stack-outputs.json';

interface Args {
  apk: string;
  version: string;
  gitSha: string;
  distributionId: string;
  minOs: string;
}

function parseArgs(): Args {
  const get = (flag: string, fallback?: string): string => {
    const idx = process.argv.indexOf(`--${flag}`);
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    if (fallback !== undefined) return fallback;
    console.error(`missing --${flag}`);
    process.exit(1);
  };
  return {
    apk: get('apk'),
    version: get('version'),
    gitSha: get('git-sha'),
    distributionId: get('distribution-id'),
    minOs: get('min-os', '8.0'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const { appDistBucket, appDistDomain } = contract.storage;
  const region = contract.region;

  const s3 = new S3Client({ region });
  const cloudfront = new CloudFrontClient({ region });

  // 1. hash the artifact
  const apkBytes = readFileSync(args.apk);
  const sha256 = createHash('sha256').update(apkBytes).digest('hex');
  const apkKey = `android/bir-app-${args.version}-${args.gitSha.slice(0, 8)}.apk`;
  console.log(`APK ${basename(args.apk)} sha256=${sha256}`);

  // 2. immutable APK + short-lived latest.json
  await s3.send(
    new PutObjectCommand({
      Bucket: appDistBucket,
      Key: apkKey,
      Body: apkBytes,
      ContentType: 'application/vnd.android.package-archive',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  const latest = {
    version: args.version,
    apk: `https://${appDistDomain}/${apkKey}`,
    sha256,
    minOs: args.minOs,
    notes: {
      en: `Bir app ${args.version} — install this update from this page or Google Play.`,
      hi: `बीड़ ऐप ${args.version} — यह अपडेट इस पेज या Google Play से इंस्टॉल करें।`,
    },
  };
  await s3.send(
    new PutObjectCommand({
      Bucket: appDistBucket,
      Key: 'android/latest.json',
      Body: JSON.stringify(latest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'max-age=60',
    }),
  );

  // 3. QR codes: Android page + iOS ad-hoc manifest (registered devices only)
  const androidUrl = `https://${appDistDomain}/`;
  const iosUrl = `itms-services://?action=download-manifest&url=https://${appDistDomain}/ios-adhoc/manifest-${args.version}.plist`;
  const [qrAndroid, qrIos] = await Promise.all([
    QRCode.toBuffer(androidUrl, { width: 512, margin: 2 }),
    QRCode.toBuffer(iosUrl, { width: 512, margin: 2 }),
  ]);
  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: appDistBucket,
        Key: 'site/qr-android.png',
        Body: qrAndroid,
        ContentType: 'image/png',
        CacheControl: 'max-age=300',
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: appDistBucket,
        Key: 'site/qr-ios.png',
        Body: qrIos,
        ContentType: 'image/png',
        CacheControl: 'max-age=300',
      }),
    ),
  ]);

  // 4. bilingual download page
  const sizeMb = (apkBytes.length / (1024 * 1024)).toFixed(1);
  const html = renderPage({ version: args.version, sha256, sizeMb, apkUrl: latest.apk });
  await s3.send(
    new PutObjectCommand({
      Bucket: appDistBucket,
      Key: 'site/index.html',
      Body: html,
      ContentType: 'text/html; charset=utf-8',
      CacheControl: 'max-age=60',
    }),
  );

  // 5. CloudFront invalidation
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: args.distributionId,
      InvalidationBatch: {
        CallerReference: `publish-${args.version}-${Date.now()}`,
        Paths: { Quantity: 2, Items: ['/site/*', '/android/latest.json'] },
      },
    }),
  );

  console.log(`✔ published ${args.version} to https://${appDistDomain}/`);
}

function renderPage(p: {
  version: string;
  sha256: string;
  sizeMb: string;
  apkUrl: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bir App — Direct Download / सीधा डाउनलोड</title>
<style>
  body{font-family:system-ui;margin:0;background:#F7F8F5;color:#17232B}
  main{max-width:640px;margin:0 auto;padding:24px}
  h1{font-size:1.6rem} .card{background:#fff;border:1px solid #DDE2DC;border-radius:12px;padding:20px;margin:16px 0}
  .btn{display:block;text-align:center;background:#2E5E4E;color:#fff;padding:14px;border-radius:10px;text-decoration:none;font-weight:600}
  code{word-break:break-all;font-size:.75rem;background:#eef0ec;padding:2px 4px;border-radius:4px}
  img.qr{width:200px;height:200px}
  .hi{color:#3E6B8C}
</style>
</head>
<body><main>
<h1>Bir App v${p.version}</h1>
<div class="card">
  <a class="btn" href="${p.apkUrl}">Download APK (${p.sizeMb} MB) / APK डाउनलोड करें</a>
  <p>Android 8.0+ · SHA-256: <code>${p.sha256}</code></p>
  <p>Install steps: open the file → <b>Settings → Allow from this source</b> → Install.</p>
  <p class="hi">इंस्टॉल करने के लिए: फ़ाइल खोलें → <b>सेटिंग्स → इस स्रोत से अनुमति दें</b> → इंस्टॉल करें।</p>
  <img class="qr" src="qr-android.png" alt="Android download QR">
</div>
<div class="card">
  <h2>iOS (registered test devices only / केवल पंजीकृत टेस्ट डिवाइस)</h2>
  <p>Public iOS installs come from the App Store / TestFlight.</p>
  <img class="qr" src="qr-ios.png" alt="iOS ad-hoc install QR">
</div>
</main></body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
