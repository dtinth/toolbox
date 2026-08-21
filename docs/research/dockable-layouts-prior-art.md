# Dockable layouts: prior art

_Research note. How mature open-source workbench/IDE systems model dockable
parts, serialise layouts, and restore layouts that reference parts which may not
currently exist._

**Why this exists.** Toolbox is adding docking/tiling plus saved layout
snapshots, and has decided the dockable unit is the **Window**. But a Window
exists _iff_ the **Tool**'s **Declarator** calls `api.ui.window(id, cb)` on the
current frame (see `CONTEXT.md`, "Window" and "Window lifecycle"). Window
existence is tool-owned and per-frame; the **Runtime** cannot force a Window to
exist, and cannot recreate one on reload because its existence depends on
tool-internal state (e.g. `let open = true` in `tools/multi-window/index.ts`).
A layout, by contrast, is user-owned and durable. This note surveys how five
systems resolve the equivalent tension.

**Method.** Everything below is read from source in the upstream repositories
(`main`/`master` as of 2026-08) or from generated model documentation embedded
in that source. Each substantive claim names a file. Where I could not verify
something I say so.

---

## 1. Lumino (JupyterLab) — live widget references, self-healing tree

Repo: `jupyterlab/lumino`, package `packages/widgets`.

### Dockable unit

A `Widget` instance. `DockPanel`/`DockLayout` deal in live JS objects — there is
no id, no descriptor, no factory. This is the closest thing to toolbox's Window
in _granularity_ but the furthest in _lifecycle_: the widget is a retained
object the application created imperatively and holds a reference to.

### Layout tree shape

`packages/widgets/src/docklayout.ts`, `namespace DockLayout`:

```ts
export interface ILayoutConfig {
  main: AreaConfig | null;
}

export interface ITabAreaConfig {
  type: "tab-area";
  widgets: Widget[]; // <- LIVE OBJECT REFERENCES
  currentIndex: number;
}

export interface ISplitAreaConfig {
  type: "split-area";
  orientation: "horizontal" | "vertical";
  children: AreaConfig[];
  sizes: number[]; // relative, normalized
}

export type AreaConfig = ITabAreaConfig | ISplitAreaConfig;
```

`saveLayout()` calls `this._root.holdAllSizes()` and then `createConfig()`
recursively; `SplitLayoutNode.createConfig()` returns
`{ type: 'split-area', orientation, sizes: this.createNormalizedSizes(), children }`.
So sizes are stored as **normalised relative weights**, not pixels.

`ILayoutConfig` is **not JSON-serialisable** — `widgets` holds live `Widget`
objects. Persisting it is the embedder's problem, which is exactly the seam
Theia fills (§4).

### Restore when a part does not exist

There is no such case, by construction: you cannot name a widget you do not
hold. But `restoreLayout` does something structurally important —
`Private.normalizeAreaConfig` **prunes and collapses** the tree:

- `normalizeTabAreaConfig` returns `null` when `config.widgets.length === 0`,
  and also `null` if every widget in it was already claimed by an earlier
  tab-area (dedup via a `widgetSet`).
- `normalizeSplitAreaConfig` skips `null` children ("Ignore an empty child"),
  returns `null` if no children survive, and **returns the single child
  directly** when only one survives — collapsing the redundant split.
- Same-orientation nested splits are hoisted into the parent.

That is the general repair algorithm for "a leaf vanished from a dock tree",
independent of _why_ it vanished. Toolbox will need exactly this function.

`restoreLayout` also unparents any widget currently in the layout that is not in
the incoming config, and reparents every widget in the config — i.e. the config
is authoritative over membership, both ways.

### Floating / detached

`DockPanel`/`DockLayout` have no floating concept. Out of scope upstream.

---

## 2. Theia — the serialisation layer Lumino lacks

Repo: `eclipse-theia/theia`, package `packages/core`.

Theia uses Lumino's `DockPanel` and therefore inherits `ILayoutConfig` with its
live widget references. Its whole contribution here is the deflate/inflate layer
that converts live references into **recreation descriptors**.

### Dockable unit

A `Widget`, but one that must have been created by `WidgetManager`. This is the
key distinction and the one most relevant to toolbox.

### Descriptors, not references

`packages/core/src/browser/widget-manager.ts`:

```ts
export interface WidgetConstructionOptions {
  factoryId: string;
  options?: any;
}
```

The doc comment on `WidgetFactory` states the intent plainly: "To identify
widgets the `WidgetManager` uses a description composed of the factory id and
the options."

`WidgetManager` keys its widget cache by `toKey({factoryId, options})` =
`stableJsonStringify(options)`, and `getDescription(widget)` reverse-looks-up a
live widget to its construction options — **returning `undefined` if the widget
was not created through the manager**.

### Layout tree shape

`packages/core/src/browser/shell/application-shell.ts`,
`namespace ApplicationShell`:

```ts
export interface LayoutData {
  version?: string | ApplicationShellLayoutVersion;
  mainPanel?: DockPanel.ILayoutConfig;
  mainPanelPinned?: boolean[];
  bottomPanel?: BottomPanelLayoutData;
  leftPanel?: SidePanel.LayoutData;
  rightPanel?: SidePanel.LayoutData;
  activeWidgetId?: string;
}
```

`packages/core/src/browser/shell/side-panel-handler.ts`:

```ts
export interface LayoutData {
  type: "sidepanel";
  items?: WidgetItem[];
  size?: number;
}
export interface WidgetItem extends WidgetOptions {
  /** Can be undefined in case the widget could not be restored. */
  widget?: Widget;
  expanded?: boolean;
  pinned?: boolean;
}
```

Note the comment — the shape is **designed for holes**.

### Serialisation

`packages/core/src/browser/shell/shell-layout-restorer.ts`. Methods are
`storeLayout(app)` / `restoreLayout(app)` (not `saveLayout`), with
`deflate(data): string` / `inflate(layoutData): Promise<LayoutData>` doing the
work.

`deflate` is a `JSON.stringify` replacer that swaps any widget-valued property
for a `WidgetDescription`:

```ts
export interface WidgetDescription {
  constructionOptions: WidgetConstructionOptions;
  innerWidgetState?: string | object;
}
```

Widgets are filtered during deflate: in the `widgets`-array branch, a
description that comes back `undefined` is simply **not pushed**. And
`convertToDescription` returns `undefined` in two cases: (a) the widget has no
`WidgetManager` description at all, and (b) it is a `StatefulWidget` whose
`storeState()` returned `undefined`.

```ts
export interface StatefulWidget {
  /** Called on unload to store the inner state. Returns 'undefined' if the widget cannot be stored. */
  storeState(): object | undefined;
  restoreState(oldState: object): void;
}
```

**A widget can opt out of persistence by returning `undefined` from
`storeState()`.** That is the closest existing analogue to a toolbox Window
saying "don't remember me".

### Restore when a part does not exist — the important part

`convertToWidget(desc, context)`:

