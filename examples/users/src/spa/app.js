import { createTRPCProxyClient } from '@trpc/client';
import { grpcWebProxyLink } from '@trpc-proto/runtime/web';
import { appRouter } from '../router.ts';

const $ = (id) => document.getElementById(id);

function api() {
  return createTRPCProxyClient({
    links: [
      grpcWebProxyLink({
        router: appRouter,
        url: '',
        auth: { token: () => $('auth-token')?.value },
      }),
    ],
  });
}

const STATUS = ['backlog', 'todo', 'in_progress', 'done'];
const PRIORITY = ['none', 'low', 'medium', 'high', 'urgent'];
const STATUS_LABEL = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
};
const ROLE_LABEL = {
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};
const AVATAR_COLORS = ['#8b7cff', '#22d3ee', '#f5b942', '#3ee0a0', '#ff5d73'];

let issues = [];
let users = [];
let teams = [];
let stats = null;
let flashId = null;
let sub;

function enumTail(value, prefix) {
  if (value == null) return '';
  const raw = String(value);
  if (raw.startsWith(prefix)) return raw.slice(prefix.length).toLowerCase();
  return raw.toLowerCase();
}

function issueStatus(issue) {
  const s = enumTail(issue?.status, 'ISSUE_STATUS_');
  return STATUS.includes(s) ? s : 'todo';
}

function issuePriority(issue) {
  const p = enumTail(issue?.priority, 'ISSUE_PRIORITY_');
  return PRIORITY.includes(p) ? p : 'none';
}

function userRole(user) {
  const r = enumTail(user?.role, 'USER_ROLE_');
  return ROLE_LABEL[r] ? r : 'member';
}

function protoStatus(status) {
  return `ISSUE_STATUS_${status.toUpperCase()}`;
}

function protoPriority(priority) {
  return `ISSUE_PRIORITY_${priority.toUpperCase()}`;
}

function protoRole(role) {
  return `USER_ROLE_${role.toUpperCase()}`;
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function colorFor(id) {
  let n = 0;
  for (const ch of String(id || '')) n = (n + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[n];
}

function userById(id) {
  return users.find((u) => u.id === id);
}

function teamById(id) {
  return teams.find((t) => t.id === id);
}

function teamsOf(userId) {
  return teams.filter((team) => (team.memberIds || []).includes(userId));
}

function fail(err) {
  $('status').className = 'bad';
  $('status').textContent = String(err.message || err);
}

function ok(text) {
  $('status').className = 'ok';
  $('status').textContent = text;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'inbox';
  const [path, query] = raw.split('?');
  const [name, id] = path.split('/');
  return {
    name: name === 'team' ? 'people' : name,
    id,
    status: new URLSearchParams(query || '').get('status') || '',
  };
}

function markNav() {
  const { name, id } = parseRoute();
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.dataset.nav === name);
  }
  for (const link of document.querySelectorAll('.rail-key')) {
    link.classList.toggle('active', name === 'teams' && link.dataset.id === id);
  }
}

function setCrumb(text) {
  $('crumb').textContent = text;
}

function prioBars(priority) {
  return `<span class="prio ${priority}"><i></i><i></i><i></i><i></i></span>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function issueRow(issue, index) {
  const status = issueStatus(issue);
  const priority = issuePriority(issue);
  const person = userById(issue.assigneeId);
  const team = teamById(issue.teamId);
  const delay = Math.min(index, 12) * 28;
  const avatar = person
    ? `<span class="avatar" style="background:${colorFor(person.id)};margin-left:8px">${initials(person.name)}</span>`
    : '';
  const key = team ? `<span class="key" style="margin-right:8px">${escapeHtml(team.key)}</span>` : '';
  return `<article class="issue-row${flashId === issue.id ? ' flash' : ''}" data-id="${issue.id}" style="animation-delay:${delay}ms">
    <span class="id">${issue.id}</span>
    <span class="title">${key}${escapeHtml(issue.title)}</span>
    <span class="pill ${status}">${STATUS_LABEL[status]}</span>
    <span class="meta">${prioBars(priority)}${avatar}</span>
  </article>`;
}

function filtered(view, status, teamId) {
  let list = issues.slice();
  if (view === 'inbox') list = list.filter((issue) => issueStatus(issue) !== 'done');
  if (status) list = list.filter((issue) => issueStatus(issue) === status);
  if (teamId) list = list.filter((issue) => issue.teamId === teamId);
  return list;
}

function bindRows(root) {
  root.querySelectorAll('.issue-row').forEach((row) => {
    row.onclick = () => {
      location.hash = `#/issues/${row.dataset.id}`;
    };
  });
}

