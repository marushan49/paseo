export const SNAPSHOT_REF_PATTERN = /^@e\d+$/;
export const MAX_SNAPSHOT_NODES = 400;

export interface CollectedSnapshotNode {
  role: string;
  name: string;
  selector: string;
}

export interface SnapshotNodeWithRef extends CollectedSnapshotNode {
  ref: string;
}

export interface SnapshotStats {
  nodeCount: number;
  refCount: number;
  textLength: number;
}

export interface FormattedSnapshot {
  yaml: string;
  nodes: SnapshotNodeWithRef[];
  truncated: boolean;
  stats: SnapshotStats;
}

export interface FindSnapshotRefInput {
  role: string;
  name: string;
}

export function formatSnapshotYaml(nodes: readonly CollectedSnapshotNode[]): FormattedSnapshot {
  const kept = nodes.slice(0, MAX_SNAPSHOT_NODES);
  const withRefs: SnapshotNodeWithRef[] = kept.map((node, index) => ({
    ...node,
    ref: `@e${index + 1}`,
  }));
  const yaml = withRefs
    .map((node) => `- ${node.role} ${JSON.stringify(node.name)} ${node.ref}`)
    .join("\n");
  const textLength = withRefs.reduce((total, node) => total + node.name.length, 0);
  return {
    yaml,
    nodes: withRefs,
    truncated: nodes.length > kept.length,
    stats: { nodeCount: withRefs.length, refCount: withRefs.length, textLength },
  };
}

export function findSnapshotRef(
  nodes: readonly SnapshotNodeWithRef[],
  target: FindSnapshotRefInput,
): string | null {
  const role = target.role.trim().toLowerCase();
  const name = target.name.trim().toLowerCase();
  for (const node of nodes) {
    if (node.role.toLowerCase() === role && node.name.trim().toLowerCase() === name) {
      return node.ref;
    }
  }
  return null;
}

export function snapshotRefIndex(ref: string): number | null {
  if (!SNAPSHOT_REF_PATTERN.test(ref)) {
    return null;
  }
  const index = Number.parseInt(ref.slice(2), 10);
  return Number.isSafeInteger(index) && index >= 1 ? index - 1 : null;
}

interface SnapshotDomElement {
  tagName: string;
  id: string;
  parentElement: SnapshotDomElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  textContent: string | null;
  querySelectorAll(selectors: string): SnapshotDomNodeList;
  getClientRects(): { length: number };
}

interface SnapshotDomNodeList {
  length: number;
  item(index: number): SnapshotDomElement | null;
}

interface SnapshotDomDocument {
  querySelectorAll(selectors: string): SnapshotDomNodeList;
  getElementById(id: string): SnapshotDomElement | null;
  documentElement: SnapshotDomElement | null;
}

declare const document: SnapshotDomDocument;
declare const getComputedStyle: (element: SnapshotDomElement) => {
  visibility: string;
  display: string;
};
declare const CSS: { escape(value: string): string };

export function collectSnapshotNodes(): CollectedSnapshotNode[] {
  // Self-contained: Playwright serializes only this function into the page,
  // so every helper and constant it needs lives inside it.
  const selectors =
    "a[href], button, input, select, textarea, h1, h2, h3, h4, h5, h6, img[alt], [role]";
  const knownRoles = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "heading",
    "img",
    "switch",
    "tab",
  ]);
  const maxNodes = 400;
  const maxNameLength = 120;

  function roleFor(tag: string, type: string, explicitRole: string | null): string | null {
    if (explicitRole && knownRoles.has(explicitRole.toLowerCase())) {
      return explicitRole.toLowerCase();
    }
    switch (tag) {
      case "A":
        return "link";
      case "BUTTON":
        return "button";
      case "SELECT":
        return "combobox";
      case "TEXTAREA":
        return "textbox";
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return "heading";
      case "IMG":
        return "img";
      case "INPUT": {
        switch (type.toLowerCase()) {
          case "checkbox":
            return "checkbox";
          case "radio":
            return "radio";
          case "hidden":
          case "file":
            return null;
          default:
            return "textbox";
        }
      }
      default:
        return null;
    }
  }

  function nameFor(element: SnapshotDomElement, doc: SnapshotDomDocument): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const labelled = id.length > 0 ? doc.getElementById(id) : null;
        const text = labelled?.textContent;
        if (text && text.trim().length > 0) {
          parts.push(text.trim().replace(/\s+/g, " "));
        }
      }
      if (parts.length > 0) {
        return parts.join(" ").slice(0, maxNameLength);
      }
    }
    const direct =
      element.getAttribute("aria-label") ??
      element.textContent ??
      element.getAttribute("placeholder") ??
      element.getAttribute("title") ??
      element.getAttribute("alt") ??
      "";
    return direct.trim().replace(/\s+/g, " ").slice(0, maxNameLength);
  }

  function isVisible(element: SnapshotDomElement): boolean {
    if (element.hasAttribute("hidden")) {
      return false;
    }
    if (element.getClientRects().length === 0) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function withNth(parent: SnapshotDomElement, current: SnapshotDomElement, tag: string): string {
    const siblings = parent.querySelectorAll(`:scope > ${tag}`);
    if (siblings.length <= 1) {
      return tag;
    }
    let nth = 1;
    for (let index = 0; index < siblings.length; index += 1) {
      if (siblings.item(index) === current) {
        break;
      }
      nth += 1;
    }
    return `${tag}:nth-of-type(${nth})`;
  }

  function selectorFor(element: SnapshotDomElement): string {
    if (element.id.length > 0) {
      return `#${CSS.escape(element.id)}`;
    }
    const parts: string[] = [];
    let current: SnapshotDomElement | null = element;
    let depth = 0;
    while (current && depth < 10) {
      const tag = current.tagName.toLowerCase();
      const parent: SnapshotDomElement | null = current.parentElement;
      if (!parent || tag === "html" || tag === "body") {
        parts.unshift(tag);
        break;
      }
      if (parent.id.length > 0) {
        parts.unshift(withNth(parent, current, tag));
        parts.unshift(`#${CSS.escape(parent.id)}`);
        break;
      }
      parts.unshift(withNth(parent, current, tag));
      current = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  const doc = document;
  const found = doc.querySelectorAll(selectors);
  const nodes: CollectedSnapshotNode[] = [];
  for (let index = 0; index < found.length && nodes.length < maxNodes; index += 1) {
    const element = found.item(index);
    if (!element || !isVisible(element)) {
      continue;
    }
    const role = roleFor(
      element.tagName,
      element.getAttribute("type") ?? "",
      element.getAttribute("role"),
    );
    if (!role) {
      continue;
    }
    const selector = selectorFor(element);
    if (selector.length === 0) {
      continue;
    }
    nodes.push({ role, name: nameFor(element, doc), selector });
  }
  return nodes;
}
