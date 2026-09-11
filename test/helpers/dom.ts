/**
 * The smallest DOM the draft page needs to run.
 *
 * The page ships as a string of browser JavaScript inside `renderPage`, so the
 * only way to test what it does when you click something is to run it. This
 * stub covers exactly the surface that script touches, and nothing else: a
 * fuller fake would be a browser, and a smaller one would not run the page.
 */
export interface StubElement {
  tagName: string;
  children: StubElement[];
  parent?: StubElement;
  dataset: Record<string, string>;
  className: string;
  innerHTML: string;
  textContent: string;
  value: string;
  type: string;
  placeholder: string;
  title: string;
  open: boolean;
  focused: boolean;
  classList: {
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
    toggle(name: string, force?: boolean): void;
  };
  appendChild(child: StubElement): StubElement;
  focus(): void;
  onclick?: () => unknown;
  oninput?: () => unknown;
  onchange?: () => unknown;
  ontoggle?: () => unknown;
}

export function createElement(tagName: string): StubElement {
  let innerHTML = "";
  const children: StubElement[] = [];

  const classes = (): string[] => element.className.split(/\s+/u).filter(Boolean);
  const setClasses = (list: string[]): void => {
    element.className = list.join(" ");
  };

  const element = {
    tagName,
    children,
    dataset: {} as Record<string, string>,
    className: "",
    textContent: "",
    value: "",
    type: "",
    placeholder: "",
    title: "",
    open: false,
    focused: false,
    classList: {
      add(name: string) {
        const list = classes();

        if (!list.includes(name)) {
          setClasses([...list, name]);
        }
      },
      remove(name: string) {
        setClasses(classes().filter((entry) => entry !== name));
      },
      contains(name: string) {
        return classes().includes(name);
      },
      toggle(name: string, force?: boolean) {
        const wanted = force === undefined ? !classes().includes(name) : force;

        if (wanted) {
          element.classList.add(name);
        } else {
          element.classList.remove(name);
        }
      },
    },
    appendChild(child: StubElement) {
      child.parent = element;
      children.push(child);
      return child;
    },
    focus() {
      element.focused = true;
    },
  } as StubElement;

  // Assigning innerHTML replaces the children, which is how the page empties
  // the list before rebuilding it.
  Object.defineProperty(element, "innerHTML", {
    get: () => innerHTML,
    set: (value: string) => {
      innerHTML = value;
      children.length = 0;
    },
    enumerable: true,
  });

  return element;
}

export interface StubDocument {
  createElement(tagName: string): StubElement;
  getElementById(id: string): StubElement | undefined;
  querySelector(selector: string): StubElement | undefined;
}

/** A document holding the elements the page expects to already be there. */
export function createDocument(ids: string[]): {
  document: StubDocument;
  byId: Map<string, StubElement>;
} {
  const byId = new Map(ids.map((id) => [id, createElement("div")]));

  const document: StubDocument = {
    createElement,
    getElementById: (id) => byId.get(id),
    // The page asks for one class selector only.
    querySelector: (selector) => byId.get(selector.replace(/^\./u, "")),
  };

  return { document, byId };
}

/** Every element under `root`, itself included, in document order. */
export function descendants(root: StubElement): StubElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

/** The elements carrying a class, which is how the page marks what things are. */
export function byClass(root: StubElement, name: string): StubElement[] {
  return descendants(root).filter((element) => element.classList.contains(name));
}

export function byTag(root: StubElement, tagName: string): StubElement[] {
  return descendants(root).filter((element) => element.tagName === tagName);
}

/** The button of a card whose label is `label`. */
export function buttonNamed(root: StubElement, label: string): StubElement {
  const found = byTag(root, "button").find((element) => element.textContent === label);

  if (!found) {
    throw new Error(`no button labelled "${label}"`);
  }

  return found;
}
