import { createTRPCProxyClient } from '@trpc/client';
import { grpcWebProxyLink } from '@trpc-proto/runtime/web';
import { appRouter } from '../router.ts';

const $ = (id) => document.getElementById(id);

const client = createTRPCProxyClient({
  links: [
    grpcWebProxyLink({
      router: appRouter,
      url: '',
    }),
  ],
});

const edits = [];
let sub;

function paintStream() {
  const out = $('stream-out');
  if (!out) return;
  out.textContent = edits.length
    ? JSON.stringify(edits, null, 2)
    : 'listening for note.put…';
}

function listen() {
  if (sub) return;
  sub = client.note.onChange.subscribe(undefined, {
    onData(note) {
      edits.push({
        at: new Date().toISOString(),
        id: note.id,
        body: note.body,
      });
      paintStream();
    },
    onError(err) {
      fail(err);
    },
  });
}

function route() {
  return location.hash.replace(/^#\/?/, '') || 'echo';
}

function markNav() {
  const current = route();
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle(
      'active',
      link.getAttribute('href') === `#/${current}`,
    );
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
        const put = await client.note.put.mutate({
          id: $('note-id').value,
          body: $('note-body').value,
        });
        $('note-out').textContent = JSON.stringify(put, null, 2);
      };
      $('get-btn').onclick = async () => {
        const got = await client.note.get.query({
          id: $('note-id').value,
        });
        $('note-out').textContent = JSON.stringify(got, null, 2);
      };
    } else if (route() === 'stream') {
      app.innerHTML = `
        <section>
          <h2>note.onChange</h2>
          <p>live server stream of every Notes put. stay subscribed while you edit.</p>
          <button id="sub-btn">Listen</button>
          <button class="secondary" id="unsub-btn">Pause</button>
          <pre id="stream-out"></pre>
        </section>`;
      paintStream();
      listen();
      $('sub-btn').onclick = () => {
        listen();
        paintStream();
      };
      $('unsub-btn').onclick = () => {
        sub?.unsubscribe();
        sub = undefined;
        const out = $('stream-out');
        if (out) out.textContent = edits.length
          ? `${JSON.stringify(edits, null, 2)}\n\n— paused —`
          : 'paused';
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
        const health = await client.health.query();
        $('echo-out').textContent = JSON.stringify(health, null, 2);
      };
      $('echo-btn').onclick = async () => {
        const echo = await client.echo.query($('echo-text').value);
        $('echo-out').textContent = echo;
      };
    }
  } catch (err) {
    fail(err);
  }
}

$('status').textContent = 'ready';
$('status').className = 'ok';
listen();
window.addEventListener('hashchange', () => {
  void render();
});
void render();
