const panes = {
  left: { currentId: null, selectedId: null, selectedIds: [], selectionAnchorId: null },
  right: { currentId: null, selectedId: null, selectedIds: [], selectionAnchorId: null },
};

let activePaneId = "left";
let nodeById = new Map();
let parentById = new Map();
let rootId = null;

const paneElements = {
  left: document.getElementById("pane-left"),
  right: document.getElementById("pane-right"),
};
const dialog = document.getElementById("edit-dialog");
const form = document.getElementById("edit-form");
const titleInput = document.getElementById("bookmark-title");
const urlInput = document.getElementById("bookmark-url");
const urlField = document.getElementById("url-field");
const managerContent = document.getElementById("manager-content");
const previewSplitter = document.getElementById("preview-splitter");
const previewToggle = document.getElementById("preview-toggle");
const previewFrame = document.getElementById("preview-frame");
const previewEmpty = document.getElementById("preview-empty");
const previewTitle = document.getElementById("preview-title");
const previewAddress = document.getElementById("preview-address");
const previewOpen = document.getElementById("preview-open");
let editorMode = "edit";
let editorNodeId = null;
let previewNodeId = null;
let previewRatio = 0.5;
let resizingPreview = false;
let bookmarkClipboard = null;
let isSortingBookmarks = false;
let isImportingBookmarks = false;

function activePane() {
  return panes[activePaneId];
}

function getSelectedNodes(pane) {
  return pane.selectedIds.map((id) => nodeById.get(id)).filter(Boolean);
}

function getPaneItems(paneId) {
  return [...(nodeById.get(panes[paneId].currentId)?.children || [])];
}

function sortBookmarkItems(items) {
  return items.sort((left, right) => {
    if (Boolean(left.url) !== Boolean(right.url)) return left.url ? 1 : -1;
    return (left.title || "").localeCompare(right.title || "", undefined, { sensitivity: "base", numeric: true });
  });
}

function snapshotBookmark(node) {
  if (node.url) return { title: node.title, url: node.url };
  return { title: node.title, children: (node.children || []).map(snapshotBookmark) };
}

function isCutPending(nodeId) {
  return bookmarkClipboard?.mode === "cut" && bookmarkClipboard.entries.some((entry) => entry.id === nodeId);
}

function copySelectionToClipboard(mode) {
  const nodes = getSelectedNodes(activePane());
  if (nodes.length === 0) return;
  const updateCutMarks = bookmarkClipboard?.mode === "cut" || mode === "cut";
  bookmarkClipboard = {
    mode,
    entries: nodes.map((node) => ({ id: node.id, snapshot: snapshotBookmark(node) })),
  };
  if (updateCutMarks) {
    for (const paneId of Object.keys(panes)) renderPane(paneId);
    if (activePane().selectedId) focusBookmarkRow(activePaneId, activePane().selectedId);
  }
  setStatus(`${mode === "cut" ? "Cut" : "Copied"} ${nodes.length} item${nodes.length === 1 ? "" : "s"}; source unchanged until paste`);
}

function selectAllBookmarks(paneId) {
  const pane = panes[paneId];
  const items = getPaneItems(paneId);
  setActivePane(paneId);
  if (items.length === 0) {
    clearPaneSelection(pane);
    previewNodeId = null;
    renderPreview();
    renderPane(paneId);
    syncControls();
    setStatus("No items to select");
    return;
  }

  pane.selectedIds = items.map((item) => item.id);
  if (!pane.selectedIds.includes(pane.selectedId)) pane.selectedId = items[0].id;
  pane.selectionAnchorId = pane.selectedId;
  previewNodeId = pane.selectedId;
  renderPreview();
  renderPane(paneId);
  syncControls();
  focusBookmarkRow(paneId, pane.selectedId);
  setStatus(`Selected all ${items.length} items in source`);
}

function clearPaneSelection(pane) {
  pane.selectedId = null;
  pane.selectedIds = [];
  pane.selectionAnchorId = null;
}

function destinationPaneId() {
  return activePaneId === "left" ? "right" : "left";
}

function setStatus(message) {
  document.getElementById("status-message").textContent = message;
}

