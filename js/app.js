import { api } from './api.js';

const app = document.getElementById('app');
const state = { me: null, household: null, members: [], tasks: [], stopWatch: null, tick: null };

/* ---------- small helpers ---------- */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function when(iso) {
  const d = new Date(iso);
  const now = new Date();
  const t = timeFmt.format(d).replace(' ', ' ');
  if (sameDay(d, now)) return t;
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  if (sameDay(d, tmr)) return `tomorrow ${t}`;
  const yst = new Date(now); yst.setDate(now.getDate() - 1);
  if (sameDay(d, yst)) return `yesterday ${t}`;
  return `${dayFmt.format(d)}, ${t}`;
}

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return when(iso);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

const appLink = () => `${location.origin}${location.pathname}`;
const inviteLink = (m) => `${appLink()}#/join/${m.token}`;
const inviteText = (m) => `Hi ${m.name}, I've added you to our home on Handover. Sign up from this link to see the tasks I hand you, with the details. Tap Done when you finish.`;

// Remembers an invite while someone logs in with an existing account.
const pending = {
  get() { try { return sessionStorage.getItem('invite'); } catch { return null; } },
  set(t) { try { sessionStorage.setItem('invite', t); } catch { /* private mode */ } },
  clear() { try { sessionStorage.removeItem('invite'); } catch { /* private mode */ } },
};

async function shareLink(text, url) {
  if (navigator.share) {
    try { await navigator.share({ text: `${text}\n${url}` }); return; } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link copied. Paste it in a message.');
  } catch {
    window.prompt('Copy this link', url);
  }
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

function stopLive() {
  if (state.stopWatch) { state.stopWatch(); state.stopWatch = null; }
  if (state.tick) { clearInterval(state.tick); state.tick = null; }
}

const isOverdue = (t) => t.status === 'open' && new Date(t.due_at) < new Date();
const nameOf = (id) => state.members.find((m) => m.id === id)?.name;

/* ---------- router ---------- */

const ownerRoutes = { home, new: newTask, family, history };

async function whoAmI() {
  state.me = await api.whoAmI();
  state.household = state.me.household || null;
  return state.me;
}

// Where a logged-in person belongs.
const startFor = (me) => (me.kind === 'owner' ? 'home' : me.kind === 'member' ? 'mine' : 'welcome');

async function route() {
  stopLive();
  window.scrollTo(0, 0);
  const [path, arg] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    const session = await api.session();
    if (path === 'join' && arg) return await joinScreen(arg, session);
    if (!session) {
      if (path === 'login') return authScreen('login');
      if (path === 'signup') return authScreen('signup');
      if (path === '' || !path) return landing();
      return go('login');
    }
    const me = state.me || await whoAmI();
    const target = startFor(me);
    if (me.kind === 'owner' && ownerRoutes[path]) return await ownerRoutes[path]();
    if (path !== target) return go(target);
    if (target === 'mine') return await mineScreen();
    return welcomeScreen(me);
  } catch (err) {
    app.innerHTML = `<section class="screen"><h1 class="h-md">Something went wrong</h1>
      <p class="muted">${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Try again</button></section>`;
  }
}

function go(path) {
  if (location.hash === `#/${path}`) route(); else location.hash = `#/${path}`;
}

window.addEventListener('hashchange', route);
route();

/* ---------- landing ---------- */

function landing() {
  app.innerHTML = `
  <section class="landing">
    <header class="brand">Handover</header>
    <h1 class="h-xl">Hand it over once. Hear back only if something’s wrong.</h1>
    <p class="lead">For the person who runs the home. Write the task once with where things are kept,
      give it to someone in the family, and stop following up. You hear back only when they can’t do it
      or it’s running late.</p>
    <div class="stack-sm">
      <a class="btn" href="#/signup">Start your home</a>
      <a class="btn btn-quiet" href="#/login">Log in</a>
    </div>

    <figure class="preview" aria-label="Example of the home screen">
      <div class="status status-needs"><span>1 thing needs you.</span></div>
      <div class="card card-needs">
        <p class="card-title">Pay the milkman</p>
        <p class="who">Ravi can’t do it</p>
        <blockquote>“He wants change, I only have a 500 note.”</blockquote>
      </div>
      <p class="list-head">On track</p>
      <div class="row"><div><p class="row-title">Hang the washed clothes</p><p class="row-sub">Ravi, by 6:00 pm</p></div><span class="pill pill-seen">Seen</span></div>
      <div class="row"><div><p class="row-title">Give Amma her 2 pm tablet</p><p class="row-sub">Anu, by 2:00 pm</p></div><span class="pill">Not opened</span></div>
      <figcaption>An example. Your screen stays this quiet.</figcaption>
    </figure>

    <ol class="steps">
      <li><strong>Write it once.</strong> What to do, how you like it done, where things are kept, by when. Add a photo of the shelf if that’s easier.</li>
      <li><strong>Invite them once.</strong> They sign up from your invite, see the steps, and tap Done. If they’re stuck, they tell you from there.</li>
      <li><strong>Stop checking.</strong> Your screen only lights up when something needs you.</li>
    </ol>

    <p class="foot muted">Invited by someone in your family? Open the invite link they sent you, or <a href="#/login">log in</a>.</p>
  </section>`;
}

/* ---------- sign up / log in ---------- */

