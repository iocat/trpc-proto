const $ = (id) => document.getElementById(id);
const PKG = 'example.v1';
let root;

function show(id, value) {
  const el = $(id);
  if (!el) return;
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function typeName(name) {
  return name.startsWith('google.') ? name : `${PKG}.${name}`;
}

async function rpc(service, method, reqType, payload, resType) {
  const Req = root.lookupType(typeName(reqType));
  const Res = root.lookupType(typeName(resType));
  const bytes = Req.encode(Req.create(payload || {})).finish();
  const res = await fetch(`/rpc/${service}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-protobuf',
      authorization: `Bearer ${$('auth-token').value}`,
    },
    body: bytes,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(new TextDecoder().decode(buf) || res.statusText);
  $('status').textContent =
    `protobuf ${bytes.length}B → ${buf.length}B · /${PKG}.${service}/${method}`;
  $('status').className = 'ok';
  return Res.toObject(Res.decode(buf), {
    defaults: true,
    longs: String,
    enums: String,
    bytes: String,
  });
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
  const listed = await rpc(
    'UserService',
    'List',
    'UserListRequest',
    { q: $('q').value || undefined, role: $('role').value || undefined },
    'UserListResponse',
  );
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
    const user = items.find((item) => item.id === selectId) || items[items.length - 1];
    if (user) show('user-out', user);
  }
}

function bindHello() {
  $('hello-btn').onclick = async () => {
    show(
      'hello-out',
      await rpc(
        'AppService',
        'Hello',
        'AppHelloRequest',
        { fullName: $('hello-name').value, description: $('hello-desc').value },
        'AppHelloResponse',
      ),
    );
  };
  $('echo-btn').onclick = async () => {
    const out = await rpc('AppService', 'Echo', 'AppEchoRequest', { value: $('echo-text').value }, 'AppEchoResponse');
    show('hello-out', out.value);
  };
}

function bindUsers() {
  $('list-btn').onclick = () => refreshUsers();
  $('create-btn').onclick = async () => {
    const created = await rpc(
      'UserService',
      'Create',
      'UserCreateRequest',
      {
        name: $('user-name').value,
        email: $('user-email').value,
        role: $('user-role').value,
        tags: $('user-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
        address: { city: $('user-city').value },
      },
      'User',
    );
    show('user-out', created);
    await refreshUsers(created.id);
  };
  $('user-rows').onclick = async (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    show(
      'user-out',
      await rpc('UserService', 'GetById', 'UserGetByIdRequest', { id: row.dataset.id }, 'User'),
    );
  };
  return refreshUsers();
}

async function bindWorkspace() {
  const stats = await rpc('OrgWorkspaceService', 'Stats', 'google.protobuf.Empty', {}, 'WorkspaceStats');
  show('stats-out', stats);
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

protobuf.load('/proto/example_v1.proto', async (err, loaded) => {
  if (err) {
    $('status').className = 'bad';
    $('status').textContent = String(err);
    return;
  }
  root = loaded;
  $('status').textContent = 'ready';
  $('status').className = 'ok';
  window.addEventListener('hashchange', () => {
    void render();
  });
  await render();
});
