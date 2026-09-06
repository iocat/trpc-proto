import { createTRPCProxyClient } from '@trpc/client';
import { grpcWebProxyLink } from '@trpc-proto/runtime/web';
import { appRouter } from '../router.ts';

const $ = (id) => document.getElementById(id);

function client() {
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

function show(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function route() {
  return location.hash.replace(/^#\/?/, '') || 'hello';
}

function markNav() {
  const current = route();
  for (const link of document.querySelectorAll('nav a')) {
    const href = link.getAttribute('href') ?? '';
    link.classList.toggle('active', href === `#/${current}`);
  }
}

function helloView() {
  return `
    <section>
      <h2>Hello / echo</h2>
      <label>Full name</label>
      <input id="hello-name" value="Ada" />
      <label>Description</label>
      <input id="hello-desc" value="from SPA" />
      <button id="hello-btn">Hello</button>
      <label>Echo</label>
      <input id="echo-text" value="analytical engine" />
      <button class="secondary" id="echo-btn">Echo</button>
      <pre id="hello-out"></pre>
    </section>`;
}

function usersView() {
  return `
    <section>
      <h2>Create user</h2>
      <label>Name</label>
      <input id="user-name" value="Charles" />
      <label>Email</label>
      <input id="user-email" value="charles@example.com" />
      <div class="row">
        <div>
          <label>Role</label>
          <select id="user-role">
            <option>USER_ROLE_MEMBER</option>
            <option>USER_ROLE_ADMIN</option>
            <option>USER_ROLE_GUEST</option>
          </select>
        </div>
        <div>
          <label>City</label>
          <input id="user-city" value="London" />
        </div>
      </div>
      <label>Tags (comma)</label>
      <input id="user-tags" value="diff-engine" />
      <button id="create-btn">Create over gRPC</button>
    </section>
    <section>
      <h2>Users</h2>
      <div class="row">
        <div>
          <label>Search</label>
          <input id="q" placeholder="name or email" />
        </div>
        <div>
          <label>Role</label>
          <select id="role">
            <option value="">any</option>
            <option>USER_ROLE_ADMIN</option>
            <option>USER_ROLE_MEMBER</option>
            <option>USER_ROLE_GUEST</option>
          </select>
        </div>
      </div>
      <button class="secondary" id="list-btn">Refresh list</button>
      <table>
        <thead>
          <tr><th>Name</th><th>Role</th><th>City</th><th>Karma</th></tr>
        </thead>
        <tbody id="user-rows"></tbody>
      </table>
      <pre id="user-out"></pre>
    </section>`;
}

function workspaceView() {
  return `
    <section>
      <h2>Workspace</h2>
      <pre id="stats-out"></pre>
    </section>`;
}

async function refreshUsers(selectId) {
  const listed = await client().user.list.query({
    q: $('q').value || undefined,
    role: $('role').value || undefined,
  });
  const items = listed.items || [];
  $('user-rows').innerHTML = items
    .map(
      (user) =>
        `<tr data-id="${user.id}"><td>${user.name}</td><td>${user.role}</td><td>${
          (user.address && user.address.city) || ''
        }</td><td>${user.karma}</td></tr>`,
    )
    .join('');
  if (selectId) {
    const user =
      items.find((item) => item.id === selectId) || items[items.length - 1];
    if (user) show('user-out', user);
  }
}

function bindHello() {
  $('hello-btn').onclick = async () => {
    show(
      'hello-out',
      await client().hello.query({
        fullName: $('hello-name').value,
        description: $('hello-desc').value,
      }),
    );
  };
  $('echo-btn').onclick = async () => {
    show('hello-out', await client().echo.query($('echo-text').value));
  };
}

function bindUsers() {
  $('list-btn').onclick = () => refreshUsers();
  $('create-btn').onclick = async () => {
    const created = await client().user.create.mutate({
      name: $('user-name').value,
      email: $('user-email').value,
      role: $('user-role').value,
      tags: $('user-tags')
        .value.split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      address: { city: $('user-city').value },
    });
    show('user-out', created);
    await refreshUsers(created.id);
  };
  $('user-rows').onclick = async (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    show('user-out', await client().user.getById.query({ id: row.dataset.id }));
  };
  return refreshUsers();
}

async function bindWorkspace() {
  show('stats-out', await client().org.workspace.stats.query());
}

async function render() {
  markNav();
  const app = $('app');
  const page = route();
  try {
    if (page === 'users') {
      app.innerHTML = usersView();
      await bindUsers();
    } else if (page === 'workspace') {
      app.innerHTML = workspaceView();
      await bindWorkspace();
    } else {
      app.innerHTML = helloView();
      bindHello();
    }
  } catch (err) {
    $('status').className = 'bad';
    $('status').textContent = String(err.message || err);
  }
}

$('status').textContent = 'ready';
$('status').className = 'ok';
window.addEventListener('hashchange', () => {
  void render();
});
void render();
