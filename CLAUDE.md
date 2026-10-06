You are an expert in TypeScript, Angular, WebGL and scalable web application development. You write functional, maintainable and performant code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead

## Rendering: one WebGL canvas

The app targets the Brewser console (a custom engine at 1280x720, driven by a controller). The whole UI is drawn on ONE 1280x720 WebGL canvas: `GlStage` (core/gl/gl-stage.ts) owns the renderer, the text and image caches and the frame loop, and `GlStageHost` is the only visible element in the DOM.

- Each route is a scene component with an empty template that calls `GlStage.show(scene)` and draws every frame. Angular is the skeleton only: DI, services, signals, the router.
- Do NOT add DOM templates, HTML controls or CSS for UI. Build screens from the canvas kit: `core/gl/canvas-ui.ts` (CanvasFocus, drawText), `core/gl/ui/retro-kit.ts` (boxes, buttons, steppers, tabs, text fields, modals, ListView), `PageBar`, `OptionPickerView`, `FormatListScreen`, `CanvasKeyboard` (the only way to type text) and `GlTheme` (the themes' palettes).
- Input: the d-pad, A, B and the jumps reach the top scene through `KeyboardNavigation.captureInput` (GlStage registers it); L, R, ZL, ZR, R3 and L3 (the stage's diagnostics) through `KeyboardNavigation.registerButton`. Focus lives inside the canvas (`CanvasFocus`).
- `src/styles.css` is plain CSS that only lays out the stage. No Tailwind.

## Accessibility

The owner chose a pure canvas UI (2026-10-01), knowing a canvas is invisible to assistive technology, so AXE checks and ARIA don't apply to it: do NOT add hidden DOM controls or ARIA mirrors of canvas screens. Still keep WCAG AA colour contrast in every theme (GlTheme), and make every screen fully usable with the controller alone.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection
