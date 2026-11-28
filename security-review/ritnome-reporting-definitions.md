# Ritnome Progress View — reporting definitions (R1, 2026-11-28)

Every dashboard, printed report and CSV draws from the same two functions (`ritnome_rep_sessions_calc`, `ritnome_rep_runs_calc`) and the same period summary (`ritnome_rep_period`), so they reconcile by construction.

| Term | Definition |
|---|---|
| Facilitated session | A recreation session opened from Today's Session (parent id created automatically when the facilitator taps the first step) or a standalone launch from the library with no session open (one activity, source `standalone`). Counted when it has at least one non-abandoned activity run. Two sessions close in time are two sessions. |
| Activity run | One execution of one activity. Several runs belong to one facilitated session. |
| Participations | Cumulative over runs: one person in five activities counts five. |
| Headcount (session) | The largest headcount recorded in the session — people present — never the sum of the runs' headcounts. |
| Recreation minutes | Per session: from the first run's start to the last run's end. Overlapping runs (two stations) never add up twice. |
| Estimated participant-minutes (Minutos-participante estimados) | Sum over runs of run minutes × that run's headcount (two stations at once are two groups of people). Labeled as an estimate. |
| Activity variety | Distinct activities run in the period. |
| Active days | Distinct Puerto Rico dates with at least one run. |
| Unique participants | Only when the facility uses handles; labeled "tracked"; never implies every resident. |
| Planned sessions | Each Puerto Rico day contributes (weekly target in force that day) ÷ 7; summed over the period and rounded once. Partial months and mid-week target changes are therefore prorated by days. Targets keep history: changing the target today never rewrites a past month. |
| Period | Puerto Rico local dates (America/Puerto_Rico). A month in progress is labeled partial, with its through-date, and is compared with the same number of days of the previous month (`previous_equivalent`). |
| Estimated sessions | Runs recorded before R1 have no parent; they are grouped by a 45-minute gap per facilitator session and flagged `estimated`. |
| Abandoned | A run with no activity for 30 minutes is abandoned and excluded. A session ended with no runs is abandoned and excluded. The inactivity lock, sign-out and a new Today's Session all close the open session. |
| Growth | Never computed from a zero denominator; shown as insufficient data. |

## Reporting standard (R2, approved 2026-11-28)
- Every Progress View report uses the executive report's header (official logo, "PROGRESS VIEW · Informes institucionales"), palette (deep teal + warm orange/coral/plum accents), hero indicators, Spanish-first text with English toggle, US Letter one page for executive summaries, and this vocabulary: *sesiones facilitadas*, *actividades ejecutadas*, *participaciones* (cumulative), *minutos de recreación*, *minutos-participante estimados*, *asistentes registrados (máximo por sesión)*, *participantes únicos (con identificador)*.
- Averages: "participaciones por sesión facilitada" = participations ÷ sessions; "asistentes registrados" = average of each session's maximum recorded headcount. They are never presented as distinct people.
- Reconciliation tests (ritnome-report.browser.test.js): activity rows sum to institutional totals; weekly prorated targets sum to the period target; dashboard, report and CSV share totals; Spanish and English carry the same numbers.
- Privacy wording: Ritnome does not collect resident names or medical information; optional individual tracking uses pseudonymous handles.
