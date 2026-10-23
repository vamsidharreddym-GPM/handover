import { api } from './api.js';

const app = document.getElementById('app');
const state = { household: null, members: [], tasks: [], stopWatch: null, tick: null };

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

function memberLink(m) {
  return `${location.origin}${location.pathname}#/m/${m.token}`;
}

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

const routes = {
  '': landing,
  login: () => authScreen('login'),
  signup: () => authScreen('signup'),
  home,
  new: newTask,
  family,
};

async function route() {
  stopLive();
  window.scrollTo(0, 0);
  const [path, arg] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (path === 'm' && arg) return await memberScreen(arg);
    const view = routes[path] || landing;
    const needsLogin = ['home', 'new', 'family'].includes(path);
    const session = await api.session();
    if (needsLogin && !session) return go('login');
    if (session && ['', 'login', 'signup'].includes(path)) return go('home');
    if (session && !state.household) state.household = await api.household();
    await view();
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
      <li><strong>Send their link once.</strong> They open it, see the steps, and tap Done. If they’re stuck, they tell you from there.</li>
      <li><strong>Stop checking.</strong> Your screen only lights up when something needs you.</li>
    </ol>

    <p class="foot muted">Got a link from your family? Just open that link. You don’t need an account.</p>
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
      state.household = await api.household();
      go(signup ? 'family' : 'home');
    } catch (ex) {
      err.textContent = /invalid login/i.test(ex.message) ? 'Email or password is wrong.' : ex.message;
      err.hidden = false;
      busy(btn, false);
    }
  });
}

/* ---------- her home ---------- */

async function loadHome() {
  [state.members, state.tasks] = await Promise.all([api.members(), api.activeTasks()]);
}

async function home() {
  await loadHome();
  renderHome();
  state.stopWatch = api.watchTasks(state.household.id, async (p) => {
    const before = p.old && state.tasks.find((t) => t.id === p.old.id);
    await loadHome();
    renderHome();
    const t = p.new;
    if (t && before && before.status !== t.status) {
      const who = nameOf(t.member_id) || 'Someone';
      if (t.status === 'cant') { toast(`${who} can’t do “${t.title}”`); navigator.vibrate?.(200); }
      if (t.status === 'done' && t.done_by === 'member') toast(`${who} finished “${t.title}”`);
    }
  });
  state.tick = setInterval(renderHome, 60000);
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
        : 'Nothing handed over yet today.'}</p>`;

  app.innerHTML = `
  <section class="screen with-bar">
    <header class="topbar">
      <span class="brand">Handover</span>
      <nav><a href="#/family">Family</a><button class="link" id="logout">Log out</button></nav>
    </header>
    <p class="hello">Hi ${esc(household.owner_name)}</p>
    ${headline}

    ${needs.length ? `<div class="stack">${needs.map(needCard).join('')}</div>` : ''}

    ${onTrack.length ? `<h2 class="list-head">On track</h2>
      <div class="list">${onTrack.map(trackRow).join('')}</div>` : ''}

    ${done.length ? `<details class="done-box"><summary>${done.length} done today</summary>
      <div class="list">${done.map(doneRow).join('')}</div></details>` : ''}

    ${!members.length ? `<div class="empty">
      <p>First, add the people you hand tasks to.</p>
      <a class="btn btn-quiet" href="#/family">Add family</a></div>`
    : !tasks.length ? `<div class="empty"><p>Handed over tasks will show here. You’ll only hear about the ones that need you.</p></div>` : ''}

    <div class="bar"><a class="btn" href="#/new">Hand over a task</a></div>
  </section>`;

  document.getElementById('logout').onclick = async () => {
    await api.logOut(); state.household = null; go('');
  };
  app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onHomeAction));
}

function details(t) {
  return `${t.how_to ? `<p class="detail"><span>How</span>${esc(t.how_to)}</p>` : ''}
    ${t.where_is ? `<p class="detail"><span>Where</span>${esc(t.where_is)}</p>` : ''}
    ${/^https:\/\//.test(t.photo_url || '') ? `<a href="${esc(t.photo_url)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(t.photo_url)}" alt="Photo for ${esc(t.title)}"></a>` : ''}`;
}

