#!/usr/bin/env node
/**
 * seed-demo.mjs — synthetic demo data for the Bir Festival 2026 stack.
 *
 * Fills the gaps the other seeders don't (catalog/itemcfg/rooms are seeded by
 * seed-catalog / seed-itemcfg / seed-rooms): a full 3-day SCHEDULE, ANNOUNCE,
 * ORDER (so the console shows revenue), INC (incidents), extra VOL/STALL/
 * WRISTBAND/GATE, and the AI knowledge base (KB#FAQ + KB#DOC) so the assistant
 * answers grounded. Idempotent — stable sk ids, so re-running overwrites.
 *
 * Everything is clearly synthetic ("demo-" ids, sample names). Shapes match
 * bir-backend/terraform/lambda/admin + the AppSync resolvers + the mobile app.
 *
 *   TABLE=bir-2026-table AWS_PROFILE=rhoai-demo node scripts/seed-demo.mjs
 *
 * Requires: aws CLI, node. Writes via `aws dynamodb batch-write-item`.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLE = process.env.TABLE || 'bir-2026-table';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE;
const tmp = mkdtempSync(join(tmpdir(), 'seed-demo-'));

const sec = (iso) => Math.floor(Date.parse(iso) / 1000); // ISO w/ +05:30 → epoch seconds
const IST = '+05:30';
const at = (day, hm) => sec(`${day}T${hm}:00${IST}`);
const now = Math.floor(Date.now() / 1000);
const D1 = '2026-11-21', D2 = '2026-11-22', D3 = '2026-11-23';

// ---- marshalling (mirror of the other seeders' av()) ----
function av(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(av) };
  if (typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, av(x)])) };
  return { NULL: true };
}
const row = (pk, sk, fields) => ({ PutRequest: { Item: { pk: { S: pk }, sk: { S: sk }, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, av(v)])) } } });

const reqs = [];

// ===== SCHEDULE (pk=SCHEDULE) — resolver reads day/venue/titleEn/titleHi/startsAt/endsAt/data(JSON string) =====
const ev = (id, day, s, e, venue, en, hi, data) =>
  reqs.push(row('SCHEDULE', id, { day, venue, titleEn: en, titleHi: hi, startsAt: at(day, s), endsAt: at(day, e), data: JSON.stringify(data), updatedAt: now, updatedBy: 'seed:demo' }));
ev('d1-opening', D1, '09:00', '10:00', 'Takeoff · Billing', 'Opening Ceremony & Flag-off', 'उद्घाटन समारोह और फ्लैग-ऑफ', { category: 'ceremony' });
ev('d1-accuracy-1', D1, '10:30', '16:00', 'Landing · Chougan', 'Paragliding Accuracy — Round 1', 'पैराग्लाइडिंग सटीकता — राउंड 1', { category: 'sport' });
ev('d1-workshop-wing', D1, '11:00', '12:30', 'Ground School Tent', 'Wing Control Workshop', 'विंग कंट्रोल कार्यशाला', { category: 'workshop', seatReservable: true });
ev('d1-night-folk', D1, '18:00', '21:00', 'Chougan Stage', 'Cultural Night: Kangra Folk', 'सांस्कृतिक संध्या: कांगड़ा लोक', { category: 'culture', votable: true, seatReservable: true });
ev('d2-xc-race', D2, '08:00', '12:00', 'Billing', 'Cross-Country Race', 'क्रॉस-कंट्री रेस', { category: 'sport' });
ev('d2-miss-auditions', D2, '11:00', '13:00', 'Main Stage', 'Miss Himachal — Auditions', 'मिस हिमाचल — ऑडिशन', { category: 'competition' });
ev('d2-chef-finals', D2, '14:00', '16:00', 'Food Street Arena', 'Chef of the Year — Finals', 'शेफ़ ऑफ़ द ईयर — फ़ाइनल', { category: 'competition', votable: true });
ev('d2-night-sufi', D2, '19:00', '22:00', 'Chougan Stage', 'Cultural Night: Sufi & Indie', 'सांस्कृतिक संध्या: सूफ़ी और इंडी', { category: 'culture', votable: true, seatReservable: true });
ev('d3-acro', D3, '09:00', '13:00', 'Billing', 'Acro Paragliding Championship', 'एक्रो पैराग्लाइडिंग चैंपियनशिप', { category: 'sport' });
ev('d3-miss-finale', D3, '15:00', '16:30', 'Main Stage', 'Miss Himachal 2026 — Grand Finale', 'मिस हिमाचल 2026 — ग्रैंड फ़ाइनल', { category: 'competition', seatReservable: true });
ev('d3-awards', D3, '18:00', '19:00', 'Chougan Stage', 'Award Ceremony', 'पुरस्कार समारोह', { category: 'ceremony' });
ev('d3-concert', D3, '19:30', '22:30', 'Chougan Stage', 'Closing Concert', 'समापन कॉन्सर्ट', { category: 'culture', votable: true });

// ===== ANNOUNCE (pk=ANNOUNCE) — titleEn/titleHi/bodyEn/bodyHi/level/active/updatedAt =====
const ann = (id, level, ago, en, hi, ben, bhi) =>
  reqs.push(row('ANNOUNCE', id, { titleEn: en, titleHi: hi, bodyEn: ben, bodyHi: bhi, level, active: true, updatedAt: now - ago }));
ann('ann-welcome', 'info', 7200, 'Welcome to Bir Festival 2026', 'बीर महोत्सव 2026 में आपका स्वागत है', 'Three days above the valley — 21–23 November. Grab your pass and check the schedule.', 'घाटी के ऊपर तीन दिन — 21–23 नवंबर। अपना पास लें और कार्यक्रम देखें।');
ann('ann-weather', 'info', 5400, 'Great flying weather today', 'आज उड़ान के लिए बढ़िया मौसम', 'Clear skies and light winds at Billing. Accuracy round is on schedule.', 'बिलिंग में साफ़ आसमान और हल्की हवाएँ। सटीकता राउंड समय पर है।');
ann('ann-shuttle', 'info', 3600, 'Free shuttle every 30 minutes', 'हर 30 मिनट में मुफ़्त शटल', 'Shuttles run Bir ⇄ Billing from 7am. Look for the marigold flags.', 'शटल सुबह 7 बजे से बीर ⇄ बिलिंग चलती हैं। गेंदे के झंडे देखें।');
ann('ann-windhold', 'alert', 900, 'Wind hold at Billing 12–2 PM', 'बिलिंग में 12–2 बजे विंड होल्ड', 'Flying paused for gusty conditions. Watch fly-status for the all-clear.', 'तेज़ हवाओं के कारण उड़ान रुकी। ऑल-क्लियर के लिए उड़ान-स्थिति देखें।');

// ===== ORDER (pk=ORDER) — sub/kind/itemId/amountInr/status/createdAt; console revenue counts CONFIRMED =====
const S1 = '44883408-20f1-70f1-dc2f-579568f51660'; // an existing demo sub
const ord = (id, sub, kind, itemId, amt, status, ago) =>
  reqs.push(row('ORDER', id, { sub, kind, itemId, amountInr: amt, status, createdAt: now - ago }));
ord('demo-ord-1001', S1, 'pass', 'pass-full', 2500, 'CONFIRMED', 86400);
ord('demo-ord-1002', 'demo-guest-2', 'pass', 'pass-day', 900, 'CONFIRMED', 72000);
ord('demo-ord-1003', 'demo-guest-3', 'activity', 'tandem-flight', 3500, 'CONFIRMED', 64800);
ord('demo-ord-1004', 'demo-guest-4', 'activity', 'chef-local', 500, 'CONFIRMED', 43200);
ord('demo-ord-1005', 'demo-guest-5', 'pass', 'pass-vip', 6000, 'CONFIRMED', 21600);
ord('demo-ord-1006', 'demo-guest-6', 'activity', 'tandem-flight', 3500, 'PENDING', 1800);

// ===== INC (pk=INC) — category/note/zone/ts/reportedBy/status/assignee =====
const inc = (id, cat, note, zone, ago, status, assignee) =>
  reqs.push(row('INC', id, { category: cat, note, zone, ts: now - ago, reportedBy: 'volunteer:demo', status, assignee: assignee || '', updatedAt: now - ago, updatedBy: 'seed:demo' }));
inc('demo-inc-1', 'medical', 'Visitor feeling dizzy near landing zone — first aid given.', 'Landing · Chougan', 5400, 'resolved', 'medic-team-a');
inc('demo-inc-2', 'lost-found', 'Found: blue backpack at Food Street. Held at help desk.', 'Food Street Arena', 2700, 'acknowledged', 'helpdesk');
inc('demo-inc-3', 'crowd', 'Queue build-up at main gate — extra scanner requested.', 'Gate · Main', 600, 'open', '');

// ===== VOL (pk=VOL) — sub/name/team/idVerified/shifts =====
const vol = (id, name, team, verified, shifts) =>
  reqs.push(row('VOL', id, { sub: id, name, team, idVerified: verified, shifts, updatedAt: now, updatedBy: 'seed:demo' }));
vol('demo-vol-1', 'Aarti Thakur', 'Landing Zone', true, [
  { id: 'sh-1', date: D1, zone: 'Landing · Chougan', role: 'Marshal', startsAtSec: at(D1, '09:00'), endsAtSec: at(D1, '15:00') },
  { id: 'sh-2', date: D2, zone: 'Landing · Chougan', role: 'Marshal', startsAtSec: at(D2, '09:00'), endsAtSec: at(D2, '15:00') },
]);
vol('demo-vol-2', 'Rohit Negi', 'Help Desk', true, [
  { id: 'sh-3', date: D1, zone: 'Bir Market', role: 'Info', startsAtSec: at(D1, '10:00'), endsAtSec: at(D1, '18:00') },
]);
vol('demo-vol-3', 'Simran Kaur', 'Safety', false, [
  { id: 'sh-4', date: D2, zone: 'Billing Takeoff', role: 'Safety spotter', startsAtSec: at(D2, '08:00'), endsAtSec: at(D2, '13:00') },
]);

// ===== STALL (pk=STALL) — stallName/category/stage/allocationLabel/feeInr/paid =====
const stall = (id, name, cat, stage, label, fee, paid) =>
  reqs.push(row('STALL', id, { stallName: name, category: cat, stage, allocationLabel: label, feeInr: fee, paid, ...(paid ? { paidMethod: 'cash/offline', paidAt: now - 3600, paidBy: 'admin:demo' } : {}), updatedAt: now, updatedBy: 'seed:demo' }));
stall('demo-stall-1', 'Himalayan Momos', 'food', 'allocated', 'F-12', 4000, true);
stall('demo-stall-2', 'Kangra Tea House', 'food', 'allocated', 'F-08', 4000, true);
stall('demo-stall-3', 'Bir Craft Collective', 'craft', 'pending', 'C-03', 3000, false);

// ===== WRISTBAND (pk=WRISTBAND) — sk UPPER; childName/ageBand/guardianName/guardianPhone/zone/active/createdAt =====
const band = (id, child, ageBand, guardian, phone, zone) =>
  reqs.push(row('WRISTBAND', id.toUpperCase(), { childName: child, ageBand, guardianName: guardian, guardianPhone: phone, zone, notes: '', active: true, createdAt: now, updatedAt: now, updatedBy: 'seed:demo' }));
band('BAND-0007', 'Kabir', '5-8', 'Meera Sharma', '+919812345670', 'Family Zone');
band('BAND-0011', 'Anaya', '3-5', 'Vikram Rana', '+919812345671', 'Food Street Arena');

// ===== GATE (pk=GATE) — label/active =====
reqs.push(row('GATE', 'gate:chogan', { label: 'Chougan Landing Gate', active: true, updatedAt: now, updatedBy: 'seed:demo' }));
reqs.push(row('GATE', 'gate:billing', { label: 'Billing Takeoff Gate', active: true, updatedAt: now, updatedBy: 'seed:demo' }));

// ===== KB#FAQ (pk=KB#FAQ) — question/answer (AI RAG) =====
const faq = (id, q, a) => reqs.push(row('KB#FAQ', id, { question: q, answer: a, updatedAt: now, updatedBy: 'seed:demo' }));
faq('faq-dates', 'When and where is the festival?', 'Bir Festival 2026 runs 21–23 November 2026 at Bir–Billing in Kangra, Himachal Pradesh — the paragliding capital of India.');
faq('faq-passes', 'What passes are available?', 'A Day Pass (₹900), a Full 3-day Pass (₹2,500) and a VIP Pass (₹6,000). Buy them in the app under "Buy a pass".');
faq('faq-tandem', 'Can I do a tandem paragliding flight?', 'Yes — book a Tandem Flight in the app. Slots run from Billing takeoff each morning, weather permitting. Certified pilots only.');
faq('faq-getting-there', 'How do I get to Bir?', 'Nearest airport is Kangra (Gaggal), ~2 hours by road. A free festival shuttle runs Bir ⇄ Billing every 30 minutes from 7 AM.');
faq('faq-fly-status', 'How do I know if flying is on?', 'The app home screen shows a live fly-status banner: Flying open, Hold, or Closed. It updates the moment marshals change it.');
faq('faq-kids', 'Is it family friendly?', 'Yes. Children get a safety wristband at the help desk linking them to a guardian phone, and there is a dedicated Family Zone.');
faq('faq-food', 'What food is available?', 'Food Street Arena has local stalls — momos, Kangra tea, siddu and dham. The Chef of the Year competition is on Day 2.');
faq('faq-cultural', 'What happens in the evenings?', 'Cultural Nights on the Chougan Stage — Kangra folk on Day 1, Sufi & Indie on Day 2, and a closing concert on Day 3. You can vote for your favourite act in the app.');

// ===== KB#DOC (pk=KB#DOC, sk=<docId>#0000) — docId/title/text/source/updatedAt (AI RAG chunks) =====
const doc = (docId, title, text, source) =>
  reqs.push(row('KB#DOC', `${docId}#0000`, { docId, title, text, source, updatedAt: now, updatedBy: 'seed:demo' }));
doc('overview', 'Festival overview', 'Bir Festival 2026 is a three-day celebration of paragliding, mountain culture, music and food at Bir–Billing, Kangra, Himachal Pradesh, 21–23 November 2026. Bir–Billing is the paragliding capital of India, with Billing as the takeoff and Chougan (Bir) as the landing meadow. The festival combines competitive flying (accuracy, cross-country, acro), cultural nights, food stalls, and family activities.', 'seed:overview');
doc('safety', 'Safety & flying', 'All flying is weather-dependent. Marshals set a live fly-status — Flying open, Hold, or Closed — shown in the app. During a wind hold, flying pauses until conditions clear. Tandem flights use certified pilots only. First-aid and medical teams are stationed at the landing zone. Report any incident to a volunteer or through the app SOS.', 'seed:safety');
doc('logistics', 'Getting there & around', 'The nearest airport is Kangra (Gaggal), about two hours by road; Pathankot is the nearest major railhead. A free festival shuttle runs between Bir and Billing every 30 minutes from 7 AM, marked with marigold flags. Lodging is arranged through the festival for registered participants across partner hotels in Bir.', 'seed:logistics');
doc('schedule-overview', 'What is on', 'Day 1 (21 Nov): opening ceremony, paragliding accuracy round, wing-control workshop, and a Kangra folk cultural night. Day 2 (22 Nov): cross-country race, Miss Himachal auditions, Chef of the Year finals, and a Sufi & Indie night. Day 3 (23 Nov): acro championship, Miss Himachal grand finale, award ceremony, and a closing concert.', 'seed:schedule');

// ---- write in batches of 25 ----
function flush(items, i) {
  const body = { [TABLE]: items };
  const f = join(tmp, `batch-${i}.json`);
  writeFileSync(f, JSON.stringify(body));
  const args = ['dynamodb', 'batch-write-item', '--request-items', `file://${f}`, '--region', REGION];
  if (PROFILE) args.push('--profile', PROFILE);
  const out = execFileSync('aws', args, { encoding: 'utf8' });
  const un = JSON.parse(out).UnprocessedItems || {};
  const left = (un[TABLE] || []).length;
  console.log(`  batch ${i}: wrote ${items.length - left}/${items.length}` + (left ? ` (⚠ ${left} unprocessed)` : ''));
}

console.log(`Seeding ${reqs.length} demo items into ${TABLE} (${REGION})…`);
let n = 0;
for (let i = 0; i < reqs.length; i += 25) flush(reqs.slice(i, i + 25), ++n);
console.log('✓ demo seed complete — schedule, announcements, orders, incidents, volunteers, stalls, wristbands, gates, KB (FAQ+docs).');
