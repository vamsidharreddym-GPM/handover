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

  async signUp(name, email, password) {
    const data = check(await sb.auth.signUp({ email, password, options: { data: { name } } }));
    if (!data.session) {
      throw new Error('Check your email to confirm your account, then log in.');
    }
    await this.household(name);
    return data.session;
  },

  async logIn(email, password) {
    return check(await sb.auth.signInWithPassword({ email, password })).session;
  },

  async logOut() {
    await sb.auth.signOut();
  },

  // Returns her household, creating it if the sign-up trigger did not.
  async household(nameIfMissing) {
    const rows = check(await sb.from('households').select('id, owner_name').limit(1));
    if (rows.length) return rows[0];
    const { data: u } = await sb.auth.getUser();
    const name = nameIfMissing || u.user?.user_metadata?.name || 'Me';
    return check(await sb.from('households')
      .insert({ owner_id: u.user.id, owner_name: name })
      .select('id, owner_name').single());
  },

  async members() {
    return check(await sb.from('members')
      .select('id, name, token, last_opened_at, created_at')
      .order('created_at'));
  },

  async addMember(householdId, name) {
    return check(await sb.from('members')
      .insert({ household_id: householdId, name })
      .select('id, name, token, last_opened_at, created_at').single());
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

  // Family member side: the link token is the only key.
  async memberView(token) {
    return check(await sb.rpc('member_view', { p_token: token }));
  },

  async memberUpdate(token, taskId, action, note = null, minutes = null) {
    check(await sb.rpc('member_update', {
      p_token: token, p_task_id: taskId, p_action: action, p_note: note, p_minutes: minutes,
    }));
  },
};
