const menuButton = document.querySelector('.menu-button');
const menuLabel = document.querySelector('.menu-label');
const navigation = document.querySelector('#site-nav');

function setMenuOpen(isOpen) {
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuLabel.textContent = isOpen ? 'Close navigation' : 'Open navigation';
  navigation.classList.toggle('open', isOpen);
}

menuButton.addEventListener('click', () => {
  setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
});

navigation.addEventListener('click', () => setMenuOpen(false));

document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    menuButton.getAttribute('aria-expanded') === 'true'
  ) {
    setMenuOpen(false);
    menuButton.focus();
  }
});

const docsSubnav = document.querySelector('.docs-subnav');
let subnavSections = [];

const progressBar = document.querySelector('.reading-progress span');
let progressFrame;

function updateReadingProgress() {
  progressFrame = undefined;
  if (!progressBar) return;

  const scrollRange =
    document.documentElement.scrollHeight - window.innerHeight;
  const progress =
    scrollRange > 0
      ? Math.min(1, Math.max(0, window.scrollY / scrollRange))
      : 0;
  progressBar.style.transform = `scaleX(${progress})`;
}

function scheduleReadingProgress() {
  if (!progressBar || progressFrame !== undefined) return;
  progressFrame = requestAnimationFrame(updateReadingProgress);
}

if (progressBar) {
  window.addEventListener('scroll', scheduleReadingProgress, { passive: true });
  window.addEventListener('resize', scheduleReadingProgress);
  updateReadingProgress();
}

const syntaxDefinitions = {
  bash: {
    pattern:
      /(#.*$)|('(?:\\.|[^'])*'|"(?:\\.|[^"])*")|(--?[a-z][\w-]*)|(\b(?:npm|npx|trpc-proto)\b)|(\b\d+\b)/g,
    classes: ['comment', 'string', 'flag', 'keyword', 'number'],
  },
  typescript: {
    pattern:
      /(\/\/.*$)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|(\b(?:as|async|await|const|export|from|function|import|new|return|type|yield)\b)|(\b(?:false|null|true|undefined)\b)|(\b\d+(?:\.\d+)?\b)/g,
    classes: ['comment', 'string', 'keyword', 'literal', 'number'],
  },
};

document.querySelectorAll('pre > code[data-language]').forEach((code) => {
  const definition = syntaxDefinitions[code.dataset.language];
  if (!definition) return;

  const highlightedLines = new Set();
  const lineSpecification = code.parentElement.dataset.highlightLines ?? '';
  for (const part of lineSpecification.split(',')) {
    if (!part) continue;
    const [startText, endText = startText] = part.split('-');
    const start = Number(startText);
    const end = Number(endText);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      highlightedLines.add(lineNumber);
    }
  }

  const lines = code.textContent.replace(/\n$/u, '').split('\n');
  const fragment = document.createDocumentFragment();
  for (const [index, sourceLine] of lines.entries()) {
    const line = document.createElement('span');
    const lineNumber = index + 1;
    line.className = 'code-line';
    if (highlightedLines.has(lineNumber)) line.classList.add('is-emphasized');

    let offset = 0;
    const pattern = new RegExp(
      definition.pattern.source,
      definition.pattern.flags,
    );
    for (const match of sourceLine.matchAll(pattern)) {
      line.append(sourceLine.slice(offset, match.index));
      const token = document.createElement('span');
      const groupIndex = match
        .slice(1)
        .findIndex((group) => group !== undefined);
      token.className = `hl-${definition.classes[groupIndex]}`;
      token.textContent = match[0];
      line.append(token);
      offset = match.index + match[0].length;
    }
    line.append(
      sourceLine.slice(offset) || (sourceLine.length === 0 ? ' ' : ''),
    );
    fragment.append(line);
  }

  code.replaceChildren(fragment);
  code.parentElement.classList.add('syntax-highlighted');
});

const panelControllers = new Map();

