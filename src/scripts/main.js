// UI wiring for IG Report. All parsing happens locally; nothing is sent anywhere.
import { loadExport } from './load.js';
import { compareLists } from './compare.js';
import { toCsv, profileUrl } from './csv.js';
import { ExportError } from './parse.js';
import { ZipError } from './zip.js';
import { sampleLists } from './sample.js';

const LISTS = ['notFollowingBack', 'fans', 'mutuals'];
const DESCRIPTIONS = {
  notFollowingBack: "You follow these accounts, but they don't follow you back.",
  fans: "These accounts follow you, but you don't follow them back.",
  mutuals: 'You follow each other.',
};
const DATE_LABELS = {
  notFollowingBack: 'You followed them',
  fans: 'They followed you',
  mutuals: 'You followed them',
};
const SLUGS = { notFollowingBack: 'not-following-back', fans: 'fans', mutuals: 'mutuals' };
const FEEDBACK_MS = 2000;
/** Rows drawn at once; big accounts (100k+) would freeze the tab otherwise. */
const PAGE_SIZE = 500;
const SEARCH_DEBOUNCE_MS = 120;

const $ = (id) => document.getElementById(id);
const els = {
  start: $('start'), results: $('results'), dropzone: $('dropzone'), fileInput: $('file-input'),
  status: $('status'), error: $('error'), sampleBtn: $('sample-btn'),
  title: $('results-title'), meta: $('results-meta'), panel: $('panel'),
  description: $('list-description'), search: $('search'), list: $('list'), empty: $('empty'),
  copyBtn: $('copy-btn'), csvBtn: $('csv-btn'), restartBtn: $('restart-btn'), sampleNote: $('sample-note'),
  moreWrap: $('more-wrap'), moreBtn: $('more-btn'), announcer: $('announcer'),
  tabs: [...document.querySelectorAll('.tab')],
};

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const num = (n) => n.toLocaleString();

/** App state: replaced, never mutated in place. */
let state = { result: null, active: 'notFollowingBack', query: '', isSample: false, limit: PAGE_SIZE };
const setState = (patch) => { state = { ...state, ...patch }; };

/* ---------------- Errors & status ---------------- */

function describeError(err) {
  if (err instanceof ZipError) {
    return ["That file couldn't be opened as a zip.", 'Download the export again from the link in Instagram\'s email, then drop the .zip here without unzipping it.'];
  }
  if (err instanceof ExportError) {
    const tips = {
      NO_FILES: 'When you request the export, tick "Followers and following" and choose JSON (or HTML) as the format.',
      NO_FOLLOWERS: 'If you are picking files one by one, select followers_1.json and following.json together.',
      NO_FOLLOWING: 'If you are picking files one by one, select followers_1.json and following.json together.',
      BAD_FILE: 'Request the export again with the format set to JSON.',
    };
    return [err.message, tips[err.code]];
  }
  return ["Something went wrong reading that file.", 'Try downloading the export again. If it keeps happening, open an issue on GitHub.'];
}

function showError(err) {
  const [headline, tip] = describeError(err);
  els.error.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = headline;
  els.error.append(strong, document.createTextNode(tip));
  els.error.hidden = false;
}

function setBusy(isBusy, message = '') {
  els.dropzone.classList.toggle('is-busy', isBusy);
  els.dropzone.setAttribute('aria-busy', String(isBusy));
  els.status.textContent = message;
}

/* ---------------- Loading ---------------- */

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length || els.dropzone.classList.contains('is-busy')) return;
  els.error.hidden = true;
  setBusy(true, 'Reading your export…');
  try {
    const lists = await loadExport(files);
    showResults(lists, false);
  } catch (err) {
    showError(err);
  } finally {
    setBusy(false);
    els.fileInput.value = '';
  }
}

/* ---------------- Results ---------------- */

function headline(count) {
  if (count === 0) return 'Everyone you follow follows you back.';
  if (count === 1) return '1 account you follow doesn\'t follow you back.';
  return `${num(count)} accounts you follow don't follow you back.`;
}

function showResults(lists, isSample) {
  const result = compareLists(lists.followers, lists.following);
  setState({ result, isSample, active: 'notFollowingBack', query: '', limit: PAGE_SIZE });

  els.title.textContent = headline(result.notFollowingBack.length);
  els.meta.textContent = `${num(lists.followers.length)} followers and ${num(lists.following.length)} following${isSample ? ' in the sample data' : ' in your export'}.`;
  for (const key of LISTS) {
    const count = num(result[key].length);
    document.querySelector(`[data-count="${key}"]`).textContent = count;
    document.querySelector(`#tab-${key} .tab-count`).textContent = count;
  }
  els.sampleNote.hidden = !isSample;
  els.search.value = '';

  els.start.hidden = true;
  els.results.hidden = false;
  els.results.classList.add('is-revealing');
  selectList('notFollowingBack');
  els.title.focus();
  window.scrollTo({ top: 0 });
}