function needCard(t) {
  const who = nameOf(t.member_id);
  let why;
  let primary;
  if (!t.member_id) {
    why = '<p class="who">No one has this task now</p>';
    primary = `<button class="btn btn-sm" data-act="reassign" data-id="${t.id}">Give it to someone</button>`;
  } else if (t.status === 'cant') {
    why = `<p class="who">${esc(who)} can’t do it</p>
      ${t.member_note ? `<blockquote>“${esc(t.member_note)}”</blockquote>` : ''}`;
    primary = `<button class="btn btn-sm" data-act="reassign" data-id="${t.id}">Give it to someone else</button>`;
  } else {
    const seen = t.seen_at ? `${esc(who)} saw it ${ago(t.seen_at)}` : `${esc(who)} hasn’t opened it yet`;
    why = `<p class="who">Was due ${when(t.due_at)}. ${seen}.</p>
      ${t.member_note ? `<blockquote>“${esc(t.member_note)}”</blockquote>` : ''}`;
    primary = `<button class="btn btn-sm" data-act="remind" data-id="${t.id}">Remind ${esc(who)}</button>`;
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
        <p class="row-sub">${esc(nameOf(t.member_id))}, by ${when(t.due_at)}${moved ? ' (moved)' : ''}</p>
        ${moved && t.member_note ? `<p class="row-note">“${esc(t.member_note)}”</p>` : ''}</div>
      <span class="pill ${t.seen_at ? 'pill-seen' : ''}">${t.seen_at ? 'Seen' : 'Not opened'}</span>
    </summary>
    <div class="row-more">${details(t) || '<p class="muted">No extra instructions.</p>'}
      <div class="actions"><button class="link" data-act="drop" data-id="${t.id}">Drop it</button></div></div>
  </details>`;
}

function doneRow(t) {
  const by = t.done_by === 'owner' ? 'You' : esc(nameOf(t.member_id) || 'Done');
  return `<div class="row"><div><p class="row-title">${esc(t.title)}</p>
    <p class="row-sub">${by}, ${when(t.done_at)}</p></div><span class="tick" aria-label="Done">✓</span></div>`;
}

async function onHomeAction(e) {
  const btn = e.currentTarget;
  const t = state.tasks.find((x) => x.id === btn.dataset.id);
  if (!t) return;
  const act = btn.dataset.act;
  try {
    if (act === 'remind') {
      const m = state.members.find((x) => x.id === t.member_id);
      await shareLink(`Reminder: “${t.title}” was due ${when(t.due_at)}. Tap Done here once it’s finished.`, memberLink(m));
      return;
    }
    if (act === 'reassign') return pickPerson(t);
    busy(btn, true, '…');
    if (act === 'more') await api.updateTask(t.id, { due_at: new Date(Date.now() + 3600000).toISOString() });
    if (act === 'self') await api.updateTask(t.id, { status: 'done', done_by: 'owner', done_at: new Date().toISOString() });
    if (act === 'drop') await api.updateTask(t.id, { status: 'cancelled' });
    toast(act === 'drop' ? 'Dropped.' : act === 'self' ? 'Marked as done by you.' : 'Moved by an hour.');
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
      if (!m.last_opened_at) askToSendLink(m);
    } catch (err) { toast(err.message); busy(b, false); }
  }));
}

function askToSendLink(m) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Send link">
    <p class="h-md">${esc(m.name)} hasn’t opened their link yet</p>
    <p class="muted">Send it once. After that, every task you give ${esc(m.name)} shows up there.</p>
    <button class="btn" data-send>Send ${esc(m.name)} the link</button>
    <button class="link" data-close>Later</button></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.dataset.close !== undefined) sheet.remove(); });
  sheet.querySelector('[data-send]').onclick = async () => {
    await shareLink(`Hi ${m.name}, I’ll put home tasks for you here, with the details. Open it, and tap Done when finished. Save it to your home screen.`, memberLink(m));
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

async function newTask() {
  const [members, saved] = await Promise.all([api.members(), api.savedTasks()]);
  state.members = members;
  if (!members.length) { toast('Add someone first.'); return go('family'); }
  const opts = dueOptions();
  let photoUrl = null;

  app.innerHTML = `
  <section class="screen with-bar">
    <a class="back" href="#/home">Home</a>
    <h1 class="h-lg">Hand over a task</h1>
    ${saved.length ? `<div class="saved"><p class="label">Use one you’ve written before</p>
      <div class="chips">${saved.map((s, i) => `<button type="button" class="chip" data-saved="${i}">${esc(s.title)}</button>`).join('')}</div></div>` : ''}
    <form id="task" class="stack" novalidate>
      <label>What needs doing<input name="title" required maxlength="80" placeholder="Hang the washed clothes"></label>
      <label><span class="lbl">How you like it done<span class="opt">optional</span></span>
        <textarea name="how_to" maxlength="600" rows="3" placeholder="Shirts on hangers. Towels on the balcony line, not the bedroom."></textarea></label>
      <label><span class="lbl">Where things are kept<span class="opt">optional</span></span>
        <textarea name="where_is" maxlength="300" rows="2" placeholder="Pegs are in the blue tub under the sink."></textarea></label>
      <div class="photo-field">
        <label class="btn btn-quiet btn-sm file-btn">Add a photo<input type="file" name="photo" accept="image/*" hidden></label>
        <div id="photo-preview"></div>
      </div>

      <fieldset><legend>By when</legend>
        <div class="chips" id="due-chips">
          ${opts.map(([label, d], i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-due="${d.toISOString()}">${label}</button>`).join('')}
          <button type="button" class="chip" data-due="custom">Pick a time</button>
        </div>
        <input type="datetime-local" name="custom_due" id="custom-due" hidden min="${toLocalInput(new Date())}">
      </fieldset>

      <fieldset><legend>Who will do it</legend>
        <div class="chips" id="who-chips">
          ${members.map((m, i) => `<button type="button" class="chip ${members.length === 1 && i === 0 ? 'on' : ''}" data-who="${m.id}">${esc(m.name)}</button>`).join('')}
        </div>
      </fieldset>
      <p class="error" id="err" hidden></p>
      <div class="bar"><button class="btn" type="submit">Hand it over</button></div>
    </form>
  </section>`;

  const form = document.getElementById('task');
  const err = document.getElementById('err');
  const pick = (group, btn) => { group.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); btn.classList.add('on'); };

  const dueChips = document.getElementById('due-chips');
  const custom = document.getElementById('custom-due');
  dueChips.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    pick(dueChips, c);
    custom.hidden = c.dataset.due !== 'custom';
    if (!custom.hidden) custom.focus();
  }));
  const whoChips = document.getElementById('who-chips');
  whoChips.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => pick(whoChips, c)));

  const preview = document.getElementById('photo-preview');
  const showPhoto = (url) => {
    preview.innerHTML = url ? `<img class="thumb" src="${esc(url)}" alt="Task photo"><button type="button" class="link" id="rm-photo">Remove photo</button>` : '';
    document.getElementById('rm-photo')?.addEventListener('click', () => { photoUrl = null; showPhoto(null); });
  };

  app.querySelectorAll('[data-saved]').forEach((c) => c.addEventListener('click', () => {
    const s = saved[Number(c.dataset.saved)];
    form.title.value = s.title;
    form.how_to.value = s.how_to || '';
    form.where_is.value = s.where_is || '';
    photoUrl = s.photo_url || null;
    showPhoto(photoUrl);
    toast('Filled in from last time. Change anything you need.');
  }));

  form.photo.addEventListener('change', async () => {
    const file = form.photo.files[0];
    if (!file) return;
    preview.innerHTML = '<p class="muted">Adding photo…</p>';
    try {
      photoUrl = await api.uploadPhoto(await shrink(file));
      showPhoto(photoUrl);
    } catch (ex) { preview.innerHTML = ''; toast(`Photo didn’t upload: ${ex.message}`); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const title = form.title.value.trim();
    const dueBtn = dueChips.querySelector('.on');
    const whoBtn = whoChips.querySelector('.on');
    let due = dueBtn?.dataset.due;
    if (due === 'custom') due = custom.value ? new Date(custom.value).toISOString() : null;
    const problem = !title ? 'Write what needs doing.'
      : !due ? 'Pick when it should be done by.'
      : new Date(due) < new Date() ? 'That time has already passed.'
      : !whoBtn ? 'Pick who will do it.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
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
        due_at: due,
      });
      const m = members.find((x) => x.id === whoBtn.dataset.who);
      toast(`Handed over to ${m.name}.`);
      go('home');
      if (!m.last_opened_at) setTimeout(() => askToSendLink(m), 400);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; busy(btn, false); }
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

