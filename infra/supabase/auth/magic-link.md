# Email magic-link — Binderly setup

Magic-link is the **fallback** auth method per `PROJECT.md` § 5:
no password, no SMS — Supabase emails the user a one-click link
that completes a sign-in.

## How it works

1. User enters email in the login form.
2. Web/mobile calls `supabase.auth.signInWithOtp({ email, options:
{ emailRedirectTo } })` (Supabase JS SDK).
3. Supabase Auth generates a one-time token and sends an email
   with a link to `<emailRedirectTo>?token=<token>&type=magiclink`.
4. User clicks the link; the app's auth-callback page exchanges
   the token for a session via `supabase.auth.verifyOtp(...)`.
5. Trigger in `0017_profile_provisioning_trigger.sql` fires (auth.users
   row created) and provisions `profile` + `subscription` rows.

## Local dev (Inbucket)

The Supabase CLI ships **Inbucket** (an in-memory SMTP catcher)
that captures all outbound mail without sending. Wired into
`config.toml` automatically when `[inbucket]` is enabled
(default). Web UI: <http://localhost:54324>.

To test locally:

1. `pnpm db:start` (if not already running).
2. From the web app, request a magic link for any email
   (`pablo+test@binderly.app` works fine — Inbucket doesn't care
   about deliverability).
3. Open <http://localhost:54324>.
4. Click the email; click the link inside.
5. The link redirects back to the app; you're signed in.

> Inbucket lists messages by recipient. Use a unique address per
> test session to keep them separable — e.g.
> `pablo+session1@binderly.app`, `pablo+session2@binderly.app`.

## Production (real SMTP)

`config.toml` has a commented-out `[auth.email.smtp]` block ready
to be filled in. Pick an SMTP provider (SendGrid, Resend, AWS SES,
Postmark — any of them work) and:

```toml
[auth.email.smtp]
enabled = true
host = "smtp.sendgrid.net"
port = 587
user = "apikey"
pass = "env(SENDGRID_API_KEY)"
admin_email = "noreply@binderly.app"
sender_name = "Binderly"
```

Then add the matching env var to the production secret manager
(Vercel for web, Supabase project secrets for hosted Auth, Fly
for Python services). Do NOT commit the SMTP password.

## Rate limits

Supabase's defaults (also pre-set in `config.toml`):

```
[auth.rate_limit]
email_sent = 2          # per hour, per project
token_verifications = 30 # per 5-minute window per IP
```

Two emails/hour is plenty for fix-typo retries; the
token_verification limit covers replay attempts. We do not
override these.

## Email template (deferred)

Supabase ships a default email template that's plain but functional.
Custom branding (logo, color scheme) lives under
`[auth.email.template.magic_link]` in `config.toml` with a
`content_path` pointing at an HTML file. **This task does not ship
the template** — it's a marketing concern handled later when the
brand assets are finalized. The default template is fine for v1.

## Cooldown

`[auth.email] max_frequency = "1s"` in `config.toml` (the bundled
default) prevents back-to-back resend spam. Mobile / web should
disable the "send link" button for ~5s after a successful send so
the cooldown isn't surfaced as a confusing error to the user.
That's a UX concern for `T-W-AUTH` / `T-M-AUTH`.
