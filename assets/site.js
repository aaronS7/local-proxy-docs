'use strict';
const dialog = document.querySelector('#search-dialog');
const input = document.querySelector('#docs-search');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
let index;
let searchRequest;
async function search() {
  if (!index) return;
  const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = index.filter(page => words.every(word => `${page.title} ${page.description} ${page.text}`.toLowerCase().includes(word)));
  results.replaceChildren();
  status.textContent = words.length ? `${matches.length} ${matches.length === 1 ? 'page' : 'pages'} found` : 'Browse the documentation';
  for (const page of matches) {
    const link = document.createElement('a');
    link.href = page.url;
    link.textContent = page.title;
    const description = document.createElement('span');
    description.textContent = page.description;
    link.append(description);
    results.append(link);
  }
}
async function openSearch() {
  if (!dialog.open) dialog.showModal();
  input.focus();
  if (!index) {
    status.textContent = 'Loading documentation…';
    try {
      searchRequest ||= fetch('search-index.json').then(response => {
        if (!response.ok) throw new Error('Could not load index');
        return response.json();
      });
      index = await searchRequest;
    } catch {
      searchRequest = undefined;
      status.textContent = 'Search could not load. Use the page navigation or try again.';
      return;
    }
  }
  search();
}
document.querySelector('.search-trigger').addEventListener('click', openSearch);
document.querySelector('#search-close').addEventListener('click', () => dialog.close());
input.addEventListener('input', search);
input.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { results.querySelector('a')?.focus(); event.preventDefault(); }
  if (event.key === 'Enter') results.querySelector('a')?.click();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  if (event.key === 'Escape') {
    if (dialog.open) { event.preventDefault(); dialog.close(); }
    document.querySelector('#sidebar').classList.remove('is-open');
    document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false');
  }
});
const menu = document.querySelector('#menu-toggle');
menu.addEventListener('click', () => {
  const open = document.querySelector('#sidebar').classList.toggle('is-open');
  menu.setAttribute('aria-expanded', String(open));
});
for (const block of document.querySelectorAll('pre')) {
  const code = block.querySelector('code');
  if (!code) continue;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code example');
  button.addEventListener('click', async () => {
    const value = code.textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const field = document.createElement('textarea');
        field.value = value;
        field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.append(field); field.select();
        try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
        finally { field.remove(); button.focus(); }
      }
      button.textContent = 'Copied';
      document.querySelector('#copy-status').textContent = 'Code example copied.';
    } catch {
      button.textContent = 'Select code';
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.querySelector('#copy-status').textContent = 'Code selected. Use your browser’s copy command.';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
  block.append(button);
}