function walkTree(node, parentId = null) {
  nodeById.set(node.id, node);
  if (parentId !== null) parentById.set(node.id, parentId);
  for (const child of node.children || []) walkTree(child, node.id);
}

async function refresh() {
  try {
    const [root] = await chrome.bookmarks.getTree();
    nodeById = new Map();
    parentById = new Map();
    walkTree(root);
    rootId = root.id;

    for (const paneId of Object.keys(panes)) {
      const pane = panes[paneId];
      if (!pane.currentId || !nodeById.has(pane.currentId)) pane.currentId = rootId;
      const currentChildren = new Set((nodeById.get(pane.currentId)?.children || []).map((node) => node.id));
      pane.selectedIds = pane.selectedIds.filter((id) => currentChildren.has(id));
      if (!pane.selectedIds.includes(pane.selectedId)) pane.selectedId = pane.selectedIds[pane.selectedIds.length - 1] || null;
      if (!pane.selectedIds.includes(pane.selectionAnchorId)) pane.selectionAnchorId = pane.selectedId;
      renderPane(paneId);
    }
    if (previewNodeId && !nodeById.has(previewNodeId)) previewNodeId = null;
    renderPreview();
    syncControls();
    setStatus("Bookmarks are up to date");
  } catch (error) {
    setStatus(`Could not load bookmarks: ${error.message}`);
  }
}

function getPath(nodeId) {
  const path = [];
  let current = nodeById.get(nodeId);
  while (current) {
    path.unshift(current);
    const parentId = parentById.get(current.id);
    current = parentId === undefined ? null : nodeById.get(parentId);
  }
  return path;
}

function renderBreadcrumbs(paneId) {
  const pane = panes[paneId];
  const nav = document.getElementById(`breadcrumbs-${paneId}`);
  nav.replaceChildren();
  const path = getPath(pane.currentId);

  path.forEach((node, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "crumb-separator";
      separator.textContent = "/";
      nav.append(separator);
    }
    const button = document.createElement("button");
    button.className = `crumb${index === path.length - 1 ? " current" : ""}`;
    button.type = "button";
    button.textContent = node.id === rootId ? "All bookmarks" : (node.title || "Untitled folder");
    button.disabled = index === path.length - 1;
    button.addEventListener("click", () => {
      setActivePane(paneId);
      pane.currentId = node.id;
      clearPaneSelection(pane);
      previewNodeId = null;
      renderPreview();
      renderPane(paneId);
      syncControls();
    });
    nav.append(button);
  });
}

function renderPane(paneId) {
  const pane = panes[paneId];
  const list = document.getElementById(`list-${paneId}`);
  const upButton = document.querySelector(`[data-pane-up="${paneId}"]`);
  const footer = document.getElementById(`footer-${paneId}`);
  list.replaceChildren();
  renderBreadcrumbs(paneId);

  const parentId = parentById.get(pane.currentId);
  upButton.disabled = pane.currentId === rootId || parentId === undefined;
  upButton.onclick = () => {
    if (parentId !== undefined) {
      setActivePane(paneId);
      pane.currentId = parentId;
      clearPaneSelection(pane);
      previewNodeId = null;
      renderPreview();
      renderPane(paneId);
      syncControls();
    }
  };

  const children = getPaneItems(paneId);
  if (children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const heading = document.createElement("strong");
    heading.textContent = "Nothing here yet";
    const detail = document.createElement("span");
    detail.textContent = "Choose another folder or add bookmarks in Chrome.";
    empty.append(heading, detail);
    list.append(empty);
  } else {
    for (const node of children) list.append(createBookmarkRow(paneId, node));
  }

  const selectedNodes = getSelectedNodes(pane);
  const selectionLabel = selectedNodes.length === 1
    ? `  |  Selected: ${selectedNodes[0].title || "Untitled"}`
    : selectedNodes.length > 1 ? `  |  Selected: ${selectedNodes.length} items` : "";
  footer.textContent = `${children.length} ${children.length === 1 ? "item" : "items"}${selectionLabel}`;
}