function authScreen(mode) {
  const signup = mode === 'signup';
  app.innerHTML = `
  <section class="screen narrow">
    <a class="back" href="#/">Handover</a>
    <h1 class="h-lg">${signup ? 'Start your home' : 'Welcome back'}</h1>
    <form id="auth" class="stack" novalidate>
      ${signup ? `<label>Your name<input name="name" required maxlength="40" autocomplete="given-name" placeholder="Madhuri"></label>` : ''}
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Password<input name="password" type="password" required minlength="6"
        autocomplete="${signup ? 'new-password' : 'current-password'}">
        ${signup ? '<span class="hint">At least 6 characters</span>' : ''}</label>
      <p class="error" id="err" hidden></p>
      <button class="btn" type="submit">${signup ? 'Create my home' : 'Log in'}</button>
    </form>
    <p class="muted center">${signup
      ? 'Already have a home? <a href="#/login">Log in</a>'
      : 'New here? <a href="#/signup">Start your home</a>'}</p>
  </section>`;

  const form = document.getElementById('auth');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const err = document.getElementById('err');
    const problem = signup && !f.name.trim() ? 'Add your name.'
      : !/^\S+@\S+\.\S+$/.test(f.email) ? 'Enter a valid email.'
      : (f.password || '').length < 6 ? 'Password needs at least 6 characters.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const btn = form.querySelector('button');
    busy(btn, true, signup ? 'Creating…' : 'Logging in…');
    try {
      if (signup) await api.signUp(f.name.trim(), f.email.trim(), f.password);
      else await api.logIn(f.email.trim(), f.password);
      const invite = pending.get();
      if (invite && !signup) {
        pending.clear();
        try { await api.acceptInvite(invite); } catch (ex) { toast(ex.message); }
      }
      const me = await whoAmI();
      go(signup && me.kind === 'owner' ? 'family' : startFor(me));
    } catch (ex) {
      err.textContent = /invalid login/i.test(ex.message) ? 'Email or password is wrong.' : ex.message;
      err.hidden = false;
      busy(btn, false);
    }
  });
}

/* ---------- her home ---------- */

const memberById = (id) => state.members.find((m) => m.id === id);
const who = (m) => (m ? (m.relation ? `${m.name} (${m.relation.toLowerCase()})` : m.name) : '');

async function loadHome() {
  [state.members, state.tasks, state.week] = await Promise.all([
    api.members(), api.activeTasks(), api.recentTasks(7),
  ]);
}

async function home() {
  await loadHome();
  renderHome();
  state.stopWatch = api.watchTasks(state.household.id, async (p) => {
    const before = p.old && state.tasks.find((t) => t.id === p.old.id);
    await loadHome();
    if (!document.querySelector('.home .panel:not([hidden])')) renderHome();
    const t = p.new;
    if (t && before && before.status !== t.status) {
      const name = nameOf(t.member_id) || 'Someone';
      if (t.status === 'cant') { toast(`${name} can’t do “${t.title}”`); navigator.vibrate?.(200); }
      if (t.status === 'done' && t.done_by === 'member') toast(`${name} finished “${t.title}”`);
    }
  });
  state.tick = setInterval(() => {
    if (!document.querySelector('.home .panel:not([hidden])')) renderHome();
  }, 60000);
}

function weekSummary() {
  const week = (state.week || []).filter((t) => t.status !== 'cancelled');
  if (!week.length) return '';
  const done = week.filter((t) => t.status === 'done');
  const byFamily = done.filter((t) => t.done_by === 'member').length;
  const cant = week.filter((t) => t.status === 'cant').length;
  const people = state.members.map((m) => {
    const mine = week.filter((t) => t.member_id === m.id);
    if (!mine.length) return '';
    return `<li>${esc(m.name)}: ${mine.filter((t) => t.status === 'done' && t.done_by === 'member').length} of ${mine.length} done</li>`;
  }).join('');
  return `<section class="week" aria-label="Last 7 days">
    <h2 class="list-head">Last 7 days</h2>
    <div class="week-nums">
      <p><b>${week.length}</b> handed over</p>
      <p><b>${byFamily}</b> done by family</p>
      <p><b>${cant}</b> couldn’t be done</p>
    </div>
    ${people ? `<ul class="week-people">${people}</ul>` : ''}
    <a class="link" href="#/history">See all tasks</a>
  </section>`;
}

function renderHome() {
  const { tasks, members, household } = state;
  const needs = tasks.filter((t) => t.status === 'cant' || isOverdue(t) || (t.status === 'open' && !t.member_id));
  const onTrack = tasks.filter((t) => t.status === 'open' && !needs.includes(t));
  const done = tasks.filter((t) => t.status === 'done');

  const headline = needs.length
    ? `<div class="status status-needs"><span>${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you.</span></div>`
    : `<div class="status status-clear"><span>All clear.</span></div>
       <p class="muted">${onTrack.length
        ? `${onTrack.length} handed over. Nothing needs you right now.`
        : 'Nothing handed over right now.'}</p>`;

  app.innerHTML = `
  <section class="screen with-bar home">
    <header class="topbar">
      <span class="brand">Handover</span>
      <nav><a href="#/history">History</a><a href="#/family">Family</a><button class="link" id="logout">Log out</button></nav>
    </header>
    <p class="hello">Hi ${esc(household.owner_name)}</p>
    ${headline}

    ${needs.length ? `<div class="stack">${needs.map(needCard).join('')}</div>` : ''}

    ${onTrack.length ? `<h2 class="list-head">On track</h2>
      <div class="list">${onTrack.map(trackRow).join('')}</div>` : ''}

    ${done.length ? `<h2 class="list-head">Done today</h2>
      <div class="list">${done.map(doneRow).join('')}</div>` : ''}

    ${!members.length ? `<div class="empty">
      <p>First, add the people you hand tasks to.</p>
      <a class="btn btn-quiet" href="#/family">Add family</a></div>`
    : !tasks.length ? `<div class="empty"><p>Tap “Hand over a task” and pick one of the common tasks. You’ll only hear about the ones that need you.</p></div>` : ''}

    ${weekSummary()}

    <div class="bar"><a class="btn" href="#/new">Hand over a task</a></div>
  </section>`;

  document.getElementById('logout').onclick = async () => {
    await api.logOut(); state.me = null; state.household = null; go('');
  };
  wirePanels(app);
  app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onHomeAction));
}

