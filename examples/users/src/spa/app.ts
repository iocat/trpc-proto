import { createTRPCClient } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import { protoSchema } from '../../generated/schema.js';
import type { AppRouter } from '../router.js';

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type IssueRecord = RouterOutputs['issue']['getById'];
type UserRecord = RouterOutputs['user']['getById'];
type TeamRecord = RouterOutputs['team']['getById'];
type WorkspaceStatsRecord = RouterOutputs['org']['workspace']['stats'];
type IssueUpdate = RouterInputs['issue']['update'];
type IssueStatus = IssueRecord['status'];
type IssuePriority = IssueRecord['priority'];
type UserRole = UserRecord['role'];
type IssueViewMode = 'list' | 'board';

function $(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as HTMLInputElement;
}

function api() {
  return createTRPCClient<AppRouter>({
    links: [
      grpcWebLink<AppRouter>({
        schema: protoSchema,
        url: '',
        encoding: 'base64',
        compress: false,
        auth: { token: () => $('auth-token').value },
      }),
    ],
  });
}

const STATUS = ['backlog', 'todo', 'in_progress', 'done'] as const;
const PRIORITY = ['none', 'low', 'medium', 'high', 'urgent'] as const;
const ROLE = ['admin', 'member', 'guest'] as const;
const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
};
const PRIORITY_LABEL = Object.fromEntries(
  PRIORITY.map((priority) => [priority, priority]),
) as Record<IssuePriority, string>;
const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};
const AVATAR_COLORS = ['#8b7cff', '#22d3ee', '#f5b942', '#3ee0a0', '#ff5d73'];

let issues: IssueRecord[] = [];
let users: UserRecord[] = [];
let teams: TeamRecord[] = [];
let stats: WorkspaceStatsRecord | null = null;
let flashId: string | null = null;
let sub: { unsubscribe(): void } | undefined;
let issueQuery = '';
let issuePriorityFilter: IssuePriority | '' = '';
let issueAssigneeFilter = '';
let issueViewMode: IssueViewMode =
  localStorage.getItem('issue-view') === 'board' ? 'board' : 'list';

function enumTail(value: unknown, prefix: string): string {
  if (value == null) return '';
  const raw = String(value);
  if (raw.startsWith(prefix)) return raw.slice(prefix.length).toLowerCase();
  return raw.toLowerCase();
}

function issueStatus(issue?: IssueRecord): IssueStatus {
  const status = enumTail(issue?.status, 'ISSUE_STATUS_') as IssueStatus;
  return STATUS.includes(status) ? status : 'todo';
}

function issuePriority(issue?: IssueRecord): IssuePriority {
  const priority = enumTail(
    issue?.priority,
    'ISSUE_PRIORITY_',
  ) as IssuePriority;
  return PRIORITY.includes(priority) ? priority : 'none';
}

function userRole(user?: UserRecord): UserRole {
  const role = enumTail(user?.role, 'USER_ROLE_') as UserRole;
  return ROLE.includes(role) ? role : 'member';
}

function protoStatus(status: string): IssueStatus {
  return status as IssueStatus;
}

function protoPriority(priority: string): IssuePriority {
  return priority as IssuePriority;
}

function protoRole(role: string): UserRole {
  return role as UserRole;
}

