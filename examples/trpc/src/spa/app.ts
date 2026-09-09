import { createTRPCClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import { protoSchema } from '../../generated/schema.js';
import type { AppRouter } from '../router.js';

function $(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as HTMLInputElement;
}

const client = createTRPCClient<AppRouter>({
  links: [
    grpcWebLink<AppRouter>({
      schema: protoSchema,
      url: `${location.protocol}//${location.hostname}:3102`,
      encoding: 'raw',
      compress: false,
    }),
  ],
});

type RouterOutputs = inferRouterOutputs<AppRouter>;
type NoteRecord = RouterOutputs['note']['get'];

const edits: Array<NoteRecord & { at: string }> = [];
let sub: { unsubscribe(): void } | undefined;

function paintStream(): void {
  const out = document.getElementById('stream-out');
  if (!out) return;
  out.textContent = edits.length
    ? JSON.stringify(edits, null, 2)
    : 'listening for note.put…';
}

function listen() {
  if (sub) return;
  sub = client.note.onChange.subscribe({}, {
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

const ROUTE_LABELS: Record<string, string> = {
  echo: 'echo',
  notes: 'note.put · note.get',
  stream: 'note.onChange',
};

function markNav(): void {
  const current = route();
  $('route-label').textContent = ROUTE_LABELS[current] ?? current;
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle(
      'active',
      link.getAttribute('href') === `#/${current}`,
    );
  }
}

function fail(err: unknown): void {
  $('status').className = 'bad';
  $('status').textContent = err instanceof Error ? err.message : String(err);
}

async function invoke(action: () => Promise<void>): Promise<void> {
  $('status').className = 'working';
  $('status').textContent = 'working';
  try {
    await action();
    $('status').className = 'ok';
    $('status').textContent = 'ready';
  } catch (err) {
    fail(err);
  }
}

async function render(): Promise<void> {
  markNav();
  const app = $('app');
  try {
    if (route() === 'notes') {
      app.innerHTML = `
        <div class="page">
          <header class="page-hero">
            <div>
              <p class="eyebrow">Typed persistence</p>
              <h1>Read. Write.<br /><span>Stay in sync.</span></h1>
              <p class="lede">Exercise two unary procedures against the same protobuf contract.</p>
            </div>
            <div class="hero-badges">
              <span>note.put</span>
              <span>note.get</span>
            </div>
          </header>

          <div class="spec-grid">
            <article><small>Service</small><strong>NoteService</strong></article>
            <article><small>Message</small><strong>Note</strong></article>
            <article><small>Contract</small><strong>id · body</strong></article>
          </div>

          <section class="console-card notes-card">
            <div class="console-pane request-pane">
              <div class="pane-heading">
                <div>
                  <span class="method method-mutate">Mutation</span>
                  <h2>Compose a note</h2>
                </div>
                <code>note.put()</code>
              </div>
              <label for="note-id">Note identifier</label>
              <div class="input-shell">
                <span>#</span>
                <input id="note-id" value="n1" autocomplete="off" />
              </div>
              <label for="note-body">Message body</label>
              <div class="input-shell">
                <span>→</span>
                <input id="note-body" value="from Protocol Studio" autocomplete="off" />
              </div>
              <div class="actions">
                <button class="primary" id="put-btn" type="button">Write note <kbd>⌘↵</kbd></button>
                <button class="ghost" id="get-btn" type="button">Read note</button>
              </div>
              <p class="safety-note"><span>◆</span> Validated with the same Zod schema used to generate protobuf.</p>
            </div>
            <div class="console-pane response-pane">
              <div class="pane-heading">
                <div>
                  <span class="method method-response">Response</span>
                  <h2>Decoded payload</h2>
                </div>
                <span class="response-status"><i></i> Ready</span>
              </div>
              <div class="output-window">
                <div class="window-bar"><i></i><i></i><i></i><span>NoteResponse.json</span></div>
                <pre id="note-out" aria-live="polite" data-empty="Run a procedure to inspect its response."></pre>
              </div>
              <div class="response-meta"><span>PROTO3</span><span>trpc.v1.NoteService</span></div>
            </div>
          </section>
        </div>`;
      $('put-btn').onclick = () => {
        void invoke(async () => {
          const put = await client.note.put.mutate({
            id: $('note-id').value,
            body: $('note-body').value,
          });
          $('note-out').textContent = JSON.stringify(put, null, 2);
        });
      };
      $('get-btn').onclick = () => {
        void invoke(async () => {
          const got = await client.note.get.query({
            id: $('note-id').value,
          });
          $('note-out').textContent = JSON.stringify(got, null, 2);
        });
      };
    } else if (route() === 'stream') {
      app.innerHTML = `
        <div class="page">
          <header class="page-hero">
            <div>
              <p class="eyebrow">Server streaming</p>
              <h1>A live view<br /><span>of every change.</span></h1>
              <p class="lede">Keep a typed gRPC-Web stream open and watch Note events arrive.</p>
            </div>
            <div class="hero-badges">
              <span>AsyncIterable</span>
              <span>zAsyncIterable</span>
            </div>
          </header>

          <div class="spec-grid">
            <article><small>Procedure</small><strong>note.onChange</strong></article>
            <article><small>Mode</small><strong>Server stream</strong></article>
            <article><small>Events seen</small><strong>${edits.length}</strong></article>
          </div>

          <section class="stream-card">
            <div class="stream-visual" aria-hidden="true">
              <div class="orbit orbit-one"></div>
              <div class="orbit orbit-two"></div>
              <div class="stream-core"><i></i><span>LIVE</span></div>
            </div>
            <div class="stream-content">
              <div class="pane-heading">
                <div>
                  <span class="method method-stream">Subscription</span>
                  <h2>Event monitor</h2>
                </div>
                <span class="response-status"><i></i> Connected</span>
              </div>
              <p>Every <code>note.put</code> is decoded and appended here without polling.</p>
              <div class="actions">
                <button class="primary" id="sub-btn" type="button">Start listening</button>
                <button class="ghost" id="unsub-btn" type="button">Pause stream</button>
              </div>
              <div class="output-window stream-output">
                <div class="window-bar"><i></i><i></i><i></i><span>event.log</span></div>
                <pre id="stream-out" aria-live="polite"></pre>
              </div>
            </div>
          </section>
        </div>`;
      paintStream();
      listen();
      $('sub-btn').onclick = () => {
        listen();
        paintStream();
      };
      $('unsub-btn').onclick = () => {
        sub?.unsubscribe();
        sub = undefined;
        $('stream-out').textContent = edits.length
          ? `${JSON.stringify(edits, null, 2)}\n\n— stream paused —`
          : 'stream paused';
      };
    } else {
      app.innerHTML = `
        <div class="page">
          <header class="page-hero">
            <div>
              <p class="eyebrow">Unary procedure</p>
              <h1>Protocol,<br /><span>made visible.</span></h1>
              <p class="lede">Send a typed request through gRPC-Web and inspect the response in real time.</p>
            </div>
            <div class="hero-badges">
              <span>Raw binary</span>
              <span>Proto3</span>
            </div>
          </header>

          <div class="spec-grid">
            <article><small>Transport</small><strong>gRPC-Web</strong></article>
            <article><small>Encoding</small><strong>Protobuf</strong></article>
            <article><small>Runtime</small><strong>TypeScript</strong></article>
          </div>

          <section class="console-card">
            <div class="console-pane request-pane">
              <div class="pane-heading">
                <div>
                  <span class="method method-query">Query</span>
                  <h2>Request</h2>
                </div>
                <code>echo.query()</code>
              </div>
              <label for="echo-text">Message</label>
              <div class="input-shell">
                <span>→</span>
                <input id="echo-text" value="protobuf" autocomplete="off" />
              </div>
              <div class="actions">
                <button class="primary" id="echo-btn" type="button">Run echo <kbd>⌘↵</kbd></button>
                <button class="ghost" id="health-btn" type="button">Health check</button>
              </div>
              <p class="safety-note"><span>◆</span> Type-safe from browser input to backend response.</p>
            </div>
            <div class="console-pane response-pane">
              <div class="pane-heading">
                <div>
                  <span class="method method-response">Response</span>
                  <h2>Decoded payload</h2>
                </div>
                <span class="response-status"><i></i> Ready</span>
              </div>
              <div class="output-window">
                <div class="window-bar"><i></i><i></i><i></i><span>EchoResponse.json</span></div>
                <pre id="echo-out" aria-live="polite" data-empty="Run echo or health to inspect the response."></pre>
              </div>
              <div class="response-meta"><span>RAW · 0 BYTES</span><span>trpc.v1.AppService</span></div>
            </div>
          </section>
        </div>`;
      $('health-btn').onclick = () => {
        void invoke(async () => {
          const health = await client.health.query();
          $('echo-out').textContent = JSON.stringify(health, null, 2);
        });
      };
      $('echo-btn').onclick = () => {
        void invoke(async () => {
          const echo = await client.echo.query($('echo-text').value);
          $('echo-out').textContent = echo;
        });
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