const safeUrl = (u) => (/^https:\/\//.test(u || '') ? esc(u) : '');

function details(t) {
  const photo = safeUrl(t.photo_url);
  const audio = safeUrl(t.audio_url);
  return `${t.how_to ? `<p class="detail"><span>Details</span>${esc(t.how_to)}</p>` : ''}
    ${t.where_is ? `<p class="detail"><span>Where things are</span>${esc(t.where_is)}</p>` : ''}
    ${audio ? `<div class="detail"><span>Voice note</span><audio controls preload="none" src="${audio}"></audio></div>` : ''}
    ${photo ? `<a href="${photo}" target="_blank" rel="noopener"><img class="thumb" src="${photo}" alt="Photo for ${esc(t.title)}" loading="lazy"></a>` : ''}`;
}

function ownerNote(t) {
  return t.owner_note ? `<p class="note-from"><span>Your note${t.sent_back_count ? ', sent back' : ''}</span>${esc(t.owner_note)}</p>` : '';
}

function doneProof(t) {
  const u = safeUrl(t.done_photo_url);
  return u ? `<div class="detail"><span>Photo when done</span><a href="${u}" target="_blank" rel="noopener"><img class="thumb" src="${u}" alt="Finished: ${esc(t.title)}" loading="lazy"></a></div>` : '';
}

// A small form that opens inside a row: a note to the family member.
function notePanel(kind, t, label, placeholder, button) {
  return `<div class="panel" data-panel="${kind}" hidden>
    <label>${label}<textarea rows="2" maxlength="300" placeholder="${placeholder}"></textarea></label>
    <button class="btn btn-sm" data-act="${kind}" data-id="${t.id}">${button}</button>
  </div>`;
}

function needCard(t) {
  const m = memberById(t.member_id);
  const name = esc(m?.name);
  let why;
  let primary;
  if (!t.member_id) {
    why = '<p class="who">No one has this task now</p>';
    primary = `<button class="btn btn-sm" data-act="reassign" data-id="${t.id}">Give it to someone</button>`;
  } else if (t.status === 'cant') {
    why = `<p class="who">${name} can’t do it</p>
      ${t.member_note ? `<blockquote>“${esc(t.member_note)}”</blockquote>` : ''}`;
    primary = `<button class="btn btn-sm" data-act="reassign" data-id="${t.id}">Give it to someone else</button>`;
  } else {
    const seen = t.seen_at ? `${name} saw it ${ago(t.seen_at)}` : `${name} hasn’t opened it yet`;
    why = `<p class="who">Was due ${when(t.due_at)}. ${seen}.</p>
      ${t.member_note ? `<blockquote>“${esc(t.member_note)}”</blockquote>` : ''}`;
    primary = `<button class="btn btn-sm" data-act="remind" data-id="${t.id}">Remind ${name}</button>`;
  }
  return `<article class="card card-needs">
    <p class="card-title">${esc(t.title)}</p>
    ${why}
    <div class="actions">${primary}
      ${t.status === 'open' && t.member_id ? `<button class="link" data-act="more" data-id="${t.id}">Give 1 more hour</button>` : ''}
      <button class="link" data-act="self" data-id="${t.id}">I’ll do it</button>
      <button class="link" data-act="drop" data-id="${t.id}">Drop it</button>
    </div>
  </article>`;
}

function trackRow(t) {
  const moved = new Date(t.due_at) > new Date(t.first_due_at);
  return `<details class="row-x">
    <summary class="row">
      <div><p class="row-title">${esc(t.title)}</p>
        <p class="row-sub">${esc(nameOf(t.member_id))}, by ${when(t.due_at)}${moved ? ' (moved)' : ''}${t.needs_photo ? ', photo asked' : ''}</p>
        ${moved && t.member_note ? `<p class="row-note">“${esc(t.member_note)}”</p>` : ''}</div>
      <span class="pill ${t.seen_at ? 'pill-seen' : ''}">${t.seen_at ? 'Seen' : 'Not opened'}</span>
    </summary>
    <div class="row-more">${details(t)}${ownerNote(t)}
      <div class="actions">
        <button class="link" data-open-panel="note">${t.owner_note ? 'Change your note' : 'Add a note or change'}</button>
        <button class="link" data-act="drop" data-id="${t.id}">Drop it</button>
      </div>
      ${notePanel('note', t, `Tell ${esc(nameOf(t.member_id))}`, 'Also get curd. Use the blue bucket, not the red one.', 'Send note')}
    </div>
  </details>`;
}

function doneRow(t) {
  const by = t.done_by === 'owner' ? 'You' : esc(nameOf(t.member_id) || 'Done');
  const proof = t.done_photo_url ? ', with photo' : '';
  return `<details class="row-x">
    <summary class="row"><div><p class="row-title">${esc(t.title)}</p>
      <p class="row-sub">${by}, ${when(t.done_at)}${proof}</p></div><span class="tick" aria-label="Done">✓</span></summary>
    <div class="row-more">${doneProof(t)}${details(t)}
      ${t.done_by === 'member' ? `<div class="actions"><button class="link" data-open-panel="sendback">Not right? Send it back</button></div>
      ${notePanel('sendback', t, 'What needs fixing', 'The towels are still on the bed.', `Send back to ${esc(nameOf(t.member_id))}`)}` : ''}
    </div>
  </details>`;
}

// Opens one inline panel inside the nearest row or card and closes the others.
function wirePanels(root) {
  root.querySelectorAll('[data-open-panel]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('.card, .row-more');
    box.querySelectorAll('.panel').forEach((p) => {
      p.hidden = p.dataset.panel !== b.dataset.openPanel || !p.hidden;
      if (!p.hidden) p.querySelector('textarea')?.focus();
    });
  }));
}

