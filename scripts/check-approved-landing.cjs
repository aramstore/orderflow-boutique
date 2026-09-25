// Render the production layout without browser, network, or checkout side effects.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { runInThisContext } = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const repo = path.resolve(__dirname, '..');
const viteRequire = createRequire(require.resolve('vite/package.json'));
const built = viteRequire('esbuild').buildSync({
  absWorkingDir: repo,
  stdin: {
    contents: `export { default as Layout } from './src/components/landing/StandardLandingLayout';
      export { APPROVED_LANDING_SECTION_ORDER as approved } from './src/lib/approvedLandingDesign';`,
    resolveDir: repo, loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  packages: 'external', jsx: 'automatic', alias: { '@': path.join(repo, 'src') },
});
const compiled = { exports: {} };
runInThisContext('(function(require,module,exports){' + built.outputFiles[0].text + '\n})')(
  require, compiled, compiled.exports,
);
const { Layout, approved } = compiled.exports;
const ids = ['hero', 'images', 'order', 'description', 'reviews', 'faq'];
const slots = Object.fromEntries(ids.map(id => [id, React.createElement(
  id === 'order' ? 'form' : 'section', { 'data-content': id, key: id },
  id === 'order' ? React.createElement('button', { type: 'submit' }, 'Order') : id,
)]));
const render = props => renderToStaticMarkup(React.createElement(Layout, { ...slots, ...props }));
const order = html => Array.from(html.matchAll(/data-content="([a-z]+)"/g), match => match[1]);
const approvedHtml = render({ sectionOrder: approved });
assert.deepEqual(order(approvedHtml), ['images', 'hero', 'order', 'description', 'reviews', 'faq']);
assert.equal((approvedHtml.match(/<form\b/g) || []).length, 1);
assert.equal((approvedHtml.match(/type="submit"/g) || []).length, 1);
assert.deepEqual(order(render({ sectionOrder: approved, formFirst: true })), [...approved]);
console.log('PASS approved reading order and one functional checkout, including legacy form-first pages');

assert.deepEqual(order(render({})), ids);
assert.match(render({ formFirst: true }), /order-2 lg:order-1/);
const paired = ['description', 'order', 'images', 'hero', 'reviews', 'faq'];
assert.deepEqual(order(render({ sectionOrder: paired })), paired);
assert.match(render({ sectionOrder: paired }), /data-wasla-part="checkout-grid"/);
console.log('PASS default layout compatibility and adjacent desktop checkout columns');

const sparse = render({ sectionOrder: approved, description: null, reviews: null, faq: null });
assert.deepEqual(order(sparse), ['images', 'hero', 'order']);
assert.equal((sparse.match(/<form\b/g) || []).length, 1);
console.log('PASS products without optional sections keep images, heading, and checkout');
