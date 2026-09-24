# Storage endpoints for the Consultant Claim System

> **Status — implemented.** These routes live in the BDOS repository
> (`Uzma-Geospatial-AI/bdos`, `backend/app.py`, the *Consultant Claim System storage* section),
> with `backend/test_ccs.py` covering them. This document is the contract between the two
> repositories: change one side and this page says what the other expects.
>
> Every route on this page is live, including the archive, the per-account draft, `kind`, the
> per-person filtering and the administrator's delete. CCS still degrades gracefully against an
> older BDOS build — a `404` on the archive switches that one feature off and nothing else.

The Consultant Claim System (CCS) signs its users in against the BDOS auth API and needs somewhere
durable to keep their work. CCS is a static browser app: it has no server of its own and cannot
hold a database credential, so BDOS owns the storage and exposes it over the same authenticated
HTTPS API the sign-in already uses.

This document specifies the endpoints, the table shapes behind them, and the access rule that
is enforced server-side. It follows the conventions already set by the *BDOS Authentication API
Integration Guide*: `Bearer` tokens, JSON bodies, `{ "detail": "…" }` on error.

- **Base URL** — `https://bdos.uzmadigitalearth.app`
- **Auth** — every endpoint below requires `Authorization: Bearer <token>`; none are public
- **Namespace** — everything is under `/ccs/` so it cannot collide with existing BDOS routes
- **Target database** — the `cradle` PostgreSQL database (credentials supplied separately,
  out of band — they are deliberately not written down in this repository, which is public)

---

## 1 · The access rule (please enforce here)

Everybody who sends a claim has an account, and each has one part in it:

| Account | Role | What they do |
|---|---|---|
| `geospatial.ai@uzmagroup.com` | `admin` | Runs the app; prepares claims and can stand in at any stage |
| `adlishah0821@gmail.com` | `consultant` | Prepares their own claim and submits it |
| `nuramilazulfa@gmail.com` | `consultant` | Prepares their own claim and submits it |
| `zharif.zaidi@uzmagroup.com` | `consultant` | Prepares their own claim and submits it |
| `afifah.zamzari@uzmagroup.com` | `consultant` | Prepares their own claim and submits it |
| `nizar.tarmizi@uzmagroup.com` | `consultant` | Prepares their own claim and submits it |
| `hanis.rashidan@uzmagroup.com` | `manager` | Reviews it first, and signs it before it goes on |
| `fadhli.jamaluddin@uzmagroup.com` | `boss` | Approves it second — the HOD |
| `fatin.zaini@uzmagroup.com` | `pa` | Places the HOD's signature on the **time sheet**, in the app or on paper |

### A consultant sees their own work only — enforced here

CCS shows a `consultant` only their own profile, their own rows in the status table and their own
filed copies; the `admin` and the three approvers see everybody's, because an approver
who cannot read what they are signing is no use.

Filtering in the browser is not filtering: the rows still arrive over the wire and anybody who
opens the console can read them — and they carry an IC number, a home address and a bank account.
So the same rule is applied here, which is the one that holds:

| Endpoint | For a `consultant` | For everybody else |
|---|---|---|
| `GET /ccs/profiles` | profiles whose `data.consultant.email` is theirs, **plus any with no owner yet** | all |
| `GET /ccs/submissions` | only rows they created | all |
| `GET /ccs/submissions/{id}` | only rows they created — `404` otherwise, not `403` | all |
| `GET /ccs/archive` | rows they filed, or filed against a profile they own | all |
| `GET /ccs/archive/{id}` | the same, `404` otherwise | all |
| `GET /ccs/draft` | their own row | their own row |

A profile carries `data.consultant.email`, the address it belongs to, which CCS stamps when a
consultant saves one and the administrator can set from the Profile step. Profiles saved before
that field existed have no owner, and are shown to everybody rather than to nobody — hiding them
would have locked every consultant out of their own details on the day this shipped. They narrow
on their own as the administrator assigns them.

**The draft is one row per account.** A single shared row made sense for three people working one
claim at a time; with four consultants each filling in their own month they overwrote each other,
silently, and the loser found out by opening the app. `ccs_drafts.id` is now the owner's email
address. The old `'shared'` row is still handed back once, and only to whoever wrote it — their
work should not vanish because the storage changed shape, and nobody else's should appear in
front of them. It stops being read the first time they save.