async function onHomeAction(e) {
  const btn = e.currentTarget;
  const t = state.tasks.find((x) => x.id === btn.dataset.id);
  if (!t) return;
  const act = btn.dataset.act;
  try {
    if (act === 'remind') {
      const m = memberById(t.member_id);
      if (!m.user_id) return askToSendLink(m);
      await shareLink(`Reminder: “${t.title}” was due ${when(t.due_at)}. Please tap Done in Handover once it’s finished.`, appLink());
      return;
    }
    if (act === 'reassign') return pickPerson(t);
    const text = btn.closest('.panel')?.querySelector('textarea')?.value.trim();
    if ((act === 'note' || act === 'sendback') && !text) { toast('Write a few words first.'); return; }
    busy(btn, true, '…');
    const now = new Date().toISOString();
    if (act === 'more') await api.updateTask(t.id, { due_at: new Date(Date.now() + 3600000).toISOString() });
    if (act === 'self') await api.updateTask(t.id, { status: 'done', done_by: 'owner', done_at: now });
    if (act === 'drop') await api.updateTask(t.id, { status: 'cancelled' });
    if (act === 'note') await api.updateTask(t.id, { owner_note: text, owner_note_at: now, seen_at: null });
    if (act === 'sendback') {
      await api.updateTask(t.id, {
        status: 'open', done_at: null, done_by: null, done_photo_url: null, owner_note: text, owner_note_at: now,
        sent_back_count: (t.sent_back_count || 0) + 1, seen_at: null,
        due_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    const name = nameOf(t.member_id);
    toast({
      drop: 'Dropped.', self: 'Marked as done by you.', more: 'Moved by an hour.',
      note: `${name} will see your note.`, sendback: `Sent back to ${name} with your note.`,
    }[act]);
    await loadHome(); renderHome();
  } catch (err) { toast(err.message); busy(btn, false); }
}

function pickPerson(t) {
  const others = state.members.filter((m) => m.id !== t.member_id);
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Give it to someone else">
    <p class="h-md">Who should do “${esc(t.title)}”?</p>
    ${others.length ? `<div class="chips">${others.map((m) =>
      `<button class="chip" data-m="${m.id}">${esc(m.name)}</button>`).join('')}</div>`
      : '<p class="muted">There’s no one else yet. Add someone in Family.</p>'}
    <button class="link" data-close>Cancel</button></div>`;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.dataset.close !== undefined) close(); });
  sheet.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
    busy(b, true, '…');
    const due = new Date(t.due_at) < new Date() ? new Date(Date.now() + 3600000).toISOString() : t.due_at;
    try {
      await api.updateTask(t.id, { member_id: b.dataset.m, status: 'open', member_note: null, seen_at: null, due_at: due });
      close();
      const m = state.members.find((x) => x.id === b.dataset.m);
      toast(`Handed over to ${m.name}.`);
      await loadHome(); renderHome();
      if (!m.user_id) askToSendLink(m);
    } catch (err) { toast(err.message); busy(b, false); }
  }));
}

function askToSendLink(m) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Send link">
    <p class="h-md">${esc(m.name)} hasn’t joined yet</p>
    <p class="muted">Send the invite once. When ${esc(m.name)} signs up from it, every task you hand over shows up in their account.</p>
    <button class="btn" data-send>Send ${esc(m.name)} the invite</button>
    <button class="link" data-close>Later</button></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.dataset.close !== undefined) sheet.remove(); });
  sheet.querySelector('[data-send]').onclick = async () => {
    await shareLink(inviteText(m), inviteLink(m));
    sheet.remove();
  };
}

/* ---------- hand over a task ---------- */

function dueOptions() {
  const now = new Date();
  const inMins = (m) => { const d = new Date(now.getTime() + m * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d; };
  const at = (h, addDays = 0) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d; };
  const opts = [['In 1 hour', inMins(60)], ['In 2 hours', inMins(120)]];
  if (now.getHours() < 18) opts.push(['By 7 pm', at(19)]);
  else opts.push(['Tonight 9:30 pm', (() => { const d = at(21); d.setMinutes(30); return d; })()]);
  opts.push(['Tomorrow 10 am', at(10, 1)]);
  return opts.filter(([, d]) => d > now);
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Common home tasks, from what testers said they hand over most. One tap fills the form.
const PRESETS = [
  { icon: '🛒', title: 'Pick up groceries', label: 'What to buy', hint: '2 packets milk, 1 kg tomatoes, coriander, 6 eggs' },
  { icon: '🍱', title: 'Order food, I’ll be late', label: 'What to order', hint: 'Dinner for 3 from the usual place. I’ll be home by 10.' },
  { icon: '🍳', title: 'Cook for yourselves, I’ll be late', label: 'What to make', hint: 'Dal and rice. Rice is in the steel dabba, cooker on 3 whistles.' },
  { icon: '🛍️', title: 'Get items on the way home', label: 'What to get', hint: 'Bread, 1 litre milk, curd from the corner shop' },
  { icon: '🧺', title: 'Put clothes in the washing machine', label: 'How', hint: 'Whites separately. Quick wash. Detergent is on the top shelf.' },
  { icon: '👕', title: 'Dry the clothes', label: 'How', hint: 'Towels on the balcony line, shirts on hangers.' },
  { icon: '👔', title: 'Iron the clothes', label: 'Which clothes', hint: 'Office shirts for tomorrow, school uniform.' },
  { icon: '🧹', title: 'Sweep the house', label: 'Anything specific', hint: 'Under the sofa and the balcony too.' },
  { icon: '🪣', title: 'Wet-mop the house', label: 'How', hint: 'One capful of floor cleaner in half a bucket.' },
  { icon: '🪴', title: 'Water the plants', label: 'Which plants', hint: 'Balcony pots only. Skip the cactus.' },
  { icon: '🗑️', title: 'Take out the trash', label: 'How', hint: 'Wet and dry separately. Truck comes at 7 am.' },
];

function takePrefill() {
  try {
    const v = sessionStorage.getItem('prefill');
    sessionStorage.removeItem('prefill');
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function newTask() {
  const [members, saved] = await Promise.all([api.members(), api.savedTasks()]);
  state.members = members;
  if (!members.length) { toast('Add someone first.'); return go('family'); }
  const opts = dueOptions();
  const presetTitles = new Set(PRESETS.map((p) => p.title.toLowerCase()));
  const own = saved.filter((s) => !presetTitles.has(s.title.trim().toLowerCase()));
  let photoUrl = null;
  let audioUrl = null;

  app.innerHTML = `
  <section class="screen with-bar">
    <a class="back" href="#/home">Home</a>
    <h1 class="h-lg">Hand over a task</h1>
    <p class="label">Pick a common task</p>
    <div class="presets">
      ${PRESETS.map((p, i) => `<button type="button" class="preset" data-preset="${i}"><span aria-hidden="true">${p.icon}</span>${esc(p.title)}</button>`).join('')}
    </div>
    ${own.length ? `<p class="label">Or one you wrote before</p>
      <div class="chips saved-chips">${own.map((s, i) => `<button type="button" class="chip" data-saved="${i}">${esc(s.title)}</button>`).join('')}</div>` : ''}

    <form id="task" class="stack form-gap" novalidate>
      <label>What needs doing<input name="title" required maxlength="80" placeholder="Or type your own task"></label>
      <label><span class="lbl"><span id="how-label">Details</span><span class="opt">optional</span></span>
        <textarea name="how_to" maxlength="600" rows="3" placeholder="How you like it done, or a list"></textarea></label>
      <label><span class="lbl">Where things are kept<span class="opt">optional</span></span>
        <textarea name="where_is" maxlength="300" rows="2" placeholder="Pegs are in the blue tub under the sink."></textarea></label>

      <div class="media-row">
        <button type="button" class="btn btn-quiet btn-sm" id="rec">Record a voice note</button>
        <label class="btn btn-quiet btn-sm file-btn">Add a photo<input type="file" name="photo" accept="image/*" hidden></label>
      </div>
      <div id="voice-preview"></div>
      <div id="photo-preview"></div>

      <fieldset><legend>By when</legend>
        <div class="chips" id="due-chips">
          ${opts.map(([label, d], i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-due="${d.toISOString()}">${label}</button>`).join('')}
          <button type="button" class="chip" data-due="custom">Pick a time</button>
        </div>
        <input type="datetime-local" name="custom_due" id="custom-due" hidden min="${toLocalInput(new Date())}">
      </fieldset>

      <fieldset><legend>Who will do it</legend>
        <div class="chips" id="who-chips">
          ${members.map((m) => `<button type="button" class="chip ${members.length === 1 ? 'on' : ''}" data-who="${m.id}">${esc(who(m))}</button>`).join('')}
          <a class="chip chip-add" href="#/family">+ Add someone</a>
        </div>
      </fieldset>

      <label class="check"><input type="checkbox" name="needs_photo"> Ask for a photo when it’s done</label>

      <p class="error" id="err" hidden></p>
      <div class="bar"><button class="btn" type="submit">Hand it over</button></div>
    </form>
  </section>`;

  const form = document.getElementById('task');
  const err = document.getElementById('err');
  const howLabel = document.getElementById('how-label');
  const pick = (group, btn) => { group.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); btn.classList.add('on'); };

  const dueChips = document.getElementById('due-chips');
  const custom = document.getElementById('custom-due');
  dueChips.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    pick(dueChips, c);
    custom.hidden = c.dataset.due !== 'custom';
    if (!custom.hidden) custom.focus();
  }));
  const whoChips = document.getElementById('who-chips');
  whoChips.querySelectorAll('[data-who]').forEach((c) => c.addEventListener('click', () => pick(whoChips, c)));

  const photoBox = document.getElementById('photo-preview');
  const showPhoto = (url) => {
    photoBox.innerHTML = url ? `<img class="thumb" src="${esc(url)}" alt="Task photo"><button type="button" class="link" id="rm-photo">Remove photo</button>` : '';
    document.getElementById('rm-photo')?.addEventListener('click', () => { photoUrl = null; showPhoto(null); });
  };
  const voiceBox = document.getElementById('voice-preview');
  const showVoice = (url) => {
    voiceBox.innerHTML = url ? `<audio controls src="${esc(url)}"></audio><button type="button" class="link" id="rm-voice">Remove voice note</button>` : '';
    document.getElementById('rm-voice')?.addEventListener('click', () => { audioUrl = null; showVoice(null); });
  };

  const fill = (title, how, where, label, hint) => {
    form.title.value = title;
    form.how_to.value = how || '';
    form.where_is.value = where || '';
    howLabel.textContent = label || 'Details';
    form.how_to.placeholder = hint || 'How you like it done, or a list';
  };

  app.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS[Number(b.dataset.preset)];
    app.querySelectorAll('.preset').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    fill(p.title, '', '', p.label, p.hint);
    form.how_to.focus();
  }));

  app.querySelectorAll('[data-saved]').forEach((c) => c.addEventListener('click', () => {
    const s = own[Number(c.dataset.saved)];
    fill(s.title, s.how_to, s.where_is);
    photoUrl = s.photo_url || null; showPhoto(photoUrl);
    audioUrl = s.audio_url || null; showVoice(audioUrl);
    form.needs_photo.checked = !!s.needs_photo;
    toast('Filled in from last time. Change anything you need.');
  }));

  const pre = takePrefill();
  if (pre) {
    const p = PRESETS.find((x) => x.title === pre.title);
    fill(pre.title, pre.how_to, pre.where_is, p?.label, p?.hint);
    photoUrl = pre.photo_url || null; showPhoto(photoUrl);
    audioUrl = pre.audio_url || null; showVoice(audioUrl);
    form.needs_photo.checked = !!pre.needs_photo;
    if (pre.member_id) {
      const c = whoChips.querySelector(`[data-who="${pre.member_id}"]`);
      if (c) pick(whoChips, c);
    }
  }

  form.photo.addEventListener('change', async () => {
    const file = form.photo.files[0];
    if (!file) return;
    photoBox.innerHTML = '<p class="muted">Adding photo…</p>';
    try {
      photoUrl = await api.uploadPhoto(await shrink(file));
      showPhoto(photoUrl);
    } catch (ex) { photoBox.innerHTML = ''; toast(`Photo didn’t upload: ${ex.message}`); }
  });

  setupRecorder(document.getElementById('rec'), voiceBox, (url) => { audioUrl = url; showVoice(url); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const title = form.title.value.trim();
    const dueBtn = dueChips.querySelector('.on');
    const whoBtn = whoChips.querySelector('.on');
    let due = dueBtn?.dataset.due;
    if (due === 'custom') due = custom.value ? new Date(custom.value).toISOString() : null;
    const problem = !title ? 'Pick a common task or write what needs doing.'
      : !due ? 'Pick when it should be done by.'
      : new Date(due) < new Date() ? 'That time has already passed.'
      : !whoBtn ? 'Pick who will do it.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Handing over…');
    try {
      await api.createTask({
        household_id: state.household.id,
        member_id: whoBtn.dataset.who,
        title,
        how_to: form.how_to.value.trim() || null,
        where_is: form.where_is.value.trim() || null,
        photo_url: photoUrl,
        audio_url: audioUrl,
        needs_photo: form.needs_photo.checked,
        due_at: due,
      });
      const m = members.find((x) => x.id === whoBtn.dataset.who);
      toast(`Handed over to ${m.name}.`);
      go('home');
      if (!m.user_id) setTimeout(() => askToSendLink(m), 400);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; busy(btn, false); }
  });
}

