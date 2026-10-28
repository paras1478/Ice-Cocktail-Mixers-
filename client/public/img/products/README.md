Drop licensed, exact-product photos here (lowercase file names; paths are case-sensitive on Linux), e.g.

  bisleri-club-soda-750ml.jpg
  schweppes-indian-tonic-water-300ml.jpg

Then set them in Admin -> Products -> Edit -> Images:
  Image URL / path : /img/products/bisleri-club-soda-750ml.jpg
  Alt text         : Bisleri Club Soda, 750 ml bottle
  Untick "Stand-in" and fill "Photo source URL" + "Licence / permission" (required for a real photo).

The form previews the image and reports if it cannot load. Afterwards run `npm run catalog:check-images` in server/.