async function family() {
  state.members = await api.members();
  const ms = state.members;
  app.innerHTML = `
  <section class="screen">
    <a class="back" href="#/home">Home</a>
    <h1 class="h-lg">Family</h1>
    <p class="muted">Everyone gets their own link. They open it to see what you’ve handed them. No app or password for them.</p>
    <div class="list">
      ${ms.map((m) => `<div class="row">
        <div><p class="row-title">${esc(m.name)}</p>
          <p class="row-sub">${m.last_opened_at ? `Opened their link ${ago(m.last_opened_at)}` : 'Hasn’t opened their link yet'}</p></div>
        <div class="row-actions">
          <button class="btn btn-sm ${m.last_opened_at ? 'btn-quiet' : ''}" data-send="${m.id}">Send link</button>
          <button class="link" data-rm="${m.id}" aria-label="Remove ${esc(m.name)}">Remove</button>
        </div></div>`).join('')}
    </div>
    <form id="add" class="add-row">
      <label class="grow">Add someone<input name="name" required maxlength="40" placeholder="Ravi"></label>
      <button class="btn btn-sm" type="submit">Add</button>
    </form>
    ${ms.length ? '<a class="btn btn-quiet next" href="#/new">Hand over a task</a>' : ''}
  </section>`;

  app.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => {
    const m = ms.find((x) => x.id === b.dataset.send);
    shareLink(`Hi ${m.name}, I’ll put home tasks for you here, with the details. Open it, and tap Done when finished. Save it to your home screen.`, memberLink(m));
  }));
  app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const m = ms.find((x) => x.id === b.dataset.rm);
    if (!window.confirm(`Remove ${m.name}? Their link will stop working.`)) return;
    await api.removeMember(m.id);
    toast(`${m.name} removed.`);
    family();
  }));
  document.getElementById('add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const btn = e.target.querySelector('button');
    busy(btn, true, '…');
    try {
      const m = await api.addMember(state.household.id, name);
      toast(`${m.name} added.`);
      await family();
    } catch (ex) { toast(ex.message); busy(btn, false); }
  });
}