BDOS reads the list from the `CCS_ROLES` environment variable — `email:role` pairs, comma
separated — and falls back to the table above, so adding somebody or moving them to another role
is an environment change and a restart, not a code edit.

The browser app already checks this list, **but that check cannot be trusted** — it is JavaScript
the user's own browser runs, and anybody can edit it. It is there to explain the door, not to lock
it. Please apply the same allow-list server-side on every `/ccs/*` route and return `403` for any
other valid BDOS token. That is the only place the rule actually holds.

The list also lives in `assets/js/auth.js` in the CCS repository, where it decides what the sign-in
page says. When somebody is added or removed, both change — but only this one is a lock. Being a
BDOS admin does not grant access here: these rows carry an IC number and a bank account, so the
list is the list.

| Situation | Expected response |
|---|---|
| No token, bad token, expired token | `401` — CCS clears the session and asks for a password |
| Valid BDOS token, not on the list above | `403` — CCS shows "not on the list for this app" |
| Valid token, on the list | `200` |

---

## 2 · What is shared, and what is private

This matters for the `WHERE` clauses, so it is worth stating plainly:

| Data | Visibility | Why |
|---|---|---|
| **Submissions** | shared | Four people move one document between them; an approver who cannot see what they approved last month is not much use |
| **Profiles** | shared, filtered | Reference data the approvers work from; a consultant should be shown only their own |
| **Claims history** | shared, filtered | Approvers see everything; a consultant sees what they sent |
| **Draft** | **should become one row per account** | Written for three people sharing one claim; five consultants each filling in their own month overwrite each other |
| **Archive** | shared | The signed copies of a finished month. Finance and the approvers all have reason to produce one later |

Everything is one set of rows: whoever signs in, on whichever machine, sees the same work. Nothing
is keyed by `uid`. The caller's email is still recorded on every write — `updated_by` on a profile
and the draft, `created_by` on a claim — so it is always visible who last touched something.

The one thing this costs: two people editing at the same moment overwrite each other, last write
wins. CCS pushes the draft at most once every five seconds and asks before replacing a form on
screen with a newer one from the database, which is enough for three people who are not filling in
the same claim simultaneously. If that ever stops being true, keying the draft by `uid` is a
`WHERE` clause.

---

## 3 · Endpoints

### Profiles

A profile is a saved set of consultant details, keyed by its name. Saving under an existing name
overwrites it — that is what CCS's **Save Profile** button already does locally.

```
GET    /ccs/profiles              → { "profiles": [ Profile, … ] }
POST   /ccs/profiles              → { "profile": Profile }
DELETE /ccs/profiles/{id}         → { "ok": true }
```

**`POST /ccs/profiles`** — upsert by `name`:

```json
{
  "name": "Ahmad bin Abdullah",
  "data": { "consultant": { "...": "..." }, "company": { "...": "..." } }
}
```

**`Profile`** as returned:

```json
{
  "id": 12,
  "name": "Ahmad bin Abdullah",
  "data": { "...": "the CCS state object, verbatim" },
  "updated_by": "geospatial.ai@uzmagroup.com",
  "updated_at": "2026-09-09T02:11:04Z"
}
```

`data` is opaque to BDOS — CCS owns its shape and will change it over time. Storing it as `jsonb`
and handing it back unaltered is all that is needed.

Errors: `400` if `name` is empty or `data` is not an object · `404` on delete of an unknown id.

### Draft — the form currently open

One row, shared, overwritten as anybody types. CCS sends it at most once every few seconds, not on
every keystroke.

```
GET /ccs/draft     → { "draft": { "data": {…}, "updated_at": "…" } }  or  { "draft": null }
PUT /ccs/draft     → { "ok": true, "updated_at": "…" }
```

**`PUT /ccs/draft`** body: `{ "data": { … } }`

`GET` must return `{ "draft": null }` (200, not 404) when nothing has been saved yet — CCS reads a
null draft as "nothing to restore" and keeps what is in the browser. A 404 reads as "the endpoint
is missing" and switches syncing off for the session, which is the opposite of what an empty
database should do.

The draft also carries `updated_by`, the email of whoever last saved it, so the app can say whose
work it is about to load.

### Claims history

Written once, when the user generates their documents. Rows are not edited afterwards.

```
POST /ccs/claims          → { "claim": Claim }
GET  /ccs/claims?limit=&before=  → { "claims": [ Claim, … ] }
```

**`POST /ccs/claims`** body:

