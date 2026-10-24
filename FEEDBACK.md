# Handover: user feedback report

- **Live app:** https://handover-vdr8.vercel.app
- **Code:** https://github.com/vamsidharreddym-GPM/handover
- **Built by:** Vamsidhar Reddy, HelloPM Buildathon, 23–24 Oct 2026

Two rounds of feedback from real users led to 9 changes. Every change shipped the same day, and each one links to its code change below.

## Who gave feedback

| Person | Who they are | Interview (23 Oct) | Round 1 (23 Oct) | Watched session (24 Oct) |
| --- | --- | --- | --- | --- |
| Madhuri | Homemaker, runs the family home (my mother) | Yes | Yes | Yes, handing tasks over |
| Sridhar | Family member who does the tasks (my father) | | | Yes, doing the tasks |
| Priyanka | Married, works full time (friend) | Yes | Yes | |
| Shailaja | Homemaker, often out at the gym or shopping (aunt) | Yes | Yes | |
| Family member | A person who receives home tasks | Yes | | |

## Step 1: discovery interviews (before building)

I asked about past behaviour, not about my idea. In their own words:

- **Madhuri:** "I have to remember everything, even after giving the work to someone else. If I don't remind them, something gets missed."
- **Priyanka:** "When I'm working, I can't keep thinking about whether someone has remembered a household task." / "I'm still the one who has to remember it."
- **Shailaja:** "Then I get calls asking where something is or what they should do. I end up guiding them even when I'm outside."
- **Family member:** "Sometimes I also don't know exactly where something is kept or how they want it done." / "If it keeps sending notifications or takes too much effort, I won't use it."

**What this decided:** all four asked, in different words, to hear only when there is a problem. Shailaja: "I would want to know if something important hasn't been done, but I don't need updates about everything." Madhuri: "If they can't do it, they should tell me instead of waiting for me to ask." That became the product's one promise: hand it over once, hear back only if something's wrong.

## Step 2: Round 1, after trying the first version (23 Oct)

| Who | What they said | What changed | Code |
| --- | --- | --- | --- |
| Shailaja | "It is hard for me to type in every task, it'll be helpful if there are basic tasks that I can preselect." | One-tap common tasks (groceries with a list, laundry, ironing, sweeping, mopping, plants, trash), plus her own past tasks as quick picks | [04f2e12](https://github.com/vamsidharreddym-GPM/handover/commit/04f2e12) |
| Priyanka | "It'll be better if there is a voice note option." | Record a voice note (up to 60 seconds) on any task | [04f2e12](https://github.com/vamsidharreddym-GPM/handover/commit/04f2e12) |
| Priyanka | "If there are options like I'll be late, cook for yourself, get items on the way home, it'll be helpful." | Added "I'll be late, please cook for yourselves" and "Get items on the way home" | [e4f053a](https://github.com/vamsidharreddym-GPM/handover/commit/e4f053a) |
| Madhuri | "After my husband completes the task, I want a picture of the completed task." | Optional "Ask for a photo when it's done", per task. His Done button opens the camera. | [04f2e12](https://github.com/vamsidharreddym-GPM/handover/commit/04f2e12) |
| Madhuri | "There should be an option to give feedback or modifications during or after the task. I don't know what he did, if he completed it the way I expect or not." | Add a note while a task is open. "Send it back" with a note after it's done. | [04f2e12](https://github.com/vamsidharreddym-GPM/handover/commit/04f2e12) |
| Madhuri | "There should be an option to select which family member to assign work to (husband, son)." | This already existed, but she didn't notice it. Names now show the relation, like "Ravi (husband)", with "+ Add someone" inside the form. | [04f2e12](https://github.com/vamsidharreddym-GPM/handover/commit/04f2e12) |

**Lesson:** the last row was a design problem, not a missing feature. I made it visible instead of adding something new.

## Step 3: watched session on their own phones (24 Oct)

Madhuri and Sridhar used the live app on their own phones. I watched and did not help. She signed up, added him, and sent the invite on WhatsApp. He signed up from it. She handed over a real task with "Ask for a photo when it's done" ticked, and he completed it with a photo.

**What I saw and heard:**

- Madhuri finished the whole journey without help, but filling in details took her time. She said it could be more user friendly.
- Madhuri said "I'll be late, order food for yourself" doesn't need a photo or a time. It should just reach Sridhar, he acknowledges it, and she knows.
- Sridhar: "It is very easy and simple to use." He said the photo helps him find where things are kept and know exactly what to do.
- Sridhar asked why Undo was there. He said a short window (about 5 minutes) is fine, but undoing yesterday's task by mistake would confuse her.

**What changed** ([d9b1ca1](https://github.com/vamsidharreddym-GPM/handover/commit/d9b1ca1)):

| What I saw | What changed |
| --- | --- |
| Filling in details took time | Where things are kept, the voice note and the photo now sit under one "Add more" link. A common task takes three taps. |
| "I'll be late" doesn't need a deadline or photo | It's now a message, not a task. He taps "Got it" and she sees he got it. |
| Undo could reopen an old task | Undo works for 5 minutes only, and the button says "Undo (5 min)". |

## Real use (live database, 24 Oct 2026, 11:59 am)

| Homes signed up | Family members joined from an invite | Tasks handed over | Done by the family member | Marked "can't do" |
| --- | --- | --- | --- | --- |
| 5 | 4 | 6 | 5 | 0 |

These counts include my own test home and the judges' demo account.

## What I chose not to change, and why

- **No notifications to the family member.** The family member interview said too many notifications would make them stop using it.
- **No edit button for finished tasks.** Sridhar's concern was confusion over old tasks. A 5-minute undo plus Madhuri's "Send it back" covers the real case without letting anyone rewrite history.

## Limits of this feedback

- Every tester is from my own family and friends, and the sample is small.
- One family member was watched on the receiving side. More husbands, sons and flatmates need to be tested next.
- The usage numbers are from day one.