// Voice note: tap to record, tap again to stop. Stops by itself after 60 seconds.
function setupRecorder(btn, box, onSaved) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    btn.hidden = true;
    return;
  }
  let rec = null;
  let timer = null;
  btn.addEventListener('click', async () => {
    if (rec) { rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {
      toast('Allow the microphone to record a voice note.');
      return;
    }
    const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      const mime = rec.mimeType || type || 'audio/webm';
      rec = null;
      btn.textContent = 'Record again';
      box.innerHTML = '<p class="muted">Saving voice note…</p>';
      try {
        const blob = new Blob(chunks, { type: mime });
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        onSaved(await api.uploadFile(blob, ext, mime.split(';')[0]));
      } catch (ex) { box.innerHTML = ''; toast(`Voice note didn’t save: ${ex.message}`); }
    };
    rec.start();
    let secs = 0;
    btn.classList.add('recording');
    btn.textContent = 'Stop recording 0:00';
    timer = setInterval(() => {
      secs += 1;
      btn.textContent = `Stop recording 0:${String(secs).padStart(2, '0')}`;
      if (secs >= 60) rec?.stop();
    }, 1000);
    rec.addEventListener('stop', () => btn.classList.remove('recording'));
  });
}

// Phone photos are large. Resize before upload so family members on slow data can open them.
function shrink(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', 0.8);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read photo'));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- family ---------- */

