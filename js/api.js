// Everything that talks to Supabase lives here, so screens stay simple.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export const api = {
  async session() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  // invite = the token from a family invite link. Without it, a new home is created.
  async signUp(name, email, password, invite = null) {
    const meta = invite ? { name, invite } : { name };
    const data = check(await sb.auth.signUp({ email, password, options: { data: meta } }));
    if (!data.session) {
      throw new Error('Check your email to confirm your account, then log in.');
    }
    return data.session;
  },

  async logIn(email, password) {
    return check(await sb.auth.signInWithPassword({ email, password })).session;
  },

  async logOut() {
    await sb.auth.signOut();
  },

  // Who is logged in: the person who runs a home, a family member, or neither yet.
  async whoAmI() {
    const homes = check(await sb.from('households').select('id, owner_name').limit(1));
    if (homes.length) return { kind: 'owner', household: homes[0] };
    const { data: u } = await sb.auth.getUser();
    const mine = check(await sb.from('members').select('id').eq('user_id', u.user.id).limit(1));
    if (mine.length) return { kind: 'member' };
    return { kind: 'none', name: u.user?.user_metadata?.name || '' };
  },

  async createHousehold(name) {
    const { data: u } = await sb.auth.getUser();
    return check(await sb.from('households')
      .insert({ owner_id: u.user.id, owner_name: name })
      .select('id, owner_name').single());
  },

  async members() {
    return check(await sb.from('members')
      .select('id, name, token, user_id, joined_at, last_opened_at, created_at')
      .order('created_at'));
  },

  async addMember(householdId, name) {
    return check(await sb.from('members')
      .insert({ household_id: householdId, name })
      .select('id, name, token, user_id, joined_at, last_opened_at, created_at').single());
  },

  async removeMember(id) {
    check(await sb.from('members').delete().eq('id', id));
  },

  // Open and stuck tasks, plus anything finished since midnight.
  async activeTasks() {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return check(await sb.from('tasks')
      .select('*')
      .or(`status.in.(open,cant),and(status.eq.done,done_at.gte."${midnight.toISOString()}")`)
      .order('due_at'));
  },

  // Past tasks she can reuse, newest first, one per title.
  async savedTasks() {
    const rows = check(await sb.from('tasks')
      .select('title, how_to, where_is, photo_url, created_at')
      .order('created_at', { ascending: false })
      .limit(100));
    const seen = new Set();
    return rows.filter((r) => {
      const key = r.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  },

  async createTask(task) {
    return check(await sb.from('tasks')
      .insert({ ...task, first_due_at: task.due_at })
      .select('*').single());
  },

  async updateTask(id, patch) {
    return check(await sb.from('tasks').update(patch).eq('id', id).select('*').single());
  },

  async uploadPhoto(blob) {
    const { data: u } = await sb.auth.getUser();
    const path = `${u.user.id}/${crypto.randomUUID()}.jpg`;
    check(await sb.storage.from('task-photos').upload(path, blob, { contentType: 'image/jpeg' }));
    return sb.storage.from('task-photos').getPublicUrl(path).data.publicUrl;
  },

  // Calls onChange whenever any of her tasks change. Returns a stop function.
  watchTasks(householdId, onChange) {
    const channel = sb.channel(`tasks-${householdId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `household_id=eq.${householdId}` },
        (payload) => onChange(payload))
      .subscribe();
    return () => sb.removeChannel(channel);
  },

  // Family member side.
  async inviteInfo(token) {
    return check(await sb.rpc('invite_info', { p_token: token }));
  },

  async acceptInvite(token) {
    check(await sb.rpc('accept_invite', { p_token: token }));
  },

  async myTasks() {
    return check(await sb.rpc('my_tasks'));
  },

  async updateMyTask(taskId, action, note = null, minutes = null) {
    check(await sb.rpc('update_my_task', {
      p_task_id: taskId, p_action: action, p_note: note, p_minutes: minutes,
    }));
  },
};