function listView(view, teamId) {
  const status = parseRoute().status;
  const list = filtered(view, status, teamId);
  const base = teamId ? `#/teams/${teamId}` : `#/${view}`;
  const chips = ['', ...STATUS]
    .map((value) => {
      const label = value ? STATUS_LABEL[value] : 'All';
      const on = status === value ? ' on' : '';
      const href = value ? `${base}?status=${value}` : base;
      return `<a class="chip${on}" href="${href}">${label}</a>`;
    })
    .join('');
  if (view === 'issues') {
    const groups = STATUS.map((key) => {
      const rows = list.filter((issue) => issueStatus(issue) === key);
      if (!rows.length) return '';
      return `<div class="group">${STATUS_LABEL[key]} · ${rows.length}</div>${rows.map(issueRow).join('')}`;
    }).join('');
    return `<div class="toolbar">${chips}</div>${groups || '<div class="empty">No issues yet</div>'}`;
  }
  return `<div class="toolbar">${chips}</div>${
    list.length ? list.map(issueRow).join('') : '<div class="empty">Inbox zero</div>'
  }`;
}

function optionList(values, labels, selected) {
  return values
    .map((value) => {
      const label = labels[value] || value;
      const sel = value === selected ? ' selected' : '';
      return `<option value="${value}"${sel}>${label}</option>`;
    })
    .join('');
}

function teamOptions(selected) {
  return `<option value="">No team</option>${teams
    .map(
      (team) =>
        `<option value="${team.id}"${team.id === selected ? ' selected' : ''}>${escapeHtml(team.key)} · ${escapeHtml(team.name)}</option>`,
    )
    .join('')}`;
}

function peopleOptions(selected) {
  return `<option value="">Unassigned</option>${users
    .map(
      (user) =>
        `<option value="${user.id}"${user.id === selected ? ' selected' : ''}>${escapeHtml(user.name)}</option>`,
    )
    .join('')}`;
}

function detailView(issue) {
  if (!issue) return `<div class="empty">Issue not found</div>`;
  const status = issueStatus(issue);
  const priority = issuePriority(issue);
  return `<div class="detail">
    <div>
      <div class="id">${issue.id}</div>
      <h1>${escapeHtml(issue.title)}</h1>
      <textarea id="issue-desc">${escapeHtml(issue.description || '')}</textarea>
    </div>
    <aside class="props">
      <label>Status</label>
      <select id="issue-status">${optionList(STATUS, STATUS_LABEL, status)}</select>
      <label>Priority</label>
      <select id="issue-priority">${optionList(PRIORITY, Object.fromEntries(PRIORITY.map((p) => [p, p])), priority)}</select>
      <label>Team</label>
      <select id="issue-team">${teamOptions(issue.teamId)}</select>
      <label>Assignee</label>
      <select id="issue-assignee">${peopleOptions(issue.assigneeId)}</select>
    </aside>
  </div>`;
}

