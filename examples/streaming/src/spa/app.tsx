import { createTRPCClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createRoot } from 'react-dom/client';
import { protoSchema } from '../../generated/schema.js';
import type { AppRouter } from '../router.js';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcWebLink<AppRouter>({
      schema: protoSchema,
      url: `${location.protocol}//${location.hostname}:3103`,
      encoding: 'raw',
      compress: false,
    }),
  ],
});

type RespondOutput = inferRouterOutputs<AppRouter>['chat']['respond'];
type ChatEvent =
  RespondOutput extends AsyncIterable<infer Event> ? Event : never;
type GenerationState = 'idle' | 'connecting' | 'live' | 'complete' | 'error';

const PRESETS = [
  'Design a cancellation-safe streaming API.',
  'Explain why backpressure matters in gRPC.',
  'Review a Rust service for production risks.',
] as const;

function App() {
  const [prompt, setPrompt] = useState<string>(PRESETS[0]);
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [tokensPerSecond, setTokensPerSecond] = useState(80);
  const [maxTokens, setMaxTokens] = useState(260);
  const [tokenCount, setTokenCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [state, setState] = useState<GenerationState>('idle');
  const [phase, setPhase] = useState('Waiting for a prompt');
  const [error, setError] = useState('');
  const subscription = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const responseBuffer = useRef('');
  const eventBuffer = useRef<ChatEvent[]>([]);
  const receivedTokens = useRef(0);
  const totalLatency = useRef(0);
  const lastPaint = useRef(0);

  const publish = useCallback(() => {
    setResponse(responseBuffer.current);
    setEvents([...eventBuffer.current]);
    setTokenCount(receivedTokens.current);
    setLatencyMs(
      receivedTokens.current
        ? totalLatency.current / receivedTokens.current
        : 0,
    );
  }, []);

  const stop = useCallback(() => {
    subscription.current?.unsubscribe();
    subscription.current = undefined;
    publish();
    setState('idle');
    setPhase('Generation stopped');
  }, [publish]);

  const generate = useCallback(() => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;

    subscription.current?.unsubscribe();
    responseBuffer.current = '';
    eventBuffer.current = [];
    receivedTokens.current = 0;
    totalLatency.current = 0;
    lastPaint.current = 0;
    setSubmittedPrompt(cleanPrompt);
    setResponse('');
    setEvents([]);
    setTokenCount(0);
    setLatencyMs(0);
    setError('');
    setPhase('Opening stream');
    setState('connecting');

    subscription.current = client.chat.respond.subscribe(
      { prompt: cleanPrompt, tokensPerSecond, maxTokens },
      {
        onStarted() {
          setState('live');
          setPhase('Rust model simulator connected');
        },
        onData(event) {
          eventBuffer.current.push(event);
          if (eventBuffer.current.length > 7) eventBuffer.current.shift();

          if (event.kind === 'token') {
            responseBuffer.current += event.content;
            receivedTokens.current += 1;
            totalLatency.current += Math.max(
              0,
              Date.now() - event.sentAtUnixMs,
            );
          } else if (event.kind === 'thinking') {
            setPhase(event.content);
          } else if (event.kind === 'tool') {
            setPhase(event.content);
          } else if (event.kind === 'done') {
            setPhase('Response complete');
          }

          const now = performance.now();
          if (now - lastPaint.current >= 45 || event.kind !== 'token') {
            lastPaint.current = now;
            publish();
          }
        },
        onError(cause) {
          publish();
          setError(cause.message);
          setPhase('Stream failed');
          setState('error');
          subscription.current = undefined;
        },
        onComplete() {
          publish();
          setPhase('Response complete');
          setState('complete');
          subscription.current = undefined;
        },
      },
    );
  }, [maxTokens, prompt, publish, tokensPerSecond]);

  useEffect(() => () => subscription.current?.unsubscribe(), []);

  const active = state === 'connecting' || state === 'live';
  const progress = Math.min(100, (tokenCount / maxTokens) * 100);
  const statusLabel = {
    idle: 'Ready',
    connecting: 'Connecting',
    live: 'Generating',
    complete: 'Complete',
    error: 'Error',
  }[state];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#chat" aria-label="Relay chat home">
          <span className="brand-glyph">R/</span>
          <span>
            <strong>Relay</strong>
            <small>stream lab</small>
          </span>
        </a>

        <button className="new-chat" type="button" onClick={() => {
          stop();
          setSubmittedPrompt('');
          setResponse('');
          setEvents([]);
          setTokenCount(0);
          setLatencyMs(0);
          setError('');
          responseBuffer.current = '';
          eventBuffer.current = [];
          receivedTokens.current = 0;
          totalLatency.current = 0;
          setPhase('Waiting for a prompt');
        }}>
          <span>＋</span> New thread
        </button>

        <p className="side-label">Try a prompt</p>
        <nav className="presets" aria-label="Prompt presets">
          {PRESETS.map((preset, index) => (
            <button type="button" key={preset} onClick={() => setPrompt(preset)}>
              <span>0{index + 1}</span>
              {preset}
            </button>
          ))}
        </nav>

        <div className="architecture">
          <p className="side-label">Live route</p>
          <div><i className="react-dot" /><span>React</span><b>browser</b></div>
          <em />
          <div><i className="proxy-dot" /><span>Forwarder</span><b>:3103</b></div>
          <em />
          <div><i className="rust-dot" /><span>Rust tonic</span><b>:50054</b></div>
        </div>
      </aside>

      <main id="chat">
        <header className="topbar">
          <div>
            <p>stream.v1.ChatService</p>
            <strong>Respond</strong>
          </div>
          <div className="top-stats">
            <span><small>Chunks</small>{tokenCount}</span>
            <span><small>Mean latency</small>{latencyMs.toFixed(1)} ms</span>
            <span className={`connection connection-${state}`}><i />{statusLabel}</span>
          </div>
        </header>

        <section className="conversation">
          {!submittedPrompt ? (
            <div className="welcome">
              <span className="welcome-mark">R/</span>
              <p className="eyebrow">Rust-powered response streaming</p>
              <h1>Ask once.<br /><em>Watch every chunk arrive.</em></h1>
              <p>This local AI simulator streams typed protobuf events through the forwarding gRPC-Web path. No cloud model or hidden HTTP endpoint.</p>
              <div className="contract-strip">
                <span>React 19</span><b>→</b><span>gRPC-Web</span><b>→</b><span>Rust</span><b>→</b><span>server stream</span>
              </div>
            </div>
          ) : (
            <div className="thread">
              <article className="message user-message">
                <div className="avatar user-avatar">TN</div>
                <div><header><strong>You</strong><span>just now</span></header><p>{submittedPrompt}</p></div>
              </article>
              <article className="message assistant-message">
                <div className="avatar assistant-avatar">R/</div>
                <div className="message-body">
                  <header><strong>Relay</strong><span>Rust simulator</span></header>
                  <div className="phase"><i />{phase}</div>
                  <p className="answer">{response}<span className={active ? 'cursor' : 'cursor hidden'} /></p>
                  {response ? (
                    <footer>
                      <span>{tokenCount} protobuf chunks</span>
                      <span>{tokensPerSecond} target chunks/s</span>
                    </footer>
                  ) : null}
                </div>
              </article>

              <section className="trace">
                <header><span>Stream trace</span><small>most recent frames</small></header>
                <div>
                  {events.map((event) => (
                    <p key={event.sequence}>
                      <span>#{event.sequence.toString().padStart(4, '0')}</span>
                      <b className={`kind kind-${event.kind}`}>{event.kind}</b>
                      <em>{event.kind === 'token' ? JSON.stringify(event.content) : event.content}</em>
                    </p>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>

        {error ? <div className="error" role="alert">{error}</div> : null}

        <section className="composer">
          <textarea
            aria-label="Message"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                generate();
              }
            }}
            disabled={active}
            rows={3}
            placeholder="Message the Rust simulator…"
          />
          <div className="composer-bar">
            <div className="settings">
              <label>
                Speed
                <select aria-label="Generation speed" value={tokensPerSecond} onChange={(event) => setTokensPerSecond(Number(event.target.value))} disabled={active}>
                  <option value="40">40 chunks/s</option>
                  <option value="80">80 chunks/s</option>
                  <option value="160">160 chunks/s</option>
                  <option value="320">320 chunks/s</option>
                </select>
              </label>
              <label>
                Length
                <select aria-label="Response length" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} disabled={active}>
                  <option value="120">120 chunks</option>
                  <option value="260">260 chunks</option>
                  <option value="600">600 chunks</option>
                  <option value="1200">1,200 chunks</option>
                </select>
              </label>
            </div>
            <button className={active ? 'send stop' : 'send'} type="button" onClick={active ? stop : generate}>
              {active ? 'Stop' : 'Generate'}
              <kbd>{active ? '■' : '⌘↵'}</kbd>
            </button>
          </div>
          <div className="progress"><i style={{ '--progress': `${progress}%` } as CSSProperties} /></div>
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<App />);
