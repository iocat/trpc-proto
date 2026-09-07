import { createTRPCProxyClient } from "@trpc/client";
import { grpcWebProxyLink } from "@trpc-proto/runtime/web";
import { appRouter } from "../router.ts";

const $ = (id) => document.getElementById(id);

function client() {
  return createTRPCProxyClient({
    links: [
      grpcWebProxyLink({
        router: appRouter,
        url: "",
        auth: { token: () => $("auth-token")?.value },
      }),
    ],
  });
}

function route() {
  return location.hash.replace(/^#\/?/, "") || "list";
}

function markNav() {
  const current = route();
  for (const link of document.querySelectorAll("nav a")) {
    const href = link.getAttribute("href") ?? "";
    link.classList.toggle("active", href === `#/${current}`);
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
  const filter = $("filter").value;
  const payload =
    filter === "open"
      ? { done: false }
      : filter === "done"
        ? { done: true }
        : {};
  const listed = await client().todo.list.query(payload);
  $("todo-rows").innerHTML = (listed.items || [])
    .map((todo) => {
      const titleClass = todo.done ? ' class="done"' : "";
      return `<tr data-id="${todo.id}">
        <td><input type="checkbox" class="toggle"${todo.done ? " checked" : ""} /></td>
        <td${titleClass}>${todo.title}</td>
        <td>${todo.notes || ""}</td>
        <td><button class="secondary tiny del">Delete</button></td>
      </tr>`;
    })
    .join("");
}

function fail(err) {
  $("status").className = "bad";
  $("status").textContent = String(err.message || err);
}

function bindList() {
  $("list-btn").onclick = () => refresh().catch(fail);
  $("filter").onchange = () => refresh().catch(fail);
  $("todo-rows").onclick = async (event) => {
    const row = event.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    try {
      if (event.target.classList.contains("toggle")) {
        await client().todo.setDone.mutate({
          id,
          done: event.target.checked,
        });
        await refresh();
      }
      if (event.target.classList.contains("del")) {
        await client().todo.remove.mutate({ id });
        await refresh();
      }
    } catch (err) {
      fail(err);
    }
  };
  return refresh();
}

function bindCreate() {
  $("create-btn").onclick = async () => {
    try {
      const created = await client().todo.create.mutate({
        title: $("title").value,
        notes: $("notes").value || undefined,
      });
      $("create-out").textContent = JSON.stringify(created, null, 2);
    } catch (err) {
      fail(err);
    }
  };
}

async function render() {
  markNav();
  const app = $("app");
  try {
    if (route() === "new") {
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

$("status").textContent = "ready";
$("status").className = "ok";
window.addEventListener("hashchange", () => {
  void render();
});
void render();