function createBookmarkRow(paneId, node) {
  const row = document.createElement("button");
  row.className = `bookmark-row${panes[paneId].selectedIds.includes(node.id) ? " selected" : ""}${isCutPending(node.id) ? " cut-pending" : ""}`;
  row.type = "button";
  row.role = "option";
  row.setAttribute("aria-selected", String(panes[paneId].selectedIds.includes(node.id)));
  row.dataset.nodeId = node.id;

  const name = document.createElement("span");
  name.className = "item-name";
  const glyph = document.createElement("span");
  glyph.className = node.url ? "bookmark-glyph" : "folder-glyph";
  glyph.setAttribute("aria-hidden", "true");
  const nameText = document.createElement("span");
  nameText.className = "item-name-text";
  nameText.textContent = node.title || (node.url ? "Untitled bookmark" : "Untitled folder");
  name.append(glyph, nameText);

  const address = document.createElement("span");
  address.className = "item-address";
  address.textContent = node.url || "Folder";
  address.title = node.url || "Folder";
  row.append(name, address);

  row.addEventListener("click", () => {
    selectBookmark(paneId, node);
  });
  row.addEventListener("dblclick", () => activateNode(paneId, node));
  return row;
}

function focusBookmarkRow(paneId, nodeId) {
  const row = [...document.querySelectorAll(`#list-${paneId} .bookmark-row`)].find((item) => item.dataset.nodeId === nodeId);
  row?.focus();
}

function selectBookmark(paneId, node) {
  setActivePane(paneId);
  panes[paneId].selectedId = node.id;
  panes[paneId].selectedIds = [node.id];
  panes[paneId].selectionAnchorId = node.id;
  previewNodeId = node.id;
  renderPreview();
  renderPane(paneId);
  syncControls();
  focusBookmarkRow(paneId, node.id);
}

function deselectBookmark(paneId, node) {
  setActivePane(paneId);
  const pane = panes[paneId];
  pane.selectedIds = pane.selectedIds.filter((id) => id !== node.id);
  if (pane.selectedId === node.id) pane.selectedId = pane.selectedIds[pane.selectedIds.length - 1] || null;
  if (pane.selectionAnchorId === node.id) pane.selectionAnchorId = pane.selectedId;
  if (previewNodeId === node.id) previewNodeId = pane.selectedId;
  renderPreview();
  renderPane(paneId);
  syncControls();
  focusBookmarkRow(paneId, node.id);
}

function selectBookmarkRange(paneId, node, initialAnchorId = null) {
  const pane = panes[paneId];
  const items = getPaneItems(paneId);
  let anchorIndex = items.findIndex((item) => item.id === pane.selectionAnchorId);
  if (anchorIndex === -1) {
    pane.selectionAnchorId = pane.selectedId || initialAnchorId || node.id;
    anchorIndex = items.findIndex((item) => item.id === pane.selectionAnchorId);
  }
  const targetIndex = items.findIndex((item) => item.id === node.id);
  if (anchorIndex === -1 || targetIndex === -1) return;
  setActivePane(paneId);
  pane.selectedIds = items.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1).map((item) => item.id);
  pane.selectedId = node.id;
  previewNodeId = node.id;
  renderPreview();
  renderPane(paneId);
  syncControls();
  focusBookmarkRow(paneId, node.id);
}

function navigateToParent(paneId) {
  const pane = panes[paneId];
  const parentId = parentById.get(pane.currentId);
  if (parentId === undefined) return;
  setActivePane(paneId);
  pane.currentId = parentId;
  clearPaneSelection(pane);
  previewNodeId = null;
  renderPreview();
  renderPane(paneId);
  syncControls();
  paneElements[paneId].focus();
}

function activateNode(paneId, node) {
  if (node.url) {
    chrome.tabs.create({ url: node.url });
  } else {
    panes[paneId].currentId = node.id;
    clearPaneSelection(panes[paneId]);
    previewNodeId = null;
    renderPreview();
    renderPane(paneId);
    syncControls();
  }
}

function setActivePane(paneId, focus = false) {
  activePaneId = paneId;
  for (const id of Object.keys(paneElements)) {
    paneElements[id].classList.toggle("active", id === paneId);
  }
  syncControls();
  if (focus) paneElements[paneId].focus();
}