function initials(name: string | undefined): string {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function colorFor(id: string): string {
  let n = 0;
  for (const ch of id) n = (n + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[n]!;
}

function userById(id: string | undefined): UserRecord | undefined {
  return users.find((user) => user.id === id);
}

function teamById(id: string | undefined): TeamRecord | undefined {
  return teams.find((team) => team.id === id);
}

function teamsOf(userId: string): TeamRecord[] {
  return teams.filter((team) => team.memberIds.includes(userId));
}

function fail(err: unknown): void {
  $('status').className = 'bad';
  $('status').textContent = err instanceof Error ? err.message : String(err);
}

function ok(text: string): void {
  $('status').className = 'ok';
  $('status').textContent = text;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'inbox';
  const [path = 'inbox', query] = raw.split('?');
  const [name = 'inbox', id] = path.split('/');
  return {
    name: name === 'team' ? 'people' : name,
    id,
    status: new URLSearchParams(query || '').get('status') || '',
  };
}

function markNav(): void {
  const { name, id } = parseRoute();
  for (const link of document.querySelectorAll<HTMLElement>('nav a')) {
    link.classList.toggle('active', link.dataset.nav === name);
  }
  for (const link of document.querySelectorAll<HTMLElement>('.rail-key')) {
    link.classList.toggle('active', name === 'teams' && link.dataset.id === id);
  }
}

function setCrumb(text: string): void {
  $('crumb').textContent = text;
}

function prioBars(priority: IssuePriority): string {
  return `<span class="prio ${priority}"><i></i><i></i><i></i><i></i></span>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function issueRow(issue: IssueRecord, index: number): string {
  const status = issueStatus(issue);
  const priority = issuePriority(issue);
  const person = userById(issue.assigneeId);
  const team = teamById(issue.teamId);
  const delay = Math.min(index, 12) * 28;
  const avatar = person
    ? `<span class="avatar" style="background:${colorFor(person.id)};margin-left:8px">${initials(person.name)}</span>`
    : '';
  const key = team
    ? `<span class="key" style="margin-right:8px">${escapeHtml(team.key)}</span>`
    : '';
  return `<article class="issue-row${flashId === issue.id ? ' flash' : ''}" data-id="${issue.id}" style="animation-delay:${delay}ms">
    <span class="id">${issue.id}</span>
    <span class="title">${key}${escapeHtml(issue.title)}</span>
    <span class="pill ${status}">${STATUS_LABEL[status]}</span>
    <span class="meta">${prioBars(priority)}${avatar}</span>
  </article>`;
}

function filtered(
  view: string,
  status = '',
  teamId?: string,
): IssueRecord[] {
  let list = issues.slice();
  if (view === 'inbox') {
    list = list.filter((issue) => issueStatus(issue) !== 'done');
  }
  if (status) list = list.filter((issue) => issueStatus(issue) === status);
  if (teamId) list = list.filter((issue) => issue.teamId === teamId);
  if (issuePriorityFilter) {
    list = list.filter(
      (issue) => issuePriority(issue) === issuePriorityFilter,
    );
  }
  if (issueAssigneeFilter) {
    list = list.filter(
      (issue) => issue.assigneeId === issueAssigneeFilter,
    );
  }
  const query = issueQuery.trim().toLowerCase();
  if (query) {
    list = list.filter((issue) => {
      const assignee = userById(issue.assigneeId)?.name || '';
      const team = teamById(issue.teamId);
      return [
        issue.id,
        issue.title,
        issue.description,
        assignee,
        team?.key,
        team?.name,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }
  return list;
}

function bindRows(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>('.issue-row, .issue-card')
    .forEach((row) => {
      row.onclick = () => {
        location.hash = `#/issues/${row.dataset.id}`;
      };
    });
}

function issueCard(issue: IssueRecord, index: number): string {
  const person = userById(issue.assigneeId);
  const team = teamById(issue.teamId);
  const priority = issuePriority(issue);
  return `<article class="issue-card${flashId === issue.id ? ' flash' : ''}" data-id="${issue.id}" draggable="true" style="animation-delay:${Math.min(index, 8) * 24}ms">
    <div class="card-meta">
      <span>${team ? escapeHtml(team.key) : 'NO TEAM'} · ${escapeHtml(issue.id)}</span>
      ${prioBars(priority)}
    </div>
    <strong>${escapeHtml(issue.title)}</strong>
    <p>${escapeHtml(issue.description || 'No description')}</p>
    <div class="card-foot">
      <span class="priority-label ${priority}">${PRIORITY_LABEL[priority]}</span>
      ${
        person
          ? `<span class="avatar" style="background:${colorFor(person.id)}">${initials(person.name)}</span>`
          : '<span class="unassigned">Unassigned</span>'
      }
    </div>
  </article>`;
}