/* ---------- family member's screen ---------- */

async function memberScreen(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    app.innerHTML = '<section class="screen"><h1 class="h-md">This link doesn’t look right</h1><p class="muted">Ask for the link again.</p></section>';
    return;
  }
  const load = async () => {
    const v = await api.memberView(token);
    if (!v) {
      app.innerHTML = '<section class="screen"><h1 class="h-md">This link isn’t active any more</h1><p class="muted">Ask for a new link.</p></section>';
      return;
    }
    renderMember(token, v);
  };
  await load();
  state.tick = setInterval(() => { if (!document.querySelector('.panel:not([hidden])')) load(); }, 60000);
}

function renderMember(token, v) {
  const open = v.tasks.filter((t) => t.status === 'open');
  const cant = v.tasks.filter((t) => t.status === 'cant');
  const done = v.tasks.filter((t) => t.status === 'done');
  const owner = esc(v.owner_name);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  app.innerHTML = `
  <section class="screen member">
    <header class="topbar"><span class="brand">Handover</span></header>
    <p class="hello">Hi ${esc(v.member.name)}</p>
    <h1 class="h-lg">${open.length ? `${owner} handed you ${open.length} ${open.length === 1 ? 'thing' : 'things'}` : 'Nothing for you right now'}</h1>
    ${!open.length ? `<p class="muted">When ${owner} hands you something, it shows up here.</p>` : ''}

    <div class="stack">${open.map((t) => memberCard(t, owner)).join('')}</div>

    ${cant.length ? `<h2 class="list-head">You told ${owner} you can’t</h2>
      <div class="list">${cant.map((t) => `<div class="row"><div><p class="row-title">${esc(t.title)}</p>
        <p class="row-sub">“${esc(t.member_note)}”</p></div></div>`).join('')}</div>` : ''}

    ${done.length ? `<h2 class="list-head">Done</h2><div class="list">${done.map((t) => `<div class="row">
      <div><p class="row-title">${esc(t.title)}</p><p class="row-sub">${when(t.done_at)}</p></div>
      ${Date.now() - new Date(t.done_at) < 15 * 60000 ? `<button class="link" data-undo="${t.id}">Undo</button>` : '<span class="tick">✓</span>'}
      </div>`).join('')}</div>` : ''}

    ${!standalone ? `<p class="tip">Tip: add this page to your home screen, so it’s one tap next time.</p>` : ''}
  </section>`;

  const act = async (btn, id, action, note, minutes, msg) => {
    busy(btn, true, '…');
    try {
      await api.memberUpdate(token, id, action, note, minutes);
      toast(msg);
      renderMember(token, await api.memberView(token));
    } catch (ex) { toast(ex.message); busy(btn, false); }
  };

  app.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () =>
    act(b, b.dataset.done, 'done', null, null, `Done. ${v.owner_name} will see it.`)));
  app.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () =>
    act(b, b.dataset.undo, 'undo', null, null, 'Moved back to your list.')));

  app.querySelectorAll('[data-open-panel]').forEach((b) => b.addEventListener('click', () => {
    const card = b.closest('.card');
    card.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.openPanel || !p.hidden; });
  }));
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
  return `<article class="card ${late ? 'card-late' : ''}">
    <p class="card-title">${esc(t.title)}</p>
    <p class="due">${late ? `Was due ${when(t.due_at)}` : `By ${when(t.due_at)}`}</p>
    ${details(t)}
    <button class="btn" data-done="${t.id}">Done</button>
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