function renderPreview() {
  const isCollapsed = managerContent.classList.contains("is-collapsed");
  const node = previewNodeId ? nodeById.get(previewNodeId) : null;
  const clearFrame = () => {
    previewFrame.hidden = true;
    if (previewFrame.dataset.previewUrl) previewFrame.src = "about:blank";
    delete previewFrame.dataset.previewUrl;
  };

  if (isCollapsed) {
    clearFrame();
    previewEmpty.hidden = false;
    previewEmpty.querySelector("strong").textContent = "Preview is collapsed";
    previewEmpty.querySelector("span").textContent = "Reopen the preview pane to view the selected bookmark.";
    return;
  }

  if (!node) {
    clearFrame();
    previewTitle.textContent = "No bookmark selected";
    previewAddress.textContent = "";
    previewOpen.hidden = true;
    previewEmpty.hidden = false;
    previewEmpty.querySelector("strong").textContent = "Select a bookmark to preview it";
    previewEmpty.querySelector("span").textContent = "Some websites prevent embedded previews.";
    return;
  }

  previewTitle.textContent = node.title || "Untitled bookmark";
  previewAddress.textContent = node.url || "Folder";
  previewOpen.hidden = !node.url;
  if (!node.url) {
    clearFrame();
    previewEmpty.hidden = false;
    previewEmpty.querySelector("strong").textContent = "Folder selected";
    previewEmpty.querySelector("span").textContent = "Open the folder in either bookmark pane to browse its contents.";
    return;
  }

  previewOpen.onclick = () => chrome.tabs.create({ url: node.url });
  let protocol;
  try {
    protocol = new URL(node.url).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") {
    clearFrame();
    previewEmpty.hidden = false;
    previewEmpty.querySelector("strong").textContent = "Preview unavailable";
    previewEmpty.querySelector("span").textContent = "Only HTTP and HTTPS bookmarks can be previewed here.";
    return;
  }

  previewEmpty.hidden = true;
  if (previewFrame.dataset.previewUrl !== node.url) {
    previewFrame.dataset.previewUrl = node.url;
    previewFrame.src = node.url;
  }
  previewFrame.hidden = false;
}

function setPreviewRatio(ratio) {
  previewRatio = Math.max(0.25, Math.min(0.75, ratio));
  managerContent.style.setProperty("--bookmark-share", `${previewRatio}fr`);
  managerContent.style.setProperty("--preview-share", `${1 - previewRatio}fr`);
  previewSplitter.setAttribute("aria-valuenow", String(Math.round(previewRatio * 100)));
}

function setPreviewCollapsed(collapsed) {
  managerContent.classList.toggle("is-collapsed", collapsed);
  previewToggle.textContent = collapsed ? "Show preview" : "Hide preview";
  previewToggle.setAttribute("aria-expanded", String(!collapsed));
  renderPreview();
}

previewToggle.addEventListener("click", () => {
  setPreviewCollapsed(!managerContent.classList.contains("is-collapsed"));
});

previewSplitter.addEventListener("pointerdown", (event) => {
  if (managerContent.classList.contains("is-collapsed")) return;
  resizingPreview = true;
  previewSplitter.setPointerCapture(event.pointerId);
  event.preventDefault();
});

previewSplitter.addEventListener("pointermove", (event) => {
  if (!resizingPreview) return;
  const bounds = managerContent.getBoundingClientRect();
  const splitterHeight = document.querySelector(".splitter-row").offsetHeight;
  setPreviewRatio((event.clientY - bounds.top - splitterHeight / 2) / (bounds.height - splitterHeight));
});

function stopPreviewResize(event) {
  resizingPreview = false;
  if (previewSplitter.hasPointerCapture(event.pointerId)) previewSplitter.releasePointerCapture(event.pointerId);
}

previewSplitter.addEventListener("pointerup", stopPreviewResize);
previewSplitter.addEventListener("pointercancel", stopPreviewResize);
previewSplitter.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setPreviewRatio(previewRatio - 0.05);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    setPreviewRatio(previewRatio + 0.05);
  }
});

