# Bir Festival 2026 — data collection

`Bir_Festival_2026_Data_Collection.xlsx` is the workbook organizers fill with the
real festival content that seeds the app. One tab per data entity the app ingests
(ticket tiers, venues, schedule, highlights & competitions, lodging rooms &
participants, volunteers & shifts, partners, users & roles, fly-status, config).

Each tab has typed columns, `*` on required fields, English/Hindi pairs, dropdowns
for every enum, header-cell comments explaining each field, and a shaded example
row. The **Instructions** tab covers formats (dates `YYYY-MM-DD`, times `HH:MM`,
phones `+91…`), fill order, and the privacy rule (gender is lodging-only).

## Regenerate the template

```bash
python3 generate_template.py      # needs openpyxl
```

The field list mirrors the data model: `bir-backend/terraform/schema.graphql`
(AppSync types), `bir-backend/scripts/seed-test-data.sh` (DynamoDB item shapes),
and the app fixtures under `bir-mobile/src/features/**/__fixtures__/`.

## Next step (import)

A companion importer will read the filled workbook and write the rows into
DynamoDB (mapping human dates/times → epoch, resolving cross-sheet ids, and
creating Cognito users + role-group memberships for the **Users & Roles** tab).
Track it in `docs/BACKEND_ASKS.md`.