const RELATIONS = ['Husband', 'Wife', 'Son', 'Daughter', 'Mother', 'Father', 'Mother-in-law', 'Father-in-law', 'Brother', 'Sister', 'Other'];

async function family() {
  state.members = await api.members();
  const ms = state.members;
  app.innerHTML = `
  <section class="screen">
    <a class="back" href="#/home">Home</a>
    <h1 class="h-lg">Family</h1>
    <p class="muted">Add the people you hand tasks to, then send each one an invite. They sign up from it and see only the tasks you give them.</p>
    <div class="list">
      ${ms.map((m) => `<div class="row">
        <div><p class="row-title">${esc(who(m))}</p>
          <p class="row-sub">${!m.user_id ? 'Invited, hasn’t joined yet'
            : m.last_opened_at ? `Joined. Last checked tasks ${ago(m.last_opened_at)}` : 'Joined'}</p></div>
        <div class="row-actions">
          ${m.user_id ? '' : `<button class="btn btn-sm" data-send="${m.id}">Send invite</button>`}
          <button class="link" data-rm="${m.id}" aria-label="Remove ${esc(m.name)}">Remove</button>
        </div></div>`).join('')}
    </div>
    <form id="add" class="add-form">
      <p class="label">Add someone</p>
      <div class="add-row">
        <label class="grow">Name<input name="name" required maxlength="40" placeholder="Ravi"></label>
        <label>Who they are<select name="relation">
          <option value="">Choose</option>${RELATIONS.map((r) => `<option>${r}</option>`).join('')}
        </select></label>
      </div>
      <button class="btn btn-sm" type="submit">Add</button>
    </form>
    ${ms.length ? '<a class="btn btn-quiet next" href="#/new">Hand over a task</a>' : ''}
  </section>`;

  app.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => {
    const m = ms.find((x) => x.id === b.dataset.send);
    shareLink(inviteText(m), inviteLink(m));
  }));
  app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const m = ms.find((x) => x.id === b.dataset.rm);
    if (!window.confirm(`Remove ${m.name}? They won’t see your tasks any more.`)) return;
    await api.removeMember(m.id);
    toast(`${m.name} removed.`);
    family();
  }));
  document.getElementById('add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) { toast('Add their name.'); return; }
    const btn = e.target.querySelector('button');
    busy(btn, true, '…');
    try {
      const m = await api.addMember(state.household.id, name, e.target.relation.value || null);
      toast(`${m.name} added. Send them the invite.`);
      await family();
    } catch (ex) { toast(ex.message); busy(btn, false); }
  });
}

/* ---------- history ---------- */

const STATUS_TEXT = { open: 'Open', done: 'Done', cant: 'Couldn’t', cancelled: 'Dropped' };

async function history() {
  const [members, tasks] = await Promise.all([api.members(), api.history()]);
  state.members = members;
  let filter = 'all';

  const render = () => {
    const list = tasks.filter((t) => filter === 'all' || t.member_id === filter);
    const groups = [];
    list.forEach((t) => {
      const day = new Date(t.created_at).toDateString();
      const g = groups.find((x) => x.day === day);
      if (g) g.items.push(t); else groups.push({ day, label: dayLabel(t.created_at), items: [t] });
    });

    app.innerHTML = `
    <section class="screen">
      <a class="back" href="#/home">Home</a>
      <h1 class="h-lg">All tasks</h1>
      <div class="chips" id="filter">
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">Everyone</button>
        ${members.map((m) => `<button class="chip ${filter === m.id ? 'on' : ''}" data-f="${m.id}">${esc(m.name)}</button>`).join('')}
      </div>
      ${!list.length ? '<div class="empty"><p>Nothing here yet. Tasks you hand over stay here.</p></div>' : ''}
      ${groups.map((g) => `<h2 class="list-head">${g.label}</h2><div class="list">${g.items.map(historyRow).join('')}</div>`).join('')}
    </section>`;

    app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    app.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
      const t = tasks.find((x) => x.id === b.dataset.again);
      try {
        sessionStorage.setItem('prefill', JSON.stringify({
          title: t.title, how_to: t.how_to, where_is: t.where_is, photo_url: t.photo_url,
          audio_url: t.audio_url, needs_photo: t.needs_photo, member_id: t.member_id,
        }));
      } catch { /* private mode */ }
      go('new');
    }));
  };
  render();
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return dayFmt.format(d);
}