function syncControls() {
  const selectedNodes = getSelectedNodes(activePane());
  for (const button of document.querySelectorAll("[data-action]")) {
    const action = button.dataset.action;
    button.disabled = action === "rename"
      ? selectedNodes.length !== 1
      : action === "edit"
        ? selectedNodes.length !== 1 || !selectedNodes[0]?.url
        : selectedNodes.length === 0;
  }
  for (const paneId of Object.keys(paneElements)) {
    paneElements[paneId].querySelector(".pane-role").textContent = paneId === activePaneId ? "SOURCE" : "DESTINATION";
  }
}

function isWithin(nodeId, ancestorId) {
  let currentId = nodeId;
  while (currentId !== undefined) {
    if (currentId === ancestorId) return true;
    currentId = parentById.get(currentId);
  }
  return false;
}

async function cloneNode(node, destinationId) {
  if (node.url) {
    await chrome.bookmarks.create({ parentId: destinationId, title: node.title, url: node.url });
    return;
  }
  const folder = await chrome.bookmarks.create({ parentId: destinationId, title: node.title });
  for (const child of node.children || []) await cloneNode(child, folder.id);
}

async function pasteBookmarkClipboard() {
  if (!bookmarkClipboard) return;
  const clipboard = bookmarkClipboard;
  const destinationId = panes[destinationPaneId()].currentId;
  try {
    if (clipboard.mode === "copy") {
      for (const entry of clipboard.entries) await cloneNode(entry.snapshot, destinationId);
      await refresh();
      setStatus(`Pasted ${clipboard.entries.length} item${clipboard.entries.length === 1 ? "" : "s"} into destination`);
      return;
    }

    const nodes = clipboard.entries.map((entry) => nodeById.get(entry.id));
    if (nodes.some((node) => !node)) {
      setStatus("One or more cut items no longer exist");
      return;
    }
    const invalidFolder = nodes.find((node) => !node.url && isWithin(destinationId, node.id));
    if (invalidFolder) {
      setStatus("A folder cannot be pasted into itself or one of its subfolders");
      return;
    }
    const nodesToMove = nodes.filter((node) => node.parentId !== destinationId);
    if (nodesToMove.length === 0) {
      setStatus("Cut items are already in the destination folder");
      return;
    }
    for (const node of nodesToMove) await chrome.bookmarks.move(node.id, { parentId: destinationId });
    bookmarkClipboard = null;
    await refresh();
    setStatus(`Moved ${nodesToMove.length} item${nodesToMove.length === 1 ? "" : "s"} into destination`);
  } catch (error) {
    setStatus(`Paste failed: ${error.message}`);
  }
}

async function runAction(action) {
  const source = activePane();
  const nodes = getSelectedNodes(source).filter((node) => node.id !== rootId);
  if (nodes.length === 0) return;
  const node = nodes[0];
  if ((action === "rename" || action === "edit") && nodes.length !== 1) {
    setStatus("Rename and Edit require a single selected item");
    return;
  }
  const destinationId = destinationPaneId();
  const destination = panes[destinationId];

  try {
    if (action === "copy") {
      for (const selectedNode of nodes) await cloneNode(selectedNode, destination.currentId);
      setStatus(`Copied ${nodes.length} item${nodes.length === 1 ? "" : "s"} to destination`);
    } else if (action === "move") {
      const invalidFolder = nodes.find((selectedNode) => !selectedNode.url && isWithin(destination.currentId, selectedNode.id));
      if (invalidFolder) {
        setStatus("A folder cannot be moved into itself or one of its subfolders");
        return;
      }
      if (nodes.every((selectedNode) => selectedNode.parentId === destination.currentId)) {
        setStatus("Already in the destination folder");
        return;
      }
      for (const selectedNode of nodes) await chrome.bookmarks.move(selectedNode.id, { parentId: destination.currentId });
      clearPaneSelection(source);
      setStatus(`Moved ${nodes.length} item${nodes.length === 1 ? "" : "s"} to destination`);
    } else if (action === "duplicate") {
      for (const selectedNode of nodes) await cloneNode(selectedNode, source.currentId);
      setStatus(`Duplicated ${nodes.length} item${nodes.length === 1 ? "" : "s"} in source`);
    } else if (action === "delete") {
      const description = nodes.length === 1
        ? `this ${node.url ? "bookmark" : "folder and all bookmarks inside it"}`
        : `${nodes.length} selected items and any bookmarks inside selected folders`;
      const titles = nodes.map((selectedNode) => selectedNode.title || "Untitled").join("\n");
      if (!window.confirm(`Delete ${description}?\n\n${titles}`)) return;
      for (const selectedNode of nodes) {
        if (selectedNode.url) await chrome.bookmarks.remove(selectedNode.id);
        else await chrome.bookmarks.removeTree(selectedNode.id);
      }
      clearPaneSelection(source);
      setStatus(`Deleted ${nodes.length} item${nodes.length === 1 ? "" : "s"} from source`);
    } else if (action === "rename" || action === "edit") {
      openEditor(action, node);
      return;
    }
    await refresh();
  } catch (error) {
    setStatus(`Action failed: ${error.message}`);
  }
}

