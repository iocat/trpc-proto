const $ = (id) => document.getElementById(id);
const PKG = 'trpc.v1';
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
    headers: { 'content-type': 'application/x-protobuf' },
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
  return location.hash.replace(/^#\/?/, '') || 'echo';
}

function markNav() {
  const current = route();
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.getAttribute('href') === `#/${current}`);
  }
}

function fail(err) {
  $('status').className = 'bad';
  $('status').textContent = String(err.message || err);
}

async function render() {
  markNav();
  const app = $('app');
  try {
    if (route() === 'notes') {
      app.innerHTML = `
        <section>
          <h2>Notes</h2>
          <label>Id</label>
          <input id="note-id" value="n1" />
          <label>Body</label>
          <input id="note-body" value="from SPA" />
          <button id="put-btn">Put</button>
          <button class="secondary" id="get-btn">Get</button>
          <pre id="note-out"></pre>
        </section>`;
      $('put-btn').onclick = async () => {
        const put = await rpc('NoteService', 'Put', 'Note', {
          id: $('note-id').value,
          body: $('note-body').value,
        }, 'Note');
        $('note-out').textContent = JSON.stringify(put, null, 2);
      };
      $('get-btn').onclick = async () => {
        const got = await rpc('NoteService', 'Get', 'NoteGetRequest', {
          id: $('note-id').value,
        }, 'Note');
        $('note-out').textContent = JSON.stringify(got, null, 2);
      };
    } else {
      app.innerHTML = `
        <section>
          <h2>Health / echo</h2>
          <button id="health-btn">Health</button>
          <label>Echo</label>
          <input id="echo-text" value="protobuf" />
          <button class="secondary" id="echo-btn">Echo</button>
          <pre id="echo-out"></pre>
        </section>`;
      $('health-btn').onclick = async () => {
        const health = await rpc('AppService', 'Health', 'google.protobuf.Empty', {}, 'AppHealthResponse');
        $('echo-out').textContent = JSON.stringify(health, null, 2);
      };
      $('echo-btn').onclick = async () => {
        const echo = await rpc('AppService', 'Echo', 'AppEchoRequest', {
          value: $('echo-text').value,
        }, 'AppEchoResponse');
        $('echo-out').textContent = echo.value;
      };
    }
  } catch (err) {
    fail(err);
  }
}

protobuf.load('/proto/trpc_v1.proto', async (err, loaded) => {
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