function peopleView() {
  const rows = users
    .map((user, i) => {
      const role = userRole(user);
      const active = user.active !== false;
      const keys = teamsOf(user.id)
        .map((team) => `<span class="key">${escapeHtml(team.key)}</span>`)
        .join(' ');
      return `<tr class="${active ? '' : 'off'}" style="animation-delay:${i * 30}ms" data-id="${user.id}">
        <td>
          <span class="avatar" style="background:${colorFor(user.id)};display:inline-grid;margin-right:8px">${initials(user.name)}</span>
          ${escapeHtml(user.name)}
        </td>
        <td>${escapeHtml(user.email)}</td>
        <td>
          <select class="role-sel" data-id="${user.id}">
            ${optionList(['admin', 'member', 'guest'], ROLE_LABEL, role)}
          </select>
        </td>
        <td>${keys || '—'}</td>
        <td>${active ? 'Active' : 'Disabled'}</td>
        <td>
          <button class="tiny edit-user" data-id="${user.id}">Edit</button>
          <button class="tiny toggle-user" data-id="${user.id}">${active ? 'Disable' : 'Enable'}</button>
        </td>
      </tr>`;
    })
    .join('');
  return `<div class="hero">
      <div>
        <h1>People</h1>
        <p>${users.length} in the workspace · roles sync over gRPC</p>
      </div>
      <button class="primary" id="invite-open" type="button">Invite</button>
    </div>
    <table class="people">
      <thead>
        <tr><th>Name</th><th>Email</th><th>Role</th><th>Teams</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function load() {
  const client = api();
  const steps = [
    ['issue.list', () => client.issue.list.query({})],
    ['user.list', () => client.user.list.query({})],
    ['stats', () => client.org.workspace.stats.query()],
    ['team.list', () => client.team.list.query({})],
  ];
  for (const [name, fn] of steps) {
    try {
      const value = await fn();
      if (name === 'issue.list') issues = value.items || [];
      if (name === 'user.list') users = value.items || [];
      if (name === 'stats') stats = value;
      if (name === 'team.list') teams = value.items || [];
    } catch (err) {
      throw new Error(`${name}: ${err.message || err}`);
    }
  }
  paintRail();
}



function teamPage(team) {
  if (!team) return `<div class="empty">Team not found</div>`;
  const members = (team.memberIds || [])
    .map((id) => userById(id))
    .filter(Boolean);
  const outsiders = users.filter((user) => !(team.memberIds || []).includes(user.id));
  const chips = members
    .map(
      (user) => `<span class="member">
        <span class="avatar" style="background:${colorFor(user.id)}">${initials(user.name)}</span>
        ${escapeHtml(user.name)}
        <button type="button" class="drop-member" data-id="${user.id}" aria-label="Remove">×</button>
      </span>`,
    )
    .join('');
  const add = outsiders.length
    ? `<label class="member add-member">
        <span class="avatar plus">+</span>
        Add member
        <select id="add-member" aria-label="Add member">
          <option value="" selected>Choose a person</option>
          ${outsiders
            .map((user) => `<option value="${user.id}">${escapeHtml(user.name)}</option>`)
            .join('')}
        </select>
      </label>`
    : '';

  return `<div class="hero">
      <div>
        <span class="key">${escapeHtml(team.key)}</span>
        <h1>${escapeHtml(team.name)}</h1>
        <p>${escapeHtml(team.description || '')}</p>
      </div>
    </div>
    <div class="members">${chips}${add}</div>
    ${listView('issues', team.id)}`;
}

function workspaceView() {
  const labels = stats?.labels || {};
  const cells = ['backlog', 'todo', 'in_progress', 'done']
    .map(
      (key, i) =>
        `<div class="stat" style="animation-delay:${i * 50}ms"><b>${labels[key] ?? 0}</b><span>${STATUS_LABEL[key]}</span></div>`,
    )
    .join('');
  return `<div class="stats">${cells}
      <div class="stat" style="animation-delay:200ms"><b>${teams.length}</b><span>Teams</span></div>
      <div class="stat" style="animation-delay:250ms"><b>${users.length}</b><span>People</span></div>
    </div>
    <form class="form" id="pulse" style="margin-top:28px">
      <label style="color:var(--mute);font-size:12px">Workspace pulse · hello / echo</label>
      <input id="pulse-name" value="Ada Lovelace" />
      <input id="pulse-echo" value="analytical engine" />
      <button class="primary" type="submit">Ping backend</button>
      <pre id="pulse-out" style="margin:0;color:var(--mute);font-family:'JetBrains Mono',monospace;font-size:12px"></pre>
    </form>`;
}

function paintRail() {
  $('ws-name').textContent = stats?.name || 'analytical-engine';
  document.title = stats?.name || 'analytical-engine';

  $('ws-meta').textContent = `${users.length} people · ${teams.length} teams`;
  $('count-inbox').textContent = String(filtered('inbox').length || '');
  $('count-all').textContent = String(issues.length || '');
  $('rail-teams').innerHTML = teams
    .map(
      (team, i) => `<a class="rail-key" href="#/teams/${team.id}" data-id="${team.id}" style="animation-delay:${i * 40}ms">
        <span class="key">${escapeHtml(team.key)}</span>${escapeHtml(team.name)}
      </a>`,
    )
    .join('');
  $('rail-team').innerHTML = users
    .slice(0, 6)
    .map(
      (user, i) => `<div class="rail-person" style="animation-delay:${i * 40}ms">
        <span class="avatar" style="background:${colorFor(user.id)}">${initials(user.name)}</span>
        ${escapeHtml(user.name)}
      </div>`,
    )
    .join('');
  markNav();
}


function listen() {
  if (sub) return;
  sub = api().issue.onChange.subscribe(undefined, {
    onData(issue) {
      const idx = issues.findIndex((row) => row.id === issue.id);
      if (idx >= 0) issues[idx] = issue;
      else issues.unshift(issue);
      flashId = issue.id;
      paintRail();
      const { name, id } = parseRoute();
      if ((name === 'inbox' || name === 'issues' || name === 'teams') && !(name === 'issues' && id)) {
        void render(false);
      }
      ok('live update');
    },
    onError(err) {
      $('live').classList.remove('on');
      fail(err);
    },
  });
  $('live').classList.add('on');
}

function closeVeil() {
  const veil = $('veil');
  veil.hidden = true;
  veil.innerHTML = '';
}

function openComposer(teamId) {
  const veil = $('veil');
  veil.hidden = false;
  veil.innerHTML = `<form class="sheet" id="compose">
    <h2>New issue</h2>
    <input id="c-title" placeholder="Issue title" autofocus required />
    <textarea id="c-desc" placeholder="Description"></textarea>
    <select id="c-status">${optionList(STATUS, STATUS_LABEL, 'todo')}</select>
    <select id="c-priority">${optionList(PRIORITY, Object.fromEntries(PRIORITY.map((p) => [p, p])), 'none')}</select>
    <select id="c-team">${teamOptions(teamId || '')}</select>
    <select id="c-assignee">${peopleOptions('')}</select>
    <button class="primary" type="submit">Create issue</button>
  </form>`;
  $('compose').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const created = await api().issue.create.mutate({
        title: $('c-title').value,
        description: $('c-desc').value || undefined,
        status: protoStatus($('c-status').value),
        priority: protoPriority($('c-priority').value),
        teamId: $('c-team').value || undefined,
        assigneeId: $('c-assignee').value || undefined,
      });
      closeVeil();
      location.hash = `#/issues/${created.id}`;
    } catch (err) {
      fail(err);
    }
  };
}