function issueBoard(list: IssueRecord[]): string {
  return `<div class="issue-board">${STATUS.map((status) => {
    const rows = list.filter((issue) => issueStatus(issue) === status);
    return `<section class="board-column" data-status="${status}">
      <header><span class="status-dot ${status}"></span><strong>${STATUS_LABEL[status]}</strong><em>${rows.length}</em></header>
      <div class="board-drop">${rows.map(issueCard).join('') || '<span class="column-empty">Drop an issue here</span>'}</div>
    </section>`;
  }).join('')}</div>`;
}

function issueMetrics(list: IssueRecord[]): string {
  const completed = list.filter((issue) => issueStatus(issue) === 'done').length;
  const completion = list.length
    ? Math.round((completed / list.length) * 100)
    : 0;
  const values = [
    ['Open', list.length - completed],
    [
      'In progress',
      list.filter((issue) => issueStatus(issue) === 'in_progress').length,
    ],
    [
      'Urgent',
      list.filter((issue) => issuePriority(issue) === 'urgent').length,
    ],
    ['Completion', `${completion}%`],
  ];
  return `<div class="issue-metrics">${values
    .map(
      ([label, value], index) =>
        `<div><span>${label}</span><strong class="metric-${index}">${value}</strong></div>`,
    )
    .join('')}</div>`;
}

function listView(view: string, teamId?: string): string {
  const status = parseRoute().status;
  const list = filtered(view, status, teamId);
  const base = teamId ? `#/teams/${teamId}` : `#/${view}`;
  const chips = ['', ...STATUS]
    .map((value) => {
      const label = value ? STATUS_LABEL[value as IssueStatus] : 'All';
      const on = status === value ? ' on' : '';
      const href = value ? `${base}?status=${value}` : base;
      return `<a class="chip${on}" href="${href}">${label}</a>`;
    })
    .join('');
  const groups = STATUS.map((key) => {
    const rows = list.filter((issue) => issueStatus(issue) === key);
    if (!rows.length) return '';
    return `<div class="group">${STATUS_LABEL[key]} · ${rows.length}</div>${rows.map(issueRow).join('')}`;
  }).join('');
  const priorityOptions = `<option value="">Any priority</option>${optionList(
    PRIORITY,
    PRIORITY_LABEL,
    issuePriorityFilter,
  )}`;
  const assigneeOptions = `<option value="">Any assignee</option>${users
    .map(
      (user) =>
        `<option value="${user.id}"${user.id === issueAssigneeFilter ? ' selected' : ''}>${escapeHtml(user.name)}</option>`,
    )
    .join('')}`;

  return `<section class="issues-screen">
    ${
      view === 'issues' && !teamId
        ? `<div class="issue-hero"><div><span>Workspace overview</span><h1>Issues that move work forward.</h1><p>Filter, plan, and update delivery without leaving the workspace.</p></div></div>${issueMetrics(filtered(view))}`
        : ''
    }
    <div class="issue-controls">
      <div class="toolbar">${chips}</div>
      <div class="filter-tools">
        <label class="issue-search"><span>⌕</span><input id="issue-search" value="${escapeHtml(issueQuery)}" placeholder="Search title, ID, team, assignee…" /></label>
        <select id="filter-priority" aria-label="Filter by priority">${priorityOptions}</select>
        <select id="filter-assignee" aria-label="Filter by assignee">${assigneeOptions}</select>
        <button class="clear-filters" id="clear-filters" type="button">Clear</button>
        <div class="view-switch" aria-label="Issue view">
          <button type="button" data-mode="list" class="${issueViewMode === 'list' ? 'on' : ''}">List</button>
          <button type="button" data-mode="board" class="${issueViewMode === 'board' ? 'on' : ''}">Board</button>
        </div>
      </div>
      <div class="result-count">${list.length} result${list.length === 1 ? '' : 's'} · live</div>
    </div>
    ${
      issueViewMode === 'board'
        ? issueBoard(list)
        : groups || '<div class="empty">No issues match these filters</div>'
    }
  </section>`;
}

