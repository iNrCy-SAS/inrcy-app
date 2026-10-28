import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const snippet = fs.readFileSync(new URL('../../ops/wordpress-navigation/inrcy-multilingual-responsive.php', import.meta.url), 'utf8');
const source = snippet.match(/<script id="inrcy-active-nav-fix"[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'The deployed WordPress snippet contains the active navigation runtime.');
const defaultLinks = [
  ['/', 'Accueil'], ['/nos-outils/', 'Nos Outils'], ['/nos-packs', 'Nos Packs'], ['/blog', 'Blog'],
  ['/faq', 'FAQ'], ['/contact', 'Contact'], ['https://inrcy.com/annuaire/', 'iNr’Annuaire'],
];

function run(pathname, { links = defaultLinks, reference, singlePost = false, readyState = 'complete' } = {}) {
  const callbacks = {};
  const elements = links.map(([href, label]) => {
    const classes = new Set(['inrcy-nav-link', 'preserved-class']);
    const attributes = { href };
    return { label, classes, attributes, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      getAttribute(name) { return attributes[name] || null; }, setAttribute(name, value) { attributes[name] = value; },
      removeAttribute(name) { delete attributes[name]; } };
  });
  const nav = { querySelectorAll(selector) { assert.equal(selector, '.inrcy-nav-link'); return elements; } };
  const document = { readyState, body: { classList: { contains(name) { return name === 'single-post' && singlePost; } } },
    querySelector() { return reference ? { href: 'https://inrcy.com' + reference } : null; },
    getElementById(id) { assert.equal(id, 'inrcyResponsiveNav'); return nav; },
    addEventListener(name, callback) { callbacks[name] = callback; } };
  const window = { location: { origin: 'https://inrcy.com', pathname }, requestAnimationFrame(callback) { callback(); },
    addEventListener(name, callback) { callbacks[name] = callback; } };
  vm.runInNewContext(source, { document, window, URL });
  if (readyState === 'loading') callbacks.DOMContentLoaded();
  callbacks.pageshow();
  for (const element of elements) {
    assert.ok(element.classes.has('preserved-class'));
    assert.equal(element.attributes['aria-current'] === 'page', element.classes.has('active'));
  }
  return elements.filter(element => element.classes.has('active')).map(element => element.label);
}

for (const [path, expected] of [
  ['/', 'Accueil'], ['/?utm_source=test', 'Accueil'],
  ['/contact', 'Contact'], ['/contact/', 'Contact'], ['/contact/?utm_source=test#form', 'Contact'],
  ['/annuaire', 'iNr’Annuaire'], ['/annuaire/', 'iNr’Annuaire'], ['/annuaire/?metier=macon&page=2#resultats', 'iNr’Annuaire'],
  ['/annuaire/professionnels/', 'iNr’Annuaire'],
  ['/nos-packs/', 'Nos Packs'], ['/nos-outils/inr-badge/', 'Nos Outils'], ['/faq/', 'FAQ'], ['/blog/', 'Blog'],
]) {
  test(`${path} activates ${expected} alone`, () => assert.deepEqual(run(path), [expected]));
}

test('a similar prefix does not activate the directory', () => assert.deepEqual(run('/annuaire-autre/'), []));
test('an unknown destination does not leave a stale active item', () => assert.deepEqual(run('/inconnu/'), []));
test('translated links are matched from their actual URL', () => assert.deepEqual(run('/en/professional-directory/', {
  reference: '/annuaire/', links: [['/en/', 'Home'], ['/en/contact/', 'Contact'], ['/en/professional-directory/', 'Directory']],
}), ['Directory']));
test('Thai and Chinese locale prefixes behave like the rest of the site', () => {
  assert.deepEqual(run('/th/annuaire/'), ['iNr’Annuaire']);
  assert.deepEqual(run('/zh/contact/'), ['Contact']);
});
test('moving menu items does not break active state', () => assert.deepEqual(run('/annuaire/', { links: [...defaultLinks].reverse() }), ['iNr’Annuaire']));
test('the blog landing alias and a single article keep the Blog menu active', () => {
  assert.deepEqual(run('/blog-conseils-generateur/'), ['Blog']);
  assert.deepEqual(run('/un-article/', { singlePost: true }), ['Blog']);
});
test('the initial DOMContentLoaded path applies the same result', () => assert.deepEqual(run('/annuaire/', { readyState: 'loading' }), ['iNr’Annuaire']));