function openEditor(mode, node) {
  editorMode = mode;
  editorNodeId = node.id;
  document.getElementById("dialog-title").textContent = mode === "rename" ? "Rename item" : "Edit bookmark";
  document.getElementById("dialog-eyebrow").textContent = node.url ? "BOOKMARK" : "FOLDER";
  titleInput.value = node.title || "";
  urlInput.value = node.url || "";
  const showUrl = mode === "edit" && Boolean(node.url);
  urlField.hidden = !showUrl;
  urlInput.required = showUrl;
  dialog.showModal();
  titleInput.focus();
  titleInput.select();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const changes = { title: titleInput.value.trim() };
  if (!changes.title) {
    titleInput.setCustomValidity("Enter a name.");
    titleInput.reportValidity();
    return;
  }
  titleInput.setCustomValidity("");
  if (editorMode === "edit" && urlField.hidden === false) changes.url = urlInput.value.trim();

  try {
    await chrome.bookmarks.update(editorNodeId, changes);
    dialog.close();
    setStatus(editorMode === "rename" ? "Renamed in source" : "Updated in source");
    await refresh();
  } catch (error) {
    setStatus(`Could not save changes: ${error.message}`);
  }
});

document.getElementById("cancel-edit").addEventListener("click", () => dialog.close());
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => runAction(button.dataset.action));
});

document.getElementById("sort-source").addEventListener("click", sortActiveFolderInBrowser);
const importFileInput = document.getElementById("import-bookmarks-file");
document.getElementById("import-bookmarks").addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];
  if (file) await importBookmarksFromFile(file);
  importFileInput.value = "";
});
document.getElementById("export-bookmarks").addEventListener("click", exportBookmarks);

async function sortActiveFolderInBrowser() {
  if (isSortingBookmarks) return;
  const paneId = activePaneId;
  const parentId = panes[paneId].currentId;
  const items = sortBookmarkItems([...(nodeById.get(parentId)?.children || [])]);
  const managedItem = items.find((item) => item.unmodifiable);
  if (managedItem) {
    setStatus("This folder contains managed bookmarks that Chrome does not allow to reorder");
    return;
  }

  const sortButton = document.getElementById("sort-source");
  isSortingBookmarks = true;
  sortButton.disabled = true;
  setStatus("Sorting bookmarks in Chrome...");
  try {
    for (let index = 0; index < items.length; index += 1) {
      await chrome.bookmarks.move(items[index].id, { parentId, index });
    }
    await refresh();
    setStatus("Sorted current folder A-Z in Chrome");
  } catch (error) {
    await refresh();
    setStatus(`Could not sort bookmarks: ${error.message}`);
  } finally {
    isSortingBookmarks = false;
    sortButton.disabled = false;
    if (activePaneId === paneId) {
      const selectedId = panes[paneId].selectedId;
      if (selectedId) focusBookmarkRow(paneId, selectedId);
      else paneElements[paneId].focus();
    }
  }
}

