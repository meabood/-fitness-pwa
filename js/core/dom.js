// dom.js — safe DOM construction. All user-entered text (meal names, exercise
// names, routine names, notes) is rendered via textContent / createTextNode.
// We never assign user data to innerHTML, so stored XSS is structurally
// impossible even though the app is local.

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props]  className, dataset, attrs, text, html(TRUSTED only), on{Event}, style
 * @param {Array<Node|string>} [children]  strings become safe text nodes
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;              // safe
    else if (k === 'html') node.innerHTML = v;                // ONLY for trusted static markup (icons)
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'attrs') {
      for (const [ak, av] of Object.entries(v)) {
        if (av != null) node.setAttribute(ak, av);
      }
    } else {
      node.setAttribute(k, v);
    }
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace all children of a parent with new nodes. */
export function mount(parent, ...nodes) {
  parent.replaceChildren(...nodes.filter(Boolean));
  return parent;
}

/** Clear a node's children. */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/** Brief, non-intrusive confirmation toast (e.g., after saving). */
let toastTimer = null;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { className: 'toast', role: 'status', text: message });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 1800);
}

let snackTimer;
/**
 * Snackbar with an Undo action for reversible operations. The action fires at
 * most once; the bar auto-dismisses after ~6s. Returns a dismiss function.
 */
export function snackbar(message, { actionLabel = 'تراجع', onAction } = {}) {
  document.querySelector('.snackbar')?.remove();
  clearTimeout(snackTimer);
  let done = false;
  const bar = el('div', { className: 'snackbar', role: 'status' });
  const dismiss = () => { clearTimeout(snackTimer); bar.remove(); };
  bar.append(el('span', { className: 'sb-msg', text: message }));
  if (onAction) {
    bar.append(el('button', { text: actionLabel, onClick: async () => { if (done) return; done = true; dismiss(); await onAction(); } }));
  }
  document.body.append(bar);
  snackTimer = setTimeout(dismiss, 6000);
  return dismiss;
}