```json
{
  "consultant":   "Ahmad bin Abdullah",
  "period_month": 8,
  "period_year":  2026,
  "invoice_no":   "INV-2026-08-026",
  "amount":       903.23,
  "documents":    ["invoice.pdf", "invoice.xlsx", "claim.pdf", "claim.docx"],
  "data":         { "...": "the full CCS state at the moment of generation" }
}
```

**`Claim`** adds `id`, `created_by` (the caller's email, from the token) and `created_at`.

**`GET /ccs/claims`** returns newest first. `limit` defaults to 50, caps at 200; `before` is an
`id` for paging. CCS only ever shows a recent list, so cursor paging is enough — no total count
needed.

Errors: `400` on a missing `consultant` or a non-numeric `amount`.

### Submissions — a document on its way through the approvals

A month is **two documents**, and they are not the same document: the invoice is a bill, the time
sheet is the evidence for it. Each is submitted separately, carries its own status, and is
approved or sent back on its own — an approver can be happy with the sheet and not with the
invoice, and say so, without holding up the half that was fine. So one row here is one document,
not one month.

Each is prepared, reviewed, approved and then signed, in that order. The order is kept here: the
client may ask for any move, and only the account whose turn it is can make it.

```
POST /ccs/submissions              → { "submission": Submission }
GET  /ccs/submissions?status=&mine= → { "submissions": [ Submission, … ] }   (no `data`)
GET  /ccs/submissions/{id}         → { "submission": Submission }            (with `data`)
POST /ccs/submissions/{id}/action  → { "submission": { id, status, history, updated_at } }
DELETE /ccs/submissions/{id}       → { "ok": true }                          (admin only)
GET  /ccs/me                       → { "email", "name", "role", "acts_on" }
```

| Status | Waiting on | Approving takes it to |
|---|---|---|
| `pending_manager` | `manager` | `pending_boss` |
| `pending_boss` | `boss` | `pending_signature` — **but see below for an invoice** |
| `pending_signature` | `pa` | `complete` |
| `returned` | the consultant who sent it | `pending_manager`, by `resubmit` |

**An approved invoice finishes at the HOD.** The last stage exists to place the HOD's signature,
and an invoice does not carry one — it has a single signature on it, the consultant's. Routing
one to the PA left a bill sitting in somebody's queue for ever, waiting on a thing that does not
exist. The `pending_boss` transition reads the row's `kind`:

```
approve at pending_boss  →  kind = 'claim'    →  pending_signature
                         →  kind = 'invoice'  →  complete
```

CCS keeps invoices out of the PA's queue as well, and draws that column as *not applicable*
rather than *waiting*. An invoice that reached `pending_signature` before the rule existed is
refused to the PA and can be closed by the `admin`, who acts at any stage.

**A claim finishes with the PA.** Nobody collects it afterwards, so there is no collecting role:
what a finished month leaves behind is read from the archive by the `admin`.

**`kind`** — `"invoice"`, `"claim"` or `"advice"`, sent on `POST /ccs/submissions` and returned by **both**
read endpoints, the list included. The list is the one that matters: it deliberately returns no
`data`, and a table of "whose September invoice is where" cannot be drawn from rows that do not
say which document they are.

`TEXT NOT NULL DEFAULT 'claim'`, added by an idempotent `ALTER` on boot: every row written before
a month was two documents was the whole claim, and the time sheet is the half that carries the
signatures. CCS also writes it inside `data.submitKind` and falls back to reading it from there,
so it works against a BDOS that predates the column.

**`DELETE /ccs/submissions/{id}`** — the `admin` account only: `403` for everybody else, `404`
for an id that is not there. It is deliberately not part of the process. A claim that was wrong
is **sent back**, not erased, and the trail of who approved what is the reason the trail exists.

What it is for is the rows that were never part of the process: the ones left behind while the
thing was being set up, which look exactly like real ones and sit in somebody's Re-submit tab for
ever. CCS shows the button to the `admin` and to nobody else, names the document, the month and
the number in the confirmation, and says plainly when the route is not there yet.

**`POST /ccs/submissions/{id}/action`** body: `{ "action": "approve" | "return" | "resubmit" | "reopen",
"note": "…", "data": { … } }`.

`data` is optional and is the whole form again — a step that signs sends the sheet back with the
signature in it, so BDOS never has to know where inside that object a signature lives. A
`resubmit` sends it too, and that one matters: a document that came back and was fixed has to
carry the fix, or the approver is handed the very document they rejected. `note` is
required by CCS on a `return`, since it is the only thing the consultant is told.

**`reopen` takes a closed month back to the PA.** It moves a `complete` time sheet or payment
advice back to `pending_signature` — where it was before the PA closed it — so a signed copy can be
added or replaced, and approving closes it again. The `pa` and the `admin` may do it; an invoice
never is, because it finishes at the HOD and has nothing on paper to add. `409` when the row is not
`complete`. The note says why, and goes into `history` with who did it.

**The `admin` acts at any stage**, including `resubmit` on a row it did not create. This is the
row in the table above spelled out for this endpoint: the office prepares claims for people, and a
consultant who is on leave, has left, or simply cannot be reached should not hold a month up.
Refusing it means a returned claim sits there until that one person comes back. `history` records
who actually pressed it, so standing in is visible rather than silent, and CCS says on the button
whose document is being sent.

Refusals are the point of this endpoint, so they are specific: `403` when the claim is waiting on
somebody else and the account is not the `admin`, `409` when it is not waiting on anybody (already
finished, or already moved on by whoever got there first), `404` when there is no such claim. The row is locked `FOR UPDATE` for
the length of a decision, so two approvers pressing at the same moment cannot both move it.

`history` is every move anybody made — `{ at, by, role, action, note, from, to }` — appended and
never rewritten. It is what makes an approval something you can point at afterwards.

Everyone can read every claim: five people working one process, and an approver who cannot see
what they approved last month is not much use. `mine=1` narrows to the claims this account sent;
`status=open` to everything unfinished.

### Archive — the signed copies of a finished month

> **Status — implemented.** The routes live in `backend/app.py` alongside the rest of `/ccs`.
> CCS still treats a `404` here as *not deployed* and says so on the Status step rather than
> pretending the archive is empty, so an older BDOS build breaks nothing.

Every other endpoint here holds the claim as software holds it. This one holds the paper: the
invoice and the time sheet with real signatures on them, scanned back in after the round trip
through the project manager, the HOD and their PA. A month is only really finished when those two
files exist somewhere other than one person's Downloads folder, and "somewhere" is here.

Rows are written once and read for years. They are not edited.

```
POST   /ccs/archive                → { "record": Record }
GET    /ccs/archive?consultant=&year=  → { "records": [ Record, … ] }   (no file contents)
GET    /ccs/archive/{id}           → { "record": Record }               (with file contents)
DELETE /ccs/archive/{id}           → { "ok": true }
```

**`POST /ccs/archive`** body:

```json
{
  "consultant":   "Ahmad bin Abdullah",
  "unique_id":    "01",
  "invoice_no":   "2026-09-003",
  "period_month": 9,
  "period_year":  2026,
  "kind":         "claim",
  "stage":        "pending_signature",
  "note":         "signed by the HOD on the 3rd",
  "files": [
    { "name": "invoice-signed.pdf", "type": "application/pdf", "size": 184320, "content": "JVBERi0…" }
  ]
}
```

`kind` is `"invoice"`, `"claim"`, or `null` for a record that covers the whole month — the Status
table lights an *On file* column per document, and needs it to say "the time sheet is back, the
invoice is not". Store it as `TEXT NULL` and return it on both read endpoints; a null one is read
as covering both, which is what every record written before this field meant.

`stage` says which signing produced it: `"pending_manager"` for the project manager's reviewed
copy, `"pending_signature"` for the finished one the PA places. Both are worth keeping and only
the second is the finished article, which is what the Status table's *On file* column asks about.
`TEXT NULL`, returned on both read endpoints; a null one is read as the finished article, since
that is all there was to file before the project manager signed anything.

`content` is the file's bytes, base64, without a `data:` prefix. CCS refuses anything over
**12 MB** before it reads it, and sends at most two files per record — but the shape is a list, so
a month that needed three attachments does not need a new endpoint.

**`Record`** as returned adds `id`, `created_by` (the caller's email, from the token) and
`created_at`. On the **list** endpoint each file is returned as `{ name, type, size }` with
**no `content`** — a year of scanned PDFs is not something to send down to draw a list with. The
single-record endpoint returns them in full; that is what a download button calls.

`consultant` and `year` are both optional filters. Newest first: `period_year DESC,
period_month DESC`.

Errors: `400` on a missing `consultant`, an empty `files` list, or a file whose `content` is not
base64 · `404` on a `GET` or `DELETE` of an unknown id · `413` if the server has its own size
limit and the body is over it.

Storing the bytes in the database column below is the simple option and is what the schema
assumes; putting them in object storage and keeping a URL in the row would work as well, so long
as the JSON above does not change. CCS does not know or care which.

Two notes on what lands here. These files carry a handwritten signature and a bank account, so
they are personal data in the same way the `data` blobs already are — same handling. And they are
the record of an approval that was actually given, which is the reason for the `DELETE`: it exists
for the case of the wrong file being uploaded, and should be reachable only by whoever created the
row or the admin.

---

## 4 · Suggested schema for `cradle`

Written as it would be applied. BDOS keeps to its own house style instead — flat `ccs_*` tables
that self-create on boot, `TEXT` ids from its own id generator, and epoch-millisecond `BIGINT`
timestamps rendered as the ISO strings below on the way out. CCS depends on the JSON above, not on
these column names.

```sql
CREATE SCHEMA IF NOT EXISTS ccs;

-- Shared: saved consultant details.
CREATE TABLE ccs.profiles (
  id          bigserial PRIMARY KEY,
  name        text        NOT NULL UNIQUE,
  data        jsonb       NOT NULL,
  created_by  text        NOT NULL,
  updated_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Shared: the one in-progress form.
CREATE TABLE ccs.drafts (
  id          text        PRIMARY KEY,   -- always 'shared'
  data        jsonb       NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Shared: what has actually been generated.
CREATE TABLE ccs.claims (
  id            bigserial   PRIMARY KEY,
  uid           text        NOT NULL,
  created_by    text        NOT NULL,
  consultant    text        NOT NULL,
  period_month  smallint    CHECK (period_month BETWEEN 1 AND 12),
  period_year   smallint,
  invoice_no    text,
  amount        numeric(12,2),
  documents     text[]      NOT NULL DEFAULT '{}',
  data          jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ccs.claims (created_at DESC);
CREATE INDEX ON ccs.claims (period_year DESC, period_month DESC);

-- Shared: claims travelling through the approvals.
CREATE TABLE ccs.submissions (
  id            text        PRIMARY KEY,
  consultant    text        NOT NULL,
  kind          text        NOT NULL DEFAULT 'claim',  -- invoice | claim
  period_month  smallint,
  period_year   smallint,
  invoice_no    text,
  status        text        NOT NULL,   -- pending_manager | pending_boss |
                                        -- pending_signature | returned | complete
  data          jsonb       NOT NULL,   -- the form, signatures and all
  history       jsonb       NOT NULL DEFAULT '[]',
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ccs.submissions (status);

-- Shared: the signed copies of a finished month.
CREATE TABLE ccs.archive (
  id            text        PRIMARY KEY,
  consultant    text        NOT NULL,
  kind          text,                                  -- invoice | claim | null = the month
  stage         text,                                  -- pending_manager | pending_signature
  unique_id     text,
  invoice_no    text,
  period_month  smallint    CHECK (period_month BETWEEN 1 AND 12),
  period_year   smallint,
  note          text,
  files         jsonb       NOT NULL DEFAULT '[]',   -- [{ name, type, size, content }]
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ccs.archive (consultant, period_year DESC, period_month DESC);
```

A note on what lands in `data`: it is the consultant's own name, address, IC number and bank
account, because those are what the invoice prints. The `cradle` rows are therefore personal data
and should sit behind the same handling as the rest of BDOS — this is exactly why CCS is asking
BDOS to hold them rather than trying to hold them itself.

---

## 5 · CORS

CCS is served from GitHub Pages, so the browser sends a cross-origin request. There are two
addresses it can come from — the Uzma organisation's copy, which is the one people use, and the
personal mirror it is developed on:

```
Origin: https://uzma-geospatial-ai.github.io
Origin: https://kymy07.github.io
```

The existing auth routes already answer with `access-control-allow-origin: *` and allow the
`authorization` and `content-type` headers, which is exactly what is needed. Please make sure the
`/ccs/*` routes inherit the same CORS handling, including the `OPTIONS` preflight — a missing
preflight response fails silently in the browser with no error message worth reading.

---

## 6 · Until these exist

CCS ships with the client half already written. On sign-in it calls `GET /ccs/draft` once; a `404`
or a network failure simply turns syncing off for that session and the app carries on saving to
the browser's own `localStorage`, exactly as it does today. So these endpoints can appear whenever
it suits BDOS — nothing breaks in the meantime, and nothing needs redeploying on the CCS side when
they do.