function parseBookmarkHTML(markup) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const rootList = [...parsed.querySelectorAll("dl")].find((list) => !list.parentElement.closest("dl"));
  if (!rootList) throw new Error("The selected file is not a bookmarks HTML file");

  function parseList(list) {
    const entries = [];
    const directEntries = [...list.querySelectorAll("dt")].filter((entry) => entry.closest("dl") === list);
    for (const entry of directEntries) {
      const heading = entry.querySelector(":scope > h3") || entry.querySelector("h3");
      if (heading) {
        let nestedList = entry.querySelector("dl");
        if (!nestedList) {
          let sibling = entry.nextElementSibling;
          while (sibling && sibling.tagName !== "DT") {
            nestedList = sibling.tagName === "DL" ? sibling : sibling.querySelector("dl");
            if (nestedList) break;
            sibling = sibling.nextElementSibling;
          }
        }
        entries.push({
          title: heading.textContent.trim() || "Imported folder",
          children: nestedList ? parseList(nestedList) : [],
        });
        continue;
      }

      const anchor = entry.querySelector(":scope > a") || entry.querySelector("a");
      const url = anchor?.getAttribute("href")?.trim();
      if (!anchor || !url) continue;
      try {
        if (["javascript:", "data:", "vbscript:"].includes(new URL(url).protocol)) continue;
      } catch {
        continue;
      }
      entries.push({ title: anchor.textContent.trim() || "Imported bookmark", url });
    }
    return entries;
  }

  return parseList(rootList);
}

async function importBookmarkNodes(nodes, parentId, counts) {
  for (const node of nodes) {
    if (node.url) {
      try {
        await chrome.bookmarks.create({ parentId, title: node.title, url: node.url });
        counts.imported += 1;
      } catch {
        counts.skipped += 1;
      }
      continue;
    }

    let folder;
    try {
      folder = await chrome.bookmarks.create({ parentId, title: node.title });
      counts.imported += 1;
    } catch {
      counts.skipped += 1;
      continue;
    }
    await importBookmarkNodes(node.children || [], folder.id, counts);
  }
}

async function importBookmarksFromFile(file) {
  try {
    const nodes = parseBookmarkHTML(await file.text());
    if (nodes.length === 0) {
      setStatus("No bookmarks found in the selected file");
      return;
    }

    const counts = { imported: 0, skipped: 0 };
    const parentId = activePane().currentId;
    isImportingBookmarks = true;
    try {
      await importBookmarkNodes(nodes, parentId, counts);
    } finally {
      isImportingBookmarks = false;
    }
    await refresh();
    setStatus(`Imported ${counts.imported} items${counts.skipped ? `; skipped ${counts.skipped}` : ""}`);
  } catch (error) {
    setStatus(`Could not import bookmarks: ${error.message}`);
  }
}

