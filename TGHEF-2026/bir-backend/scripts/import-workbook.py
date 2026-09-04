#!/usr/bin/env python3
"""
B7: import the filled data-collection workbook into the deployed backend.

Reads Bir_Festival_2026_Data_Collection.xlsx and writes:
  - DynamoDB rows: ticket tiers, schedule, competition registrations (lodging
    pool), rooms, volunteers (+shifts), stall/hospitality consoles, fly-status;
  - CDN JSON: the Highlights catalog (categories+items+slots) and venues.json;
  - Cognito users + role-group membership for volunteers, partners and the
    Users & Roles tab (so the console rows keyed by Cognito sub resolve).

Dates 'YYYY-MM-DD' + times 'HH:MM' (IST) become epoch seconds; venue_id and
volunteer_phone references are resolved across sheets. Idempotent.

Usage:
  AWS_PROFILE=rhoai-demo AWS_REGION=us-east-1 python3 scripts/import-workbook.py \
      [--workbook data-collection/Bir_Festival_2026_Data_Collection.xlsx] \
      [--no-users] [--dry-run]
"""
import argparse, json, os, subprocess, sys
from datetime import datetime, timezone, timedelta

import boto3
import openpyxl
from botocore.exceptions import ClientError

IST = timezone(timedelta(hours=5, minutes=30))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Fixed throwaway password only to move imported demo users to CONFIRMED; login
# is passwordless OTP (custom-auth), so this is never used to authenticate.
DEMO_PW = "BirImport#2026x!"


