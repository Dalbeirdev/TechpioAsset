# Archive

Documents that are no longer published, kept because they still hold something
worth having.

## user-guide-v1.3-2026-08-07.pdf

The "User Registration & Role Testing Guide", served at
`/docs/user-guide.pdf` until v2.23 and linked from the marketing footer.

Retired because it had drifted: it named the old domain (`piotask.com`), used the
old product name throughout, and stated that Company Admin cannot see costs —
that role carries every permission, cost included. A downloaded PDF cannot be
corrected once it is on somebody's desktop, which is the whole problem.

**The user-facing half was rewritten as pages** under `/guides`, where it ships
with the code it describes:

| Was | Is now |
| --- | --- |
| §1 How user accounts are registered | `/guides/inviting-people` |
| §2 The 13 system roles | `/guides/roles-and-permissions` — generated from `ROLE_PERMISSIONS`, so it cannot drift |
| §5 How assets are added | `/guides/adding-assets` |
| (new) | `/guides/raising-a-request` |

**The rest is a QA regression script** — example personas, a per-role test pass
(§3, §4a–4h), cross-cutting checks (§6) and recommendations (§7). That is
internal testing material rather than user documentation, so it was never a
candidate for the public site. It is kept here verbatim rather than transcribed:
text extracted from the PDF loses word boundaries, and a lossy retype of a test
script is worse than the original.

If that script is worth reviving, it belongs in the repo as Markdown next to the
integration suite, written from the current role matrix rather than copied from
here — several of its role claims are already out of date.