function escapeBookmarkHTML(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function serializeBookmarkNode(node, depth = 1) {
  const indent = "    ".repeat(depth);
  if (node.url) return `${indent}<DT><A HREF="${escapeBookmarkHTML(node.url)}">${escapeBookmarkHTML(node.title)}</A>\n`;
  const children = (node.children || []).map((child) => serializeBookmarkNode(child, depth + 1)).join("");
  return `${indent}<DT><H3>${escapeBookmarkHTML(node.title)}</H3>\n${indent}<DL><p>\n${children}${indent}</DL><p>\n`;
}

async function exportBookmarks() {
  try {
    const [root] = await chrome.bookmarks.getTree();
    const entries = (root.children || []).map((node) => serializeBookmarkNode(node)).join("");
    const markup = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${entries}</DL><p>\n`;
    const url = URL.createObjectURL(new Blob([markup], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bookmarks.html";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Exported bookmarks.html");
  } catch (error) {
    setStatus(`Could not export bookmarks: ${error.message}`);
  }
}

for (const paneId of Object.keys(paneElements)) {
  paneElements[paneId].addEventListener("click", (event) => {
    if (!event.target.closest("button")) setActivePane(paneId);
  });
  paneElements[paneId].addEventListener("focus", () => setActivePane(paneId));
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
  if (dialog.open || isEditing) return;

  if (event.key === "Tab" && !isEditing && !dialog.open) {
    event.preventDefault();
    setActivePane(destinationPaneId(), true);
    return;
  }

  const key = event.key.toLowerCase();
  if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "a") {
    event.preventDefault();
    selectAllBookmarks(activePaneId);
    return;
  }
  const actionByNumber = { "1": "copy", "2": "move", "3": "rename" };
  if (event.ctrlKey && !event.altKey && !event.shiftKey && actionByNumber[key]) {
    event.preventDefault();
    runAction(actionByNumber[key]);
    return;
  }

  const selectedNodes = getSelectedNodes(activePane());
  const selected = activePane().selectedId ? nodeById.get(activePane().selectedId) : null;
  if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && (key === "c" || key === "x")) {
    if (selectedNodes.length > 0) {
      event.preventDefault();
      copySelectionToClipboard(key === "x" ? "cut" : "copy");
    }
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && key === "v" && bookmarkClipboard) {
    event.preventDefault();
    pasteBookmarkClipboard();
    return;
  }
  if (key === "delete") {
    if (selectedNodes.length > 0) {
      event.preventDefault();
      runAction("delete");
    }
    return;
  }
  if (event.altKey && key === "enter") {
    event.preventDefault();
    if (selectedNodes.length === 1 && selected?.url) openEditor("edit", selected);
    return;
  }

  const targetElement = target instanceof Element ? target : null;
  const paneElement = targetElement?.closest(".pane");
  const focusedRow = targetElement?.closest(".bookmark-row");
  const paneId = paneElement?.dataset.pane || activePaneId;
  const isPaneControl = targetElement?.closest("button, a, input, select, textarea, [contenteditable='true'], [role='separator']");

  if (key === "backspace") {
    if (isPaneControl && !paneElement) return;
    event.preventDefault();
    navigateToParent(paneId);
    return;
  }

  if (key === " " && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (isPaneControl && !focusedRow) return;
    const nodeId = focusedRow?.dataset.nodeId || panes[paneId].selectedId;
    const node = nodeId ? nodeById.get(nodeId) : null;
    if (!node) return;
    event.preventDefault();
    if (panes[paneId].selectedIds.includes(node.id)) deselectBookmark(paneId, node);
    else {
      const pane = panes[paneId];
      setActivePane(paneId);
      pane.selectedIds.push(node.id);
      pane.selectedId = node.id;
      if (!pane.selectionAnchorId) pane.selectionAnchorId = node.id;
      previewNodeId = node.id;
      renderPreview();
      renderPane(paneId);
      syncControls();
      focusBookmarkRow(paneId, node.id);
    }
    return;
  }

  if ((key === "arrowup" || key === "arrowdown") && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (isPaneControl && !focusedRow) return;
    const items = getPaneItems(paneId);
    if (items.length === 0) return;
    const referenceId = focusedRow?.dataset.nodeId || panes[paneId].selectedId;
    const currentIndex = items.findIndex((item) => item.id === referenceId);
    const nextIndex = currentIndex === -1
      ? (key === "arrowdown" ? 0 : items.length - 1)
      : Math.max(0, Math.min(items.length - 1, currentIndex + (key === "arrowdown" ? 1 : -1)));
    event.preventDefault();
    setActivePane(paneId);
    if (event.shiftKey) selectBookmarkRange(paneId, items[nextIndex], referenceId);
    else selectBookmark(paneId, items[nextIndex]);
    return;
  }

  if ((key === "home" || key === "end") && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (isPaneControl && !focusedRow) return;
    const items = getPaneItems(paneId);
    if (items.length === 0) return;
    event.preventDefault();
    selectBookmark(paneId, items[key === "home" ? 0 : items.length - 1]);
    return;
  }

  if (key === "enter" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (targetElement?.closest("button, a, input, select, textarea, [contenteditable='true']") && !focusedRow) return;
    if (!paneElement && !targetElement) return;
    const paneId = paneElement?.dataset.pane || activePaneId;
    const nodeId = focusedRow?.dataset.nodeId || panes[paneId].selectedId;
    const node = nodeId ? nodeById.get(nodeId) : null;
    if (!node) return;

    event.preventDefault();
    const pane = panes[paneId];
    if (pane.selectedIds.length !== 1 || pane.selectedIds[0] !== node.id) selectBookmark(paneId, node);
    else setActivePane(paneId);
    syncControls();
    if (node.url) {
      previewNodeId = node.id;
      if (managerContent.classList.contains("is-collapsed")) setPreviewCollapsed(false);
      else renderPreview();
    } else {
      activateNode(paneId, node);
    }
  }
});

for (const eventName of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
  chrome.bookmarks[eventName].addListener(() => {
    if (!isSortingBookmarks && !isImportingBookmarks) refresh();
  });
}

refresh();