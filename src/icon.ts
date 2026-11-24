// icon.ts: the four icons, as inline SVG.
//
// Where this file sits. These are small pieces of view with no behaviour.
// `src/view.ts` calls them and puts the result among an element's children.
// Read view.ts first. This file answers one question that it raises: how do
// you build Html where there is no `h`?
//
// The builder that a view function receives (`h`) exists only inside a view:
// the runtime passes it in, and application code cannot construct one. For
// markup built anywhere else, `foldkit/html` exports `inertHtml`. It is the
// same builder, typed with a Message type of `never`. Every element and
// attribute works, but an event handler cannot be written with it, because
// there is no Message it could be given. "Inert" means only that: the markup
// cannot send anything to `update`. An icon needs nothing more, and so these
// functions can be called from any view without being handed a builder.
//
// The alias `ih` is Foldkit's convention. It keeps the inert builder and a
// view's own `h` distinguishable wherever they are used (FOLDKIT.md, "View").
//
// The icons are from the Phosphor set, which the original Stem Shovel tuner
// uses (the design, "What is on screen").

// `Html` is the type of a virtual DOM node: what every view function returns.
import { type Html, inertHtml as ih } from 'foldkit/html'

// Every Phosphor icon is drawn on the same 256 by 256 grid.
const PHOSPHOR_VIEW_BOX = '0 0 256 256'

// Makes an icon out of its path data. It is a function that returns a
// function. `phosphor(path)` is called once for each icon, when this module
// loads. The function it returns is called by the view on every render, with
// the classes for that use: `Icon.power('h-[15px] w-[15px]')`. The classes
// give the icon its size, and a caller can add more (`animate-spin` on the
// spinner).
//
// `ih.svg` and `ih.path` are element functions like `h.div`: the builder
// covers SVG elements as well as HTML ones. The attributes:
//
//   AriaHidden(true)      the icons are decoration. The control an icon sits
//                         in has a name of its own (visible text, or an
//                         `aria-label`), so assistive technology should skip
//                         the picture.
//   Class(className)      the caller's classes.
//   Xmlns, ViewBox        the SVG namespace and the icon's coordinate grid.
//   Fill('currentColor')  paints the icon in the text colour of whatever it
//                         sits in, so the `text-...` class on a button colours
//                         its icon as well.
//   D(path)               on the <path>: the shape itself.
const phosphor =
  (path: string) =>
  (className: string): Html =>
    ih.svg(
      [
        ih.AriaHidden(true),
        ih.Class(className),
        ih.Xmlns('http://www.w3.org/2000/svg'),
        ih.ViewBox(PHOSPHOR_VIEW_BOX),
        ih.Fill('currentColor'),
      ],
      [ih.path([ih.D(path)])],
    )

// The On / Off button's icon.
export const power = phosphor(
  'M120 128V48a8 8 0 0 1 16 0v80a8 8 0 0 1-16 0m60.37-78.7a8 8 0 0 0-8.74 13.4C194.74 77.77 208 101.57 208 128a80 80 0 0 1-160 0c0-26.43 13.26-50.23 36.37-65.3a8 8 0 0 0-8.74-13.4C47.9 67.38 32 96.06 32 128a96 96 0 0 0 192 0c0-31.94-15.9-60.62-43.63-78.7',
)

// Takes the power icon's place while the tuner is starting. The shape is a
// ring with a gap. The view adds `animate-spin` to turn it.
export const spinner = phosphor(
  'M232 128a104 104 0 0 1-208 0c0-41 23.81-78.36 60.66-95.27a8 8 0 0 1 6.68 14.54C60.15 61.59 40 93.27 40 128a88 88 0 0 0 176 0c0-34.73-20.15-66.41-51.34-80.73a8 8 0 0 1 6.68-14.54C208.19 49.64 232 87 232 128',
)

// The caret at the right of the tuning picker's button.
export const caretDown = phosphor(
  'm213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32',
)

// The three dots on the settings menu's button.
export const dotsThreeVertical = phosphor(
  'M140 128a12 12 0 1 1-12-12a12 12 0 0 1 12 12m-12-56a12 12 0 1 0-12-12a12 12 0 0 0 12 12m0 112a12 12 0 1 0 12 12a12 12 0 0 0-12-12',
)
