import { type Html, inertHtml as ih } from 'foldkit/html'

const PHOSPHOR_VIEW_BOX = '0 0 256 256'

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

export const power = phosphor(
  'M120 128V48a8 8 0 0 1 16 0v80a8 8 0 0 1-16 0m60.37-78.7a8 8 0 0 0-8.74 13.4C194.74 77.77 208 101.57 208 128a80 80 0 0 1-160 0c0-26.43 13.26-50.23 36.37-65.3a8 8 0 0 0-8.74-13.4C47.9 67.38 32 96.06 32 128a96 96 0 0 0 192 0c0-31.94-15.9-60.62-43.63-78.7',
)

export const spinner = phosphor(
  'M232 128a104 104 0 0 1-208 0c0-41 23.81-78.36 60.66-95.27a8 8 0 0 1 6.68 14.54C60.15 61.59 40 93.27 40 128a88 88 0 0 0 176 0c0-34.73-20.15-66.41-51.34-80.73a8 8 0 0 1 6.68-14.54C208.19 49.64 232 87 232 128',
)

export const caretDown = phosphor(
  'm213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32',
)

export const dotsThreeVertical = phosphor(
  'M140 128a12 12 0 1 1-12-12a12 12 0 0 1 12 12m-12-56a12 12 0 1 0-12-12a12 12 0 0 0 12 12m0 112a12 12 0 1 0 12 12a12 12 0 0 0-12-12',
)
