const $ = (id) => document.getElementById(id);
const PKG = 'todo.v1';
let root;

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
  return location.hash.replace(/^#\/?/, '') || 'list';
}

function markNav() {
  const current = route();
  for (const link of document.querySelectorAll('nav a')) {
    const href = link.getAttribute('href') ?? '';
    link.classList.toggle('active', href === `#/${current}`);
  }
}

function listView() {
  return `
    <section>
      <h2>List</h2>
      <div class="row">
        <select id="filter">
          <option value="all">all</option>
          <option value="open">open</option>
          <option value="done">done</option>
        </select>
        <button class="secondary tiny" id="list-btn">Refresh</button>
      </div>
      <table>
        <thead>
          <tr><th></th><th>Title</th><th>Notes</th><th></th></tr>
        </thead>
        <tbody id="todo-rows"></tbody>
      </table>
    </section>`;
}

function createView() {
  return `
    <section>
      <h2>Create</h2>
      <label>Title</label>
      <input id="title" value="Write tests" />
      <label>Notes</label>
      <input id="notes" value="codec + auth" />
      <button id="create-btn">Add todo</button>
      <pre id="create-out"></pre>
    </section>`;
}

async function refresh() {
  const filter = $('filter').value;
  const payload =
    filter === 'open' ? { done: false } : filter === 'done' ? { done: true } : {};
  const listed = await rpc('TodoService', 'List', 'TodoListRequest', payload, 'TodoListResponse');
  $('todo-rows').innerHTML = (listed.items || [])
    .map((todo) => {
      const titleClass = todo.done ? ' class="done"' : '';
      return `<tr data-id="${todo.id}">
        <td><input type="checkbox" class="toggle"${todo.done ? ' checked' : ''} /></td>
        <td${titleClass}>${todo.title}</td>
        <td>${todo.notes || ''}</td>
        <td><button class="secondary tiny del">Delete</button></td>
      </tr>`;
    })
    .join('');
}

function bindList() {
  $('list-btn').onclick = () => refresh().catch(fail);
  $('filter').onchange = () => refresh().catch(fail);
  $('todo-rows').onclick = async (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    const id = row.dataset.id;
    try {
      if (event.target.classList.contains('toggle')) {
        await rpc('TodoService', 'SetDone', 'TodoSetDoneRequest', {
          id,
          done: event.target.checked,
        }, 'Todo');
        await refresh();
      }
      if (event.target.classList.contains('del')) {
        await rpc('TodoService', 'Remove', 'TodoGetByIdRequest', { id }, 'TodoGetByIdRequest');
        await refresh();
      }
    } catch (err) {
      fail(err);
    }
  };
  return refresh();
}

function bindCreate() {
  $('create-btn').onclick = async () => {
    try {
      const created = await rpc('TodoService', 'Create', 'TodoCreateRequest', {
        title: $('title').value,
        notes: $('notes').value || undefined,
      }, 'Todo');
      $('create-out').textContent = JSON.stringify(created, null, 2);
    } catch (err) {
      fail(err);
    }
  };
}

function fail(err) {
  $('status').className = 'bad';
  $('status').textContent = String(err.message || err);
}

async function render() {
  markNav();
  const app = $('app');
  try {
    if (route() === 'new') {
      app.innerHTML = createView();
      bindCreate();
    } else {
      app.innerHTML = listView();
      await bindList();
    }
  } catch (err) {
    fail(err);
  }
}

protobuf.load('/proto/todo_v1.proto', async (err, loaded) => {
  if (err) {
    fail(err);
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