function openTeamComposer() {
  const veil = $('veil');
  veil.hidden = false;
  veil.innerHTML = `<form class="sheet" id="compose-team">
    <h2>New team</h2>
    <input id="t-key" placeholder="Key · ENG" required />
    <input id="t-name" placeholder="Name" required />
    <textarea id="t-desc" placeholder="What this team owns"></textarea>
    <button class="primary" type="submit">Create team</button>
  </form>`;
  $('compose-team').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const created = await api().team.create.mutate({
        key: $('t-key').value,
        name: $('t-name').value,
        description: $('t-desc').value || undefined,
      });
      closeVeil();
      location.hash = `#/teams/${created.id}`;
      await render(true);
    } catch (err) {
      fail(err);
    }
  };
}

function openInvite() {
  const veil = $('veil');
  veil.hidden = false;
  const teamPick = `<option value="">No team yet</option>${teams
    .map((team) => `<option value="${team.id}">${escapeHtml(team.key)}</option>`)
    .join('')}`;
  veil.innerHTML = `<form class="sheet" id="invite">
    <h2>Invite person</h2>
    <input id="invite-name" placeholder="Full name" required />
    <input id="invite-email" type="email" placeholder="Email" required />
    <select id="invite-role">${optionList(['member', 'admin', 'guest'], ROLE_LABEL, 'member')}</select>
    <input id="invite-city" placeholder="City" value="London" />
    <select id="invite-team">${teamPick}</select>
    <button class="primary" type="submit">Invite</button>
  </form>`;
  $('invite').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const person = await api().user.create.mutate({
        name: $('invite-name').value,
        email: $('invite-email').value,
        role: protoRole($('invite-role').value),
        address: { city: $('invite-city').value || 'London' },
      });
      const teamId = $('invite-team').value;
      if (teamId) {
        await api().team.addMember.mutate({ teamId, userId: person.id });
      }
      closeVeil();
      location.hash = '#/people';
      await render(true);
      ok('invited');
    } catch (err) {
      fail(err);
    }
  };
}