function historyRow(t) {
  const name = esc(nameOf(t.member_id) || 'No one');
  const outcome = t.status === 'done'
    ? `${t.done_by === 'owner' ? 'You did it' : `${name} did it`}, ${when(t.done_at)}${t.done_at > t.due_at ? ' (late)' : ''}`
    : t.status === 'cant' ? `${name} couldn’t: “${esc(t.member_note || '')}”`
    : t.status === 'cancelled' ? 'Dropped'
    : `${name}, due ${when(t.due_at)}`;
  return `<details class="row-x">
    <summary class="row"><div><p class="row-title">${esc(t.title)}</p>
      <p class="row-sub">${outcome}${t.sent_back_count ? `, sent back ${t.sent_back_count}×` : ''}</p></div>
      <span class="pill pill-${t.status}">${STATUS_TEXT[t.status]}</span></summary>
    <div class="row-more">${doneProof(t)}${details(t)}${ownerNote(t)}
      <div class="actions"><button class="link" data-again="${t.id}">Hand over again</button></div>
    </div>
  </details>`;
}

/* ---------- family member's screen ---------- */

// Opened from an invite link.
async function joinScreen(token, session) {
  const info = /^[0-9a-f-]{36}$/i.test(token) ? await api.inviteInfo(token) : null;
  if (!info) {
    app.innerHTML = `<section class="screen narrow"><a class="back" href="#/">Handover</a>
      <h1 class="h-lg">This invite doesn’t work</h1>
      <p class="muted">It may have been removed. Ask for a new invite.</p></section>`;
    return;
  }
  const owner = esc(info.owner_name);

  if (info.joined) {
    app.innerHTML = `<section class="screen narrow"><a class="back" href="#/">Handover</a>
      <h1 class="h-lg">This invite has already been used</h1>
      <p class="muted">If it was you, log in to see your tasks.</p>
      <a class="btn" href="#/login">Log in</a></section>`;
    return;
  }

  if (session) {
    app.innerHTML = `<section class="screen narrow"><a class="back" href="#/">Handover</a>
      <h1 class="h-lg">Join ${owner}’s home as ${esc(info.member_name)}?</h1>
      <p class="error" id="err" hidden></p>
      <button class="btn" id="accept">Join</button>
      <button class="link" id="other">Use a different account</button></section>`;
    document.getElementById('accept').onclick = async (e) => {
      busy(e.target, true, 'Joining…');
      try { await api.acceptInvite(token); state.me = null; go('mine'); } catch (ex) {
        const err = document.getElementById('err'); err.textContent = ex.message; err.hidden = false; busy(e.target, false);
      }
    };
    document.getElementById('other').onclick = async () => {
      await api.logOut(); state.me = null; route();
    };
    return;
  }

  app.innerHTML = `
  <section class="screen narrow">
    <a class="back" href="#/">Handover</a>
    <h1 class="h-lg">${owner} added you to their home</h1>
    <p class="muted">Sign up to see the tasks ${owner} hands you, with the steps and where things are kept. You’ll only get the tasks meant for you.</p>
    <form id="join" class="stack" novalidate>
      <label>Your name<input name="name" required maxlength="40" value="${esc(info.member_name)}"></label>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Password<input name="password" type="password" required minlength="6" autocomplete="new-password">
        <span class="hint">At least 6 characters</span></label>
      <p class="error" id="err" hidden></p>
      <button class="btn" type="submit">Join ${owner}’s home</button>
    </form>
    <p class="muted center">Already have an account? <a href="#/login" id="login-instead">Log in to join</a></p>
  </section>`;
  document.getElementById('login-instead').onclick = () => pending.set(token);
  const form = document.getElementById('join');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const err = document.getElementById('err');
    const problem = !f.name.trim() ? 'Add your name.'
      : !/^\S+@\S+\.\S+$/.test(f.email) ? 'Enter a valid email.'
      : (f.password || '').length < 6 ? 'Password needs at least 6 characters.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const btn = form.querySelector('button');
    busy(btn, true, 'Joining…');
    try {
      await api.signUp(f.name.trim(), f.email.trim(), f.password, token);
      state.me = null;
      go('mine');
    } catch (ex) {
      err.textContent = /already registered/i.test(ex.message)
        ? 'This email already has an account. Log in to join instead.' : ex.message;
      err.hidden = false;
      busy(btn, false);
    }
  });
}

// Logged in, but neither runs a home nor has joined one (for example, an invite that was already used).
function welcomeScreen(me) {
  app.innerHTML = `
  <section class="screen narrow">
    <header class="topbar"><span class="brand">Handover</span><nav><button class="link" id="logout">Log out</button></nav></header>
    <h1 class="h-lg">You’re not part of a home yet</h1>
    <p class="muted">If someone in your family invited you, open their invite link again. Or start your own home to hand over tasks.</p>
    <form id="start" class="stack">
      <label>Your name<input name="name" required maxlength="40" value="${esc(me.name)}"></label>
      <button class="btn" type="submit">Start my own home</button>
    </form>
  </section>`;
  document.getElementById('logout').onclick = async () => { await api.logOut(); state.me = null; go(''); };
  document.getElementById('start').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    await api.createHousehold(name);
    state.me = null;
    go('family');
  });
}

async function mineScreen() {
  const load = async () => {
    const v = await api.myTasks();
    if (!v) { state.me = null; return go('welcome'); }
    renderMember(v);
  };
  await load();
  state.tick = setInterval(() => { if (!document.querySelector('.panel:not([hidden])')) load(); }, 60000);
}