document.querySelectorAll('[role="tablist"]').forEach((tabList) => {
  const tabs = [...tabList.querySelectorAll(':scope > [role="tab"]')];

  function selectTab(selectedTab, scrollToPanel = false) {
    let selectedPanel;
    tabs.forEach((tab) => {
      const selected = tab === selectedTab;
      const panel = document.querySelector(
        `#${tab.getAttribute('aria-controls')}`,
      );

      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
      if (selected) selectedPanel = panel;
    });

    if (selectedTab.classList.contains('docs-tab')) {
      renderDocumentationSubnav(selectedPanel, selectedTab);
    }

    if (scrollToPanel && selectedTab.classList.contains('docs-tab')) {
      selectedPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    scheduleReadingProgress();
  }

  tabs.forEach((tab, index) => {
    const panelId = tab.getAttribute('aria-controls');
    panelControllers.set(panelId, () => selectTab(tab));

    tab.addEventListener('click', () => {
      selectTab(tab, true);
      if (tab.classList.contains('docs-tab')) {
        const firstSection = document
          .querySelector(`#${panelId}`)
          .querySelector('.doc-section');
        if (firstSection) {
          history.replaceState(null, '', `#${firstSection.id}`);
        }
      }
    });
    tab.addEventListener('keydown', (event) => {
      const keyTargets = {
        ArrowDown: (index + 1) % tabs.length,
        ArrowLeft: (index - 1 + tabs.length) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        ArrowUp: (index - 1 + tabs.length) % tabs.length,
        End: tabs.length - 1,
        Home: 0,
      };
      const targetIndex = keyTargets[event.key];

      if (targetIndex === undefined) return;

      event.preventDefault();
      const nextTab = tabs[targetIndex];
      selectTab(nextTab, true);
      nextTab.focus();
    });
  });

  const initialTab =
    tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
  if (initialTab) selectTab(initialTab);
});

function renderDocumentationSubnav(panel, tab) {
  if (!docsSubnav) return;

  tab.insertAdjacentElement('afterend', docsSubnav);
  docsSubnav.dataset.panel = panel.id;
  subnavSections = [...panel.querySelectorAll(':scope > .doc-section[id]')];
  const list = document.createElement('ol');

  for (const section of subnavSections) {
    const heading = section.querySelector('h2');
    if (!heading) continue;

    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${section.id}`;
    link.textContent = heading.textContent;
    item.append(link);
    list.append(item);
  }

  docsSubnav.replaceChildren(list);
  docsSubnav.hidden = list.childElementCount === 0;
  updateActiveSubnav();
}

function updateActiveSubnav() {
  if (!docsSubnav || subnavSections.length === 0) return;

  const marker =
    (document.querySelector('.site-header')?.offsetHeight ?? 0) + 40;
  let activeSection = subnavSections[0];

  for (const section of subnavSections) {
    if (section.getBoundingClientRect().top > marker) break;
    activeSection = section;
  }

  if (
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 2
  ) {
    activeSection = subnavSections.at(-1);
  }

  docsSubnav.querySelectorAll('a').forEach((link) => {
    if (link.hash === `#${activeSection.id}`) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

if (docsSubnav) {
  window.addEventListener('scroll', updateActiveSubnav, { passive: true });
  window.addEventListener('resize', updateActiveSubnav);
}

function revealTabPanels(target) {
  const panels = [];
  for (let element = target; element; element = element.parentElement) {
    if (element.getAttribute?.('role') === 'tabpanel') panels.push(element);
  }
  for (const panel of panels.reverse()) {
    panelControllers.get(panel.id)?.();
  }
}

function revealCurrentHash() {
  if (!location.hash) return;
  const target = document.getElementById(
    decodeURIComponent(location.hash.slice(1)),
  );
  if (target) revealTabPanels(target);
}

revealCurrentHash();
window.addEventListener('hashchange', revealCurrentHash);

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    const target = document.getElementById(
      decodeURIComponent(link.getAttribute('href').slice(1)),
    );
    if (target) revealTabPanels(target);
  });
});

const toast = document.querySelector('.toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny this context.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) throw new Error('Clipboard copy was rejected');
}

document
  .querySelectorAll('[data-copy], [data-copy-target]')
  .forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.dataset.copyTarget;
      const target = targetId ? document.querySelector(`#${targetId}`) : null;
      const value = button.dataset.copy ?? target?.innerText;

      if (!value) {
        showToast('Nothing to copy');
        return;
      }

      try {
        await copyText(value.trim());
        showToast('Copied to clipboard');
      } catch {
        showToast('Copy failed — select the command manually');
      }
    });
  });