def tfout(name, fallback=""):
    try:
        return subprocess.check_output(
            ["terraform", "output", "-raw", name], cwd=os.path.join(HERE, "terraform"),
            stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return fallback


def epoch(date_s, time_s="00:00"):
    if not date_s:
        return None
    dt = datetime.strptime(f"{str(date_s)[:10]} {str(time_s)[:5]}", "%Y-%m-%d %H:%M").replace(tzinfo=IST)
    return int(dt.timestamp())


def yn(v):
    return str(v).strip().lower() in ("yes", "true", "y", "1")


def sheet_rows(ws):
    """Yield each data row of a template sheet as a header->value dict.
    Row 0 is the section comment, row 1 the headers, row 2+ the data."""
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        return
    headers = [(str(h).replace("*", "").strip() if h is not None else "") for h in rows[1]]
    for r in rows[2:]:
        if all(c is None or str(c).strip() == "" for c in r):
            continue
        yield {headers[i]: r[i] for i in range(len(headers)) if headers[i]}


def clean(v):
    return None if v is None or str(v).strip() == "" else str(v).strip()


class Importer:
    def __init__(self, args):
        self.args = args
        self.table_name = tfout("dynamodb_table", "bir-2026-table")
        self.bucket = tfout("storage_media_bucket", "bir-2026-media-37970b6d")
        self.pool = tfout("auth_user_pool_id", "us-east-1_LwsiJjOK2")
        self.ddb = boto3.resource("dynamodb").Table(self.table_name)
        self.s3 = boto3.client("s3")
        self.idp = boto3.client("cognito-idp")
        self.venue_name = {}   # venue_id -> name_en
        self.sub_by_phone = {}  # phone -> Cognito sub (cache)
        self.put_count = 0

    def put(self, item):
        item = {k: v for k, v in item.items() if v is not None}
        if self.args.dry_run:
            print("  PUT", json.dumps(item, default=str)[:160])
        else:
            self.ddb.put_item(Item=item)
        self.put_count += 1

    def s3_json(self, key, obj):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        if self.args.dry_run:
            print(f"  S3 s3://{self.bucket}/{key} ({len(body)} bytes)")
        else:
            self.s3.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json")

    def ensure_user(self, phone, groups, name=None):
        """Create (idempotent) a Cognito user, confirm it, add role groups; return sub."""
        phone = clean(phone)
        if not phone:
            return None
        if phone in self.sub_by_phone:
            sub = self.sub_by_phone[phone]
        else:
            if not self.args.dry_run:
                try:
                    attrs = [{"Name": "phone_number", "Value": phone},
                             {"Name": "phone_number_verified", "Value": "true"}]
                    self.idp.admin_create_user(UserPoolId=self.pool, Username=phone,
                                               UserAttributes=attrs, MessageAction="SUPPRESS")
                    self.idp.admin_set_user_password(UserPoolId=self.pool, Username=phone,
                                                     Password=DEMO_PW, Permanent=True)
                except ClientError as e:
                    if e.response["Error"]["Code"] != "UsernameExistsException":
                        raise
                u = self.idp.admin_get_user(UserPoolId=self.pool, Username=phone)
                sub = next(a["Value"] for a in u["UserAttributes"] if a["Name"] == "sub")
            else:
                sub = f"dry-{phone}"
                print(f"  COGNITO create {phone} name={name}")
            self.sub_by_phone[phone] = sub
        for g in groups:
            if not self.args.dry_run:
                self.idp.admin_add_user_to_group(UserPoolId=self.pool, Username=phone, GroupName=g)
            else:
                print(f"  COGNITO {phone} -> group {g}")
        return sub

    # ---- per-sheet importers ----
    def tiers(self, ws):
        for r in sheet_rows(ws):
            self.put({"pk": "TIER", "sk": r["id"], "titleEn": r["title_en"], "titleHi": r["title_hi"],
                      "priceInr": int(r["price_inr"]), "description": clean(r.get("description_en"))})

    def venues(self, ws):
        out = []
        for r in sheet_rows(ws):
            self.venue_name[r["id"]] = r["name_en"]
            out.append({"id": r["id"], "nameEn": r["name_en"], "nameHi": clean(r.get("name_hi")),
                        "lat": float(r["latitude"]), "lng": float(r["longitude"])})
        self.s3_json("config/venues.json", {"venues": out})

    def schedule(self, ws):
        for r in sheet_rows(ws):
            self.put({"pk": "SCHEDULE", "sk": f"{r['date']}#{r['id']}", "day": str(r["date"])[:10],
                      "venue": self.venue_name.get(r["venue_id"], r["venue_id"]),
                      "titleEn": r["title_en"], "titleHi": r["title_hi"],
                      "startsAt": epoch(r["date"], r["start_time"]),
                      "endsAt": epoch(r["date"], r["end_time"]) if clean(r.get("end_time")) else None,
                      "data": json.dumps({"votable": yn(r.get("votable")), "category": clean(r.get("category"))})})

    def catalog(self, wb):
        cats = [{"id": r["id"], "title": r["title_en"], "titleHi": r["title_hi"], "icon": r["icon_emoji"],
                 "order": int(r["sort_order"]), "kind": r["kind"]}
                for r in sheet_rows(wb["4. Highlight Categories"])]
        slots_by_item = {}
        for r in sheet_rows(wb["6. Highlight Slots"]):
            slots_by_item.setdefault(r["item_id"], []).append({
                "id": r["slot_id"], "startsAtSec": epoch(r["date"], r["start_time"]),
                "label": r["label_en"], "labelHi": r["label_hi"],
                "capacity": int(r["capacity"]) if clean(r.get("capacity")) else None,
                "remaining": int(r["capacity"]) if clean(r.get("capacity")) else None})
        items = []
        for r in sheet_rows(wb["5. Highlight Items"]):
            item = {"id": r["id"], "categoryId": r["category_id"], "title": r["title_en"], "titleHi": r["title_hi"],
                    "summary": r["summary_en"], "summaryHi": r["summary_hi"],
                    "venue": self.venue_name.get(r.get("venue_id"), clean(r.get("venue_id"))),
                    "dates": [d.strip() for d in str(r["dates"]).split(",") if d.strip()],
                    "media": [], "regMode": r["reg_mode"],
                    "gateChecked": yn(r.get("gate_checked")), "guardianRequired": yn(r.get("guardian_required")),
                    "weatherSensitive": yn(r.get("weather_sensitive")),
                    "rules": clean(r.get("rules_en")), "rulesHi": clean(r.get("rules_hi")),
                    "eligibility": clean(r.get("eligibility_en")), "eligibilityHi": clean(r.get("eligibility_hi"))}
            if clean(r.get("fee_inr")):
                item["fee"] = {"amount": int(r["fee_inr"]), "currency": "INR"}
            if clean(r.get("capacity")):
                item["capacity"] = int(r["capacity"])
            if r["id"] in slots_by_item:
                item["slots"] = slots_by_item[r["id"]]
            items.append({k: v for k, v in item.items() if v is not None})
        self.s3_json("config/highlights/catalog.json", {"version": 1, "categories": cats, "items": items})

    def participants(self, ws):
        for r in sheet_rows(ws):
            nights = [d.strip() for d in str(r.get("lodging_nights") or "").split(",") if d.strip()]
            self.put({"pk": "REG", "sk": r["reg_id"], "name": r["name"], "competitionId": r["competition_id"],
                      "gender": r["gender"], "nights": nights, "needsLodging": yn(r.get("needs_lodging")),
                      "status": clean(r.get("status")) or "confirmed",
                      "coupleGroupId": clean(r.get("couple_group_id")), "notes": clean(r.get("notes"))})

    def rooms(self, ws):
        for r in sheet_rows(ws):
            nights = sorted(d.strip() for d in str(r["available_nights"]).split(",") if d.strip())
            frm = nights[0] if nights else ""
            last = nights[-1] if nights else ""
            to = (last[:8] + f"{int(last[8:]) + 1:02d}") if last else ""
            self.put({"pk": "ROOM", "sk": r["id"], "hotelName": r["hotel_name"], "roomLabel": r["room_label"],
                      "type": r["type"], "capacity": int(r["capacity"]), "doubleOccupancy": yn(r.get("double_occupancy")),
                      "availability": {"from": frm, "to": to, "nights": nights},
                      "contactPhone": clean(r.get("contact_phone")), "propertyId": clean(r.get("property_id")),
                      "amenitiesNote": clean(r.get("amenities_note")), "status": clean(r.get("status")) or "active"})

    def volunteers(self, wb):
        shifts_by_phone = {}
        for r in sheet_rows(wb["10. Volunteer Shifts"]):
            shifts_by_phone.setdefault(clean(r["volunteer_phone"]), []).append({
                "id": r["shift_id"], "date": str(r["date"])[:10], "zone": r["zone"], "role": r["role"],
                "startsAtSec": epoch(r["date"], r["start_time"]), "endsAtSec": epoch(r["date"], r["end_time"])})
        for r in sheet_rows(wb["9. Volunteers"]):
            phone = clean(r["phone"])
            if not self.args.no_users:
                sub = self.ensure_user(phone, ["volunteer"], r["name"])
            else:
                sub = phone
            if not sub:
                continue
            self.put({"pk": "VOL", "sk": sub, "sub": sub, "name": r["name"], "team": r["team"],
                      "idVerified": yn(r.get("id_verified")), "shifts": shifts_by_phone.get(phone, [])})

    def stalls(self, ws):
        for r in sheet_rows(ws):
            if self.args.no_users:
                continue
            sub = self.ensure_user(r.get("vendor_phone"), ["partner"], r["stall_name"])
            if not sub:
                continue
            rules = [s.strip() for s in str(r.get("rules_en") or "").split(";") if s.strip()]
            rules_hi = [s.strip() for s in str(r.get("rules_hi") or "").split(";") if s.strip()]
            self.put({"pk": "STALL", "sk": sub, "stallName": r["stall_name"], "category": r["category"],
                      "stage": r["stage"], "allocationLabel": clean(r.get("allocation_label")),
                      "feeInr": int(r["fee_inr"]) if clean(r.get("fee_inr")) else None,
                      "paid": yn(r.get("paid")), "analytics": [], "rules": rules, "rulesHi": rules_hi})

    def hospitality(self, ws):
        for r in sheet_rows(ws):
            if self.args.no_users:
                continue
            sub = self.ensure_user(r.get("manager_phone"), ["partner"], r["hotel_name"])
            if not sub:
                continue
            self.put({"pk": "HOSP", "sk": sub, "hotelName": r["hotel_name"], "tier": r["tier"],
                      "complimentaryRooms": int(r["complimentary_rooms"]) if clean(r.get("complimentary_rooms")) else 0,
                      "allocations": []})

    def users_roles(self, ws):
        for r in sheet_rows(ws):
            if self.args.no_users:
                continue
            self.ensure_user(r["phone"], [r["role"]], r["name"])

    def fly_status(self, ws):
        for r in sheet_rows(ws):
            self.put({"pk": "FLYSTATUS", "sk": "current", "state": r["state"],
                      "reasonEn": clean(r.get("reason_en")), "reasonHi": clean(r.get("reason_hi")),
                      "updatedAt": int(datetime.now(IST).timestamp()), "refundsAutoQueued": yn(r.get("refunds_auto_queued"))})

    def run(self):
        wb = openpyxl.load_workbook(self.args.workbook, data_only=True)
        print(f"table={self.table_name} bucket={self.bucket} pool={self.pool} users={not self.args.no_users}")
        self.venues(wb["2. Venues"])            # first: builds venue_id -> name
        self.tiers(wb["1. Ticket Tiers"])
        self.schedule(wb["3. Cultural-Night Schedule"])
        self.catalog(wb)                         # categories + items + slots -> CDN
        self.participants(wb["7. Competition Participants"])
        self.rooms(wb["8. Rooms Inventory"])
        self.volunteers(wb)                      # volunteers + shifts (+ Cognito)
        self.stalls(wb["11. Partners - Stalls"])
        self.hospitality(wb["12. Partners - Hospitality"])
        self.users_roles(wb["13. Users & Roles"])
        self.fly_status(wb["14. Fly Status (initial)"])
        print(f"done: {self.put_count} DynamoDB items, {len(self.sub_by_phone)} Cognito users")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", default=os.path.join(HERE, "data-collection", "Bir_Festival_2026_Data_Collection.xlsx"))
    ap.add_argument("--no-users", action="store_true", help="skip Cognito user creation (and console rows that need a sub)")
    ap.add_argument("--dry-run", action="store_true")
    Importer(ap.parse_args()).run()


if __name__ == "__main__":
    main()