function renderMember(v) {
  const open = v.tasks.filter((t) => t.status === 'open');
  const cant = v.tasks.filter((t) => t.status === 'cant');
  const done = v.tasks.filter((t) => t.status === 'done');
  const owner = esc(v.owner_name);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  app.innerHTML = `
  <section class="screen member">
    <header class="topbar"><span class="brand">Handover</span><nav><button class="link" id="logout">Log out</button></nav></header>
    <p class="hello">Hi ${esc(v.member.name)}</p>
    <h1 class="h-lg">${open.length ? `${owner} handed you ${open.length} ${open.length === 1 ? 'thing' : 'things'}` : 'Nothing for you right now'}</h1>
    ${!open.length ? `<p class="muted">When ${owner} hands you something, it shows up here.</p>` : ''}

    <div class="stack">${open.map((t) => memberCard(t, owner)).join('')}</div>

    ${cant.length ? `<h2 class="list-head">You told ${owner} you can’t</h2>
      <div class="list">${cant.map((t) => `<div class="row"><div><p class="row-title">${esc(t.title)}</p>
        <p class="row-sub">“${esc(t.member_note)}”</p></div></div>`).join('')}</div>` : ''}

    ${done.length ? `<h2 class="list-head">Done</h2><div class="list">${done.map((t) => `<div class="row">
      <div><p class="row-title">${esc(t.title)}</p><p class="row-sub">${when(t.done_at)}${t.done_photo_url ? ', photo sent' : ''}</p></div>
      ${Date.now() - new Date(t.done_at) < 15 * 60000 ? `<button class="link" data-undo="${t.id}">Undo</button>` : '<span class="tick">✓</span>'}
      </div>`).join('')}</div>` : ''}

    ${!standalone ? `<p class="tip">Tip: add this page to your home screen, so it’s one tap next time.</p>` : ''}
  </section>`;

  document.getElementById('logout').onclick = async () => { await api.logOut(); state.me = null; go(''); };

  const act = async (btn, id, action, note, minutes, msg, photo = null) => {
    busy(btn, true, '…');
    try {
      await api.updateMyTask(id, action, note, minutes, photo);
      toast(msg);
      renderMember(await api.myTasks());
    } catch (ex) { toast(ex.message); busy(btn, false); }
  };

  app.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => {
    const t = open.find((x) => x.id === b.dataset.done);
    if (!t.needs_photo) {
      act(b, t.id, 'done', null, null, `Done. ${v.owner_name} will see it.`);
      return;
    }
    // She asked for a photo: open the camera, then mark done with it.
    const input = b.closest('.card').querySelector('input[type=file]');
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      busy(b, true, 'Sending photo…');
      try {
        const url = await api.uploadPhoto(await shrink(file));
        busy(b, false);
        act(b, t.id, 'done', null, null, `Done. ${v.owner_name} will see your photo.`, url);
      } catch (ex) { toast(`Photo didn’t upload: ${ex.message}`); busy(b, false); }
    };
    input.click();
  }));
  app.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () =>
    act(b, b.dataset.undo, 'undo', null, null, 'Moved back to your list.')));

  wirePanels(app);
  app.querySelectorAll('.panel [data-mins]').forEach((c) => c.addEventListener('click', () => {
    c.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
  }));
  app.querySelectorAll('.panel [data-reason]').forEach((c) => c.addEventListener('click', () => {
    const ta = c.closest('.panel').querySelector('textarea');
    ta.value = c.textContent; ta.focus();
  }));
  app.querySelectorAll('[data-send-late]').forEach((b) => b.addEventListener('click', () => {
    const panel = b.closest('.panel');
    const mins = Number(panel.querySelector('.chip.on')?.dataset.mins);
    if (!mins) { toast('Pick how much more time you need.'); return; }
    act(b, b.dataset.sendLate, 'late', panel.querySelector('textarea').value, mins, `${v.owner_name} will see the new time.`);
  }));
  app.querySelectorAll('[data-send-cant]').forEach((b) => b.addEventListener('click', () => {
    const note = b.closest('.panel').querySelector('textarea').value.trim();
    if (!note) { toast(`Add a short reason so ${v.owner_name} knows what to do.`); return; }
    act(b, b.dataset.sendCant, 'cant', note, null, `Sent to ${v.owner_name}.`);
  }));
}

function memberCard(t, owner) {
  const late = new Date(t.due_at) < new Date();
  const note = t.owner_note
    ? `<p class="note-from"><span>${t.sent_back_count ? `${owner} sent this back` : `Note from ${owner}`}, ${ago(t.owner_note_at)}</span>${esc(t.owner_note)}</p>` : '';
  return `<article class="card ${late ? 'card-late' : ''}">
    <p class="card-title">${esc(t.title)}</p>
    <p class="due">${late ? `Was due ${when(t.due_at)}` : `By ${when(t.due_at)}`}</p>
    ${note}
    ${details(t)}
    ${t.needs_photo ? `<p class="photo-ask">${owner} asked for a photo when it’s done.</p>` : ''}
    <input type="file" accept="image/*" capture="environment" hidden>
    <button class="btn" data-done="${t.id}">${t.needs_photo ? 'Take photo and mark done' : 'Done'}</button>
    <div class="actions">
      <button class="link" data-open-panel="late">Need more time</button>
      <button class="link" data-open-panel="cant">Can’t do it</button>
    </div>
    <div class="panel" data-panel="late" hidden>
      <p class="label">How much more time?</p>
      <div class="chips"><button class="chip" data-mins="30">30 min</button><button class="chip" data-mins="60">1 hour</button><button class="chip" data-mins="120">2 hours</button></div>
      <textarea rows="2" maxlength="200" placeholder="Anything ${owner} should know (optional)"></textarea>
      <button class="btn btn-sm" data-send-late="${t.id}">Send new time</button>
    </div>
    <div class="panel" data-panel="cant" hidden>
      <p class="label">Tell ${owner} why</p>
      <div class="chips"><button class="chip" data-reason>Not at home</button><button class="chip" data-reason>Don’t have what I need</button><button class="chip" data-reason>Not sure how</button></div>
      <textarea rows="2" maxlength="200" placeholder="A few words"></textarea>
      <button class="btn btn-sm" data-send-cant="${t.id}">Tell ${owner}</button>
    </div>
  </article>`;
}