function selectList(key, { focusTab = false } = {}) {
  setState({ active: key, limit: PAGE_SIZE });
  for (const tab of els.tabs) {
    const isActive = tab.dataset.list === key;
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive && focusTab) tab.focus();
  }
  els.panel.setAttribute('aria-labelledby', `tab-${key}`);
  document.querySelectorAll('.venn-region').forEach((g) => g.classList.toggle('is-active', g.dataset.region === key));
  document.querySelectorAll('.venn-count').forEach((t) => t.classList.toggle('is-active', t.dataset.count === key));
  els.description.textContent = DESCRIPTIONS[key];
  renderList();
}

function visibleAccounts() {
  const query = state.query.trim().toLowerCase().replace(/^@/, '');
  const accounts = state.result[state.active];
  return query ? accounts.filter((a) => a.username.toLowerCase().includes(query)) : accounts;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function openIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'row-open');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M14 5h5v5M19 5l-8 8M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4');
  svg.append(path);
  return svg;
}

function rowFor(account) {
  const row = document.createElement(state.isSample ? 'div' : 'a');
  row.className = 'row';
  if (!state.isSample) {
    row.href = profileUrl(account.username);
    row.target = '_blank';
    row.rel = 'noopener noreferrer';
    row.setAttribute('aria-label', `Open @${account.username} on Instagram (opens in a new tab)`);
  }
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = (account.username.match(/[a-z0-9]/i) ?? ['?'])[0];
  const name = document.createElement('span');
  name.className = 'row-name';
  name.textContent = `@${account.username}`;
  row.append(avatar, name);
  if (account.timestamp != null) {
    const date = new Date(account.timestamp * 1000);
    const when = document.createElement('time');
    when.className = 'row-date';
    when.dateTime = date.toISOString().slice(0, 10);
    when.textContent = monthYear.format(date);
    when.title = `${DATE_LABELS[state.active]} on ${fullDate.format(date)}`;
    row.append(when);
  }
  if (!state.isSample) row.append(openIcon());
  const li = document.createElement('li');
  li.append(row);
  return li;
}

function renderList() {
  const accounts = visibleAccounts();
  const fragment = document.createDocumentFragment();
  accounts.slice(0, state.limit).forEach((a) => fragment.append(rowFor(a)));
  els.list.replaceChildren(fragment);

  const remaining = accounts.length - state.limit;
  els.moreWrap.hidden = remaining <= 0;
  if (remaining > 0) {
    els.moreBtn.textContent = `Show ${num(Math.min(remaining, PAGE_SIZE))} more (${num(remaining)} left)`;
  }

  const total = state.result[state.active].length;
  els.empty.hidden = accounts.length > 0;
  if (!accounts.length) {
    els.empty.textContent = total ? `No usernames match "${state.query.trim()}".` : 'Nobody in this list.';
  }
  els.copyBtn.disabled = !accounts.length;
  els.csvBtn.disabled = !accounts.length;
}

/* ---------------- Copy & CSV ---------------- */

function announce(text) {
  els.announcer.textContent = '';
  // A fresh text node after clearing makes screen readers re-read repeat messages.
  requestAnimationFrame(() => { els.announcer.textContent = text; });
}

function flash(button, text) {
  announce(text);
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  button.classList.add('is-done');
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => {
    button.textContent = original;
    button.classList.remove('is-done');
  }, FEEDBACK_MS);
}

async function copyUsernames() {
  const accounts = visibleAccounts();
  try {
    await navigator.clipboard.writeText(accounts.map((a) => a.username).join('\n'));
    flash(els.copyBtn, `Copied ${num(accounts.length)}`);
  } catch {
    flash(els.copyBtn, "Couldn't copy");
  }
}

function downloadCsv() {
  const blob = new Blob([toCsv(visibleAccounts())], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ig-report-${SLUGS[state.active]}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  flash(els.csvBtn, 'Downloaded');
}

/* ---------------- Events ---------------- */

function restart() {
  setState({ result: null, query: '', isSample: false });
  els.list.replaceChildren();
  els.results.hidden = true;
  els.results.classList.remove('is-revealing');
  els.error.hidden = true;
  els.start.hidden = false;
  els.dropzone.focus();
}

function onTabKeydown(event) {
  const index = LISTS.indexOf(state.active);
  const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: LISTS.length - 1 - index };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = LISTS[(index + moves[event.key] + LISTS.length) % LISTS.length];
  selectList(next, { focusTab: true });
}

function bindDropzone() {
  const { dropzone, fileInput } = els;
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragging')));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    handleFiles(event.dataTransfer?.files ?? []);
  });
  // Stop a file dropped beside the box from opening in the browser instead.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

function init() {
  bindDropzone();
  els.sampleBtn.addEventListener('click', () => showResults(sampleLists(), true));
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectList(tab.dataset.list));
    tab.addEventListener('keydown', onTabKeydown);
  });
  document.querySelectorAll('.venn-region').forEach((g) => g.addEventListener('click', () => selectList(g.dataset.region)));
  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setState({ query: els.search.value, limit: PAGE_SIZE });
      renderList();
    }, SEARCH_DEBOUNCE_MS);
  });
  els.moreBtn.addEventListener('click', () => {
    setState({ limit: state.limit + PAGE_SIZE });
    renderList();
  });
  els.copyBtn.addEventListener('click', copyUsernames);
  els.csvBtn.addEventListener('click', downloadCsv);
  els.restartBtn.addEventListener('click', restart);
}

init();
