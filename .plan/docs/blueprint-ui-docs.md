# Blueprint UI - Complete Documentation Reference

Blueprint is Palantir's React-based UI toolkit for the web. It is optimized for building complex, data-dense interfaces for desktop applications. This document covers every component, prop interface, and pattern across all Blueprint packages.

NPM scope: `@blueprintjs/*`
Peer dependencies: `react`, `react-dom`

---

# Table of Contents

1. [Getting Started](#getting-started)
2. [Design Principles](#design-principles)
3. [Core Package (@blueprintjs/core)](#core-package)
   - [Providers and Context](#providers-and-context)
   - [Typography](#typography)
   - [Colors](#colors)
   - [Variables (Sass/Less)](#variables)
   - [Components](#components)
   - [Form Controls](#form-controls)
   - [Form Inputs](#form-inputs)
   - [Overlays](#overlays)
   - [Hooks](#hooks)
4. [Icons Package (@blueprintjs/icons)](#icons-package)
5. [Datetime Package (@blueprintjs/datetime)](#datetime-package)
6. [Select Package (@blueprintjs/select)](#select-package)
7. [Table Package (@blueprintjs/table)](#table-package)
8. [Labs Package (@blueprintjs/labs)](#labs-package)

---

# Getting Started

## Installation

```sh
pnpm add @blueprintjs/core react react-dom
```

Additional packages:
- `@blueprintjs/icons` - 500+ vector UI icons
- `@blueprintjs/datetime` - date and time pickers
- `@blueprintjs/select` - select, suggest, multi-select, omnibar
- `@blueprintjs/table` - spreadsheet-like table component
- `@blueprintjs/labs` - experimental/unstable components (Box, Flex)

## CSS Setup

You MUST include CSS files from each Blueprint package you use:

```tsx
// ESM bundler
import "normalize.css";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
// Add other blueprint-*.css files as needed:
// import "@blueprintjs/datetime/lib/css/blueprint-datetime.css";
// import "@blueprintjs/select/lib/css/blueprint-select.css";
// import "@blueprintjs/table/lib/css/table.css";
```

Or in HTML:

```html
<link href="path/to/node_modules/normalize.css/normalize.css" rel="stylesheet" />
<link href="path/to/node_modules/@blueprintjs/core/lib/css/blueprint.css" rel="stylesheet" />
<link href="path/to/node_modules/@blueprintjs/icons/lib/css/blueprint-icons.css" rel="stylesheet" />
```

## Basic Usage

```tsx
import { Button } from "@blueprintjs/core";

<Button intent="success" text="button content" onClick={incrementCounter} />
```

## Browser Support

Blueprint supports Chrome, Firefox, Safari, and Microsoft Edge. IE is not supported since v5.0.

## TypeScript

Blueprint is written in TypeScript. Type definitions are included in NPM packages. Requires TypeScript 4.0+.

---

# Design Principles

- Blueprint strictly adheres to semver in its public APIs
- JS APIs exported from the root/main module of a Blueprint package
- HTML structure of components
- CSS styles for rendered components

---

# Core Package

`@blueprintjs/core` is the primary package with 40+ React components. Install:

```sh
pnpm add @blueprintjs/core react react-dom
```

The core package depends on `@blueprintjs/icons` which provides 500+ UI icons.

---

## Providers and Context

### BlueprintProvider

`BlueprintProvider` is a convenience wrapper component which combines several Blueprint context providers into one. It is recommended to render this component near the root of your React application.

```tsx
import { BlueprintProvider } from "@blueprintjs/core";
import * as ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <BlueprintProvider>
        <App />
    </BlueprintProvider>,
);
```

It combines:
- HotkeysProvider
- OverlaysProvider
- PortalProvider

### HotkeysProvider

`HotkeysProvider` is required as an ancestor of any component using the `useHotkeys` hook or `HotkeysTarget` component. It manages global hotkey registrations and renders the hotkeys dialog (triggered by pressing `?`).

```tsx
import { HotkeysProvider } from "@blueprintjs/core";

<HotkeysProvider>
    <App />
</HotkeysProvider>
```

Props:
- `dialogProps` - Props to customize the hotkeys dialog
- `renderDialog` - Custom renderer for the hotkeys dialog
- `value` - Optional externally managed context value

### OverlaysProvider

`OverlaysProvider` manages the overlay stack for components like Dialog, Drawer, Popover, etc. It is required for Overlay2-based components (recommended in v5, required in future versions).

```tsx
import { OverlaysProvider } from "@blueprintjs/core";

<OverlaysProvider>
    <App />
</OverlaysProvider>
```

### PortalProvider

`PortalProvider` allows customization of how Portal renders its children. Use it to specify a custom portal container or add classes to all portal elements.

```tsx
import { PortalProvider } from "@blueprintjs/core";

<PortalProvider portalClassName="my-custom-class" portalContainer={myContainer}>
    <App />
</PortalProvider>
```

---

## Typography

### UI Text

The base font size is 14px. Blueprint uses the default sans-serif operating system font.

CSS classes:
- `.bp5-ui-text` - Reset to default font size/line height
- `.bp5-running-text` - For longform text (articles, documents). Children `<h*>`, `<ul>`, `<ol>`, `<blockquote>`, `<code>`, `<pre>`, `<kbd>` get styled automatically.
- `.bp5-heading` - Apply to `<h1>`-`<h6>` tags
- `.bp5-code` - Inline code
- `.bp5-code-block` - Multiline code blocks
- `.bp5-blockquote` - Block quotes
- `.bp5-list` - Styled lists
- `.bp5-list-unstyled` - Remove list decorations

### HTML Element Components

Blueprint provides React components for common HTML elements:

| Component | HTML tag | Class |
|-----------|----------|-------|
| `H1`-`H6` | `h1`-`h6` | `HEADING` |
| `Blockquote` | `blockquote` | `BLOCKQUOTE` |
| `Code` | `code` | `CODE` |
| `Pre` | `pre` | `CODE_BLOCK` |
| `OL` | `ol` | `LIST` |
| `UL` | `ul` | `LIST` |
| `HTMLTable` | `table` | `HTML_TABLE` |

### Dark Theme

Add `.bp5-dark` to a container to theme all nested Blueprint elements. The dark theme cascades to nested `.bp5-*` elements.

Components that support `.bp5-dark` directly: Card, Dialog, Popover, Tooltip, Toast.

### RTL Support

Use `.bp5-rtl` utility class. Blueprint components use logical properties (`start`/`end` instead of `left`/`right`).

---

## Colors

### Intent Colors

- Blue (primary) - elevates elements from the gray scale
- Green (success) - indicates successful operations
- Orange (warning) - indicates warnings
- Red (danger) - indicates errors/destructive operations

Many components support the `intent` prop: `intent="primary"`, `intent="success"`, `intent="warning"`, `intent="danger"`.

### Usage in Code

```tsx
import { Colors } from "@blueprintjs/core";
<div style={{ color: Colors.BLUE3, background: Colors.BLACK }} />
```

```scss
@import "@blueprintjs/core/lib/scss/variables";
.rule {
    color: $pt-link-color;
    background: $black;
}
```

---

## Variables

### Spacing

`$pt-spacing` is the base unit: 4px. Use multiples for consistent spacing:

```scss
.my-component {
    padding: $pt-spacing * 4;   // 16px
    margin-bottom: $pt-spacing * 2; // 8px
    gap: $pt-spacing;           // 4px
}
```

Note: `$pt-grid-size` (10px) is deprecated. Use `$pt-spacing` (4px) instead.

### Common Dimensions

- `$pt-border-radius`
- `$pt-button-height`
- `$pt-button-height-large`
- `$pt-input-height`
- `$pt-input-height-large`
- `$pt-navbar-height`

### Z-Index Layers

- `$pt-z-index-base`
- `$pt-z-index-content`
- `$pt-z-index-overlay`

### Color Aliases

Key Sass variables:

- `$pt-intent-primary`, `$pt-intent-success`, `$pt-intent-warning`, `$pt-intent-danger`
- `$pt-app-background-color`, `$pt-dark-app-background-color`
- `$pt-text-color`, `$pt-text-color-muted`, `$pt-text-color-disabled`
- `$pt-heading-color`, `$pt-link-color`
- `$pt-dark-text-color`, `$pt-dark-text-color-muted`, `$pt-dark-text-color-disabled`
- `$pt-icon-color`, `$pt-icon-color-hover`, `$pt-icon-color-disabled`, `$pt-icon-color-selected`
- `$pt-divider-black`, `$pt-dark-divider-black`
- `$pt-code-text-color`, `$pt-code-background-color`

### Elevation Shadows

- `$pt-elevation-shadow-0` through `$pt-elevation-shadow-4`
- Dark variants: `$pt-dark-elevation-shadow-0` through `$pt-dark-elevation-shadow-4`

---

## Components

### Alert

Alerts notify users of important information and optionally request confirmation.

```tsx
import { Alert } from "@blueprintjs/core";

<Alert
    isOpen={isOpen}
    onConfirm={handleConfirm}
    onCancel={handleCancel}
    cancelButtonText="Cancel"
    confirmButtonText="Delete"
    icon="trash"
    intent="danger"
>
    <p>Are you sure you want to delete this item?</p>
</Alert>
```

Key props:
- `isOpen: boolean` - controlled visibility
- `onConfirm?: () => void` - confirm button handler
- `onCancel?: () => void` - cancel button handler
- `onClose?: () => void` - handles both confirm and cancel
- `cancelButtonText?: string` - shows cancel button when defined
- `confirmButtonText?: string` - text for confirm button (default: "OK")
- `icon?: IconName | MaybeElement` - icon before alert body
- `intent?: Intent` - visual intent applied to confirm button
- `canEscapeKeyCancel?: boolean` - whether ESC triggers cancel (default: false)
- `canOutsideClickCancel?: boolean` - whether clicking overlay triggers cancel (default: false)
- `loading?: boolean` - shows spinner on confirm button

### Breadcrumbs

Represents the path to the current resource in a hierarchical structure.

```tsx
import { Breadcrumbs } from "@blueprintjs/core";

<Breadcrumbs
    items={[
        { text: "Home", href: "/" },
        { text: "Products", href: "/products" },
        { text: "Widget", href: "/products/widget" },
    ]}
/>
```

Uses OverflowList to collapse breadcrumbs that exceed available space. Supports custom `breadcrumbRenderer` and `currentBreadcrumbRenderer`.

### Button

A clickable element for triggering actions.

```tsx
import { Button, AnchorButton } from "@blueprintjs/core";

<Button text="Click me" intent="primary" onClick={handleClick} />
<Button icon="refresh" />
<AnchorButton href="/login" text="Login" />
```

Key props:
- `text?: React.ReactNode` - button label
- `intent?: Intent` - visual intent (primary, success, warning, danger)
- `variant?: "solid" | "minimal" | "outlined"` - visual style (default: "solid")
- `size?: "small" | "medium" | "large"` - button size
- `icon?: IconName | MaybeElement` - icon before text
- `endIcon?: IconName | MaybeElement` - icon after text
- `active?: boolean` - active/pressed appearance
- `disabled?: boolean`
- `loading?: boolean` - shows spinner
- `fill?: boolean` - expand to fill container
- `alignText?: "left" | "center" | "right"` - text alignment
- `ellipsizeText?: boolean` - truncate with ellipsis
- `onClick?: React.MouseEventHandler`

AnchorButton uses `<a>` tag and supports `href`, `target` props. Use AnchorButton when you need hover events on disabled buttons (native `<button disabled>` blocks all events).

Note: `minimal` and `outlined` boolean props are deprecated. Use `variant` instead.

### ButtonGroup

Arranges related buttons horizontally or vertically.

```tsx
import { ButtonGroup, Button } from "@blueprintjs/core";

<ButtonGroup>
    <Button text="Left" />
    <Button text="Center" />
    <Button text="Right" />
</ButtonGroup>
```

Key props:
- `variant?: "solid" | "minimal" | "outlined"` - applied to all children
- `size?: "small" | "medium" | "large"` - size of all children
- `fill?: boolean` - all buttons expand equally
- `vertical?: boolean` - stack vertically
- `alignText?: Alignment` - text alignment for all buttons

### Callout

Visually highlights important content. Supports title, icon, and content.

```tsx
import { Callout } from "@blueprintjs/core";

<Callout title="Attention" intent="warning" icon="warning-sign">
    Please review before proceeding.
</Callout>
```

Key props:
- `intent?: Intent` - sets color and default icon
- `icon?: IconName | MaybeElement | false` - custom icon or disable
- `title?: string` - title text
- `compact?: boolean` - reduced padding

### Card

A bounded container for grouping content with solid background.

```tsx
import { Card, Elevation } from "@blueprintjs/core";

<Card elevation={Elevation.TWO} interactive onClick={handleClick}>
    <h5>Card Title</h5>
    <p>Card content</p>
</Card>
```

Key props:
- `elevation?: 0 | 1 | 2 | 3 | 4` - shadow depth (default: 0)
- `interactive?: boolean` - hover/click styling
- `selected?: boolean` - selection state
- `compact?: boolean` - reduced padding
- `onClick?: React.MouseEventHandler`

### CardList

Groups cards into a vertical list without extra spacing.

```tsx
import { CardList, Card } from "@blueprintjs/core";

<CardList>
    <Card>Item 1</Card>
    <Card>Item 2</Card>
    <Card>Item 3</Card>
</CardList>
```

Key props:
- `bordered?: boolean` - show borders (default: true)
- `compact?: boolean` - reduced padding

Can be embedded in a Section component for titles/descriptions.

### ControlCard

Interactive Card with embedded form control. Three variants:

```tsx
import { SwitchCard, CheckboxCard, RadioCard, RadioGroup } from "@blueprintjs/core";

<SwitchCard checked={isEnabled} onChange={handleChange}>
    Enable notifications
</SwitchCard>

<CheckboxCard checked={isSelected} onChange={handleChange}>
    Accept terms
</CheckboxCard>

<RadioGroup selectedValue={value} onChange={handleChange}>
    <RadioCard label="Option A" value="a" />
    <RadioCard label="Option B" value="b" />
</RadioGroup>
```

The `showAsSelectedWhenChecked` prop controls whether checked cards appear "selected."

### Collapse

Reveals/hides content with smooth sliding animation.

```tsx
import { Collapse, Button } from "@blueprintjs/core";

const [isOpen, setIsOpen] = React.useState(false);

<Button onClick={() => setIsOpen(!isOpen)} text="Toggle" />
<Collapse isOpen={isOpen}>
    <div>Collapsible content here</div>
</Collapse>
```

Key props:
- `isOpen: boolean` - controls visibility
- `keepChildrenMounted?: boolean` - keep DOM nodes when collapsed (default: false)
- `transitionDuration?: number` - animation duration in ms (default: 200)

Content must be in normal document flow (no `position: absolute`).

### ContextMenu

Right-click context menus.

```tsx
import { ContextMenu, Menu, MenuItem } from "@blueprintjs/core";

<ContextMenu
    content={
        <Menu>
            <MenuItem text="Save" />
            <MenuItem text="Delete" intent="danger" />
        </Menu>
    }
>
    <div>Right click me!</div>
</ContextMenu>
```

Renders a `<div>` wrapper by default (customize with `tagName`). Supports advanced render function API for `children` to avoid wrapper element.

### Dialog

Presents content overlaid on the UI.

```tsx
import { Dialog, DialogBody, DialogFooter, Button } from "@blueprintjs/core";

<Dialog title="Settings" icon="cog" isOpen={isOpen} onClose={handleClose}>
    <DialogBody>
        <p>Dialog content here</p>
    </DialogBody>
    <DialogFooter
        actions={
            <>
                <Button text="Cancel" onClick={handleClose} />
                <Button text="Save" intent="primary" onClick={handleSave} />
            </>
        }
    />
</Dialog>
```

Key Dialog props:
- `isOpen: boolean` - controlled visibility
- `onClose?: (event: React.SyntheticEvent) => void`
- `title?: React.ReactNode` - dialog header title
- `icon?: IconName | MaybeElement` - header icon
- `canEscapeKeyClose?: boolean` (default: true)
- `canOutsideClickClose?: boolean` (default: true)
- `isCloseButtonShown?: boolean` (default: true)

DialogBody props:
- `useOverflowScrollContainer?: boolean` - constrain height with scrolling

MultistepDialog for multi-step wizards:

```tsx
import { MultistepDialog, DialogStep, DialogBody } from "@blueprintjs/core";

<MultistepDialog isOpen={isOpen} onClose={handleClose} title="Wizard">
    <DialogStep id="step1" title="Step 1" panel={<DialogBody>Step 1 content</DialogBody>} />
    <DialogStep id="step2" title="Step 2" panel={<DialogBody>Step 2 content</DialogBody>} />
</MultistepDialog>
```

### Divider

Thin line separator. Adapts to flex container direction.

```tsx
import { Divider } from "@blueprintjs/core";

<Divider />
<Divider compact /> // no margin
```

### Drawer

Overlays content anchored to screen edge.

```tsx
import { Drawer, DrawerSize } from "@blueprintjs/core";

<Drawer
    isOpen={isOpen}
    onClose={handleClose}
    title="Settings"
    size={DrawerSize.STANDARD}
>
    <div>Drawer content</div>
</Drawer>
```

Key props:
- `isOpen: boolean`
- `onClose?: () => void`
- `size?: string | number` - CSS width (or height if vertical)
  - `DrawerSize.SMALL` = 360px
  - `DrawerSize.STANDARD` = 50% (default)
  - `DrawerSize.LARGE` = 90%
- `position?: "top" | "bottom" | "left" | "right"` (default: "right")
- `title?: React.ReactNode`

### EditableText

In-place editable text. Renders as text, becomes input on focus/click.

```tsx
import { EditableText } from "@blueprintjs/core";

<EditableText
    value={title}
    onChange={setTitle}
    placeholder="Click to edit..."
/>
```

### EntityTitle

Renders a title with an optional icon, subtitle, heading level, and tags.

```tsx
import { EntityTitle } from "@blueprintjs/core";

<EntityTitle
    icon="document"
    title="My Document"
    subtitle="Last edited 2 days ago"
    heading={H4}
/>
```

### Icon

Renders SVG icons from the Blueprint icon set.

```tsx
import { Icon, IconSize } from "@blueprintjs/core";

<Icon icon="cross" />
<Icon icon="globe" size={20} />
<Icon icon="graph" size={IconSize.LARGE} intent="primary" />
```

Key props:
- `icon: IconName` - icon name string (type-checked)
- `size?: number` - pixel size (uses 16px grid for <20, 20px grid for >=20)
- `intent?: Intent` - color intent
- `title?: string` - accessible title (sets aria-hidden=false)
- `tagName?: string | null` - wrapper element (default: "span", null for SVG only)
- `color?: string` - custom CSS color

Static icon imports (tree-shakeable):

```tsx
import { Download } from "@blueprintjs/icons";
<Button icon={<Download size={16} />} text="Download" />
```

CSS icon API (icon fonts):
```html
<span class="bp5-icon-standard bp5-icon-projects"></span>
<span class="bp5-icon-large bp5-icon-geosearch bp5-intent-success"></span>
```

### Link

Themed anchor tag component.

```tsx
import { Link } from "@blueprintjs/core";

<Link href="/about">About us</Link>
<Link href="/about" underline="hover" color="inherit">subtle link</Link>
```

Key props:
- `underline?: "always" | "hover" | "none"` (default: "always")
- `color?: "primary" | "success" | "warning" | "danger" | "inherit"` (default: "primary")
- All standard `<a>` attributes

### Menu

A list of interactive items for selection or navigation.

```tsx
import { Menu, MenuItem, MenuDivider } from "@blueprintjs/core";

<Menu>
    <MenuItem icon="new-text-box" text="New text box" onClick={handleNewText} />
    <MenuItem icon="new-object" text="New object" onClick={handleNewObject} />
    <MenuDivider />
    <MenuItem icon="trash" text="Delete" intent="danger" />
</Menu>
```

MenuItem props:
- `text: React.ReactNode` - required label
- `icon?: IconName | MaybeElement`
- `label?: string` - right-aligned text (e.g., hotkey)
- `labelElement?: React.ReactNode` - right-aligned JSX
- `intent?: Intent`
- `active?: boolean` - keyboard focus appearance
- `disabled?: boolean`
- `selected?: boolean` - selection state (use with `roleStructure="listoption"`)
- `shouldDismissPopover?: boolean` (default: true)
- `roleStructure?: "menuitem" | "listoption" | "listitem" | "none"` (default: "menuitem")
- `children` - renders submenu in nested popover
- `onClick?, href?, target?` - interaction

### Navbar

Top navigation bar.

```tsx
import { Navbar, NavbarGroup, NavbarHeading, NavbarDivider, Button, Alignment } from "@blueprintjs/core";

<Navbar>
    <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading>My App</NavbarHeading>
        <NavbarDivider />
        <Button variant="minimal" icon="home" text="Home" />
        <Button variant="minimal" icon="document" text="Files" />
    </NavbarGroup>
</Navbar>
```

### NonIdealState

Displays empty/error states with icon, title, description, and action.

```tsx
import { NonIdealState, Button } from "@blueprintjs/core";

<NonIdealState
    icon="search"
    title="No results found"
    description="Try a different search term."
    action={<Button text="Clear search" onClick={handleClear} />}
/>
```

Key props:
- `icon?: IconName | MaybeElement`
- `title?: React.ReactNode`
- `description?: React.ReactNode`
- `action?: React.JSX.Element`
- `layout?: "vertical" | "horizontal"` (default: "vertical")

### OverflowList

Renders items that fit in a container and collapses the rest.

```tsx
import { OverflowList } from "@blueprintjs/core";

<OverflowList
    items={items}
    visibleItemRenderer={(item) => <Tag key={item.id}>{item.name}</Tag>}
    overflowRenderer={(overflowItems) => (
        <Popover content={<Menu>{overflowItems.map(renderOverflowItem)}</Menu>}>
            <Tag>+{overflowItems.length}</Tag>
        </Popover>
    )}
/>
```

### Overlay2

Low-level overlay component that renders content on top of the application. Used internally by Dialog, Drawer, Popover, etc. Requires OverlaysProvider.

```tsx
import { Overlay2 } from "@blueprintjs/core";

<Overlay2 isOpen={isOpen} onClose={handleClose}>
    <div ref={childRef}>Overlay content</div>
</Overlay2>
```

Key props:
- `isOpen: boolean` - controlled visibility
- `onClose?: () => void`
- `autoFocus?: boolean` (default: true)
- `enforceFocus?: boolean` (default: true)
- `canEscapeKeyClose?: boolean` (default: true)
- `canOutsideClickClose?: boolean` (default: true)
- `hasBackdrop?: boolean` (default: true)
- `usePortal?: boolean` (default: true)
- `lazy?: boolean` (default: true)
- `transitionDuration?: number` (default: 300)

Lifecycle callbacks: `onOpening`, `onOpened`, `onClosing`, `onClosed`.

### PanelStack

Manages a stack of panels with breadcrumb-style navigation.

```tsx
import { PanelStack2 } from "@blueprintjs/core";

<PanelStack2
    initialPanel={{ renderPanel: MyRootPanel, title: "Root" }}
    onOpen={handleOpen}
    onClose={handleClose}
/>
```

### Popover (deprecated - use PopoverNext)

Floating content next to a target element. Built on Popper.js.

```tsx
import { Popover, Button, Classes } from "@blueprintjs/core";

<Popover
    content={<div>Popover content</div>}
    interactionKind="click"
    placement="bottom"
>
    <Button text="Click me" />
</Popover>
```

Key props:
- `content?: string | JSX.Element` - popover content
- `children` or `renderTarget` - trigger element
- `interactionKind?: "click" | "click-target" | "hover" | "hover-target"` (default: "click")
- `placement?: Placement` (default: "auto")
- `isOpen?: boolean` - controlled mode
- `defaultIsOpen?: boolean` (default: false)
- `onInteraction?: (nextOpenState: boolean) => void`
- `disabled?: boolean`
- `minimal?: boolean` - no arrow, subtle animation
- `hasBackdrop?: boolean` - click-only (default: false)
- `usePortal?: boolean` (default: true)
- `fill?: boolean` - target fills container
- `matchTargetWidth?: boolean`
- `captureDismiss?: boolean` (default: false)
- `hoverOpenDelay?: number` (default: 150)
- `hoverCloseDelay?: number` (default: 300)
- `shouldReturnFocusOnClose?: boolean` (default: false)
- `popoverClassName?: string`
- `targetTagName?: string` (default: "span")
- `inheritDarkTheme?: boolean` (default: true)

Dismiss elements: Add `Classes.POPOVER_DISMISS` to elements inside popover content to close on click. Use `Classes.POPOVER_DISMISS_OVERRIDE` to cancel dismissal on subtrees.

### PopoverNext

Modern replacement for Popover, built on Floating UI instead of Popper.js.

```tsx
import { PopoverNext, Button } from "@blueprintjs/core";

<PopoverNext
    content={<div>Popover content</div>}
    interactionKind="click"
    placement="bottom"
>
    <Button text="Click me" />
</PopoverNext>
```

Differences from Popover:
- `shouldReturnFocusOnClose` defaults to `true` (was `false`)
- Uses `placement` prop (not `position`)
- `animation` prop: `"scale"` (default) or `"minimal"`
- `arrow` prop to control arrow visibility (default: `true`)
- Uses Floating UI `middleware` config instead of Popper.js `modifiers`

Key additional props:
- `animation?: "scale" | "minimal"`
- `arrow?: boolean` (default: true)
- `middleware?: MiddlewareConfig` - Floating UI middleware configuration
- `positioningStrategy?: "absolute" | "fixed"` (default: "absolute")

### Portal

Renders children into a new DOM subtree outside the component hierarchy. Used internally by Overlay2.

```tsx
import { Portal } from "@blueprintjs/core";

<Portal container={document.getElementById("portal-target")}>
    <div>Portal content</div>
</Portal>
```

Target element resolution order:
1. `container` prop
2. `portalContainer` from PortalProvider context
3. `document.body`

### ProgressBar

Indicates progress or indeterminate loading.

```tsx
import { ProgressBar } from "@blueprintjs/core";

<ProgressBar value={0.7} intent="primary" />
<ProgressBar /> {/* indeterminate */}
```

Key props:
- `value?: number` - 0 to 1 (omit for indeterminate)
- `intent?: Intent`
- `animate?: boolean` (default: true)
- `stripes?: boolean` (default: true)

### ResizeSensor

Observes DOM resize events on a single child element. Thin wrapper around ResizeObserver.

```tsx
import { ResizeSensor, ResizeEntry } from "@blueprintjs/core";

<ResizeSensor onResize={(entries: ResizeEntry[]) => console.log(entries)}>
    <div style={{ width: dynamicWidth }} />
</ResizeSensor>
```

Child MUST be a native DOM element or use `React.forwardRef()`.

### Section

Container for structuring content with optional title, description, and collapsibility.

```tsx
import { Section, SectionCard } from "@blueprintjs/core";

<Section title="Settings" icon="cog" collapsible>
    <SectionCard>
        <p>Content here</p>
    </SectionCard>
    <SectionCard>
        <p>More content</p>
    </SectionCard>
</Section>
```

### SegmentedControl

Linear collection of buttons for choosing an option (like Radio but with button appearance).

```tsx
import { SegmentedControl } from "@blueprintjs/core";

<SegmentedControl
    options={[
        { label: "List", value: "list" },
        { label: "Grid", value: "grid" },
        { label: "Gallery", value: "gallery" },
    ]}
    defaultValue="list"
    onValueChange={handleChange}
/>
```

Supports controlled (`value`/`onValueChange`) and uncontrolled (`defaultValue`) usage.

### Skeleton

Loading state that mimics content shape. Apply `Classes.SKELETON` CSS class:

```tsx
import { Classes } from "@blueprintjs/core";

<div className={Classes.SKELETON}>Loading placeholder text</div>
```

The skeleton inherits dimensions of the element. Disable focusable elements when using skeleton class.

### Slider / RangeSlider / MultiSlider

Numeric input for choosing numbers between bounds.

```tsx
import { Slider, RangeSlider } from "@blueprintjs/core";

<Slider min={0} max={100} value={50} onChange={handleChange} />
<RangeSlider min={0} max={100} value={[25, 75]} onChange={handleChange} />
```

Slider props:
- `value?: number` (default: 0)
- `onChange?: (value: number) => void`
- `onRelease?: (value: number) => void`
- `initialValue?: number` (default: 0) - other end of track fill

Base slider props (shared):
- `min?: number` (default: 0)
- `max?: number` (default: 10)
- `stepSize?: number` (default: 1)
- `labelStepSize?: number`
- `labelValues?: number[]`
- `labelRenderer?: boolean | ((value: number) => string | JSX.Element)`
- `disabled?: boolean`
- `vertical?: boolean`
- `showTrackFill?: boolean` (default: true)
- `intent?: Intent`

RangeSlider uses `value: [number, number]`.

MultiSlider for custom multi-handle sliders:

```tsx
<MultiSlider onChange={handleChange}>
    <MultiSlider.Handle value={startValue} type="start" intentAfter="primary" />
    <MultiSlider.Handle value={endValue} type="end" />
</MultiSlider>
```

### Spinner

Circular progress indicator.

```tsx
import { Spinner, SpinnerSize } from "@blueprintjs/core";

<Spinner />  {/* indeterminate */}
<Spinner value={0.7} />  {/* determinate */}
<Spinner size={SpinnerSize.SMALL} intent="primary" />
```

Key props:
- `value?: number` - 0 to 1 (omit for indeterminate)
- `size?: number` - pixel width/height
  - `SpinnerSize.SMALL`
  - `SpinnerSize.STANDARD`
  - `SpinnerSize.LARGE`
- `intent?: Intent`
- `tagName?: string` (default: "div")

### Tabs

Switch between multiple panels of content.

```tsx
import { Tab, Tabs } from "@blueprintjs/core";

<Tabs id="myTabs" onChange={handleTabChange} selectedTabId={selectedTab}>
    <Tab id="tab1" title="First" panel={<Panel1 />} />
    <Tab id="tab2" title="Second" panel={<Panel2 />} />
    <Tab id="tab3" title="Third" panel={<Panel3 />} disabled />
    <Tabs.Expander />
    <input type="text" placeholder="Search..." />
</Tabs>
```

Tab selection is managed by `id`, not index.

Tabs props:
- `id: string` - unique identifier
- `selectedTabId?: TabId` - controlled mode
- `defaultSelectedTabId?: TabId` - uncontrolled mode
- `onChange?: (newTabId: TabId, prevTabId: TabId | undefined) => void`
- `vertical?: boolean`
- `animate?: boolean` (default: true) - animated indicator
- `renderActiveTabPanelOnly?: boolean` (default: false)

Tab props:
- `id: TabId` - unique identifier
- `title?: React.ReactNode` - tab label
- `panel?: JSX.Element` - content panel
- `icon?: IconName | MaybeElement`
- `disabled?: boolean`
- `tagContent?: React.ReactNode` - renders a Tag after title

### Tag

Lightweight visual container for short text strings.

```tsx
import { Tag } from "@blueprintjs/core";

<Tag intent="primary">Active</Tag>
<Tag icon="user" onRemove={handleRemove}>John</Tag>
<Tag round minimal>Label</Tag>
```

Key props:
- `intent?: Intent`
- `icon?: IconName | MaybeElement`
- `endIcon?: IconName | MaybeElement`
- `interactive?: boolean`
- `minimal?: boolean`
- `round?: boolean`
- `size?: "medium" | "large"`
- `fill?: boolean`
- `active?: boolean`
- `onRemove?: (e, tagProps) => void` - shows X button when defined
- `multiline?: boolean` (default: false)
- `onClick?: React.MouseEventHandler`

### CompoundTag

Key-value pair variant of Tag.

```tsx
import { CompoundTag } from "@blueprintjs/core";

<CompoundTag leftContent="Status" intent="success">Active</CompoundTag>
```

`leftContent` renders on the left side, `children` on the right side.

### Text

Adds accessible overflow behavior with ellipsis truncation and title attribute.

```tsx
import { Text } from "@blueprintjs/core";

<Text ellipsize>This long text will be truncated with an ellipsis</Text>
```

### Toast

Lightweight, ephemeral notice in response to user actions.

```tsx
import { OverlayToaster, Position } from "@blueprintjs/core";

// Create a singleton toaster (recommended pattern)
const AppToaster = OverlayToaster.create({
    position: Position.TOP,
});

// Show a toast
(await AppToaster).show({
    message: "File saved successfully.",
    intent: "success",
    icon: "tick",
    timeout: 5000,
});
```

Toast props:
- `message: React.ReactNode` - toast content
- `intent?: Intent`
- `icon?: IconName | MaybeElement`
- `timeout?: number` (default: 5000ms, 0 disables)
- `isCloseButtonShown?: boolean` (default: true)
- `action?: ActionProps & LinkProps` - action button
- `onDismiss?: (didTimeoutExpire: boolean) => void`

OverlayToaster methods:
- `show(props: ToastProps): string` - returns toast key
- `dismiss(key: string): void`
- `clear(): void`
- `getToasts(): ToastOptions[]`

React component usage:

```tsx
const toaster = React.useRef<OverlayToaster>(null);
<OverlayToaster position={Position.TOP_RIGHT} ref={toaster} />
// Then: toaster.current?.show({ message: "Toast!" });
```

### Tooltip

Lightweight popover for hover interactions.

```tsx
import { Tooltip, Button } from "@blueprintjs/core";

<Tooltip content="This is helpful info">
    <Button text="Hover me" />
</Tooltip>
```

Key props:
- `content: JSX.Element | string` - tooltip content
- `intent?: Intent`
- `compact?: boolean` (default: false)
- `placement?: Placement` (default: "auto")
- `hoverOpenDelay?: number` (default: 100)
- `hoverCloseDelay?: number` (default: 0)
- `interactionKind?: "hover" | "hover-target"` (default: "hover-target")
- `disabled?: boolean`
- `minimal?: boolean`

Use AnchorButton instead of Button if you need tooltips on disabled buttons.

Combining with Popover: Tooltip must be inside Popover (`Popover > Tooltip > target`).

### Tree

Hierarchical data display.

```tsx
import { Tree, TreeNodeInfo } from "@blueprintjs/core";

const nodes: TreeNodeInfo[] = [
    {
        id: 0,
        label: "Root",
        icon: "folder-close",
        isExpanded: true,
        childNodes: [
            { id: 1, label: "Child 1", icon: "document" },
            { id: 2, label: "Child 2", icon: "document" },
        ],
    },
];

<Tree
    contents={nodes}
    onNodeClick={handleNodeClick}
    onNodeExpand={handleNodeExpand}
    onNodeCollapse={handleNodeCollapse}
/>
```

TreeNodeInfo interface:
- `id: string | number` - unique identifier
- `label: string | JSX.Element`
- `icon?: IconName | MaybeElement`
- `secondaryLabel?: string | MaybeElement`
- `isExpanded?: boolean`
- `isSelected?: boolean`
- `disabled?: boolean`
- `hasCaret?: boolean`
- `childNodes?: TreeNodeInfo[]`
- `nodeData?: T` - custom user object
- `className?: string`

Tree callbacks receive `(node, nodePath, event)` where `nodePath` is an array of indices (e.g., `[2, 0]` = first child of third root).

---

## Form Controls

### FormGroup

Wrapper for form controls with label, helper text, and validation.

```tsx
import { FormGroup, InputGroup } from "@blueprintjs/core";

<FormGroup
    label="Username"
    labelFor="username-input"
    labelInfo="(required)"
    helperText="Enter your username"
    intent={hasError ? "danger" : undefined}
>
    <InputGroup id="username-input" placeholder="Enter username" />
</FormGroup>
```

Key props:
- `label?: React.ReactNode`
- `labelFor?: string` - associates with input
- `labelInfo?: React.ReactNode` - appears after label
- `helperText?: React.ReactNode` - below children
- `subLabel?: React.ReactNode` - below label
- `intent?: Intent` - colors helper text
- `disabled?: boolean`
- `inline?: boolean` - label and children on same line
- `fill?: boolean`

### ControlGroup

Groups multiple form controls into one unit.

```tsx
import { ControlGroup, Button, InputGroup } from "@blueprintjs/core";

<ControlGroup fill vertical={false}>
    <Button icon="filter">Filter</Button>
    <InputGroup placeholder="Find filters..." />
</ControlGroup>
```

ControlGroup vs InputGroup: ControlGroup is a parent with multiple children (separate controls). InputGroup is a single control with internal elements.

### Label

Wraps form inputs with labels. Prefer FormGroup over Label.

```tsx
import { Label, Classes } from "@blueprintjs/core";

<Label>
    Username
    <input className={Classes.INPUT} placeholder="Enter username" />
</Label>
```

### Checkbox

```tsx
import { Checkbox } from "@blueprintjs/core";

<Checkbox checked={isChecked} onChange={handleChange} label="Enable feature" />
<Checkbox indeterminate={true} label="Partial selection" />
```

Key props:
- `checked?: boolean`
- `defaultChecked?: boolean`
- `indeterminate?: boolean` - visual only third state
- `label?: React.ReactNode`
- `onChange?: React.FormEventHandler<HTMLInputElement>`
- `alignIndicator?: "left" | "right"` (or "start"/"end" for RTL)
- `inline?: boolean`
- `disabled?: boolean`
- `size?: "small" | "medium" | "large"`

### Radio / RadioGroup

```tsx
import { Radio, RadioGroup } from "@blueprintjs/core";

<RadioGroup
    label="Meal preference"
    onChange={handleChange}
    selectedValue={selectedMeal}
>
    <Radio label="Soup" value="soup" />
    <Radio label="Salad" value="salad" />
    <Radio label="Sandwich" value="sandwich" />
</RadioGroup>
```

RadioGroup props:
- `label?: React.ReactNode`
- `onChange: React.FormEventHandler<HTMLInputElement>`
- `selectedValue?: string | number`
- `inline?: boolean`
- `disabled?: boolean`

### Switch

Toggle control similar to Checkbox but with physical switch appearance.

```tsx
import { Switch } from "@blueprintjs/core";

<Switch checked={isDarkMode} onChange={handleToggle} label="Dark mode" />
<Switch innerLabel="off" innerLabelChecked="on" />
```

Key props:
- `checked?: boolean`
- `label?: React.ReactNode`
- `innerLabel?: string` - text inside switch when unchecked
- `innerLabelChecked?: string` - text inside switch when checked
- `alignIndicator?: Alignment`

### HTMLSelect

Styled native `<select>` dropdown.

```tsx
import { HTMLSelect } from "@blueprintjs/core";

<HTMLSelect
    options={["Option 1", "Option 2", "Option 3"]}
    onChange={handleChange}
/>

// Or with value/label objects:
<HTMLSelect
    options={[
        { label: "Choose...", value: "" },
        { label: "Option 1", value: "1" },
        { label: "Option 2", value: "2" },
    ]}
    value={selectedValue}
    onChange={handleChange}
/>
```

### SegmentedControl

(See Components section above)

---

## Form Inputs

### InputGroup

Text input with optional icons and buttons.

```tsx
import { InputGroup } from "@blueprintjs/core";

<InputGroup
    leftIcon="search"
    placeholder="Search..."
    rightElement={<Button icon="cross" variant="minimal" />}
    onChange={handleChange}
    value={query}
/>

<InputGroup type="password" leftIcon="lock" />
<InputGroup type="search" /> {/* automatically rounded */}
```

Key props:
- `leftIcon?: IconName | MaybeElement`
- `leftElement?: JSX.Element`
- `rightElement?: JSX.Element`
- `intent?: Intent`
- `size?: "small" | "medium" | "large"`
- `round?: boolean`
- `fill?: boolean`
- `disabled?: boolean`
- `readOnly?: boolean`
- `placeholder?: string`
- `value?: string` - controlled mode
- `onChange?: React.FormEventHandler`
- `asyncControl?: boolean` - for async state updates (e.g., redux-form)
- `type?: string` (default: "text")
- `inputRef?: React.Ref<HTMLInputElement>`

### TextArea

Multiline text input.

```tsx
import { TextArea } from "@blueprintjs/core";

<TextArea
    value={text}
    onChange={handleChange}
    fill
    growVertically
/>
```

### FileInput

Styled file upload input.

```tsx
import { FileInput } from "@blueprintjs/core";

<FileInput
    text={fileName || "Choose file..."}
    onInputChange={handleFileChange}
    disabled={false}
/>
```

Note: File name does NOT auto-update. You must update the `text` prop yourself.

### NumericInput

Numeric input with increment/decrement controls.

```tsx
import { NumericInput } from "@blueprintjs/core";

<NumericInput
    value={count}
    onValueChange={(valueAsNumber, valueAsString) => setCount(valueAsString)}
    min={0}
    max={100}
    stepSize={1}
/>
```

Key props:
- `value?: number | string` - in controlled mode, should be string
- `onValueChange?: (valueAsNumber: number, valueAsString: string, inputElement: HTMLInputElement | null) => void`
- `min?: number`
- `max?: number`
- `stepSize?: number` (default: 1)
- `majorStepSize?: number` (default: 10) - Shift+arrow
- `minorStepSize?: number | null` (default: 0.1) - Alt+arrow, null disables
- `clampValueOnBlur?: boolean` (default: false)
- `allowNumericCharactersOnly?: boolean` (default: true)
- `selectAllOnFocus?: boolean` (default: false)
- `selectAllOnIncrement?: boolean` (default: false)
- `fill?: boolean`
- `size?: "small" | "medium" | "large"`
- `leftIcon?, leftElement?, rightElement?` - like InputGroup

Keyboard: Up/Down = +/- stepSize, Shift+Up/Down = +/- majorStepSize, Alt+Up/Down = +/- minorStepSize.

Important: In controlled mode, use the string value (`valueAsString`) to allow typing decimal points and negative numbers.

### TagInput

Displays Tag elements inside an input field.

```tsx
import { TagInput } from "@blueprintjs/core";

<TagInput
    values={tags}
    onAdd={(values) => setTags([...tags, ...values])}
    onRemove={(value, index) => setTags(tags.filter((_, i) => i !== index))}
    onChange={(values) => setTags(values)}
    placeholder="Add tags..."
    leftIcon="tag"
/>
```

Key props:
- `values: readonly React.ReactNode[]` - tag values (required)
- `onAdd?: (values: string[], method: "default" | "blur" | "paste") => boolean | void`
- `onRemove?: (value: React.ReactNode, index: number) => void`
- `onChange?: (values: React.ReactNode[]) => boolean | void`
- `separator?: string | RegExp | false` (default: `/[,\n\r]/`)
- `addOnBlur?: boolean` (default: false)
- `addOnPaste?: boolean` (default: true)
- `inputValue?: string` - controlled input
- `onInputChange?: React.FormEventHandler`
- `tagProps?: TagProps | ((value, index) => TagProps)`
- `leftIcon?: IconName | MaybeElement`
- `rightElement?: JSX.Element`
- `fill?: boolean`
- `disabled?: boolean`
- `size?: "medium" | "large"`
- `autoResize?: boolean` (default: false)
- `placeholder?: string`

---

## Overlays

(Alert, ContextMenu, Dialog, Drawer, Popover, PopoverNext, Toast, Tooltip - see Components section above)

(Overlay2, Portal - see Components section above)

---

## Hooks

### useHotkeys

Register keyboard shortcuts in function components.

```tsx
import { useHotkeys, KeyComboTag } from "@blueprintjs/core";

function MyComponent() {
    const hotkeys = React.useMemo(() => [
        {
            combo: "R",
            global: true,
            label: "Refresh data",
            onKeyDown: () => console.info("Refreshing..."),
        },
        {
            combo: "mod+S",
            global: true,
            label: "Save",
            onKeyDown: () => handleSave(),
            preventDefault: true,
        },
        {
            combo: "F",
            group: "Input",
            label: "Focus input",
            onKeyDown: () => inputRef.current?.focus(),
        },
    ], []);

    const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);

    return (
        <div tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}>
            Press <KeyComboTag combo="R" /> to refresh
        </div>
    );
}
```

Important: The `hotkeys` array MUST be memoized.

Hotkeys must define a `group` (local) or be marked as `global: true`.
- Global hotkeys: bound to document, always active
- Local hotkeys: you must bind `handleKeyDown`/`handleKeyUp` to a focusable element

HotkeyConfig interface:
- `combo: string` - key combo (e.g., "mod+S", "shift+1", "ctrl+left")
- `label: string` - description shown in hotkeys dialog
- `global?: boolean` - global vs local
- `group?: string` - grouping in hotkeys dialog
- `onKeyDown?: (e: KeyboardEvent) => void`
- `onKeyUp?: (e: KeyboardEvent) => void`
- `preventDefault?: boolean` (default: false)
- `stopPropagation?: boolean` (default: false)
- `allowInInput?: boolean` (default: false)
- `disabled?: boolean`

Key combo syntax:
- Modifiers: `alt`/`option`, `ctrl`, `shift`, `meta`/`cmd`/`command`/`win`
- `mod` = `cmd` on Mac, `ctrl` on Windows/Linux
- Named keys: `plus`, `minus`, `backspace`, `tab`, `enter`/`return`, `esc`/`escape`, `space`, `pageup`, `pagedown`, `end`, `home`, `left`, `up`, `right`, `down`, `ins`, `del`
- Letters are case-insensitive. Spaces in combos are ignored.

### useOverlayStack

Internal hook for managing the global overlay stack. Used by Overlay2 internally.

---

# Icons Package

`@blueprintjs/icons` provides 500+ vector UI icons in 16px and 20px sizes, in SVG and font formats.

```sh
npm install --save @blueprintjs/icons
```

```tsx
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
```

## Loading Icons

Since Blueprint v5.0, icons are not loaded by default. Several loading strategies:

### 1. Static Imports (recommended for tree-shaking)

```tsx
import { Button } from "@blueprintjs/core";
import { Download } from "@blueprintjs/icons";

<Button text="Download" icon={<Download size={16} />} />
```

### 2. Dynamic Imports (string literal API)

```tsx
import { Button } from "@blueprintjs/core";

// Blueprint handles the import for you
<Button text="Download" icon="download" />
```

Requires bundler support for `await import()`. Default behavior: first usage triggers a network request to load the icon bundle for that size.

### 3. Load All Icons Upfront

```tsx
import { Icons } from "@blueprintjs/icons";
Icons.setLoaderOptions({ loader: "all" });
await Icons.loadAll();
```

### 4. Vite Configuration

```tsx
import { Icons, IconPaths } from "@blueprintjs/icons";

const iconModules = import.meta.glob(
    [
        "../node_modules/@blueprintjs/icons/lib/esm/generated/16px/paths/*.js",
        "../node_modules/@blueprintjs/icons/lib/esm/generated/20px/paths/*.js",
    ],
    { eager: true },
);

Icons.setLoaderOptions({
    loader: async (name, size) =>
        iconModules[
            `../node_modules/@blueprintjs/icons/lib/esm/generated/${size}px/paths/${name}.js`
        ].default,
});
```

### 5. Preload Specific Icons

```tsx
import { Icons } from "@blueprintjs/icons";
await Icons.load(["download", "caret-down", "endorsed", "help", "lock"]);
```

---

# Datetime Package

`@blueprintjs/datetime` provides date and time picker components.

```sh
npm install --save @blueprintjs/datetime
```

```tsx
import "@blueprintjs/datetime/lib/css/blueprint-datetime.css";
```

## DatePicker

Standalone calendar for selecting a single date.

```tsx
import { DatePicker } from "@blueprintjs/datetime";

<DatePicker
    value={selectedDate}
    onChange={(date, isUserChange) => setDate(date)}
    minDate={new Date(2020, 0, 1)}
    maxDate={new Date(2025, 11, 31)}
    highlightCurrentDay
    showActionsBar
/>
```

Key props:
- `value?: Date | null` - controlled mode
- `defaultValue?: Date` - uncontrolled mode
- `onChange?: (selectedDate: Date | null, isUserChange: boolean) => void`
- `minDate?: Date` (default: 20 years ago)
- `maxDate?: Date` (default: 6 months from now)
- `highlightCurrentDay?: boolean` (default: false)
- `showActionsBar?: boolean` (default: false) - Today/Clear buttons
- `shortcuts?: boolean | DatePickerShortcut[]`
- `timePrecision?: "minute" | "second" | "millisecond"` - adds time picker
- `timePickerProps?: TimePickerProps`
- `canClearSelection?: boolean` (default: true)
- `initialMonth?: Date`
- `reverseMonthAndYearMenus?: boolean` (default: false)
- `locale?: Locale | string` (default: "en-US")
- `dayPickerProps?: DayPickerSingleProps` - react-day-picker props
- `footerElement?: JSX.Element`

## DateInput

Text input with a DatePicker popover for forms.

```tsx
import { DateInput } from "@blueprintjs/datetime";

<DateInput
    value={dateStr}
    onChange={(newDate, isUserChange) => setDateStr(newDate)}
    dateFnsFormat="yyyy-MM-dd"
    placeholder="YYYY-MM-DD"
    showActionsBar
    closeOnSelection
/>
```

Key props:
- `value?: string | null` - ISO string
- `defaultValue?: string`
- `onChange?: (newDate: string | null, isUserChange: boolean) => void`
- `dateFnsFormat?: string` - date-fns format string (e.g., "yyyy-MM-dd")
- OR custom `formatDate` and `parseDate` functions
- `closeOnSelection?: boolean` (default: true)
- `disabled?: boolean`
- `fill?: boolean`
- `placeholder?: string`
- `inputProps?: Partial<InputGroupProps>`
- `showActionsBar?: boolean` (default: false)
- `shortcuts?: boolean | DatePickerShortcut[]`
- `showTimezoneSelect?: boolean` (default: false)
- `timezone?: string` - controlled timezone
- `defaultTimezone?: string`
- `onTimezoneChange?: (timezone: string) => void`
- `onError?: (errorDate: Date) => void`
- `invalidDateMessage?: string` (default: "Invalid date")
- `outOfRangeMessage?: string` (default: "Out of range")
- `popoverProps?: Partial<PopoverProps>`

## DateRangePicker

Calendar for selecting date ranges.

```tsx
import { DateRangePicker } from "@blueprintjs/datetime";

<DateRangePicker
    value={dateRange}
    onChange={(range) => setDateRange(range)}
    shortcuts
/>
```

## DateRangeInput

Two text inputs with a DateRangePicker popover.

```tsx
import { DateRangeInput } from "@blueprintjs/datetime";

<DateRangeInput
    value={dateRange}
    onChange={(range) => setDateRange(range)}
    dateFnsFormat="yyyy-MM-dd"
/>
```

## TimePicker

Time selection (hour, minute, second, millisecond).

```tsx
import { TimePicker, TimePrecision } from "@blueprintjs/datetime";

<TimePicker
    value={time}
    onChange={setTime}
    precision={TimePrecision.MINUTE}
    showArrowButtons
/>
```

Key props:
- `value?: Date`
- `defaultValue?: Date`
- `onChange?: (newTime: Date) => void`
- `precision?: "minute" | "second" | "millisecond"` (default: "minute")
- `showArrowButtons?: boolean` (default: false)
- `useAmPm?: boolean` (default: false)
- `minTime?: Date`
- `maxTime?: Date`
- `selectAllOnFocus?: boolean` (default: false)
- `disabled?: boolean`
- `autoFocus?: boolean`

## TimezoneSelect

Dropdown for selecting IANA timezones.

```tsx
import { TimezoneSelect } from "@blueprintjs/datetime";

<TimezoneSelect
    value={timezone}
    onChange={setTimezone}
    showLocalTimezone
/>
```

Key props:
- `value?: string` - IANA timezone code
- `onChange?: (timezone: string) => void`
- `showLocalTimezone?: boolean`
- `date?: Date` - used for UTC offset display
- `disabled?: boolean`
- `fill?: boolean`
- `placeholder?: string`

---

# Select Package

`@blueprintjs/select` provides components for selecting items from lists.

```sh
npm install --save @blueprintjs/select
```

```tsx
import "@blueprintjs/select/lib/css/blueprint-select.css";
```

## Select

Single-item selection from a filtered list in a popover.

```tsx
import { Button, MenuItem } from "@blueprintjs/core";
import { Select, ItemPredicate, ItemRenderer } from "@blueprintjs/select";

interface Film {
    title: string;
    year: number;
    rank: number;
}

const filterFilm: ItemPredicate<Film> = (query, film, _index, exactMatch) => {
    const normalizedTitle = film.title.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    if (exactMatch) return normalizedTitle === normalizedQuery;
    return `${film.rank}. ${normalizedTitle} ${film.year}`.indexOf(normalizedQuery) >= 0;
};

const renderFilm: ItemRenderer<Film> = (film, { handleClick, handleFocus, modifiers }) => {
    if (!modifiers.matchesPredicate) return null;
    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled}
            key={film.rank}
            label={film.year.toString()}
            onClick={handleClick}
            onFocus={handleFocus}
            roleStructure="listoption"
            text={`${film.rank}. ${film.title}`}
        />
    );
};

<Select<Film>
    items={TOP_100_FILMS}
    itemPredicate={filterFilm}
    itemRenderer={renderFilm}
    noResults={<MenuItem disabled text="No results." roleStructure="listoption" />}
    onItemSelect={setSelectedFilm}
>
    <Button
        text={selectedFilm?.title ?? "Select a film"}
        endIcon="double-caret-vertical"
    />
</Select>
```

Key props:
- `items: T[]` - all items
- `itemRenderer: ItemRenderer<T>` - renders each item
- `onItemSelect: (item: T) => void` - selection callback
- `itemPredicate?: ItemPredicate<T>` - filter per item
- `itemListPredicate?: ItemListPredicate<T>` - filter entire array
- `noResults?: React.ReactNode` - shown when no matches
- `initialContent?: React.ReactNode | null` - shown when query is empty
- `filterable?: boolean` (default: true) - show search input
- `query?: string` - controlled query
- `onQueryChange?: (query: string) => void`
- `activeItem?: T | CreateNewItem | null` - controlled active item
- `onActiveItemChange?: (activeItem: T | null, isCreateNewItem: boolean) => void`
- `disabled?: boolean`
- `fill?: boolean`
- `resetOnSelect?: boolean` (default: false)
- `resetOnClose?: boolean` (default: false)
- `popoverProps?: Partial<PopoverProps>`
- `createNewItemFromQuery?: (query: string) => T` - enable "create new" option
- `createNewItemRenderer?: (query, active, handleClick) => JSX.Element`
- `itemListRenderer?: ItemListRenderer<T>` - custom list rendering

ItemRenderer callback receives `(item, { handleClick, handleFocus, modifiers, query, ref })`. Remember to:
- Check `modifiers.matchesPredicate` to hide non-matching items
- Forward the `ref` to the rendered element
- Set a unique `key`

Disabling a Select requires both `disabled={true}` on Select AND disabling its children Button.

## Suggest

Like Select but renders an InputGroup as the trigger instead of arbitrary children.

```tsx
import { Suggest } from "@blueprintjs/select";

<Suggest<Film>
    items={films}
    itemPredicate={filterFilm}
    itemRenderer={renderFilm}
    inputValueRenderer={(film) => film.title}
    onItemSelect={setSelectedFilm}
    selectedItem={selectedFilm}
    noResults={<MenuItem disabled text="No results." roleStructure="listoption" />}
/>
```

Additional props:
- `inputValueRenderer: (item: T) => string` - converts item to input text
- `selectedItem?: T | null` - controlled selection
- `defaultSelectedItem?: T`
- `closeOnSelect?: boolean` (default: true)
- `openOnKeyDown?: boolean` (default: false)
- `resetOnClose?: boolean` (default: false)
- `inputProps?: Partial<InputGroupProps>`

## MultiSelect

Multiple item selection with TagInput.

```tsx
import { MultiSelect } from "@blueprintjs/select";

<MultiSelect<Film>
    items={films}
    itemPredicate={filterFilm}
    itemRenderer={renderFilm}
    tagRenderer={(film) => film.title}
    selectedItems={selectedFilms}
    onItemSelect={handleItemSelect}
    onRemove={handleRemove}
    onClear={handleClear}
    noResults={<MenuItem disabled text="No results." roleStructure="listoption" />}
/>
```

Additional props:
- `selectedItems: T[]` - controlled selected values
- `tagRenderer: (item: T) => React.ReactNode` - item to tag content
- `onRemove?: (item: T, index: number) => void`
- `onClear?: () => void` - shows clear button
- `openOnKeyDown?: boolean` (default: false)
- `placeholder?: string` (default: "Search...")
- `tagInputProps?: Partial<TagInputProps>`

## Omnibar

macOS Spotlight-style typeahead using Overlay.

```tsx
import { Omnibar } from "@blueprintjs/select";

<Omnibar<Film>
    isOpen={isOpen}
    items={films}
    itemPredicate={filterFilm}
    itemRenderer={renderFilm}
    onItemSelect={handleSelect}
    onClose={() => setIsOpen(false)}
/>
```

Fully controlled via `isOpen` prop.

## QueryList

Higher-order component providing query/item interactions. Used internally by Select, Suggest, MultiSelect, and Omnibar. Use directly for custom select UIs.

```tsx
import { QueryList } from "@blueprintjs/select";

<QueryList<Film>
    items={films}
    itemPredicate={filterFilm}
    itemRenderer={renderFilm}
    renderer={(listProps) => (
        <div>
            <InputGroup
                value={listProps.query}
                onChange={listProps.handleQueryChange}
            />
            <Menu ulRef={listProps.itemsParentRef}>
                {listProps.filteredItems.map(listProps.renderItem)}
            </Menu>
        </div>
    )}
/>
```

---

# Table Package

`@blueprintjs/table` provides a spreadsheet-like interactive table.

```sh
npm install --save @blueprintjs/table
```

```tsx
import "@blueprintjs/table/lib/css/table.css";
```

## Basic Usage

```tsx
import { Cell, Column, Table } from "@blueprintjs/table";

const dollarRenderer = (rowIndex: number) => <Cell>{`$${(rowIndex * 10).toFixed(2)}`}</Cell>;
const euroRenderer = (rowIndex: number) => <Cell>{`€${(rowIndex * 10 * 0.85).toFixed(2)}`}</Cell>;

<Table numRows={10}>
    <Column name="Dollars" cellRenderer={dollarRenderer} />
    <Column name="Euros" cellRenderer={euroRenderer} />
</Table>
```

The table is data-agnostic - it does not store data internally. You provide data through cell renderers.

## Table Props (key ones)

- `numRows?: number` - number of rows
- `children: Column[]` - Column components as children
- `columnWidths?: Array<number | null>` - controlled column widths
- `rowHeights?: Array<number | null>` - controlled row heights
- `enableColumnReordering?: boolean` (default: false)
- `enableColumnResizing?: boolean` (default: true)
- `enableRowReordering?: boolean` (default: false)
- `enableRowResizing?: boolean` (default: true)
- `enableRowHeader?: boolean` (default: true)
- `enableFocusedCell?: boolean` (default: false)
- `enableGhostCells?: boolean` (default: false)
- `enableMultipleSelection?: boolean` (default: true)
- `enableColumnHeader?: boolean` (default: true)
- `numFrozenColumns?: number` (default: 0)
- `numFrozenRows?: number` (default: 0)
- `selectedRegions?: Region[]` - controlled selection
- `selectionModes?: RegionCardinality[]` (default: SelectionModes.ALL)
- `loadingOptions?: TableLoadingOption[]`
- `cellRendererDependencies?: React.DependencyList` - triggers cell re-render on change
- `renderMode?: "batch" | "batch-on-update" | "none"` (default: "batch-on-update")
- `onSelection?: (selectedRegions: Region[]) => void`
- `onColumnWidthChanged?, onRowHeightChanged?` - resize callbacks
- `onColumnsReordered?, onRowsReordered?` - reorder callbacks
- `onFocusedCell?: (focusedCell: FocusedCellCoordinates) => void`
- `onVisibleCellsChange?: (rowIndices, columnIndices) => void`
- `getCellClipboardData?: (row, col) => any` - custom copy behavior
- `bodyContextMenuRenderer?: ContextMenuRenderer`
- `rowHeaderCellRenderer?: RowHeaderRenderer`

## Column Props

- `name?: string` - column header name
- `cellRenderer?: CellRenderer` - `(rowIndex: number, columnIndex: number) => Cell`
- `columnHeaderCellRenderer?: ColumnHeaderRenderer`
- `loadingOptions?: ColumnLoadingOption[]`
- `id?: string | number` - unique ID for width persistence
- `nameRenderer?: (name: string, index?: number) => React.ReactElement`

## Cell Component

```tsx
import { Cell } from "@blueprintjs/table";

const cellRenderer = (rowIndex: number) => (
    <Cell loading={isLoading} intent={rowIndex === 0 ? "primary" : undefined}>
        {data[rowIndex]}
    </Cell>
);
```

## Editable Components

- `EditableCell` - double-click-to-edit cells
- `EditableName` - click-to-edit column headers

```tsx
import { EditableCell, Column, Table } from "@blueprintjs/table";

const cellRenderer = (rowIndex: number) => (
    <EditableCell
        value={data[rowIndex]}
        onConfirm={(value) => handleCellEdit(rowIndex, value)}
    />
);
```

## Regions and Selection

```tsx
import { Regions, SelectionModes, RegionCardinality } from "@blueprintjs/table";

// Create regions
const cellRegion = Regions.cell(0, 0);           // { rows: [0,0], cols: [0,0] }
const rowRegion = Regions.row(0, 2);             // { rows: [0,2], cols: null }
const columnRegion = Regions.column(0);           // { rows: null, cols: [0,0] }
const tableRegion = Regions.table();              // { rows: null, cols: null }

// Selection modes
<Table selectionModes={SelectionModes.COLUMNS_AND_CELLS} />
<Table selectionModes={[RegionCardinality.FULL_ROWS]} />
```

## Features

- Sorting: Implement in `bodyContextMenuRenderer` or column header menus
- Freezing: `numFrozenColumns`, `numFrozenRows`
- Loading states: `loadingOptions` on Table and Column, `loading` on Cell
- Formatting: `TruncatedFormat` and `JSONFormat` components for long content
- Reordering: `enableColumnReordering`, `enableRowReordering`
- Re-rendering: Use `cellRendererDependencies` to trigger re-renders when data changes

## TruncatedFormat / JSONFormat

```tsx
import { Cell, TruncatedFormat, JSONFormat } from "@blueprintjs/table";

<Cell>
    <TruncatedFormat detectTruncation>{longString}</TruncatedFormat>
</Cell>

<Cell>
    <JSONFormat detectTruncation>{jsonObject}</JSONFormat>
</Cell>
```

---

# Labs Package

`@blueprintjs/labs` contains unstable/experimental components. Every minor version may break.

```sh
npm install --save @blueprintjs/labs
```

```tsx
import "@blueprintjs/labs/lib/css/blueprint-labs.css";
```

## Box

Generic layout component exposing CSS box-model and flexbox APIs as props.

```tsx
import { Box } from "@blueprintjs/labs";

<Box padding={4} margin={2} display="flex" gap={2}>
    <Box flex={1}>Left</Box>
    <Box flex={1}>Right</Box>
</Box>
```

Key props:
- Spacing: `margin`, `padding` and logical variants (`marginInline`, `paddingBlock`, etc.)
- Positioning: `position`, `inset` and logical variants
- Sizing: `width`, `height`
- Flexbox: `display`, `flex`, `flexDirection`, `flexWrap`, `gap`
- Alignment: `alignItems`, `alignContent`, `alignSelf`, `justifyContent`, `justifyItems`, `justifySelf`
- Overflow: `overflow`, `overflowX`, `overflowY`
- `asChild` - merge props onto single child element instead of rendering wrapper

## Flex

Specialized Box with `display="flex"` pre-applied.

```tsx
import { Flex } from "@blueprintjs/labs";

<Flex flexDirection="row" alignItems="center" justifyContent="space-between" gap={3}>
    <span>Left content</span>
    <span>Right content</span>
</Flex>

<Flex flexDirection="column" gap={2}>
    <div>Row 1</div>
    <div>Row 2</div>
</Flex>
```

Supports all Box props except `display`.

---

# Common Patterns

## Intent System

Many components support the `intent` prop for conveying purpose through color:

```tsx
type Intent = "none" | "primary" | "success" | "warning" | "danger";
```

- `"primary"` (blue) - main actions, elevated elements
- `"success"` (green) - successful operations, confirmations
- `"warning"` (orange) - warnings, caution
- `"danger"` (red) - errors, destructive actions

## Size System

Components that support sizing use:

```tsx
type Size = "small" | "medium" | "large";
```

Some components use `NonSmallSize = "medium" | "large"`.

## Controlled vs Uncontrolled

Most components support both patterns:
- Controlled: provide `value`/`isOpen` and `onChange`/`onClose`
- Uncontrolled: provide `defaultValue`/`defaultIsOpen`

## Classes Constants

```tsx
import { Classes } from "@blueprintjs/core";

Classes.DARK          // "bp5-dark"
Classes.ACTIVE        // "bp5-active"
Classes.DISABLED      // "bp5-disabled"
Classes.FILL          // "bp5-fill"
Classes.FIXED         // "bp5-fixed"
Classes.SKELETON      // "bp5-skeleton"
Classes.INPUT         // "bp5-input"
Classes.HEADING       // "bp5-heading"
Classes.RUNNING_TEXT  // "bp5-running-text"
Classes.POPOVER_DISMISS // "bp5-popover-dismiss"
```

## Accessibility

- Blueprint uses standard ARIA attributes
- Focus management is built into overlay components
- Keyboard navigation supported across all interactive components
- Color contrast meets WCAG 2.0 standards
- RTL support via logical properties

## OverlaysProvider Requirement

Components using Overlay2 (Dialog, Drawer, Popover, Alert, etc.) work best with OverlaysProvider in the React tree. Required in future major versions.

```tsx
import { BlueprintProvider } from "@blueprintjs/core";

// Simplest setup - wraps HotkeysProvider, OverlaysProvider, PortalProvider
<BlueprintProvider>
    <App />
</BlueprintProvider>
```