```ts
try {
    desc = await this.fireWillInflateWidget(desc, context);
    const widget = await this.widgetManager.getOrCreateWidget(
        desc.constructionOptions.factoryId, desc.constructionOptions.options);
    ...
    if (widget.isDisposed) { return undefined; }
    return widget;
} catch (e) {
    if (ApplicationShellLayoutMigrationError.is(e)) { throw e; }
    this.logger.warn(`Couldn't restore widget for ${desc.constructionOptions.factoryId}. Error: ${e} `);
    return undefined;
}
```

`getOrCreateWidget` throws `No widget factory '<id>' has been registered.` when
the factory is absent — so a missing contributor is a caught, logged,
`undefined`-returning case, **not** a failed restore.

The holes are then swept up by `ShellLayoutRestorer.ParseContext`: arrays
created by `filteredArray()` are compacted after all inflation promises settle —

```ts
if (this.toFilter.length) {
  this.toFilter.forEach((array) => {
    for (let i = 0; i < array.length; i++) {
      if (array[i] === undefined) {
        array.splice(i--, 1);
      }
    }
  });
}
```

— and the resulting Lumino `ILayoutConfig` with emptied tab areas is then
handed to `DockPanel.restoreLayout`, whose `normalizeAreaConfig` (§1) collapses
the now-empty nodes. **The two layers compose exactly: Theia produces holes,
Lumino heals them.**

State restoration failure is degraded separately and more softly: if
`restoreState(oldState)` throws, it logs `Couldn't restore widget state for
${widget.id}` and keeps the widget. So "the part exists but its state is
garbage" and "the part does not exist" are distinct outcomes.

### Versioning

`inflate` reads `layout.version`, warns if behind/ahead, and runs registered
`ApplicationShellLayoutMigration` contributions with `onWillInflateLayout` and
`onWillInflateWidget` hooks. Migration exceptions are deliberately _not_ caught
("if one migration fails all should fail") and fall back to the default layout;
`RESET_LAYOUT` is offered as an escape hatch.

### Named snapshots

`PERSPECTIVE_LAYOUTS_STORAGE_KEY = 'perspective-layouts'` with
`PersistedPerspectiveData { activePerspectiveId: string; layouts: Record<string, string> }`
— named perspectives, each a deflated layout string. Note: `Record<id, string>`,
i.e. each snapshot is an opaque serialised blob keyed by name.

### Floating / secondary windows

`ApplicationShell.Area` includes `'secondaryWindow'`, handled by
`SecondaryWindowHandler` (`packages/core/src/browser/secondary-window-handler.ts`).
But `ApplicationShell.LayoutData` has **no** secondary-window field, and
`getLayoutData()` does not read the handler. Conclusion: Theia treats a widget
in a secondary window as removed from the persisted dock tree — secondary
windows are session-only. (Verified by absence in `getLayoutData()`; I did not
find any separate secondary-window persistence, but "absence of evidence" —
treat as high-confidence, not certain.)

---

## 3. VS Code — two separate systems, and the best analogue to our problem

Repo: `microsoft/vscode`.

VS Code has **two** independent docking systems that answer our question
differently, plus a third (webviews) that is the closest match to toolbox.

### 3a. Editor groups: `SerializableGrid`

`src/vs/base/browser/ui/grid/grid.ts`:

```ts
export interface ISerializedLeafNode {
  type: "leaf";
  data: unknown; // <- opaque, produced by view.toJSON()
  size: number;
  visible?: boolean;
  maximized?: boolean;
}
export interface ISerializedBranchNode {
  type: "branch";
  data: ISerializedNode[];
  size: number;
  visible?: boolean;
}
export type ISerializedNode = ISerializedLeafNode | ISerializedBranchNode;
export interface ISerializedGrid {
  root: ISerializedNode;
  orientation: Orientation;
  width: number;
  height: number;
}
```

Sizes are **absolute pixels at save time**, plus the grid's own `width`/`height`
so proportions can be recovered on a different viewport. The leaf payload is
opaque `unknown`: the grid delegates entirely to
`ISerializableView.toJSON()` / `IViewDeserializer.fromJSON(json)`.

Note the "hidden but remembered" encoding on the leaf: when a view is hidden,
`serializeNode` writes `size = node.cachedVisibleSize` and `visible: false` —
the node keeps its slot and its remembered size while invisible. A branch whose
children are all invisible is itself marked `visible: false`.

`EditorPart` (`src/vs/workbench/browser/parts/editor/editorPart.ts`) stores:

```ts
export interface IEditorPartUIState {
  readonly serializedGrid: ISerializedGrid;
  readonly activeGroup: GroupIdentifier;
  readonly mostRecentActiveGroups: GroupIdentifier[];
}
```

under `'editorpart.state'` in the workspace memento. The grid's leaves are
editor _groups_, and each group serialises to
`ISerializedEditorGroupModel { id, locked?, editors: ISerializedEditorInput[], mru, preview?, sticky? }`
(`src/vs/workbench/common/editor/editorGroupModel.ts`).

**Restore when a part does not exist.** `EditorGroupModel.serialize()` looks up
an `IEditorSerializer` per editor via
`registry.getEditorSerializer(editor)`. If there is none, or
`canSerialize()` is false, the editor is **omitted from the serialised array
entirely**, and `mru`/`preview`/`sticky` indices are recomputed against the
surviving set. On the way back, `deserialize()` maps each entry through
`registry.getEditorSerializer(e.id)` and wraps the whole thing in `coalesce(...)`
— missing serialiser means the editor silently disappears and sticky indices are
decremented. A whole failed grid restore is caught in
`doCreateGridControlWithPreviousState`, which logs
`Error restoring editor grid widget: ...`, calls `disposeGroups()`, and returns
`false` so startup falls back to a fresh grid.

**Named snapshots.** `EditorParts`
(`src/vs/workbench/browser/parts/editor/editorParts.ts`) implements _Editor
Working Sets_: `saveWorkingSet(name)`, `getWorkingSets()`, `applyWorkingSet()`,
`deleteWorkingSet()`, persisted under `'editor.workingSets'` in workspace
storage as `IEditorWorkingSetState extends IEditorWorkingSet { main: IEditorPartUIState; auxiliary: IEditorPartsUIState }`.
Crucially a snapshot is **the same structure as the live-session state**, run
through **the same deserialiser** — so a snapshot degrades on missing parts
exactly the way a session restore does. There is no separate snapshot format.

### 3b. Views and view containers: id-keyed state that outlives the view

`src/vs/workbench/common/views.ts` — `IViewDescriptor` has `id`, `name`,
`ctorDescriptor: SyncDescriptor<IView>`, and notably
`readonly when?: ContextKeyExpression`.

Extension-contributed views come from the **static** `contributes.views`
manifest section, registered by `ViewsExtensionHandler` in
`src/vs/workbench/api/browser/viewsExtensionPoint.ts` — at startup, without
activating the extension. The extension point's `activationEventsGenerator`
yields `onView:${viewDescriptor.id}`. The view's _content_ is deferred until the
pane is actually shown: `AbstractTreeView` (`src/vs/workbench/browser/parts/views/treeView.ts`)
calls `this.createTree()` then
`this.extensionService.activateByEvent('onView:' + this.id)` and, until a data
provider shows up, renders `"There is no data provider registered that can
provide view data."` **This is the canonical shape of "the slot is real, the
content is lazy."**

**View layout state is stored by id, decoupled from the descriptor's
existence.** `src/vs/workbench/services/views/common/viewContainerModel.ts`:

```ts
interface IStoredWorkspaceViewState {
  collapsed: boolean;
  isHidden: boolean;
  size?: number;
  order?: number;
}
interface IStoredGlobalViewState {
  id: string;
  isHidden: boolean;
  order?: number;
}
```

`ViewDescriptorsState.initialize()` builds its `Map<string, IViewDescriptorState>`
**entirely from storage**, before any descriptor registers. Registration later
attaches a descriptor to the pre-existing state entry. And
`ViewContainerModel.remove(viewDescriptors)` splices items out of
`viewDescriptorItems` but **never deletes from the state map** — so uninstalling
an extension removes its views from the UI while their remembered size,
collapsed-ness, order and visibility survive, keyed by view id, and are
reapplied verbatim if the extension is reinstalled.

Cross-container moves are stored separately in
`src/vs/workbench/services/views/browser/viewDescriptorService.ts` under
`'views.customizations'` (`IViewsCustomizations` with `viewContainerLocations`,
`viewLocations`, `viewContainerBadgeEnablementStates`), profile-scoped. Again:
keyed by string id, not by object.

