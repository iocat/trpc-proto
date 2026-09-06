const $ = (id) => document.getElementById(id);
let root;

function fail(err) {
  $('status').className = 'bad';
  $('status').textContent = String(err.message || err);
}

function servicesOf(ns, into = []) {
  if (ns instanceof protobuf.Service) into.push(ns);
  if (ns.nestedArray) {
    for (const nested of ns.nestedArray) servicesOf(nested, into);
  }
  return into;
}

function render() {
  const services = servicesOf(root);
  $('app').innerHTML = `
    <section>
      <h2>Services</h2>
      ${services
        .map((service) => {
          const methods = Object.keys(service.methods).sort();
          return `<h2>${service.fullName.replace(/^\./, '')}</h2>
            <pre>${methods.join('\n') || '(no methods)'}</pre>`;
        })
        .join('')}
    </section>`;
}

protobuf.load('/proto/calcom_v1.proto', (err, loaded) => {
  if (err) {
    fail(err);
    return;
  }
  root = loaded;
  $('status').textContent = 'proto loaded';
  $('status').className = 'ok';
  render();
});
