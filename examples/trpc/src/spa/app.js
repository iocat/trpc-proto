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
          <p>server-streaming subscription. Put a note on Notes, events land here.</p>
          <button id="sub-btn">Subscribe</button>
          <button class="secondary" id="unsub-btn">Unsubscribe</button>
          <pre id="stream-out"></pre>
        </section>`;
      const events = [];
      let sub;
      $('sub-btn').onclick = () => {
        sub?.unsubscribe();
        events.length = 0;
        $('stream-out').textContent = 'listening…';
        sub = client.note.onChange.subscribe(undefined, {
          onData(note) {
            events.push(note);
            $('stream-out').textContent = JSON.stringify(events, null, 2);
          },
          onError(err) {
            fail(err);
          },
        });
      };
      $('unsub-btn').onclick = () => {
        sub?.unsubscribe();
        sub = undefined;
        $('stream-out').textContent = 'stopped';
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
window.addEventListener('hashchange', () => {
  void render();
});
void render();
