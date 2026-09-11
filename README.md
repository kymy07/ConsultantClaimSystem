<div align="center">

# Consultant Claim System

**Invoice Timesheet &amp; Personnel Time Sheet generator · PDF · Excel · Word**
Fill the form once, tick the calendar, download all four documents.

[![Live](https://img.shields.io/badge/Live-uzma--geospatial--ai.github.io%2FClaimConsultant-F26522?style=for-the-badge&logo=githubpages&logoColor=white)](https://uzma-geospatial-ai.github.io/ClaimConsultant/)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2F5597?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/Uzma-Geospatial-AI/ClaimConsultant/actions)
[![Build](https://img.shields.io/badge/Build-none%20required-1F3864?style=for-the-badge)]()
[![Offline](https://img.shields.io/badge/Runs%20offline-after%20sign--in-F26522?style=for-the-badge)]()
[![Dependencies](https://img.shields.io/badge/npm%20install-not%20needed-2F5597?style=for-the-badge&logo=npm&logoColor=white)]()

### 🔗 **[uzma-geospatial-ai.github.io/ClaimConsultant](https://uzma-geospatial-ai.github.io/ClaimConsultant/)**

<img src="assets/img/preview.png" alt="The invoice step — a fillable copy of the invoice itself" width="100%">

</div>

---

## Overview

A static web app for consultants who invoice monthly. Enter your details once, tick the days
you worked on a calendar grid, and the app generates the two documents finance asks for — in
four file formats — straight from the browser.

No server, no build step, no `npm install`. Every library is vendored into `vendor/`, so the
whole thing runs from a single folder on any machine.

The one thing that needs the network is the front door: everybody who sends a claim has a **BDOS**
account and signs in with it. After that the session lasts 30 days and the app works with the
network unplugged.

A consultant sees their own profile, their own rows and their own filed copies. The administrator
and the three approvers see everybody's — an approver who cannot read what they are signing is no
use. That filtering is drawn in the browser today and needs enforcing server-side; see
[the endpoint notes](docs/BDOS-CCS-Endpoints.md#a-consultant-sees-their-own-work-only--and-that-needs-enforcing-here).

---

## Documents Generated

| # | Document | Formats | Output file name |
|---|---|---|---|
| 1 | **Claim** — Uzma Personnel Time Sheet | PDF · Word | `Claim Aug 2026 - Name.pdf` / `.docx` |
| 2 | **Invoice Timesheet** | PDF · Excel | `2026-01-003 - Name.pdf` / `.xlsx` |

Both PDFs are laid out to match the official templates: the invoice in portrait with the navy
header band, the time sheet in landscape with Sections A, B and C, the notes block and the
Uzma footer.

---

## Signing In

The app is for five people, so the door is a **BDOS** account
(`https://bdos.uzmadigitalearth.app`) plus the list in
[`assets/js/auth.js`](assets/js/auth.js), which also says what each of them does with a claim:

```js
const ROLES = {
  'adlishah0821@gmail.com':          'consultant',
  'nuramilazulfa@gmail.com':         'consultant',
  'hanis.rashidan@uzmagroup.com':    'manager',
  'fadhli.jamaluddin@uzmagroup.com': 'boss',
  'fatin.zaini@uzmagroup.com':       'pa'
};
```

A consultant fills claims in; the manager, the HOD and the PA only read and sign, so the wizard is
not even drawn for those accounts — they get the Approvals queue and nothing else. The `admin`
prepares claims like a consultant **and** can move any claim at any stage, including approving or
rejecting everything waiting in one go: somebody has to be able to finish a month when the project
manager is on leave and the HOD is on a plane.

| | |
|---|---|
| **Who checks the password** | BDOS. This app never sees, stores or transmits it anywhere else |
| **What comes back** | a JWT valid for **30 days**, kept in `localStorage` under `ccs.token` |
| **On every visit after** | the stored token opens the app immediately, and BDOS is asked to confirm it in the background |
| **Offline** | a valid token still opens the app — a dead network never locks you out |
| **Signing out** | discards the token; BDOS has no logout endpoint because the token is stateless |
| **Password resets** | there is no self-service reset — a BDOS administrator sets a new one |

The allow-list is applied twice: once to what was typed, and again to the address BDOS itself
confirms, so an account that is not on the list cannot get in with a valid password.

> **This gate says who is at the keyboard — it is not a lock on the data.** Everything it hides
> is HTML and JavaScript the browser has already downloaded, and anyone with the folder can
> open `index.html` directly. It is the right size of lock for a tool whose data never leaves
> your own browser; it is *not* what would protect a shared database. See
> [Data Storage](#data-storage).

---

## The Flow

```
Step 1  Profile ──▶ Step 2  Pick a document ──┬─▶ A    Claim Form ───────────┐
                                              ├─▶ B    Invoice ──────────────┤─▶ Generate ─▶ Submit ─▶ Status
                                              └─▶ A+B  Claim Form + Invoice ─┘
```

| Choice | Steps you see | You get |
|---|---|---|
| **A** Claim Form | Claim Form · Generate · Submit · Status | PDF + Word |
| **B** Invoice Timesheet | Invoice · Generate · Submit · Status | PDF + Excel |
| **A + B** Both | Claim Form · Invoice · Generate · Submit · Status | PDF + Word + Excel |

**The time sheet comes before the invoice**, everywhere. It is the evidence and the invoice is
the bill that follows from it: the days are counted, then they are charged for. The other order
asked somebody to price a month before saying which days of it they had worked.

**Generate** downloads the files and nothing else. **Submit** sends them away. They used to be one
screen, and they are two different decisions: generating happens several times while a month is
still being argued about, submitting happens once and cannot be taken back. The Submit step is a
summary of what is about to go — who, which month, which invoice number, how much, and anything
wrong with it — and then one button.

**A month is two documents, and they go separately.** The invoice is a bill; the time sheet is
the evidence for it. Submit asks which of them goes, so a sheet that is ready need not wait for
an invoice still being argued about, and each carries its own status the whole way — the project
manager can be happy with one and not the other, and say so. Both halves of one month carry the
**same** invoice number: it identifies the claim, not the document.

Step 3 onwards is not a form *about* the document — it **is** the document. The invoice step
draws the invoice with its navy band, BILL TO bar, item table and totals; the Claim step draws
the Uzma time sheet with Section A, the 31-column Section B grid and the Section C approval
block. Every entry sits exactly where it will print, and every empty box carries a hint of what
belongs in it, so nobody has to guess what goes where.

<img src="assets/img/preview-choose.png" alt="Step 2 — choosing which document to produce" width="100%">

Your details from step 1 appear inside both documents and stay in sync: edit the name on the
invoice and step 1 updates too. You cannot leave step 1 without a name or step 2 without a
choice; everything after that is optional, and the stepper stays clickable so you can change
your mind at any time.

Because the invoice period decides its own month, choosing **A** alone never asks you to touch
the timesheet. Choose **A + B** and setting the period pulls the timesheet to the same month —
unless you have already ticked days, in which case your ticks win.

A claim is for one month, and that month is written in four places: the **Month / Year** boxes,
the **Assignment Period** line above them, the invoice period, and the year inside the invoice
number. They are one fact, so they are kept as one: set any of them and the rest follow.
Assignment Period accepts whatever people actually write there — `Sep-26`, `September 2026`,
`2026-09` — and anything that is not a month (`Aug-Sep 26`, written on purpose) is left alone.

The month also fills itself in. An untouched sheet opens with **every working day ticked** and
the **Selangor public holidays marked PH**, because that is what almost every month is; the
weekend labels itself from the calendar as it always did. One click on any cell and the sheet
stops being automatic — it is the consultant's now, and changing the month afterwards will not
rewrite their corrections. **Fill the month in** does it again on demand, and **Clear all ticks**
hands it back to the calendar.

<img src="assets/img/preview-claim.png" alt="The Claim step — the Uzma Personnel Time Sheet, fillable" width="100%">

---

## Features

| | |
|---|---|
| 🔐 **BDOS sign-in** | Two named accounts, checked against the BDOS auth API; the 30-day session then opens the app offline |
| 🗄️ **Shared history, when BDOS offers it** | Profiles, the open draft, every submitted claim and the signed copies go to the `cradle` database through BDOS &mdash; and the app works exactly as before when it cannot reach them |
| 🧭 **Guided, branching flow** | Fill your details once, then pick **A** (Invoice), **B** (Claim) or **both** — the remaining steps rearrange so you only ever see the document you asked for |
| 📄 **You fill the real document** | Steps 3 and 4 are pixel-shaped copies of the invoice and the Uzma time sheet, so every value is typed exactly where it prints |
| 💡 **A hint in every box** | Each blank carries an example of what belongs in it, and optional fields say so outright |
| 📅 **Tickable day grid** | Section B is the real 31-column table — click a cell to cycle `blank → / → PH → PTO → MC → UL`; Saturdays and Sundays label themselves from the calendar |
| 💰 **Paid days decide the money** | Every day of the month is paid or it is not. Worked `/`, the weekend, `PH`, `PTO` and `MC` are paid and add up to TOTAL DAYS [A]; `UL` is not, and neither is a working day nobody marked — so the month's pay is `rate ÷ days in month × paid days`, and unpaid leave shows up in the figure without anybody working it out |
| 🧮 **Leave that carries itself forward** | `PTO` and `MC` are 12 days a year each. `UL` has no allowance — nobody is paid for an unpaid day, so there is nothing to ration — and it is counted and shown but can never be "over". Nobody types last month's figure any more: what earlier months used is added up from the months that have actually been submitted, keyed by month so resubmitting a returned claim costs nothing. A row per kind — under the grid, and on the profile card before you open it — shows this month, the year so far and what is left. **An allowance that is spent stops being offered**: the day cell skips straight past it rather than letting somebody claim a thirteenth day and be told afterwards |
| 🪪 **Profiles in unique-ID order** | The ones with an ID first, in ID order, and the ones without last. A profile with no ID cannot produce an invoice number, so it is a job still to do — and it belongs where it gets noticed rather than scattered through the alphabet |
| 🔒 **Three fields the office sets** | The **unique ID**, the **claim count** and the **account** a profile belongs to are the administrator's. One person deciding they are 07 is how two people end up both being 07 — so everybody else can read them and see why they are what they are, and change none of them |
| 🚧 **Step 1 has to be finished** | A name, a unique ID, a monthly rate and a signature, or nothing goes further. The monthly rate starts **empty** rather than at a figure nobody reads. And an edit that has not been saved holds the step too: **Next** is not offered while there is a reason it would be refused, and says which — a draft is not a profile, and details typed in and never saved came back blank the next month |
| ↩️ **A rejection is a job, not a status** | When something you sent is sent back, a **Re-submit** tab appears by itself — the step straight after Submit — with a number on it and the reason in the approver's own words. The document it is about opens itself: reject the invoice and the invoice is what is loaded, ready to edit **in the card itself** — the step that draws it is moved into the card and moved back afterwards, so fixing one number is not a trip to another screen and back with the reason left behind. Fix the one thing, send it round again, and what goes up is the form as it stands rather than the stored copy the approver already rejected. It never opens over the top of work that is not about it: another month, another person, or an unsaved edit, and the choice stays with you |
| 🖊️ **The PA signs the time sheet, and only that** | The last stage exists to place the HOD's signature, and an invoice does not carry one. So an invoice never lands in the PA's queue and that column reads *not applicable* rather than *waiting* — a bill waiting on a signature that does not exist is a bill waiting for ever |
| 📥 **Download all, for whoever collects the forms** | The `finance` account approves nothing and prepares nothing — it collects. So it gets one screen, **Documents to collect**: every signed form on file, for everybody, and a **Download all** that saves each one named for the person and the month rather than for whatever the scanner called it. A queue of decisions that will never be yours to make is not information, it is furniture |
| ✍️ **One signature, kept on the profile** | Draw it once, or upload a scan — **PDF**, PNG or JPG. A scan is a whole page, so the app finds the ink on it, puts a box round what it found, and shows a preview of exactly what will be kept; drag a different box if the guess was wrong. From then on it prints itself into the PERSONNEL box on the Claim form and onto the Invoice. The PDF reader is a third of a megabyte and is fetched only when somebody actually uploads one |
| 📅 **Public holidays it already knows** | The Selangor calendar ships with the app. Fixed dates are worked out for any year; the movable ones — Raya, Thaipusam, Deepavali, the Agong's birthday — are gazetted a year at a time and are written down in [`holidays.js`](assets/js/holidays.js). A year the table does not know still gets its fixed dates and **says so on the page** rather than pretending there are none |
| 🔢 **Invoice numbers that write themselves** | `2026-01-003` is the year, the person, and the third claim they have sent. The middle is the profile's **Unique ID** — its own field on the Profile step, highlighted, because without it there is no number and the app will not guess a digit that would put two people on one series. The count goes up by one each time a claim is submitted, and follows the person rather than the form. Typing your own number over it is allowed, and the page says so |
| 🗃️ **The signed copies, on file** | Everything else the app keeps is the claim as software holds it. The **Status** step also takes the paper: upload the signed invoice and the signed time sheet once they come back, and they are filed against that person and that month in the shared database. Any month can then be produced again a year later without hunting through anybody's Downloads folder |
| 🧮 **One way of pricing a month, shown as it works** | The monthly rate less the days that are not paid for, and the live formula line spells the sum out. There is nothing to choose: a calculation method used to be a dropdown of three, two of which were never picked. A month settled at some other figure is typed straight over the amount, which is a clearer way of saying "not the usual" than switching the sum off |
| 📅 **Dates that keep up** | The three dates in section C are today's, every time the form is opened — a claim started on the 9th and sent on the 11th is dated the 11th. Type a different one and it stays; empty it and it goes back to being today's. A date somebody signed against is a fact and is never moved |
| ✍️ **Sign in the signature box** | The four pads (Personnel, Project Manager, HOD, Verified By) sit inside Section C where the pen would go; blank space around the stroke is trimmed before it is embedded |
| ✅ **Three stages, in order** | A submitted document goes to the project manager, then to the HOD, and the HOD's signature is placed by their PA. Each approver reads it as it will be printed, signs their own box or sends it back with a reason, and every move is recorded against a name and a time |
| 🚦 **A status table that starts from the people** | Everybody with a profile gets a row per document for the month you are looking at, **whether or not they have sent anything** — because "has Amila sent September yet" is the question that gets asked, and a list of what was sent can never answer it. Then five lights, in the order they happen: **Sent · Reviewed · Approved · Signed · On file**. Green done, amber waiting here now, red sent back from here, blank not yet. Pick another month from the same row of controls |
| 🧑 **Every column says whose it is** | "Reviewed" tells nobody anything; **Reviewed / Muhammad Hanis Rashidan** tells them who to go and ask. Each heading names the person who holds that stage, and each light says who actually moved it and when — usually the same person, occasionally the admin standing in |
| 🗄️ **A History tab, for the administrator** | Status answers "where is this month". History answers "where is last March": every signed copy ever filed, for everybody, grouped by month and filtered by person or year. Only the admin account is offered it |
| 📱 **Works on a phone** | The four people who approve a claim read it on whatever is in their hand. The status table becomes a card each below 700px, every ordinary field is 16px so iOS does not zoom in and stay there, tap targets are 40px, and the notch does not sit over the top bar. The two document replicas keep their printed geometry and scroll sideways instead — shrinking those would mean the thing on screen was no longer the thing that prints |
| 🖊️ **The PA signs, on screen or on paper** | The last stage is the PA's, and their whole job is the signature. Draw it in the app, or — when it was signed on paper, in a room, with a pen — upload the finished document instead. Either finishes the month, and the uploaded one goes straight onto the Signed copies list |
| 🖋️ **Approval block starts filled** | Section C opens with the usual names and today's date already in place — every one is a normal field, so type over it when somebody else signs |
| 🏷️ **Official artwork, placed to the millimetre** | The Uzma wordmark ships with the app and is positioned from proportions measured off the printed form, not eyeballed |
| 👁️ **View before you download** | **View PDF** renders the finished document in the browser's own PDF viewer &mdash; check it, then download from inside the viewer or close and keep editing. Nothing reaches the disk until you say so |
| 🗂️ **Multiple activity rows** | Eight rows like the original form, each with its own Job ID, allocated days and past claim |
| 📊 **Totals that add up** | `TOTAL DAYS [A]`, `ALLOCATED [B]`, `PAST CLAIM [C]` and `BALANCE [B-(A+C)]` are computed per row and in aggregate |
| 💾 **Autosave + profiles** | Everything persists to `localStorage`; save one profile per consultant and switch between them. **Save Profile** sits at the foot of the details it saves, not in the top bar a screenful away. The profile list gives every profile its own row &mdash; the name opens that profile's details in the form, **Delete** removes that one, and **+ Add new profile** clears the form for another consultant |
| 🗑️ **The administrator can delete a claim** | Not part of the process — a claim that was wrong is sent back, not erased, and the trail of who approved what is the point of the trail. It is for the rows left behind while the thing was being set up, which look exactly like real ones. Admin only, with a confirmation that names the document, the month and the number, because that is where the difference is |
| 🧨 **Reset All** | Two-step confirmation, then every stored key is wiped and the app is empty again |
| 📱 **Responsive** | Collapses to a single column below 840px, and to phone-shaped below 700px — see [On a Phone](#on-a-phone) |

---

## On a Phone

Four of the five people who touch a claim only ever approve one, and they do it on whatever is in
their hand. So the parts they use work at 360px before anything else does:

- The **status table becomes a card each** below 700px — name, document, the five lights in a
  row with their labels under them, then the buttons. No horizontal scrolling to find out whether
  something is waiting on you.
- **Every ordinary field is 16px** on a small screen. Below that, iOS Safari zooms the page in
  when a field takes focus and never zooms back out, which is the single most common way a form
  becomes unusable on an iPhone.
- **Tap targets are 40px**, the top bar stacks, and the stepper scrolls sideways with momentum.
- The **notch** is kept out of the way with `env(safe-area-inset-*)`, and pinch zoom is never
  disabled — `maximum-scale` locks out the people who need it most.
- iOS Safari will not render a PDF inside an iframe; it shows one blank page. The viewer says so
  on a small screen and points at **Open in new tab**, which does work.

The two **document replicas** are the exception, deliberately. They are the printed page at its
printed size, and they scroll sideways rather than reflow — a replica that rearranged itself to
fit a phone would no longer be showing you where each value lands on the paper, which is the
entire reason it is a replica. Filling one in on a phone is possible; it is not pleasant, and it
was never meant to be.

---

## Tech Stack

**Frontend** — HTML5 · CSS3 (custom properties, grid, flexbox) · vanilla JavaScript (ES6+)
**PDF** — jsPDF 2.5.1 + jsPDF-AutoTable 3.8.2
**Excel** — ExcelJS 4.4.0
**Word** — docx 8.5.0
**Typeface** — Carlito (SIL OFL), metrically identical to Calibri
**PDF reading** — pdf.js 3.11.174 (Apache-2.0), loaded on demand for scanned signatures
**Signatures** — signature_pad 4.1.7 · Canvas 2D
**Downloads** — FileSaver.js 2.0.5
**CI** — GitHub Actions (Node 20 · 22)

No bundler, no framework, no dependencies to audit at runtime.

---

## Project Structure

```
ConsultantClaimSystem/
├── index.html                    # the whole UI — the document replicas live here
├── assets/
│   ├── css/style.css             # design tokens + every component
│   ├── img/                      # logo-uzma.png + README screenshots
│   └── js/
│       ├── auth.js               # the BDOS sign-in gate + allow-list
│       ├── sync.js               # profiles / draft / claims → the cradle DB, via BDOS
│       ├── state.js              # data model, formulas, localStorage
│       ├── holidays.js           # the Selangor public holiday calendar
│       ├── logo.js               # brand artwork loading + vector fallbacks
│       ├── timesheet.js          # Section B — the 31-column day grid
│       ├── signature.js          # in-form signature pads + image trimming
│       ├── gen-invoice.js        # Invoice → PDF (jsPDF) + Excel (ExcelJS)
│       ├── gen-claim.js          # Claim   → PDF (jsPDF) + Word (docx)
│       ├── preview.js            # the on-screen PDF viewer
│       ├── approvals.js          # the status table and the decisions
│       ├── archive.js            # the signed copies, the History step, Download all
│       ├── resubmit.js           # what came back, and putting it right
│       └── app.js                # step flow, profiles, generate buttons
├── docs/
│   └── BDOS-CCS-Endpoints.md     # the storage API this app asks BDOS for
├── test/
│   ├── page.test.js              # markup + stylesheet: what a fake DOM cannot see
│   ├── auth.test.js              # who may sign in, and what happens next
│   ├── sync.test.js              # the database sync, and how it degrades
│   └── generate.test.js          # generates all four docs and checks them
├── vendor/                       # pinned libraries, committed for offline use
│   ├── carlito.js                # the Calibri-metric typeface, subset for this form
│   ├── Carlito-OFL.txt           # its licence
│   ├── pdf.min.js                # pdf.js — reads a signature off a scanned PDF
│   ├── pdf.worker.min.js         # its worker; both fetched only when one is uploaded
│   └── pdfjs-Apache-2.0.txt      # its licence
└── .github/workflows/ci.yml      # lint + tests on Node 20 & 22
```

---

## Getting Started

The app is live on GitHub Pages — nothing to install:

**<https://uzma-geospatial-ai.github.io/ClaimConsultant/>**

That is the one to use. A second copy is published from the personal mirror at
<https://kymy07.github.io/ConsultantClaimSystem/>; it is the same app, but the two have separate
`localStorage`, so work saved at one address is not visible at the other.

It runs entirely in your browser there too: nothing is uploaded, everything stays in that
browser's `localStorage`. To keep a copy on your own machine instead:

```bash
git clone https://github.com/Uzma-Geospatial-AI/ClaimConsultant.git
cd ClaimConsultant
```

Then just double-click `index.html`. That is the whole setup.

To serve it over HTTP instead:

```bash
python -m http.server 8000
```

Then open <http://127.0.0.1:8000/>.

> **Serving over HTTP matters when more than one person shares a computer.** Opened from
> `file://`, Chrome treats every local file as one origin, so two copies of this folder under
> the same Windows account share the same `localStorage`. Over HTTP each URL gets its own
> origin and the data stays separate.

---

## How the Amount Is Calculated

A month on a monthly rate is paid **in full**, and the days that are not paid for are taken off
it — which is how payroll states it, and how somebody reading the invoice checks it:

```
deduction = unpaid days ÷ days in the month × monthly rate
amount    = monthly rate − deduction
```

The divisor is the **calendar month** — 28, 30 or 31 — never a count of weekdays. A consultant on
a monthly rate is paid for the Sunday as much as for the Tuesday, so taking the weekend out of the
divisor would quietly cut the rate by three tenths. Which days are unpaid is the sheet's answer,
not the formula's: unpaid leave and a working day nobody marked are the only two that cost
anything (see `PAID_MARKS`). A month with nothing unpaid deducts nothing and pays the rate.


There is nothing to pick. The **Invoice** step shows the rate and the formula line, and the
formula line updates as you type.

| Situation | Formula |
|---|---|
| With a time sheet — the usual | `monthly rate − (unpaid days ÷ days in month × monthly rate)` |
| An invoice sent on its own, for a part month | `monthly rate ÷ days in month × calendar days in period` |

A **calculation method** used to be a dropdown of three. A daily rate was one of them: nobody
used it, and what it did do was let a month be priced at the days somebody happened to tick,
which is not what any of these contracts say. A fixed amount was another, and typing over the
amount in the item table already says the same thing more clearly — the app keeps what you typed,
says it has been typed over, and offers the calculated figure back. So both are gone, and a draft
saved while they existed has the method and the daily rate stripped on the way in.

There are two monthly cases because there are two situations. With a time sheet the sheet says
which days were paid for, so the deduction is real and is taken off the whole month. Without one
— an invoice sent alone, for a part month — there is nothing to deduct from and the period is all
there is, so the rate is spread across the calendar days it covers.

Worked examples, both from real invoices:

```
RM 3,500.00 − nothing to deduct: all 30 days of September 2026 are paid      = RM 3,500.00
RM 3,500.00 − (2 unpaid days ÷ 30 × RM 3,500.00) = RM 3,500.00 − RM 233.33   = RM 3,266.67
RM 3,500.00 ÷ 31 days (August 2026) × 8 calendar days (24–31 Aug)            = RM   903.23
```

The figure the sum arrives at is the starting point, not the last word: type over the first
item's amount and the app keeps what you typed, says it has been typed over, and offers the
calculated one back. A month settled at something else is a decision, and the form should not
argue with it.

Long values wrap rather than collide: an address wider than its column continues on the next
line and pushes the block down, instead of running into the Period column beside it.

The address is typed as two lines because it prints as two, so **Address (Line 1)** holds only
what the invoice can print on one — 66 mm, which is 46 characters at the 8.5 pt the invoice is
set in, measured with the PDF's own metrics. Type past that and the overflow moves to the front
of line 2 with the caret, breaking between words and never inside one, so you carry on typing
where the words went. `splitAddressLines()` in `state.js` holds the rule.

---

## Branding & Logos

The site header, the footer and the Claim PDF all read their artwork from `assets/img/`:

| File | Used by | Status |
|---|---|---|
| `logo-uzma.png` (or `.jpg` / `.svg`) | top-right of the Claim page, PDF and Word file | **ships with the app** |
| `logo-geospatial.png` (or `.jpg` / `.svg`) | site header + footer | drop yours in |

Drop a file in and it is picked up on the next reload — no code change. Where one is missing the
app falls back to a **typographic recreation** of that wordmark, so nothing renders blank. The
fallbacks are approximations; use the official artwork for anything you actually submit.

### Matching the printed sheet

Every value below was read out of the reference PDF itself — its font table and its own
drawing operators — or out of the Excel workbook it is printed from, rather than matched by
eye. The sheet prints to one scale in both directions, so a length taken from the workbook is
carried over as a share of the content width and holds on our A4 landscape page too:

| | Value | Where it came from |
|---|---|---|
| Typeface | Calibri / Calibri Bold | the PDF's embedded font table |
| Panel and header fills | `#F2F2F2` | the fill operator behind Section A, the day table head and Section C |
| Arrow and footer rule | `#ED7D31` | Office's *Orange, Accent 2* |
| Arrow size | 0.899 % × 0.909 % of the content width | 6.137 × 6.200 pt on a 682.32 pt sheet |
| Footer rule | 0.585 pt wide, 2.657 % of the content width tall | a stroked line, not a bar |
| Section C columns | 15.224 %, 27.458 %, 28.500 %, 28.817 % of the content width | the workbook's column breaks — C→K, K→Y, Y→AN, AN→BB |
| Section C rows | 34, 34, 80.15, 30 and 30 pt on a 1655.25 pt sheet | its row heights, heading rows through Date |
| Gap above Section C | 3.746 % of the content width | the four empty rows (62 pt) between the grid and (C) |
| `Project Code` | no rule under it | its cell, AY15:BB15, is the one field on the form with no bottom border |

Two of those are easy to get wrong by drawing what looks like a table. The label column is
**open** beside the two heading rows — the box starts at `PREPARED BY`, and the space to its
left is where the `(C)` marker sits, not a grey cell. And `Project Code` shares its line with
the profit centres but carries no rule of its own.

The Uzma wordmark is a separate matter: it is an image on the reference sheet, and its own
orange is `#F26522` — a different colour from the form's `#ED7D31`. Both are correct; they are
different things. The typographic fallback in `logo.js` keeps the brand orange.

**On the typeface.** The sheet is an Excel document set in Calibri, and a PDF that is not set
in Calibri does not read as the same form. Calibri belongs to Microsoft and cannot be shipped
in a public repository, so the app embeds **Carlito** — an open-licensed face drawn to be
metrically identical. Every glyph carries the same advance width, checked against the Calibri
on a Windows machine across both weights, so lines break and columns fill exactly as in the
original. It is subset to Latin-1, Latin Extended-A and the punctuation this form actually
meets, which brings two weights down from 1.3 MB to 240 kB.

Two deliberate differences remain. The reference is **US Letter** landscape and this app
renders **A4**, because A4 is what comes out of a Malaysian printer; every measurement above is
a fraction of the content width, so the proportions survive the change. And the day grid labels
*every* weekend in the month, not only those inside the claimed period — that is the app
filling the sheet in for you, and it is why the ticks are worth checking before you download.

### Placing the Uzma mark

Supplied artwork carries its own padding — the Uzma PNG is a 270 × 92 canvas around a wordmark
that is only 228 × 41, and the margin is not symmetric. Sized by that canvas, the mark prints at
roughly half scale and sits off-centre. So `loadLogo()` crops the transparent margin before
handing the image on, and every caller measures the mark itself.

The header then places it from proportions taken off the printed time sheet rather than from
guesswork:

| | Reference form (Letter landscape) | This app (A4 landscape) |
|---|---|---|
| Mark width | 58.57 pt — **8.583 %** of the content width | 8.583 % |
| Right edge | **0.725 %** of that width inside the margin | 0.725 % |
| Vertical | a shade below the centre of the orange arrow | same |

Because both are fractions of the content width, the header lands in the same place on A4 as it
does on the original Letter-size form, and the PDF, the Word file and the on-screen Claim page
all size the mark identically.

Site colours come from the Geospatial AI wordmark and live as CSS custom properties in
`assets/css/style.css`:

```css
--navy:#2c3e50;   --navy-deep:#223140;   --orange:#f1662a;
```

The generated documents keep the colours of the official templates instead, so re-theming the
site never changes what finance receives.

---

## Data Storage

The app has no server of its own, and it never holds a database password &mdash; a static page
downloaded by a browser has nowhere to hide one. Everything it stores by itself lives in
`localStorage`:

| Key | Contents |
|---|---|
| `ccs.current` | the form currently open, autosaved every 250 ms |
| `ccs.profiles` | every profile saved via **Save Profile** |
| `ccs.token` | the BDOS session token (30 days) |
| `ccs.user` | the signed-in name and email, to greet you and to re-check the allow-list |

Worth knowing:

- Data never leaves the browser on that computer.
- It is lost if you clear browsing data, switch browser or machine, or use a private window.
- The quota is roughly 5–10 MB; signatures (base64 PNG) take the most room. If the quota is
  exceeded the app raises a red warning instead of failing silently — export a JSON backup then.
- The shared database is the backup. When it is reachable the draft and every profile are
  already in `cradle`, and signing in on another machine brings them back; when it is not, this
  browser is the only copy.

### The shared database

Beyond the browser, the app keeps five things in the **`cradle`** PostgreSQL database &mdash;
**profiles**, **the draft that is open**, **a history of every claim sent**, **the claims
travelling through the approvals**, and **the signed copies that come back**. They are one
shared set of rows, so signing in on another laptop brings the work with you and nothing is lost
when a browser is cleared.

A browser cannot speak to PostgreSQL: it is a TCP wire protocol, not HTTP, and a public static
app could not be trusted with the password anyway. So the database stays behind BDOS, which
already authenticates these users, and the app reaches it over the same API as the sign-in.
Those endpoints live in the BDOS repository (`backend/app.py`, the *Consultant Claim System
storage* section) and are specified in [`docs/BDOS-CCS-Endpoints.md`](docs/BDOS-CCS-Endpoints.md)
&mdash; six routes under `/ccs/`, the tables behind them, and the allow-list that is enforced
there rather than here, because a check written in JavaScript is a check the reader can edit.

| Data | Where | Who sees it |
|---|---|---|
| Profiles | `ccs_profiles` | every account |
| The open draft | `ccs_drafts` | every account — one row |
| Claims sent | `ccs_claims` | every account |
| Claims being approved | `ccs_submissions` | every account |
| Signed copies | `ccs_archive` | every account — **not deployed yet** |

The archive is newer than the rest and BDOS has not shipped it. It is the one thing here that
**must not** switch syncing off when it 404s: drafts, profiles and approvals are a working system
without it, and taking them down because one newer feature is missing would be the archive
breaking the app it was added to. So the Status step says the archive is not switched on yet,
which is true, rather than "nothing filed", which would have somebody hunting for files that were
never uploaded.

**Until a BDOS build carrying those routes is deployed, none of this is on.**
[`sync.js`](assets/js/sync.js) probes
once at sign-in; a `404`, a `403` or an unreachable server turns syncing off for the session
without a word, and the app saves to `localStorage` exactly as it always has. That is also what
happens on a plane. Nothing in the app ever waits on a sync response, so a slow or broken
database cannot interrupt somebody filling in a form.

The mark this browser keeps is **the newest stored draft it has been shown**, and it is recorded
as the server timed it, not as this machine did. The two clocks are not the same clock, and comparing one against the other made a
server a few seconds ahead look like somebody else had saved something newer — so the app offered
to replace your form with your own work, on every reload. A stored draft that is the form already
on screen is not put to anybody either: there is nothing to choose between. And answering the
question settles it — meaning the mark as "the last thing this browser sent" was the same bug
wearing a different hat, because a reload with nothing typed sends nothing, so the mark never
moved and the same question came back every time.

When a draft is found in the database, it is adopted only when it cannot cost you anything:
silently if the form on screen is untouched, and otherwise only after asking, and only when the
stored draft is demonstrably newer than the last one this browser sent up. Work on your screen
wins by default. Because the draft is shared, the question names whoever saved it &mdash; it may
be one of the other two rather than your own other laptop.

### Where a claim starts

Step 1 is not a form, it is a question: whose claim is this. Each saved profile is a card carrying
the year's leave balance, so **`PTO 7` `MC 10` `UL 12`** is readable before anything is opened.
Opening one fills in everything downstream — the details, the bank account, the rate — and the
month's pay is worked out from that rate and the days that are paid for. That figure can be typed
over when a month is settled at something else; the app says so, and offers the calculated one
back.

Two numbers on the profile are not about this month at all. **Unique ID** is the person — the
middle of `2026-01-003` — and **Next claim number** is how many claims they have sent. Both live
on the profile because they belong to the person, not to whatever happens to be in the form; both
are ordinary fields, so somebody who sent three claims on paper before this app existed starts at
four by typing four. A profile with no unique ID has no invoice number, and the page says so
rather than inventing a digit that would put two people on one series.

### Approvals

A claim does not go straight to Finance. It travels:

```
  consultant          project manager        HOD              PA to the HOD
  ─────────────────   ────────────────────   ──────────────   ───────────────────
  fills it in     →   SIGNS it, then     →   approves     →   SIGNS the time
  submits it          approves               it (no            sheet → complete
                                             signature)
                          │                      │           (an invoice is
                          │                      │            finished here)
                          └──── sends back ──────┴──→ returned, with a reason
                                                        │
                                                        └─→ Re-submit tab
  signing means either: draw it in the app  ·  or upload the paper you signed
```

Each approver reads the document as it will be printed &mdash; the PDF is rebuilt from the
submitted form and opened in the same viewer the consultant used, and it is the document that was
sent, so an invoice opens as an invoice &mdash; and then signs their own box or sends it back.
**Nothing on that screen edits a claim**: one that came back is fixed by the consultant in the
form, not by the approver in the queue.

**Two of the three stages put a name to the document, and neither will pass one on without it.**
The project manager signs before it reaches the HOD, and the PA places the HOD's signature at the
end. Both can do it either way: drawn in the app where the document has a box for it, or signed
on paper and the scan uploaded back. The HOD is the exception &mdash; they approve, and sign
nothing themselves.

Only the time sheet is signed. An invoice carries one signature, the consultant's own, and
nobody in the queue adds to it &mdash; the project manager and the HOD approve a bill, they do
not sign it, so an invoice moves on with a decision and nothing else to upload.

Every scan is kept, labelled with the signing that produced it. The project manager's is a
*reviewed copy*; the PA's is the finished article, and only that one lights the **On file**
column.

The last stage is the PA's, and the signature is their whole part in it. They can draw it in the
app, or &mdash; when it was signed on paper, in a room, with a pen &mdash; upload the finished
document instead. Either finishes the month; the uploaded one also lights the **On file** column
and joins the Signed copies list, which is the record somebody actually needs when Finance asks
about September a year later.

The Status step shows one month. The **History** step &mdash; offered to the administrator
account and nobody else &mdash; shows every month: every signed copy ever filed, grouped by
month, filtered by person or year. Both are reporting screens, so neither is gated behind filling
a form in: opening the app to see whether somebody has sent September should not first ask you to
choose a document you are not going to produce.

Who each stage belongs to is written into the table rather than left to be remembered. The
heading names the person &mdash; **Reviewed / Muhammad Hanis Rashidan**, **Approved /
Gs. Mohammad Fadhli Jamaluddin**, **Signed / Fatin Zaini** &mdash; and each light says who
actually moved it, and when. Those names live in one place, [`auth.js`](assets/js/auth.js),
beside the accounts they belong to; the approval block on the Claim page starts from the same
list rather than a second copy of it.

Who may move a claim is decided by the stage it is at, and decided in BDOS, not here: the project
manager cannot approve in the HOD's place, nobody can approve twice, and the row is locked while
a decision is recorded so two approvers pressing at once cannot both move it. Every move is
appended to a history that is never rewritten &mdash; who, when, which way, and what they said.

The HOD does not sign anything themselves. They approve; their PA places the signature. That is
the arrangement the office already had, and the app follows it rather than arguing with it.

When a claim comes back signed, the two finished documents are filed on the same screen: **File
the signed copies**, under the profile that is open and the month on the sheet, so there is no
second place to type a name and a month and therefore no second place to get them wrong. Anything
over 12 MB is refused before it is read. The list underneath is every month anybody has filed,
newest first, filterable by person — which is the record somebody actually needs when Finance
asks about September a year later.

### One thing to remember when changing anything under `assets/`

GitHub Pages serves this page **and everything it loads** with `Cache-Control: max-age=600`. A
reload fetches the page again but keeps the old JavaScript for up to ten minutes, which looks
exactly like a fix that did not work — and costs an afternoon before anybody suspects the cache.

So every local file is loaded with a `?v=` stamp:

```html
<script src="assets/js/sync.js?v=20260911c"></script>
```

**Bump that stamp whenever you change a file under `assets/`.** It is one find-and-replace across
`index.html`, and it makes an ordinary reload pick up the whole set at once. `page.test.js`
refuses a local file without a stamp, or a set of files that do not share one.

---

## Testing & CI

```bash
node test/page.test.js        # 37 checks — the markup and the stylesheet
node test/auth.test.js        # 29 checks — the sign-in gate
node test/sync.test.js        # 38 checks — the database sync
node test/generate.test.js    # 73 checks — the arithmetic and the four documents
```

No `npm install`, and nothing touches the network. Three of the suites load the application
code into a Node VM behind a small browser stub.

`generate.test.js` carries most of the arithmetic. The invoice number and where a person's
count starts; Assignment Period parsed back into a month; leave carried forward out of the
months already submitted, counted once and never twice; an allowance that is spent skipping
itself when a day cell is clicked; and a month filling itself in — 21 working days in September
2026, Malaysia Day marked PH, the weekend left to the calendar, and one click making the sheet
the consultant's. It then produces all four documents and checks both the older arithmetic — the
invoice amount (RM 903.23), `TOTAL DAYS [A]`, `BALANCE`, the automatic SAT/SUN labels — and the files
themselves: size and magic bytes for each, that the Claim PDF really embeds Carlito, and that
the Invoice PDF does *not*, since it is not set in Calibri and should not carry a face it never
draws with. It also pins the template's grey and orange, so a change to either fails loudly
rather than quietly shipping a form that no longer matches the one finance receives.

`auth.test.js` puts a fake BDOS and a fake browser behind the gate — no network call, no real
password — and pins the rules that matter: only the two listed accounts get in, the address
BDOS confirms overrules the one typed, an expired token is dropped rather than trusted, a
valid one opens the app even with the network down, and signing out leaves nothing behind.

`page.test.js` is the odd one out: it reads `index.html` and `style.css` as text, because the
two worst bugs this app has had were invisible to a stubbed DOM. An overlay that sets its own
`display` beats the browser's `[hidden]{display:none}`, so `el.hidden = true` did nothing and
the sign-in gate sat over the unlocked app forever; and a form whose submit listener never
bound fell back to a native GET, putting a password in the URL. In a fake DOM both of those
pass. So this suite asserts that every overlay has its `[hidden]` rule, that the sign-in form
cannot submit natively, and that the scripts load in a workable order.

`sync.test.js` runs the sync against a stub BDOS, and its first assertion is the one that
matters most today: with the endpoints returning 404, syncing switches off, one probe is sent
and nothing else, and the app is left exactly as it was. It then checks that a draft is adopted
only when no work can be lost, that profiles converge in both directions, and that a recorded
claim carries the month as 1&ndash;12 rather than the 0&ndash;11 the form uses internally.

GitHub Actions runs all four on every push across Node 20 and 22, alongside a JavaScript syntax
check, a vendored-library check, and a scan that fails the build if a real IC number or bank
account number ever lands in the repository.

---

## Editing Guide

<details>
<summary><b>Changing the theme</b></summary>

Every colour is a CSS custom property in the `:root` block at the top of `assets/css/style.css`:

```css
--navy:#1f3864;   --orange:#f26522;   --blue:#2e5c99;
--ink:#1b2330;    --muted:#6b7686;    --line:#dde3ec;
```

The PDF generators keep their own copies as RGB triples (`NAVY`, `BAR`, `LBL` in
`gen-invoice.js`), because jsPDF cannot read CSS. Change both if you re-brand.

</details>

<details>
<summary><b>Changing who can sign in</b></summary>

The list is one object at the top of `assets/js/auth.js`, mapping each address to its part in a
claim (`consultant`, `manager`, `boss`, `pa`).

That object only decides what the app draws. The list that actually holds is BDOS's `CCS_ROLES`,
checked on every `/ccs/*` request, and both have to change together &mdash; see
[`docs/BDOS-CCS-Endpoints.md`](docs/BDOS-CCS-Endpoints.md).

Addresses are compared lower-case and trimmed, so case and stray spaces do not matter. Anyone
added here still needs a BDOS account — registration is invite-only, so ask a BDOS
administrator for a one-time PIN first. `test/auth.test.js` asserts the list is exactly two
names long; update that expectation when you add a third.

</details>

<details>
<summary><b>Changing the Bill To company</b></summary>

The defaults live in `defaultState()` in `assets/js/state.js`:

```js
company: {
  name:  'Geospatial AI Sdn Bhd',
  regNo: '200901001789 (844716-P)',
  addr1: 'Uzma Tower, No 2, Jalan PJU 8/8A',
  addr2: 'Damansara Perdana, 47820 Petaling Jaya, Selangor'
}
```

Anything typed in the **Bill To** tab overrides them for the current form.

</details>

<details>
<summary><b>Adding a field to the form</b></summary>

Three places, in order:

1. `index.html` — add the `<label><input id="..."></label>`
2. `state.js` — add the key to `defaultState()` so it survives a reload
3. `app.js` — add `['element_id', 'section', 'key']` to the `FIELDS` array

`mergeDefaults()` backfills the new key for anyone with older saved data, so nothing breaks.

</details>

<details>
<summary><b>Changing who approves Section C</b></summary>

Section C opens pre-filled so the common case needs no typing. The starting values live in
`SIGN_DEFAULTS` at the top of `assets/js/app.js`, and `fillDefaultsForMonth()` applies them
**only to fields that are still empty** — so nothing you have already typed is ever overwritten:

```js
const SIGN_DEFAULTS = {
  hod:      '…',   // the approver whose name appears under APPROVED BY
  verified: ''     // Group People & Finance sign on paper, so this stays blank
};
```

`PREPARED BY` follows your name from step 1, and both dates default to today. All six are
ordinary fields on the Claim page: type over any of them when a different person signs.

</details>

<details>
<summary><b>Adjusting the Claim form layout</b></summary>

`gen-claim.js` draws the time sheet with an explicit `y` cursor in millimetres on A4 landscape
(297 × 210). The vertical budget is tight — Section A, the day table, Section C, the notes and
the footer all have to fit on one page. If you add a row, take the height from `secH` or the
signature row rather than pushing the footer down.

Section C is not free-hand: `C_EDGE`, `C_ROW` and `C_GAP` at the top of the file hold its
column breaks, row heights and the gap above it as shares of the content width, straight from
the workbook. Change those and the PDF and the Word copy move together.

</details>

<details>
<summary><b>Rebuilding the Carlito subset</b></summary>

`vendor/carlito.js` is generated, not hand-written. To rebuild it — after adding a language
that needs more glyphs, say:

```bash
pip install fonttools
curl -sLO https://cdn.jsdelivr.net/gh/googlefonts/carlito@main/fonts/ttf/Carlito-Regular.ttf
curl -sLO https://cdn.jsdelivr.net/gh/googlefonts/carlito@main/fonts/ttf/Carlito-Bold.ttf

pyftsubset Carlito-Regular.ttf --unicodes="U+0020-007E,U+00A0-017F,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+20AC,U+2122" --layout-features='*' --no-hinting --desubroutinize
```

Base64 the result and drop it into the `REGULAR` and `BOLD` strings. Keep it as concatenated
string chunks — a raw newline inside a JavaScript string literal is a syntax error, and the
whole file is one `<script>`, so that mistake takes the app down with it.

Do **not** substitute Microsoft's `calibri.ttf`. It renders identically, but this repository is
public and the font is not redistributable.

</details>

<details>
<summary><b>Updating a vendored library</b></summary>

Drop the new UMD build into `vendor/` under the same file name and run the tests. The CI job
checks each expected file exists and is non-empty, so a rename will fail the build loudly
rather than silently break a download button.

</details>

---

## Contact

[![Email](https://img.shields.io/badge/Email-adlishah0821%40gmail.com-F26522?style=flat-square&logo=gmail&logoColor=white)](mailto:adlishah0821@gmail.com)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-adlishah--hakimi-1F3864?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/adlishah-hakimi-56325223a/)
[![GitHub](https://img.shields.io/badge/GitHub-kymy07-1F3864?style=flat-square&logo=github)](https://github.com/kymy07)

---

<div align="center">

**Adlishah Hakimi bin Sharilfuddin** · Malaysia

</div>