function bindIssueTools(root: HTMLElement): void {
  const search = root.querySelector<HTMLInputElement>('#issue-search');
  const priority =
    root.querySelector<HTMLSelectElement>('#filter-priority');
  const assignee =
    root.querySelector<HTMLSelectElement>('#filter-assignee');
  const clear = root.querySelector<HTMLButtonElement>('#clear-filters');

  if (search) {
    search.oninput = () => {
      issueQuery = search.value;
      const cursor = search.selectionStart ?? search.value.length;
      void render(false).then(() => {
        const next = document.querySelector<HTMLInputElement>('#issue-search');
        next?.focus();
        next?.setSelectionRange(cursor, cursor);
      });
    };
  }
  if (priority) {
    priority.onchange = () => {
      issuePriorityFilter = priority.value as IssuePriority | '';
      void render(false);
    };
  }
  if (assignee) {
    assignee.onchange = () => {
      issueAssigneeFilter = assignee.value;
      void render(false);
    };
  }
  if (clear) {
    clear.onclick = () => {
      issueQuery = '';
      issuePriorityFilter = '';
      issueAssigneeFilter = '';
      void render(false);
    };
  }
  root.querySelectorAll<HTMLButtonElement>('.view-switch button').forEach(
    (button) => {
      button.onclick = () => {
        issueViewMode = button.dataset.mode === 'board' ? 'board' : 'list';
        localStorage.setItem('issue-view', issueViewMode);
        void render(false);
      };
    },
  );
  root.querySelectorAll<HTMLElement>('.issue-card').forEach((card) => {
    card.ondragstart = (event) => {
      if (!card.dataset.id) return;
      event.dataTransfer?.setData('text/plain', card.dataset.id);
      event.dataTransfer?.setDragImage(card, 16, 16);
      card.classList.add('dragging');
    };
    card.ondragend = () => card.classList.remove('dragging');
  });
  root.querySelectorAll<HTMLElement>('.board-column').forEach((column) => {
    column.ondragover = (event) => {
      event.preventDefault();
      column.classList.add('drop-ready');
    };
    column.ondragleave = () => column.classList.remove('drop-ready');
    column.ondrop = async (event) => {
      event.preventDefault();
      column.classList.remove('drop-ready');
      const id = event.dataTransfer?.getData('text/plain');
      const status = column.dataset.status;
      const issue = issues.find((item) => item.id === id);
      if (!id || !status || !issue || issueStatus(issue) === status) return;
      try {
        const updated = await api().issue.update.mutate({
          id,
          status: protoStatus(status),
        });
        const index = issues.findIndex((item) => item.id === updated.id);
        if (index >= 0) issues[index] = updated;
        await render(false);
        ok(`moved to ${STATUS_LABEL[protoStatus(status)]}`);
      } catch (err) {
        fail(err);
      }
    };
  });
}

function optionList<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  selected: string | undefined,
): string {
  return values
    .map((value) => {
      const label = labels[value] || value;
      const sel = value === selected ? ' selected' : '';
      return `<option value="${value}"${sel}>${label}</option>`;
    })
    .join('');
}

function teamOptions(selected?: string): string {
  return `<option value="">No team</option>${teams
    .map(
      (team) =>
        `<option value="${team.id}"${team.id === selected ? ' selected' : ''}>${escapeHtml(team.key)} · ${escapeHtml(team.name)}</option>`,
    )
    .join('')}`;
}

function peopleOptions(selected?: string): string {
  return `<option value="">Unassigned</option>${users
    .map(
      (user) =>
        `<option value="${user.id}"${user.id === selected ? ' selected' : ''}>${escapeHtml(user.name)}</option>`,
    )
    .join('')}`;
}