function openUserEditor(user) {
  const veil = $('veil');
  veil.hidden = false;
  const role = userRole(user);
  veil.innerHTML = `<form class="sheet" id="edit-user">
    <h2>Edit ${escapeHtml(user.name)}</h2>
    <input id="u-name" value="${escapeHtml(user.name)}" required />
    <input id="u-email" type="email" value="${escapeHtml(user.email)}" required />
    <select id="u-role">${optionList(['admin', 'member', 'guest'], ROLE_LABEL, role)}</select>
    <input id="u-city" value="${escapeHtml(user.address?.city || '')}" placeholder="City" />
    <input id="u-tags" value="${escapeHtml((user.tags || []).join(', '))}" placeholder="tags, comma separated" />
    <button class="primary" type="submit">Save</button>
  </form>`;
  $('edit-user').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api().user.update.mutate({
        id: user.id,
        name: $('u-name').value,
        email: $('u-email').value,
        role: protoRole($('u-role').value),
        address: { city: $('u-city').value || 'London' },
        tags: $('u-tags')
          .value.split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      closeVeil();
      await render(true);
      ok('saved');
    } catch (err) {
      fail(err);
    }
  };
}

function openCommand() {
  const veil = $('veil');
  veil.hidden = false;
  const items = [
    { label: 'Go to Inbox', run: () => (location.hash = '#/inbox') },
    { label: 'Go to Issues', run: () => (location.hash = '#/issues') },
    { label: 'Go to People', run: () => (location.hash = '#/people') },
    { label: 'Go to Workspace', run: () => (location.hash = '#/workspace') },
    { label: 'New issue', run: () => openComposer() },
    { label: 'New team', run: openTeamComposer },
    { label: 'Invite person', run: openInvite },
    ...teams.map((team) => ({
      label: `Team ${team.key}  ${team.name}`,
      run: () => (location.hash = `#/teams/${team.id}`),
    })),
    ...users.map((user) => ({
      label: `Person  ${user.name}`,
      run: () => {
        location.hash = '#/people';
        openUserEditor(user);
      },
    })),
    ...issues.map((issue) => ({
      label: `${issue.id}  ${issue.title}`,
      run: () => (location.hash = `#/issues/${issue.id}`),
    })),
  ];
  let q = '';
  const paint = () => {
    const shown = items.filter((item) => item.label.toLowerCase().includes(q));
    $('cmdk-list').innerHTML = shown
      .slice(0, 12)
      .map(
        (item, i) =>
          `<div class="cmdk-item${i === 0 ? ' on' : ''}" data-i="${i}">${escapeHtml(item.label)}</div>`,
      )
      .join('');
    $('cmdk-list').onclick = (event) => {
      const node = event.target.closest('.cmdk-item');
      if (!node) return;
      closeVeil();
      shown[Number(node.dataset.i)]?.run();
    };
  };
  veil.innerHTML = `<div class="cmdk">
    <input id="cmdk-q" placeholder="Search issues, people, teams…" />
    <div class="cmdk-list" id="cmdk-list"></div>
  </div>`;
  paint();
  const input = $('cmdk-q');
  input.focus();
  input.oninput = () => {
    q = input.value.toLowerCase();
    paint();
  };
  input.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = items.filter((item) => item.label.toLowerCase().includes(q))[0];
      closeVeil();
      first?.run();
    }
  };
}

