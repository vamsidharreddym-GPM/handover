# Handover

Hand a home task over once. Hear back only if something's wrong.

Built for the person who runs the home. When she hands a task to someone in the family, she usually stays stuck with it: she explains where things are, remembers to check, and follows up. Handover lets her write the task once (what, how, where things are kept, by when, optional photo) and then stop checking. Her home screen stays quiet unless a task needs her: someone says they can't do it, or it's past due and not marked done.

Family members don't sign up. Each one gets a private link. They open it, see the steps, and tap Done, Need more time, or Can't do it.

## How it's built

- Plain HTML, CSS and JavaScript. No build step, so Vercel serves the folder as is.
- Supabase for login, the database, photos and live updates.
- Data rules live in the database (`supabase/schema.sql`):
  - Row level security: an account only ever sees its own household.
  - Family members can't read tables directly. Their link goes through two database functions (`member_view`, `member_update`) that check the link and only touch that person's tasks.
  - "Can't do it" needs a reason, so she knows what to do next.

## Run your own copy

1. Create a Supabase project. In SQL Editor, run `supabase/schema.sql`.
2. In Supabase > Authentication > Sign In / Providers > Email, turn off "Confirm email".
3. Put your project URL and anon key in `js/config.js`.
4. Deploy the folder on Vercel (framework preset: Other, no build command).