function detailView(issue: IssueRecord | undefined): string {
  if (!issue) return `<div class="empty">Issue not found</div>`;
  const status = issueStatus(issue);
  const priority = issuePriority(issue);
  const created = new Date(issue.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `<div class="detail">
    <div class="detail-main">
      <div class="detail-kicker"><span class="id">${issue.id}</span><span>Created ${created}</span></div>
      <input class="detail-title" id="issue-title" value="${escapeHtml(issue.title)}" aria-label="Issue title" />
      <label class="field-label" for="issue-desc">Description</label>
      <textarea id="issue-desc" placeholder="Add context, decisions, and acceptance criteria…">${escapeHtml(issue.description || '')}</textarea>
      <div class="detail-actions">
        <button class="primary" id="save-issue" type="button">Save changes</button>
        <span>Properties save instantly</span>
      </div>
    </div>
    <aside class="props">
      <div class="props-heading"><span>Properties</span><i></i></div>
      <label>Status</label>
      <select id="issue-status">${optionList(STATUS, STATUS_LABEL, status)}</select>
      <label>Priority</label>
      <select id="issue-priority">${optionList(PRIORITY, PRIORITY_LABEL, priority)}</select>
      <label>Team</label>
      <select id="issue-team">${teamOptions(issue.teamId)}</select>
      <label>Assignee</label>
      <select id="issue-assignee">${peopleOptions(issue.assigneeId)}</select>
    </aside>
  </div>`;
}

function peopleView(): string {
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
            ${optionList(ROLE, ROLE_LABEL, role)}
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

async function loadStep<T>(
  name: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw new Error(
      `${name}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

async function load(): Promise<void> {
  const client = api();
  const [issueList, userList, workspaceStats, teamList] = await Promise.all([
    loadStep('issue.list', () => client.issue.list.query({})),
    loadStep('user.list', () => client.user.list.query({})),
    loadStep('stats', () => client.org.workspace.stats.query()),
    loadStep('team.list', () => client.team.list.query({})),
  ]);
  issues = issueList.items;
  users = userList.items;
  stats = workspaceStats;
  teams = teamList.items;
  paintRail();
}

function teamPage(team: TeamRecord | null | undefined): string {
  if (!team) return `<div class="empty">Team not found</div>`;
  const members = team.memberIds
    .map((id) => userById(id))
    .filter((user): user is UserRecord => user !== undefined);
  const outsiders = users.filter(
    (user) => !team.memberIds.includes(user.id),
  );
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
            .map(
              (user) =>
                `<option value="${user.id}">${escapeHtml(user.name)}</option>`,
            )
            .join('')}
        </select>
      </label>`
    : '';

  return `<div class="hero team-hero">
      <div>
        <span class="key">${escapeHtml(team.key)}</span>
        <h1>${escapeHtml(team.name)}</h1>
        <p>${escapeHtml(team.description || '')}</p>
      </div>
      <button class="tiny" id="edit-team" type="button">Edit team</button>
    </div>
    <div class="team-summary"><span><b>${members.length}</b> members</span><span><b>${issues.filter((issue) => issue.teamId === team.id).length}</b> issues</span></div>
    <div class="members">${chips}${add}</div>
    ${listView('issues', team.id)}`;
}

function workspaceView(): string {
  const labels = stats?.labels || {};
  const cells = STATUS.map(
    (key, index) =>
      `<div class="stat" style="animation-delay:${index * 50}ms"><b>${labels[key] ?? 0}</b><span>${STATUS_LABEL[key]}</span></div>`,
  ).join('');
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

function paintRail(): void {
  $('ws-name').textContent = stats?.name || 'analytical-engine';
  document.title = stats?.name || 'analytical-engine';

  $('ws-meta').textContent = `${users.length} people · ${teams.length} teams`;
  $('count-inbox').textContent = String(filtered('inbox').length || '');
  $('count-all').textContent = String(issues.length || '');
  $('rail-teams').innerHTML = teams
    .map(
      (
        team,
        i,
      ) => `<a class="rail-key" href="#/teams/${team.id}" data-id="${team.id}" style="animation-delay:${i * 40}ms">
        <span class="key">${escapeHtml(team.key)}</span>${escapeHtml(team.name)}
      </a>`,
    )
    .join('');
  $('rail-team').innerHTML = users
    .slice(0, 6)
    .map(
      (
        user,
        i,
      ) => `<div class="rail-person" style="animation-delay:${i * 40}ms">
        <span class="avatar" style="background:${colorFor(user.id)}">${initials(user.name)}</span>
        ${escapeHtml(user.name)}
      </div>`,
    )
    .join('');
  markNav();
}

function listen(): void {
  if (sub) return;
  sub = api().issue.onChange.subscribe({}, {
    onData(issue) {
      const index = issues.findIndex((row) => row.id === issue.id);
      if (index >= 0) issues[index] = issue;
      else issues.unshift(issue);
      flashId = issue.id;
      paintRail();
      const { name, id } = parseRoute();
      if (
        (name === 'inbox' || name === 'issues' || name === 'teams') &&
        !(name === 'issues' && id)
      ) {
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

function closeVeil(): void {
  const veil = $('veil');
  veil.hidden = true;
  veil.innerHTML = '';
}

function openComposer(teamId?: string): void {
  const veil = $('veil');
  veil.hidden = false;
  veil.innerHTML = `<form class="sheet" id="compose">
    <h2>New issue</h2>
    <input id="c-title" placeholder="Issue title" autofocus required />
    <textarea id="c-desc" placeholder="Description"></textarea>
    <select id="c-status">${optionList(STATUS, STATUS_LABEL, 'todo')}</select>
    <select id="c-priority">${optionList(PRIORITY, PRIORITY_LABEL, 'none')}</select>
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

function openTeamComposer(): void {
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

function openTeamEditor(team: TeamRecord): void {
  const veil = $('veil');
  veil.hidden = false;
  veil.innerHTML = `<form class="sheet" id="edit-team-form">
    <div class="sheet-heading"><div><span>Team settings</span><h2>Edit ${escapeHtml(team.name)}</h2></div><button class="sheet-close" type="button" aria-label="Close">×</button></div>
    <label for="et-key">Team key</label>
    <input id="et-key" value="${escapeHtml(team.key)}" required />
    <label for="et-name">Name</label>
    <input id="et-name" value="${escapeHtml(team.name)}" required />
    <label for="et-desc">Description</label>
    <textarea id="et-desc" placeholder="What this team owns">${escapeHtml(team.description || '')}</textarea>
    <button class="primary" type="submit">Save team</button>
  </form>`;
  veil.querySelector<HTMLButtonElement>('.sheet-close')!.onclick = closeVeil;
  $('edit-team-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api().team.update.mutate({
        id: team.id,
        key: $('et-key').value,
        name: $('et-name').value,
        description: $('et-desc').value,
      });
      closeVeil();
      await render(true);
      ok('team updated');
    } catch (err) {
      fail(err);
    }
  };
}

function openInvite(): void {
  const veil = $('veil');
  veil.hidden = false;
  const teamPick = `<option value="">No team yet</option>${teams
    .map(
      (team) => `<option value="${team.id}">${escapeHtml(team.key)}</option>`,
    )
    .join('')}`;
  veil.innerHTML = `<form class="sheet" id="invite">
    <h2>Invite person</h2>
    <input id="invite-name" placeholder="Full name" required />
    <input id="invite-email" type="email" placeholder="Email" required />
    <select id="invite-role">${optionList(ROLE, ROLE_LABEL, 'member')}</select>
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

function openUserEditor(user: UserRecord | undefined): void {
  if (!user) return;
  const veil = $('veil');
  veil.hidden = false;
  const role = userRole(user);
  veil.innerHTML = `<form class="sheet" id="edit-user">
    <h2>Edit ${escapeHtml(user.name)}</h2>
    <input id="u-name" value="${escapeHtml(user.name)}" required />
    <input id="u-email" type="email" value="${escapeHtml(user.email)}" required />
    <select id="u-role">${optionList(ROLE, ROLE_LABEL, role)}</select>
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

function openCommand(): void {
  const veil = $('veil');
  veil.hidden = false;
  const items: Array<{ label: string; run(): void }> = [
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
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const node = target.closest<HTMLElement>('.cmdk-item');
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
      const first = items.filter((item) =>
        item.label.toLowerCase().includes(q),
      )[0];
      closeVeil();
      first?.run();
    }
  };
}

async function render(reload = true): Promise<void> {
  markNav();
  try {
    if (reload) await load();
    const { name, id } = parseRoute();
    const view = $('view');
    if (name === 'people') {
      setCrumb('People');
      view.innerHTML = peopleView();
      $('invite-open').onclick = openInvite;
      view.querySelectorAll<HTMLButtonElement>('.edit-user').forEach((button) => {
        button.onclick = () => openUserEditor(userById(button.dataset.id));
      });
      view.querySelectorAll<HTMLButtonElement>('.toggle-user').forEach((button) => {
        button.onclick = async () => {
          const user = userById(button.dataset.id);
          if (!user) return;
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
      view.querySelectorAll<HTMLSelectElement>('.role-sel').forEach((select) => {
        select.onchange = async () => {
          const userId = select.dataset.id;
          if (!userId) return;
          try {
            await api().user.update.mutate({
              id: userId,
              role: protoRole(select.value),
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
      const team =
        teamById(id) || (id ? await api().team.getById.query({ id }) : null);
      setCrumb(team ? `${team.key} · ${team.name}` : 'Team');
      view.innerHTML = teamPage(team);
      if (!team) return;
      bindRows(view);
      bindIssueTools(view);
      $('edit-team').onclick = () => openTeamEditor(team);
      const add = view.querySelector<HTMLSelectElement>('#add-member');
      if (add) {
        add.onchange = async () => {
          if (!add.value) return;
          try {
            await api().team.addMember.mutate({
              teamId: team.id,
              userId: add.value,
            });
            await render(true);
            ok('member added');
          } catch (err) {
            fail(err);
          }
        };
      }
      view.querySelectorAll<HTMLButtonElement>('.drop-member').forEach((button) => {
        button.onclick = async (event) => {
          event.stopPropagation();
          const userId = button.dataset.id;
          if (!userId) return;
          try {
            await api().team.removeMember.mutate({
              teamId: team.id,
              userId,
            });
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
        issues.find((row) => row.id === id) ||
        (await api().issue.getById.query({ id }));
      setCrumb(issue?.id || 'Issue');
      view.innerHTML = detailView(issue);
      if (!issue) return;
      const save = async (patch: IssueUpdate): Promise<void> => {
        try {
          const next = await api().issue.update.mutate(patch);
          const index = issues.findIndex((row) => row.id === next.id);
          if (index >= 0) issues[index] = next;
          ok('saved');
        } catch (err) {
          fail(err);
        }
      };
      const status = $('issue-status');
      const priority = $('issue-priority');
      const assignee = $('issue-assignee');
      const team = $('issue-team');
      const description = $('issue-desc');
      const title = $('issue-title');
      $('save-issue').onclick = () =>
        void save({
          id,
          title: title.value,
          description: description.value,
        });
      status.onchange = () =>
        void save({ id, status: protoStatus(status.value) });
      priority.onchange = () =>
        void save({ id, priority: protoPriority(priority.value) });
      assignee.onchange = () =>
        void save({ id, assigneeId: assignee.value || '' });
      team.onchange = () => void save({ id, teamId: team.value || '' });
      title.onkeydown = (event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          $('save-issue').click();
        }
      };
      return;
    }
    setCrumb(name === 'issues' ? 'All issues' : 'Inbox');
    view.innerHTML = listView(name === 'issues' ? 'issues' : 'inbox');
    bindRows(view);
    bindIssueTools(view);
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
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement;
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