**`when` clauses are the one genuinely declarative existence mechanism in this
survey.** `ViewContainerModel.onDidChangeContext()` re-evaluates
`contextKeyService.contextMatchesRules(item.viewDescriptor.when)` for every item
whenever a relevant context key changes, and flips `item.state.active`. The
_descriptor_ and its _state_ stay put; only the `active` bit moves. Visibility is
`isViewDescriptorVisible = state.active && isViewDescriptorVisibleWhenActive`.
That factoring — **a durable per-id state record, plus a re-derived
"present right now" bit** — is the single most directly transferable idea for
toolbox. E4 has the same idea as `MUIElement.getVisibleWhen()`.

### 3c. Webview panels: deferred owner, preserved slot

The closest analogue to toolbox's problem: an editor tab whose entire existence
depends on an extension that may not be loaded yet.

`src/vs/workbench/contrib/webviewPanel/browser/webviewEditorInputSerializer.ts`
serialises to `SerializedWebview { ..., viewType, options, state, extensionId, extensionLocation, iconPath }`
and deserialises via `this._webviewWorkbenchService.openRevivedWebview({...})`.

`src/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.ts`:

```ts
export class LazilyResolvedWebviewEditorInput extends WebviewInput {
    private _resolved = false;
    @memoize public override async resolve() {
        if (!this._resolved) {
            this._resolved = true;
            this._resolvePromise = createCancelablePromise(token => this._webviewWorkbenchService.resolveWebview(this, token));
            ...
        }
        return super.resolve();
    }
}
```

```ts
public async resolveWebview(webview: WebviewInput, token: CancellationToken): Promise<void> {
    const didRevive = await this.tryRevive(webview, token);
    if (!didRevive && !token.isCancellationRequested) {
        // A reviver may not be registered yet. Put into pool and resolve promise when we can revive
        return this._revivalPool.enqueueForRestoration(webview, token);
    }
}
```

and — the decisive line for our problem —

```ts
public shouldPersist(webview: WebviewInput): boolean {
    // Revived webviews may not have an actively registered reviver but we still want to persist them
    // since a reviver should exist when it is actually needed.
    if (webview instanceof LazilyResolvedWebviewEditorInput) { return true; }
    return Iterable.some(this._revivers.values(), reviver => canRevive(reviver, webview));
}
```

**VS Code deliberately keeps persisting a part whose owner is currently absent**,
on the theory that the owner will come back. A `RevivalPool` holds such inputs
until a matching resolver registers, at which point `reviveFor` drains the
matching entries. If it never registers, the tab stays there with an unresolved
webview.

Related: `src/vs/workbench/browser/parts/editor/editorPlaceholder.ts` provides
`EditorPlaceholder` with concrete `WorkspaceTrustRequiredPlaceholderEditor` and
`ErrorPlaceholderEditor` — VS Code will render a visible, explained placeholder
in an editor slot rather than remove the slot.

### Floating windows and the Auxiliary Bar

Two different things:

- **Auxiliary Bar** is not floating at all. It is simply a third
  `ViewContainerLocation`: `enum ViewContainerLocation { Sidebar, Panel, AuxiliaryBar }`
  in `src/vs/workbench/common/views.ts`. It is a location token in the view
  system, and view→location assignment is persisted in `views.customizations`.

- **Floating editor windows** are separate, fully-fledged parts.
  `AuxiliaryEditorPartImpl extends EditorPart`
  (`src/vs/workbench/browser/parts/editor/auxiliaryEditorPart.ts`) — each
  floating window has _its own_ `SerializableGrid` and _its own_
  `IEditorPartUIState`. `EditorParts` persists them as:

  ```ts
  interface IEditorPartsUIState {
    readonly auxiliary: IAuxiliaryEditorPartState[]; // IAuxiliaryWindowOpenOptions + { state: IEditorPartUIState }
    readonly mru: number[];
    // main state is managed by the main part
  }
  ```

  `restoreParts()` awaits `mainPart.whenReady`, then calls
  `createAuxiliaryEditorPart(...)` per entry and `Promise.allSettled`s them —
  a floating window that fails to reopen does not block the others.

  **A floating window is a sibling root, not a node in the main tree.** Bounds
  come from `auxiliaryWindow.createState()`; content comes from a nested
  `IEditorPartUIState`. That is the structural decision toolbox needs for the
  **Projector**.

---

## 4. Eclipse Platform UI / E4 — the model _is_ the layout, and it is durable

Repo: `eclipse-platform/eclipse.platform.ui`.

### Dockable unit

`MPart` — "This a concrete class representing the core UI functionality within a
Window. It's what used to be a View / Editor in Eclipse 3."
(`bundles/org.eclipse.e4.ui.model.workbench/src/org/eclipse/e4/ui/model/application/ui/basic/MPart.java`).
`MPart extends MPartSashContainerElement, MStackElement, MContribution, MContext, MUILabel`.

The `MContribution` mix-in is what makes an `MPart` a **descriptor and a
container at once**: it carries a `contributionURI` (a `bundleclass://` URI) and
an `object` field holding the instantiated POJO — which may be `null`. So unlike
every other system here, Eclipse does not need a separate descriptor type; the
model element _is_ the durable record, and the live object hangs off it.

### Layout tree shape

Nested containment in the E4 application model:

- `MPartSashContainer` — "This is the concrete class representing sashed
  containment in the UI Model. This type is recursive, allowing the creation of
  a tree of sashes whose leafs are Parts."
- `MPartStack` — a tabbed stack of `MStackElement`s.
- `MPart`, `MPlaceholder` — leaves (both implement `MPartSashContainerElement`
  and `MStackElement`).
- `MPerspective` / `MPerspectiveStack` — named layout snapshots, first-class
  model elements.

Sizes are stored in `MUIElement.getContainerData()`:
"This is a persistent field that may be used by the parent element's renderer to
maintain any data that it needs to control the container. For example this is
where the SashRenderer stores the 'weight' of a particular element."
(`.../application/ui/MUIElement.java`). Note the deprecation note in the same
doc: containerData is "effectively deprecated in favor of the parent renderer
simply adding a new keyed value to the UIElement's `persistentData` map."

The whole model is serialised as EMF XMI. `ResourceHandler`
(`bundles/org.eclipse.e4.ui.workbench/src/org/eclipse/e4/ui/internal/workbench/ResourceHandler.java`)
writes `workbench.xmi` — literally
`resourceSet.createResource(URI.createURI("workbench.xmi"))` and
`new File(getBaseLocation(), "workbench.xmi")`. `IWorkbench.CLEAR_PERSISTED_STATE`
is the reset switch.

### Lazy instantiation

`MUIElement.isToBeRendered()`, doc verbatim:

> This field controls whether the given UIElement should be displayed within the
> application. Note that due to lazy loading it is possible to have this field
> set to true but to not have actually rendered the element itself (it does show
> up as a tab on the appropriate stack but will only be rendered when that tab is
> selected.

So a part can be **in the layout, tab visible, not instantiated**. `getWidget()`
"will only be non-null when the element has been rendered."

`MUIElement.isVisible()` is a _different_ flag: "whether or not the given
UIElement appears in the presentation or whether it should be 'cached' for
specialized use… The MinMaxAddon uses this flag for example when a stack becomes
minimized. By setting the flag to false the stack's widget is cleanly removed
from the UI but is still 'rendered'."

Three independent axes, then: **in-model / to-be-rendered / visible**. Toolbox
currently collapses all three into one bit ("did the declarator call
`ui.window`?").

`MUIElement.getVisibleWhen()` holds an `MExpression` — E4's equivalent of VS
Code's `when`, i.e. declaratively-derived presence evaluated against context.

### What `MPlaceholder` actually is — correct a common misreading

`MPlaceholder` is **not** "a stand-in for a part that failed to load". From
`.../ui/advanced/MPlaceholder.java`:

> A Placeholder is a concrete class used to share elements between perspectives.
> The elements referenced by a Placeholder generally exist in the Window's
> 'sharedElements' list. By convention a placeholder usually shares the same
> elementId as the element that it's referencing.

and `getRef()`: "The reference to the actual UI element that this Placeholder is
acting as a proxy for." `MWindow.getSharedElements()`: "This is the collection of
UI Elements that are referenced by Placeholders, allowing the re-use of these
elements in different Perspectives."

So `MPlaceholder` solves **one part appearing in N perspectives** — a single
`MPart` lives once in `window.sharedElements`, and each perspective's sash tree
holds an `MPlaceholder` pointing at it, with a per-perspective `closeable`
override ("This allows a Part to be closeable in one perspective but not
closeable in a different one"). `MUIElement.getCurSharedRef()` is the transient
back-pointer to the placeholder currently hosting the element.

**This is a directly relevant pattern for toolbox**: it is exactly the mechanism
for "the same Window appears in more than one saved layout, and layout-specific
attributes (closeable, size) belong to the reference, not to the Window."

### Restore when a part cannot be created

The compatibility layer is explicit. `ViewReference`
(`bundles/org.eclipse.ui.workbench/eclipseui/org/eclipse/ui/internal/ViewReference.java`):

```java
@Override
public IWorkbenchPart createPart() throws PartInitException {
    try {
        if (descriptor == null) {
            return createErrorPart();
        }
        return descriptor.createView();
    } catch (CoreException e) { ... throw new PartInitException(...); }
}

@Override
IWorkbenchPart createErrorPart() {
    IStatus status = new Status(IStatus.ERROR, WorkbenchPlugin.PI_WORKBENCH,
            NLS.bind(WorkbenchMessages.ViewFactory_initException, getModel().getElementId()), new Exception());
    return createErrorPart(status);
}

@Override
public IWorkbenchPart createErrorPart(IStatus status) { return new ErrorViewPart(status); }
```

`ErrorViewPart` (`.../ui/internal/ErrorViewPart.java`) is documented as "This
part is shown instead the views with errors." — it renders a `StatusPart` in the
slot.

**Eclipse keeps the slot and fills it with an error part.** It does not drop the
node. This is the opposite policy from VS Code editors, Theia, and Lumino, all
of which prune. Eclipse can afford it because `MPart` is itself the durable
record — deleting it would lose the user's layout intent.

State survives the object's absence via a memento on the model:
`ViewReference.persist()` writes `view.saveState(root)` into
`getModel().getPersistedState().put(MEMENTO_KEY, ...)`, and the constructor
reads it back, handing it to `view.init(viewSite, memento)`. So `IViewPart`
receives its previous state at construction, from data stored on the `MPart`.

### Detached windows

`MWindow.getWindows()`: "The collection of 'Detached' windows associated with
this window." A detached window is a **child `MWindow` in the same persisted
model tree**, with its own `x`/`y`/`width`/`height` (each with `isSetX()`
/`unsetX()` — genuinely optional). Same file as everything else in
`workbench.xmi`. Contrast with VS Code, where floating editor windows are
siblings with their own grid; Eclipse nests them under the main window.

---

## 5. NetBeans — flat modes, path-addressed, ids everywhere

Repo: `apache/netbeans`, modules `platform/openide.windows` and
`platform/core.windows`.

### Dockable unit

`TopComponent` (`platform/openide.windows/src/org/openide/windows/TopComponent.java`)
— `public class TopComponent extends JComponent implements Externalizable, ...`.
Docked into a `Mode` (a tabbed container); `WindowManager` owns the whole thing.

### Layout tree shape — the interesting divergence

NetBeans does **not** persist a nested tree. `WindowManagerConfig`
(`platform/core.windows/src/org/netbeans/core/windows/persistence/WindowManagerConfig.java`)
holds a **flat** `ModeConfig[] modes` (plus `GroupConfig[] groups`,
`String[] tcIdViewList`, `activeModeName`, editor-area geometry, screen size,
etc). Each mode carries its own **path** into an implicit split tree:

```java
public class ModeConfig {
    public String name;
    public int state;                       // MODE_STATE_JOINED | MODE_STATE_SEPARATED
    public int kind;                        // MODE_KIND_EDITOR | VIEW | SLIDING
    public String side;
    public SplitConstraint[] constraints;   // <- path from root
    public Rectangle bounds;
    public Rectangle relativeBounds;
    public int frameState;
    public String selectedTopComponentID;
    public boolean permanent = true;
    public boolean minimized = false;
    public TCRefConfig[] tcRefConfigs;      // <- ids, not objects
    public Map<String,Integer> slideInSizes;
    public String previousSelectedTopComponentID;
}
```

```java
public class SplitConstraint {
    public final int orientation;   // Constants.HORIZONTAL | VERTICAL
    public final int index;         // "Cell index. From TOP to BOTTOM or from LEFT to RIGHT respectivelly."
    public final double splitWeight; // "in range from 0.0 to 1.0"
}
```

A `SplitConstraint[]` is a root-relative path — `[[H,0,0.25],[V,1,0.7]]` — so
the tree is _reconstructed_ from the union of all modes' paths rather than
stored as nesting. **This shape is inherently tolerant of missing nodes: drop a
mode and the remaining paths still describe a valid tree.** It is worth
considering for toolbox precisely because our leaves are the unreliable part.

### Membership is a list of ids with an `opened` flag

```java
public class TCRefConfig {
    public String tc_id;
    /** Is TopComponent opened. */
    public boolean opened;
    public String previousMode;
    public int previousIndex;
    public boolean dockedInMaximizedMode;
    public boolean dockedInDefaultMode;
    public boolean slidedInMaximized;
}
```

`opened` is the explicit "hidden but remembered" bit. `PersistenceHandler`
(`platform/core.windows/src/org/netbeans/core/windows/PersistenceHandler.java`,
`initModeFromConfig`) branches on it:

```java
if (tcRefConfig.opened) {
    lazyLoader.lazyLoad(mode, mc.selectedTopComponentID, tcRefConfig, j);
} else {
    mode.addUnloadedTopComponent(tcRefConfig.tc_id);
}
```

Opened components are **lazily** materialised; closed ones are registered as
_unloaded ids_. `ModeImpl` (`platform/core.windows/src/org/netbeans/core/windows/ModeImpl.java`)
exposes three parallel id lists — `getOpenedTopComponentsIDs()`,
`getClosedTopComponentsIDs()`, `getTopComponentsIDs()` — plus
`addUnloadedTopComponent(String tcID, int index)` and
`setUnloadedSelectedTopComponent(String tcID)`. **The mode remembers membership
and tab order for components whose classes have never been loaded.** Reopening a
view later puts it back in its remembered mode at its remembered index.

### Persistence policy constants

`TopComponent.java`:

```java
/** Persistence type of TopComponent instance. TopComponent is persistent. */
public static final int PERSISTENCE_ALWAYS = 0;
/** Persistence type of TopComponent instance. TopComponent is persistent only when it is opened in Mode. */
public static final int PERSISTENCE_ONLY_OPENED = 1;
/** Persistence type of TopComponent instance. TopComponent is not persistent. */
public static final int PERSISTENCE_NEVER = 2;
```

`getPersistenceType()` reads `@TopComponent.Description(persistenceType = ...)`,
falls back to a legacy `"PersistenceType"` client property, and defaults to
`PERSISTENCE_ALWAYS`; it warns if a subclass overrides neither. The annotation
default is also `PERSISTENCE_ALWAYS`.

**Semantics that matter for toolbox:**

- `PERSISTENCE_ALWAYS` — persisted whether open or closed. This is what makes
  the `opened=false` `TCRefConfig` meaningful: the layout remembers where a
  closed thing _belongs_.
- `PERSISTENCE_ONLY_OPENED` — persisted only if currently open; a closed one
  leaves no trace. This is the policy toolbox's per-frame Windows most naturally
  map onto.
- `PERSISTENCE_NEVER` — never persisted at all; also
  `isTopComponentPersistentWhenClosed` and the internal
  `topComponentNonPersistentID` set track these.

A **three-valued, per-part, part-author-chosen persistence policy** is the
cleanest single idea in this survey and has no analogue in the newer systems
(Theia's `storeState() -> undefined` is a two-valued approximation).

### Restore when a part does not exist

`PersistenceManager.getTopComponentPersistentForID(stringId, deserialize)`
(`platform/core.windows/src/org/netbeans/core/windows/persistence/PersistenceManager.java`)
looks in an id→TC cache, then on disk for a `.settings` `DataObject` with an
`InstanceCookie`:

```java
} else {
    // no instance cookie, which means that module which owned top
    // component is gone or versions of data and module are incompatible
    String excAnnotation = NbBundle.getMessage(PersistenceManager.class, "EXC_BrokenTCSetting", stringId);
    LOG.log(warningLevelForDeserTC(stringId), "[PersistenceManager.getTopComponentForID]" + ...);
}
...
} catch (NoClassDefFoundError | ClassNotFoundException | ClassCastException | IOException ex) { ... }
return null;
```

`null` is returned, logged at INFO the first time per id and FINE thereafter
(`warningLevelForDeserTC`), and the mode simply comes up without it. No error
part, no dialog. Note the comment defending this as normal:
"can happen quite often when switching projects… IMHO not really a problem."

### Mid-session module changes

`ModuleChangeHandler`
(`platform/core.windows/src/org/netbeans/core/windows/persistence/ModuleChangeHandler.java`)
is a `FileChangeListener` on the module config folders, documented as: "Handler
of changes in module folder. Changes can be for example generated by
enabling/disabling module which defines some winsys element(s)." So NetBeans
treats install/uninstall as a live filesystem event that adds/removes modes,
groups and tc-refs at runtime. I did not read its handlers in detail — treat the
precise removal semantics as **unverified**.

### Floating windows

Not a separate structure: `ModeConfig.state` is `Constants.MODE_STATE_JOINED`
(0) or `Constants.MODE_STATE_SEPARATED` (1)
(`platform/core.windows/src/org/netbeans/core/windows/Constants.java`), with
`bounds` / `relativeBounds` / `frameState` on the same `ModeConfig`.
`WindowManagerConfig` carries parallel `...Joined` and `...Separated` geometry
for the main window.

**Floating is a property of the dock node, not a different kind of node.** A
mode can flip between docked and floating without changing its identity, its
membership list, or its `constraints` path — so re-docking restores it to the
right place. Contrast VS Code (floating = separate part with its own grid) and
Eclipse (detached = child `MWindow`). NetBeans' encoding is the most
economical, and the most obviously right for toolbox's **Projector**, which is
already defined as "a Window that physically lives in another browser document
while staying logically in the main instance's render tree".

---

## Cross-cutting answers

### Q1 — What is the dockable unit?

| System          | Unit                                          | Identity                                              | Closer to our…                                               |
| --------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Lumino          | `Widget` instance                             | object identity                                       | Window (but retained, not re-declared)                       |
| Theia           | `Widget` created by `WidgetManager`           | `factoryId` + `options`                               | Window (a Tool with two Windows = two factory/options pairs) |
| VS Code editors | editor _group_ (grid leaf); editors within it | `GroupIdentifier`; editor `typeId` + serialised value | group ≈ a tab container; the editor ≈ a Window               |
| VS Code views   | `IViewDescriptor`                             | string `id`                                           | Window                                                       |
| Eclipse         | `MPart`                                       | `elementId` (+ `MPlaceholder` refs)                   | Window                                                       |
| NetBeans        | `TopComponent` in a `Mode`                    | `tc_id` string                                        | Window                                                       |

**Nobody docks the equivalent of a Tool instance.** Every system docks the
finer-grained unit. Toolbox's choice of Window as the dockable unit is
uncontroversial. What is unusual is not the choice of unit but its lifecycle.

### Q2 — How is the layout tree serialised?

Three distinct shapes:

1. **Nested binary/n-ary tree with a discriminated node type** — Lumino
   (`tab-area` / `split-area`, normalised `sizes[]`), VS Code
   (`leaf` / `branch`, pixel `size` + root `width`/`height`), Theia (Lumino's,
   plus side-panel item lists).
2. **Nested typed model tree** — Eclipse E4 (`MPartSashContainer` /
   `MPartStack` / `MPart` / `MPlaceholder`), sizes in `containerData`
   /`persistentData`, serialised as XMI.
3. **Flat list of nodes, each carrying a path** — NetBeans
   (`ModeConfig.constraints: SplitConstraint[]`, each
   `{orientation, index, splitWeight}`).

Sizes: relative weights (Lumino `sizes[]`, NetBeans `splitWeight` 0..1, Eclipse
sash weight in `containerData`) vs. absolute pixels captured alongside the
viewport dimensions (VS Code `size` + `ISerializedGrid.width/height`). Relative
is the majority and is clearly better for a browser desktop that changes size.

### Q3 — Restore when the referenced part does not exist ⭐

This is the heart of it, and there are exactly **four** strategies in use:

**(a) Descriptor + factory lookup, prune on failure.**
Theia: `getOrCreateWidget(factoryId, options)` throws → catch → log
`Couldn't restore widget for <factoryId>` → return `undefined` → array
compaction → Lumino `normalizeAreaConfig` collapses the emptied nodes.
VS Code editors: `registry.getEditorSerializer(e.id)` returns nothing → `coalesce`
drops the editor and decrements `sticky`.
_Cost:_ the user's layout silently degrades. _Benefit:_ no zombie UI, no
special-case rendering.

**(b) Keep the slot, render a placeholder.**
Eclipse: `descriptor == null → createErrorPart() → new ErrorViewPart(status)`,
shown "instead the views with errors". VS Code has the same tool in
`editorPlaceholder.ts` (`WorkspaceTrustRequiredPlaceholderEditor`,
`ErrorPlaceholderEditor`) though it uses it for reasons other than a missing
contributor.
_Cost:_ visible clutter. _Benefit:_ the user's arrangement is preserved, and the
failure is explained rather than silent.

**(c) Defer: keep the slot, wait for the owner to show up.**
VS Code webview panels. `LazilyResolvedWebviewEditorInput` restores immediately
from serialised data; `resolveWebview` tries every registered reviver and, if
none matches, `enqueueForRestoration` parks it in a `RevivalPool` until a
matching reviver registers, then `reviveFor` drains it. And `shouldPersist`
returns `true` for such inputs anyway: _"Revived webviews may not have an
actively registered reviver but we still want to persist them since a reviver
should exist when it is actually needed."_
_This is the closest match to toolbox's problem_, because a webview panel's
existence, like a Window's, is owned by code that may not be running.

**(d) Persist membership as ids, materialise lazily, tolerate `null`.**
NetBeans. `TCRefConfig.tc_id` + `opened`; `opened → lazyLoad`,
`!opened → mode.addUnloadedTopComponent(tc_id)`. A mode holds
opened/closed/**unloaded** id lists, so it knows where a never-loaded component
belongs. If the class is gone, `getTopComponentPersistentForID` returns `null`
after an INFO log and the mode comes up short one tab.
Eclipse achieves the same effect differently: `MUIElement.isToBeRendered()` can
be `true` with `getWidget() == null` — "it does show up as a tab on the
appropriate stack but will only be rendered when that tab is selected."

**Universal underlying rule:** _no system stores a live reference in a durable
layout._ Lumino does, and is exactly the system that has no persistence.
Everything durable stores **an id, or an id plus construction options** — and
therefore has to answer "what if that id resolves to nothing?" explicitly.

**Second universal rule:** _layout-slot state is keyed by id and outlives the
part._ VS Code's `ViewDescriptorsState` builds its map from storage before any
descriptor registers, and `ViewContainerModel.remove()` never deletes from it.
NetBeans' unloaded-id lists do the same. Eclipse's `MPart.persistedState` does
the same. This is the mechanism that makes "close it, reopen it, it comes back
where it was" work.

### Q4 — Part disappears mid-session while docked

- **VS Code views:** `IViewsRegistry.deregisterViews` fires `onViewsDeregistered`
  → `ViewDescriptorService.onDidDeregisterViews` → `ViewContainerModel.remove`.
  Descriptor items are spliced out; **the per-id state map is untouched**, and
  `views.customizations` (cross-container placement) is untouched. Reinstalling
  restores position, size, collapsed-ness and visibility.
- **VS Code webviews:** the tab stays. The webview simply never resolves (or
  resolves later, via `RevivalPool`).
- **Eclipse:** the `MPart` stays in the model; if the object cannot be created,
  `ErrorViewPart` fills the slot.
- **Theia:** widget disposal removes it from `WidgetManager.widgets`
  (`widget.disposed.connect(() => this.widgets.delete(key))`), and it drops out
  of the next `storeLayout`. A widget disposed during restore is also discarded
  (`if (widget.isDisposed) return undefined`).
- **NetBeans:** `ModuleChangeHandler` watches the module folders for
  enable/disable and reacts at runtime. Precise removal semantics **unverified**.
- **Lumino:** `Widget.dispose()` removes it from the layout; the tree self-heals
  on the next `restoreLayout` normalisation pass.

### Q5 — Floating / detached vs. the dock tree

Three different structural answers — and toolbox has to pick one:

| System   | Encoding                                                                                                                                                                             | Consequence                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code  | `AuxiliaryEditorPartImpl extends EditorPart`; each floating window is a **sibling root** with its own `ISerializedGrid` + window bounds, listed in `IEditorPartsUIState.auxiliary[]` | Clean separation; a floating window can itself be split. Reopening is `Promise.allSettled` so one failure is isolated. Re-docking must move the editor between trees. |
| Eclipse  | Detached windows are **child `MWindow`s** in `MWindow.getWindows()`, in the same `workbench.xmi`                                                                                     | One model, one file, uniform traversal. Each has its own x/y/w/h, all `unset`-able.                                                                                   |
| NetBeans | **Same node, a flag**: `ModeConfig.state = MODE_STATE_JOINED \| MODE_STATE_SEPARATED`, with `bounds`/`relativeBounds` alongside `constraints`                                        | Cheapest. Float/unfloat is one field; the mode keeps its identity, membership and dock path, so re-docking is automatic.                                              |
| Theia    | `'secondaryWindow'` is an `ApplicationShell.Area`, but **not in `LayoutData`**                                                                                                       | Secondary windows are session-only; they do not survive reload.                                                                                                       |

VS Code's **Auxiliary Bar** is a red herring for this question — it is a
`ViewContainerLocation`, i.e. a docked region, not a floating window.

### Q6 — Does anything have per-frame declarative part existence?

**No. Plainly: none of the five.** All five use imperative creation with an
explicit lifetime:

- Lumino: `dockPanel.addWidget(w, {mode, ref})` / `widget.dispose()`.
- Theia: `widgetManager.getOrCreateWidget(factoryId, options)` +
  `shell.addWidget(...)`; the widget lives until disposed.
- VS Code: `editorService.openEditor(...)`; views are registered once into a
  registry.
- Eclipse: `EPartService.showPart(...)` / `MPart` added to the model tree.
- NetBeans: `TopComponent.open()` / `.close()`.

**What imperative existence buys them, precisely:**

1. **A part is a stable, addressable, long-lived object that the layout may
   point at.** No frame can make it vanish behind the layout's back.
2. **Existence and visibility are separable** into multiple independent bits
   (Eclipse: in-model / `toBeRendered` / `visible`; NetBeans: member /
   `opened` / minimised-slid-in; VS Code: registered / `active` / hidden /
   collapsed). Toolbox currently has one bit for all of this.
3. **The runtime can create a part it has never seen** — from a factory id or a
   `contributionURI`. This is what makes restore-on-reload possible at all.
4. **Somebody other than the part can decide it should exist.** The user
   dragging a saved layout onto the screen is a legitimate cause of a part
   coming into being.

The two mechanisms that come _closest_ to declarative existence are, notably,
both **derived-presence-with-durable-state**, not tool-owned existence:

- **VS Code `when` clauses** — `IViewDescriptor.when?: ContextKeyExpression`,
  re-evaluated in `ViewContainerModel.onDidChangeContext()`, flipping
  `item.state.active` while leaving `item.state` (size/order/collapsed/hidden)
  intact.
- **Eclipse `MUIElement.getVisibleWhen()`** — an `MExpression` on the model
  element, same idea.

In both, the _declaration_ decides a boolean; the _model_ owns everything else
and persists regardless. That is the shape toolbox should copy.

I did not investigate React-era docking libraries (dockview, flexlayout-react,
rc-dock, golden-layout). Whether any of them ties part existence to render
output is **unverified**; my expectation is that they all keep the layout as
app-owned state with `component` id + `params` descriptors, but I did not check.

---

## Implications for toolbox

The collision: **Window existence is per-frame and tool-owned; layout is durable
and user-owned.** Every system in this survey resolves the same collision the
same way at the top level — _by refusing to let it be a collision._ They split
the concept in two:

> **A durable, id-keyed _layout slot_ owned by the layout; and a live _part
> instance_ owned by whoever creates it. The slot can exist without the
> instance. The instance can exist without being slotted.**

Toolbox currently has only the instance. Everything below follows from adding
the slot.

### The concrete problem restated in toolbox terms

A saved layout must be able to say "Window `<instance>::settings` goes here" at
a moment when:

1. the Tool instance is not running (fresh page load);
2. the Tool instance is running but its Declarator did not call
   `ui.window("settings", …)` this frame (`open === false`);
3. the Tool source no longer declares that Window at all (the tool was edited);
4. the Tool is no longer in the **Manifest**.

Cases 1 and 2 are the ones worth engineering for. 3 and 4 are the "prune it"
cases.

### Named option 1 — Layout slots keyed by scoped id, with a per-slot `present` bit re-derived each frame

**This is the recommendation.** It is VS Code's `when`-clause factoring
(`viewDescriptorItem.state` durable, `state.active` re-derived) applied to our
per-frame model.

The window manager already has the right key: `scopeId(instanceId, originalId)`
= `` `${instanceId}::${originalId}` `` (`src/runtime/window-manager.ts`). Extend
`WindowState` from `{x, y, zIndex}` to also carry the dock slot, and — this is
the change — **stop deleting state when a Window stops being declared.**
`forget(prefix)` is currently called on tool close; that stays, but the
per-frame `place(orderedIds)` must not imply "ids absent from this array are
gone."

Per frame, the declarator's `ui.window` calls produce the set of _present_
Windows. The layout tree holds _slots_. Rendering intersects them:

- slot present in layout **and** declared this frame → render the Window there;
- slot in layout, **not** declared → the slot is _dormant_. Keep its geometry,
  keep its position in the dock tree, render nothing (or a thin placeholder —
  see option 3);
- declared but not in the layout → place it by the existing centring/cascade
  rule and add a slot.

Trade-offs: costs one extra concept (slot vs. Window) and forces every layout
consumer to handle dormant slots. Buys: closing and reopening a sub-window puts
it back exactly where it was — the behaviour NetBeans gets from
`addUnloadedTopComponent` and VS Code gets from `ViewDescriptorsState`. Without
this, `open = !open` in `tools/multi-window/index.ts` loses the Window's dock
position every single toggle, which will read as a bug.

### Named option 2 — Persist Tool instances, not Windows, and let Windows re-derive

For a saved layout to survive reload, something must relaunch the Tool. The
Runtime already knows how: the URL is kept in sync as
`?tool=qr-code-reader,counter` (`CONTEXT.md`, "Relationships"), and
`runtime.launchTool` exists.

So the durable snapshot is two-layer, mirroring Theia's `factoryId` + `options`:

```
snapshot = {
  version: 1,
  instances: [{ instanceId, toolId }],          // <- the recreation descriptors
  tree: <dock tree of scoped window ids>,       // <- the slots
  geometry: { "<scoped id>": {x, y, w, h} }
}
```

On restore: launch each `toolId`, mapping saved `instanceId`s to the fresh ones;
let each Tool's Declarator run; then intersect declared Windows against the
tree's slots per option 1. Slots for Windows the tool did not declare stay
dormant. Slots whose `toolId` is no longer in the Manifest are pruned.

`instances` is the exact analogue of `WidgetConstructionOptions{factoryId,
options}` and of NetBeans' `.settings`-file lookup. The mapping step is where
Theia's `getOrCreateWidget` cache-by-key lives; we need a deliberate decision on
whether re-launching a `toolId` **reuses** a running instance or **creates a new
one** — CONTEXT.md's "one instance per tool id was considered — resolved: the
same Tool can be opened multiple times" means we must key on `instanceId` and
accept that instance ids are not stable across reloads. Recommend: the snapshot
stores a **slot-local instance key** (`"0"`, `"1"`, …) rather than a runtime
`instanceId`, and restore builds the mapping.

Trade-off: the main Window of each instance is guaranteed to come back
(CONTEXT.md: it "exists for the lifetime of the tool instance"); sub-windows are
best-effort and depend on tool-internal state, which is not persisted. That
asymmetry is real and should be documented rather than hidden.

### Named option 3 — A dormant-slot affordance (Eclipse's `ErrorViewPart`, softened)

Two sub-options for what a dormant slot looks like:

- **Prune** (Theia / VS Code editors / Lumino): remove the slot, collapse the
  tree. Simple, silent, lossy.
- **Show a stub** (Eclipse): render a small placeholder in the slot — tool name,
  window title, and, where the Runtime can offer it, nothing more than "this
  window is closed". Costs screen space; makes the layout comprehensible.

Recommend a **hybrid keyed to the cause**, which is what the survey supports:

| Cause                                                  | Behaviour                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Tool running, Window not declared this frame           | Dormant slot, **invisible**, geometry retained. Collapse the tree around it as if absent, but do not delete the slot. |
| Tool not running (fresh load, or user closed the tool) | Dormant slot, **invisible**, retained until the layout is next saved.                                                 |
| Tool id absent from the Manifest / import fails        | **Prune** the slot, run the Lumino-style normalisation, log once.                                                     |

The distinction between rows 1–2 and row 3 is precisely VS Code's
`shouldPersist` comment: keep persisting a part whose owner is merely absent,
"since a reviver should exist when it is actually needed"; drop it only when the
owner is genuinely gone.

### Named option 4 — A per-Window persistence policy, NetBeans-style

Add an option to `ui.window`, e.g.
`ui.window(id, { persistence: "always" | "onlyOpen" | "never" }, cb)`, mapping
onto `PERSISTENCE_ALWAYS` / `PERSISTENCE_ONLY_OPENED` / `PERSISTENCE_NEVER`.

- `"always"` (default for the implicit main Window) — a slot is kept even when
  the Window is not declared. This is what makes "close the sub-window, reopen
  it, it's back in its dock slot" work.
- `"onlyOpen"` — the slot exists only while declared; disappearing removes it
  from the layout. Right default for transient/modal-ish sub-windows.
- `"never"` — never enters a layout at all; always floats.

This is cheap (one optional field), gives tool authors the one decision only
they can make, and is the only mechanism in the survey that lets the _part_
tell the _layout_ how durable it is. Theia's `storeState(): object | undefined`
is the degenerate two-valued version of the same idea and is worth adding
alongside it if Windows ever carry restorable state.

Recommend default `"onlyOpen"` for sub-windows declared via `ui.window`, because
it matches the existing per-frame semantics and is the least surprising; and
`"always"` for the implicit main Window, whose lifetime already equals the Tool
instance's.

### Named option 5 — Path-addressed slots instead of a nested tree (NetBeans)

Instead of nesting slots inside split nodes, store a flat list of slots each with
a `SplitConstraint[]`-style path (`{orientation, index, weight}[]`). The tree is
reconstructed from the union of paths.

Trade-off: harder to render (must rebuild the tree), harder to express "these two
share a tab stack" without a mode-like intermediate. Buys: **removing a slot
cannot corrupt the tree** — no empty nodes to collapse, no single-child splits to
hoist. Given that toolbox's leaves are exactly the unreliable part, this is worth
a prototype before committing to the nested shape. My default recommendation is
still the nested shape (it is what four of five systems use, and Lumino's
`normalizeAreaConfig` is ~60 lines we can port), but the path shape deserves an
honest look.

### Named option 6 — Slot references, so one Window can appear in several layouts

Eclipse's `MPlaceholder` exists for exactly the reason toolbox will hit as soon
as it has more than one saved layout: the same `MPart` lives once in
`window.sharedElements`, and each perspective holds a placeholder pointing at it,
carrying **per-perspective** overrides (`closeable`).

Applied here: a Window's identity and geometry live once, per instance; each
saved layout holds a _reference_ to the scoped id plus layout-local attributes
(size in the tree, tab index, dormant-or-not). Adopt this from the start; adding
it later means migrating every stored snapshot.

### Things to copy verbatim

- **`normalizeAreaConfig`** (Lumino, `docklayout.ts` ~line 2160–2247): prune
  empty tab areas; skip null children; return the single surviving child in place
  of a one-child split; hoist same-orientation nested splits. This is the
  tree-repair function and it is the same regardless of why a leaf vanished.
- **Relative sizes.** Lumino's normalised `sizes[]` or NetBeans' 0..1
  `splitWeight`, not VS Code's pixels-plus-viewport. A browser desktop resizes
  constantly.
- **A `version` field and a migration hook.** Theia's
  `applicationShellLayoutVersion` + `ApplicationShellLayoutMigration` with
  `onWillInflateLayout` / `onWillInflateWidget`, and a `RESET_LAYOUT` command
  that clears storage. Cheap now, impossible to retrofit.
- **A "reset layout" command.** Every system has one. Theia's logs
  `Please use 'Reset Workbench Layout' command if the layout looks bogus.`
- **Float as a flag on the slot, not a separate tree.** NetBeans'
  `MODE_STATE_JOINED | MODE_STATE_SEPARATED` with bounds on the same node. This
  fits the **Projector** exactly: CONTEXT.md already defines a popped-out Window
  as one that "physically lives in another browser document while staying
  logically in the main instance's render tree." Keeping the popped-out Window as
  a flagged node in the dock tree means un-popping restores its dock position for
  free — whereas VS Code's sibling-root model would require moving the node
  between trees. Toolbox's Projector semantics make the NetBeans encoding
  strictly better here.

### The one thing to decide first

Whether a **dormant slot** is a thing that exists. Options 1, 3, 4 and 6 all
presuppose it; option "prune everything" is the alternative and is what Theia
and VS Code's editor grid do.

Recommendation: **yes, dormant slots exist**, because toolbox's per-frame model
makes them the _common_ case rather than the exceptional one. In Theia a widget
disappearing from the layout means it was disposed — a rare, deliberate act. In
toolbox it means a tool flipped a boolean. Pruning on every such flip would make
docking useless for exactly the tools that most want it.

---

## Source index

| Claim area                                                                                                              | Repo                                 | Path                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `ILayoutConfig`, `saveLayout`/`restoreLayout`, normalisation                                                            | jupyterlab/lumino                    | `packages/widgets/src/docklayout.ts`                                                                                |
| `DockPanel`                                                                                                             | jupyterlab/lumino                    | `packages/widgets/src/dockpanel.ts`                                                                                 |
| `deflate`/`inflate`, `WidgetDescription`, `StatefulWidget`, `convertToWidget`, `ParseContext`, perspectives, migrations | eclipse-theia/theia                  | `packages/core/src/browser/shell/shell-layout-restorer.ts`                                                          |
| `WidgetFactory`, `WidgetConstructionOptions`, `getOrCreateWidget`, `getDescription`, `toKey`                            | eclipse-theia/theia                  | `packages/core/src/browser/widget-manager.ts`                                                                       |
| `ApplicationShell.LayoutData`, `getLayoutData`/`setLayoutData`, `Area` incl. `secondaryWindow`                          | eclipse-theia/theia                  | `packages/core/src/browser/shell/application-shell.ts`                                                              |
| `SidePanel.LayoutData`, `WidgetItem.widget?`                                                                            | eclipse-theia/theia                  | `packages/core/src/browser/shell/side-panel-handler.ts`                                                             |
| `SecondaryWindowHandler`                                                                                                | eclipse-theia/theia                  | `packages/core/src/browser/secondary-window-handler.ts`                                                             |
| `ISerializedGrid`/`Node`, `SerializableGrid`, `ISerializableView`, `IViewDeserializer`                                  | microsoft/vscode                     | `src/vs/base/browser/ui/grid/grid.ts`                                                                               |
| `GridView.deserialize`                                                                                                  | microsoft/vscode                     | `src/vs/base/browser/ui/grid/gridview.ts`                                                                           |
| `IEditorPartUIState`, `doCreateGridControlWithState`, restore-failure handling                                          | microsoft/vscode                     | `src/vs/workbench/browser/parts/editor/editorPart.ts`                                                               |
| `IEditorPartsUIState`, auxiliary parts, `restoreParts`, editor working sets                                             | microsoft/vscode                     | `src/vs/workbench/browser/parts/editor/editorParts.ts`                                                              |
| `AuxiliaryEditorPartImpl extends EditorPart`                                                                            | microsoft/vscode                     | `src/vs/workbench/browser/parts/editor/auxiliaryEditorPart.ts`                                                      |
| `ISerializedEditorGroupModel`, `serialize`/`deserialize`, `coalesce`                                                    | microsoft/vscode                     | `src/vs/workbench/common/editor/editorGroupModel.ts`                                                                |
| `IViewDescriptor`, `ViewContainerLocation`, `IViewsRegistry`                                                            | microsoft/vscode                     | `src/vs/workbench/common/views.ts`                                                                                  |
| `IStoredWorkspaceViewState`, `ViewDescriptorsState`, `onDidChangeContext`, `remove`                                     | microsoft/vscode                     | `src/vs/workbench/services/views/common/viewContainerModel.ts`                                                      |
| `views.customizations`, `onDidDeregisterViews`                                                                          | microsoft/vscode                     | `src/vs/workbench/services/views/browser/viewDescriptorService.ts`                                                  |
| `contributes.views`, `onView:` activation events                                                                        | microsoft/vscode                     | `src/vs/workbench/api/browser/viewsExtensionPoint.ts`                                                               |
| `noDataProviderMessage`, `activateByEvent('onView:…')`                                                                  | microsoft/vscode                     | `src/vs/workbench/browser/parts/views/treeView.ts`                                                                  |
| `EditorPlaceholder`, `ErrorPlaceholderEditor`                                                                           | microsoft/vscode                     | `src/vs/workbench/browser/parts/editor/editorPlaceholder.ts`                                                        |
| `LazilyResolvedWebviewEditorInput`, `RevivalPool`, `shouldPersist`                                                      | microsoft/vscode                     | `src/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.ts`                                          |
| `SerializedWebview`, `WebviewEditorInputSerializer`                                                                     | microsoft/vscode                     | `src/vs/workbench/contrib/webviewPanel/browser/webviewEditorInputSerializer.ts`                                     |
| `MUIElement` (`toBeRendered`, `visible`, `containerData`, `curSharedRef`, `visibleWhen`)                                | eclipse-platform/eclipse.platform.ui | `bundles/org.eclipse.e4.ui.model.workbench/src/org/eclipse/e4/ui/model/application/ui/MUIElement.java`              |
| `MPlaceholder` (`ref`, `closeable`)                                                                                     | eclipse-platform/eclipse.platform.ui | `.../ui/advanced/MPlaceholder.java`                                                                                 |
| `MPart`                                                                                                                 | eclipse-platform/eclipse.platform.ui | `.../ui/basic/MPart.java`                                                                                           |
| `MPartSashContainer`                                                                                                    | eclipse-platform/eclipse.platform.ui | `.../ui/basic/MPartSashContainer.java`                                                                              |
| `MWindow` (`getWindows` = detached, `getSharedElements`)                                                                | eclipse-platform/eclipse.platform.ui | `.../ui/basic/MWindow.java`                                                                                         |
| `workbench.xmi`, `CLEAR_PERSISTED_STATE`                                                                                | eclipse-platform/eclipse.platform.ui | `bundles/org.eclipse.e4.ui.workbench/src/org/eclipse/e4/ui/internal/workbench/ResourceHandler.java`                 |
| `createErrorPart`, memento persist/init                                                                                 | eclipse-platform/eclipse.platform.ui | `bundles/org.eclipse.ui.workbench/eclipseui/org/eclipse/ui/internal/ViewReference.java`                             |
| `ErrorViewPart`                                                                                                         | eclipse-platform/eclipse.platform.ui | `bundles/org.eclipse.ui.workbench/eclipseui/org/eclipse/ui/internal/ErrorViewPart.java`                             |
| `PERSISTENCE_*`, `getPersistenceType`, `@Description`                                                                   | apache/netbeans                      | `platform/openide.windows/src/org/openide/windows/TopComponent.java`                                                |
| `WindowManagerConfig`, `ModeConfig`, `TCRefConfig`                                                                      | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/persistence/{WindowManagerConfig,ModeConfig,TCRefConfig}.java` |
| `SplitConstraint`                                                                                                       | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/SplitConstraint.java`                                          |
| `MODE_STATE_JOINED/SEPARATED`                                                                                           | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/Constants.java`                                                |
| `getTopComponentPersistentForID`, missing-module handling                                                               | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/persistence/PersistenceManager.java`                           |
| `initModeFromConfig`, `lazyLoad` vs `addUnloadedTopComponent`                                                           | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/PersistenceHandler.java`                                       |
| `addUnloadedTopComponent`, id lists                                                                                     | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/ModeImpl.java`                                                 |
| `ModuleChangeHandler`                                                                                                   | apache/netbeans                      | `platform/core.windows/src/org/netbeans/core/windows/persistence/ModuleChangeHandler.java`                          |

### Explicitly unverified

- Theia secondary-window persistence: concluded session-only from the _absence_
  of a field in `ApplicationShell.LayoutData` and of any read in
  `getLayoutData()`. Not proven by a positive citation.
- NetBeans `ModuleChangeHandler` removal semantics: I read its class doc and
  field declarations, not its `fileDeleted`/`fileFolderCreated` handlers.
- VS Code behaviour when an extension is uninstalled _while_ one of its views is
  visible: I traced the registry/model path (`deregisterViews` →
  `ViewContainerModel.remove`) but did not verify the disposal path for the
  live `ViewPane` widget.
- React-era docking libraries (dockview, flexlayout-react, rc-dock,
  golden-layout): not investigated at all.