async function render(reload = true) {
  markNav();
  try {
    if (reload) await load();
    const { name, id } = parseRoute();
    const view = $('view');
    if (name === 'people') {
      setCrumb('People');
      view.innerHTML = peopleView();
      $('invite-open').onclick = openInvite;
      view.querySelectorAll('.edit-user').forEach((btn) => {
        btn.onclick = () => openUserEditor(userById(btn.dataset.id));
      });
      view.querySelectorAll('.toggle-user').forEach((btn) => {
        btn.onclick = async () => {
          const user = userById(btn.dataset.id);
          try {
            await api().user.update.mutate({
              id: user.id,
              active: user.active === false,
            });
            await render(true);
          } catch (err) {
            fail(err);
          }
        };
      });
      view.querySelectorAll('.role-sel').forEach((sel) => {
        sel.onchange = async (event) => {
          try {
            await api().user.update.mutate({
              id: sel.dataset.id,
              role: protoRole(event.target.value),
            });
            ok('role updated');
          } catch (err) {
            fail(err);
          }
        };
      });
      return;
    }
    if (name === 'teams') {
      const team = teamById(id) || (id ? await api().team.getById.query({ id }) : null);
      setCrumb(team ? `${team.key} · ${team.name}` : 'Team');
      view.innerHTML = teamPage(team);
      bindRows(view);
      const add = $('add-member');
      if (add) {
        add.onchange = async () => {
          if (!add.value) return;
          try {
            await api().team.addMember.mutate({ teamId: team.id, userId: add.value });
            await render(true);
            ok('member added');
          } catch (err) {
            fail(err);
          }
        };
      }
      view.querySelectorAll('.drop-member').forEach((btn) => {
        btn.onclick = async (event) => {
          event.stopPropagation();
          try {
            await api().team.removeMember.mutate({ teamId: team.id, userId: btn.dataset.id });
            await render(true);
            ok('removed');
          } catch (err) {
            fail(err);
          }
        };
      });
      return;
    }
    if (name === 'workspace') {
      setCrumb('Workspace');
      view.innerHTML = workspaceView();
      $('pulse').onsubmit = async (event) => {
        event.preventDefault();
        try {
          const hello = await api().hello.query({
            fullName: $('pulse-name').value,
            description: 'workspace pulse',

          });
          const echo = await api().echo.query($('pulse-echo').value);
          $('pulse-out').textContent = `${hello.message}\necho ${echo}`;
        } catch (err) {
          fail(err);
        }
      };
      return;
    }
    if (name === 'issues' && id) {
      const issue =
        issues.find((row) => row.id === id) || (await api().issue.getById.query({ id }));
      setCrumb(issue?.id || 'Issue');
      view.innerHTML = detailView(issue);
      const save = async (patch) => {
        try {
          const next = await api().issue.update.mutate(patch);
          const idx = issues.findIndex((row) => row.id === next.id);
          if (idx >= 0) issues[idx] = next;
          ok('saved');
        } catch (err) {
          fail(err);
        }
      };
      $('issue-status').onchange = (event) =>
        save({ id, status: protoStatus(event.target.value) });
      $('issue-priority').onchange = (event) =>
        save({ id, priority: protoPriority(event.target.value) });
      $('issue-assignee').onchange = (event) =>
        save({ id, assigneeId: event.target.value || '' });
      $('issue-team').onchange = (event) => save({ id, teamId: event.target.value || '' });
      $('issue-desc').onchange = (event) => save({ id, description: event.target.value });
      return;
    }
    setCrumb(name === 'issues' ? 'All issues' : 'Inbox');
    view.innerHTML = listView(name === 'issues' ? 'issues' : 'inbox');
    bindRows(view);
  } catch (err) {
    fail(err);
  }
}

$('new-issue').onclick = () => {
  const { name, id } = parseRoute();
  openComposer(name === 'teams' ? id : undefined);
};
$('new-team').onclick = () => openTeamComposer();
$('search-btn').onclick = () => openCommand();
$('veil').onclick = (event) => {
  if (event.target === $('veil')) closeVeil();
};

window.addEventListener('hashchange', () => {
  flashId = null;
  void render(false);
});

window.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
    return;
  }
  if (event.key === 'Escape') closeVeil();
  if (typing) return;
  if (event.key.toLowerCase() === 'c') {
    event.preventDefault();
    openComposer();
  }
  if (event.key.toLowerCase() === 't') {
    event.preventDefault();
    openTeamComposer();
  }
});

ok('ready');
listen();
void render(true);
