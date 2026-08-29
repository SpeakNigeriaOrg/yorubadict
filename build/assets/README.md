# Source art

## og-image.svg → public/og-image.png

The social preview card. Committed as a PNG because that is what Facebook,
WhatsApp, Slack and Twitter accept; the SVG here is what it was drawn from.

Regenerate (macOS, no dependencies):

    qlmanage -t -s 1200 -o /tmp build/assets/og-image.svg
    sips -c 630 1200 /tmp/og-image.svg.png --out public/og-image.png

Two things about the file will look strange until you know why:

- It is 1200×1200 with the card centred in the middle 630 rows, rather than
  1200×630. qlmanage always renders to a square canvas, and sips can only crop
  from the centre, so the padding is what makes an exact 1200×630 crop possible.

- It says "Yorùbá Dictionary" rather than "Sọ̀rọ̀ Sókè". qlmanage does not stack
  combining marks: ọ̀ is ọ plus U+0300 and there is no precomposed character for
  it, so the name rendered as "Sọ`rọ` Sókè" with the accents detached and beside
  the letters. On a Yorùbá dictionary that is worse than not showing the name.
  ù and á are precomposed and render correctly, which is why they are here.
  The name still reaches every preview through og:title, which the platform sets
  in a real font that shapes properly.
