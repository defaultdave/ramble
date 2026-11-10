// The photo pool manifest: what each curated experience's generated pictures show, in the
// order they are stored. Position 0 is the cover, and the count per experience (3 to 5) is the number
// of lines here. The seed draws every picture itself from arithmetic (src/lib/seed/testPhotoArt.ts),
// so there is no third-party art and no file to license. They are flat illustrations that stand in for
// the photography Ramble's own team shoots, so each caption describes the scene the picture draws and
// the stored alt text opens with "Illustration:". Rights: Ramble owned, generated test image.

export const photoPoolRights = {
  rightsBasis: 'ramble_owned',
  rightsHolder: 'Ramble (generated test image)',
} as const;

export const photoManifest: Readonly<Record<string, readonly string[]>> = {
  // The coverage set.
  'sunset-kayak-on-the-hudson': [
    'A single kayak on calm water with a gold sun low over the skyline.',
    'Paddles and life jackets lined up on the dock at the Pier 26 boathouse.',
    'A small group paddling a slow loop past the piers as the sky turns pink.',
    'A paddle blade dipping into still water with rings spreading out.',
    'Dry bags and a lifejacket on a wooden bench, ready for the lesson on the dock.',
  ],
  'kids-wheel-class': [
    'A small bowl on a pottery wheel in warm studio light.',
    'Rows of child-sized aprons on pegs beside a low sink.',
    'Three finished bowls in different glazes lined up on a shelf.',
  ],
  'little-bakers-cookie-club': [
    'A tray of round cookies with colorful sprinkles on a small kitchen counter.',
    'A rolling pin, cutters, and a scatter of flour on a wooden table.',
    'A white cookie box tied with string beside a child-sized apron.',
  ],
  'natural-wine-explained': [
    'A glass of red wine on a zinc bar with a row of bottles behind it.',
    'Six small pours lined up on a tasting mat beside bread and cheese.',
    'Hand-written tasting notes next to an open bottle.',
    'A twelve-seat wine bar with warm lamps and a chalkboard list.',
  ],
  'hand-rolled-pasta-in-carroll-gardens': [
    'A nest of fresh pasta dough on a floured wooden board.',
    'Two hand-cut pasta shapes drying on a rack.',
    'A bowl of finished pasta with sauce at a shared table.',
    'A teaching kitchen with copper pots on a rail and aprons on hooks.',
    'A rolling pin and a bench scraper beside a mound of flour.',
  ],
  'dumpling-folding-in-sunset-park': [
    'A bamboo steamer of pleated dumplings with steam rising.',
    'Hands pinching a pleat into a round of dough on a floured table.',
    'A box of frozen dumplings packed to take home.',
  ],
  'wheel-throwing-for-beginners': [
    'A lump of clay centered on a spinning wheel beneath two wet hands.',
    'A row of mugs waiting to dry on a studio shelf.',
    'A glazed mug on a windowsill in morning light.',
    'Pottery tools and a sponge on a clay-spattered table.',
  ],
  'cast-iron-and-cobblestones': [
    'A row of iron-columned warehouse fronts on a cobblestone street.',
    'A loading dock with a heavy iron door and a faded painted sign.',
    'A walking group pausing at a street corner while the guide points up.',
  ],
  'sunday-sound-bath': [
    'Concentric rings in soft light, like the ripple of a struck bowl.',
    'Crystal and metal singing bowls arranged on a rug.',
    'Mats, blankets, and bolsters laid out in a dim, quiet room.',
  ],
  'coffee-cupping-in-williamsburg': [
    'A row of small cups on a cupping table with spoons beside each one.',
    'A bag of whole beans beside a hand grinder.',
    'A tray of pastries next to a pour-over setup.',
  ],
  'sourdough-mornings-at-rise-bakery': [
    'A round sourdough loaf with a crisp, scored crust on a cooling rack.',
    'A jar of bubbly starter beside a dough scraper.',
    'Bakers shaping loaves at a flour-dusted counter.',
  ],
  'fresh-mozzarella-night': [
    'A ball of fresh mozzarella in a bowl of warm water.',
    'Hands stretching warm curd over a steel pot.',
    'A plate of sliced mozzarella with tomatoes and basil.',
  ],
  'rooftop-sunrise-yoga': [
    'Concentric rings of orange light rising behind a rooftop water tower.',
    'Yoga mats set in a row on a roof as the sky brightens.',
    'A figure in a seated pose against a pale morning skyline.',
  ],
  'winter-paddle-series': [
    'A kayak on dark winter water under a low, cold sun.',
    'Dry suits hanging in a boathouse beside a stack of paddles.',
    'A steaming thermos on the dock at dawn.',
  ],
  // Makers.
  'hand-built-planters': [
    'A small clay planter holding a fresh herb on a sunny windowsill.',
    'Coils and slabs of clay laid out on a worktable.',
    'Three finished planters in different glazes in a row.',
  ],
  'block-printed-tote-night': [
    'A canvas tote printed with a repeating leaf pattern.',
    'A carved rubber stamp and a tray of ink on a table.',
    'Rolls of fabric and a wall of ink-stained aprons.',
  ],
  'visible-mending-afternoon': [
    'A knit sweater with a bright stitched patch at the elbow.',
    'Colorful thread and a darning mushroom on a wooden table.',
    'A shared table of people mending with needles in hand.',
  ],
  'glaze-your-own-dinner-plates': [
    'Four plain white bisque plates waiting to be painted.',
    'A wall of glaze test tiles in every color.',
    'A painted dinner plate drying on a rack.',
  ],
  'sunday-sauce-for-a-crowd': [
    'A large pot of red sauce simmering on a stove with a wooden spoon.',
    'Meatballs rolled and lined up on a tray.',
    'A long lunch table with bread, a bowl of sauce, and glasses.',
  ],
  'bao-bun-basics': [
    'A stack of soft white bao buns in a bamboo steamer.',
    'Hands folding a round of dough around a filling.',
    'A long table with trays of dough and bowls of filling.',
  ],
  'pickles-and-ferments-workshop': [
    'Three jars of brightly colored pickles on a counter.',
    'Sliced cucumbers, salt, and spices ready to be packed.',
    'A hand pressing cabbage into a jar.',
  ],
  'stirred-not-shaken-cocktail-class': [
    'A stirred cocktail in a coupe glass with a twist of citrus peel.',
    'A mixing glass, bar spoon, and jigger on a bar top.',
    'A back room with a bar and stools set for a class.',
  ],
  'amaro-and-aperitivo-hour': [
    'Six small glasses of amber and ruby liquids in a row.',
    'Bottles of herbal liqueur on a shelf with hand-written labels.',
    'A snack board with olives, nuts, and sliced cheese.',
  ],
  'three-grapes-one-night': [
    'Three glasses of white wine side by side in the same light.',
    'Three bottles from three producers with their labels turned out.',
    'A tasting mat with nine small pours and bread in the middle.',
  ],
  'dumpling-crawl-on-eighth-avenue': [
    'A paper tray of pan-fried dumplings at a street-front counter.',
    'A busy avenue with shop awnings and a guide holding a small flag.',
    'Steaming baskets stacked behind a counter window.',
    'A hand holding a dumpling with chopsticks over a dipping dish.',
    'A printed map with five stops circled in red.',
  ],
  'latte-art-basics': [
    'A cup of coffee with a heart poured in white milk foam.',
    'A barista tilting a steaming pitcher over a cup.',
    'A row of practice cups on a bar, each with a different pattern.',
  ],
  'home-espresso-clinic': [
    'An espresso machine pulling a dark shot into a small cup.',
    'A grinder and a tamper on a bar top beside a scale.',
    'A paper bag of roasted beans with a hand-stamped label.',
  ],
  'cheese-counter-tasting': [
    'A board of six cheeses with small knives and sliced bread.',
    'A cheese counter under a blue awning with wheels stacked in the window.',
    'A jar of pickles and a wedge of cheese wrapped in paper.',
  ],
  // Walks, outdoors, wellness, kids.
  'lower-east-side-stoop-stories': [
    'A row of tenement stoops with fire escapes above them.',
    'A bakery window with a tray of fresh pastries.',
    'A walking group gathered on a corner while the guide tells a story.',
  ],
  'sunset-park-side-streets-walk': [
    'A colorful mural on the side of a brick building on a quiet street.',
    'A hillside park with a skyline view in the distance.',
    'A pot of tea and small cups on a table at the end of the walk.',
  ],
  'park-slope-brownstone-walk': [
    'A row of brownstones with tall stoops and carved cornices.',
    'A close view of a stone doorway with a bold front door.',
    'The edge of a park with a view down a tree-lined hill.',
  ],
  'waterfront-bike-ride-from-sunset-park': [
    'Bicycles leaning on a railing beside the water on a bright morning.',
    'A cyclist on a protected bike path with the harbor beyond.',
    'Helmets and water bottles lined up on a bench.',
  ],
  'twilight-pedal-along-the-waterfront': [
    'A bike path along the river with the city lights coming on.',
    'A cyclist silhouetted against an orange evening sky.',
    'A bicycle bell and handlebar in warm dusk light.',
  ],
  'learn-to-kayak-in-the-cove': [
    'A kayak resting on flat, sheltered water beside a dock.',
    'A paddle held across a boat, showing the right grip.',
    'A guide on the dock demonstrating a stroke to a small group.',
  ],
  'saturday-morning-at-the-stoop-garden': [
    'Raised garden beds full of leafy greens in morning sun.',
    'A basket of freshly picked vegetables beside a pair of gloves.',
    'A volunteer watering rows of seedlings with a can.',
    'A garden gate with a hand-painted sign on a city avenue.',
    'A glass of lemonade on a wooden bench in the garden.',
  ],
  'candlelit-restorative-yoga': [
    'A softly lit room with mats, bolsters, and a few candles.',
    'A figure resting on a bolster under a blanket.',
    'Eye pillows and folded blankets stacked on a shelf.',
  ],
  'garden-meditation-morning': [
    'Cushions set among raised beds in early light.',
    'A figure sitting in stillness beside a row of green plants.',
    'A pot of tea and cups on a table in the garden.',
  ],
  'little-bakers-pizza-night': [
    'A small pizza with sauce and cheese on a child-sized board.',
    'Dough being stretched on a floured counter by small hands.',
    'A row of children in aprons at a counter, each with a pizza.',
  ],
  'family-paddle-sunday': [
    'A tandem kayak with a child and an adult paddling on calm water.',
    'Child-sized life jackets hanging in a row on the dock.',
    'A guide in a boat close beside a family paddling.',
  ],
  'kids-dumpling-saturday': [
    'A tray of small, lopsided dumplings made by children.',
    'Small hands folding a pleat in a round of dough.',
    'A low table with stools and bowls of filling.',
  ],
  'sew-a-hand-puppet': [
    'A felt hand puppet with button eyes and a stitched smile.',
    'A table of colorful felt pieces, buttons, and blunt needles.',
    'Three finished puppets on a shelf in different colors.',
  ],
  // Guide entries.
  'letterpress-card-night-at-quill-and-ink': [
    'A stack of freshly printed cards beside an iron letterpress.',
    'Drawers of metal type in a one-room print shop.',
    'A hand inking a roller above a locked-up block of type.',
  ],
  'bookbinding-afternoon-at-quill-and-ink': [
    'A small notebook with a linen spine and a sewn binding.',
    'A bone folder, needle, and waxed thread on a worktable.',
    'A stack of heavy paper sheets folded and ready to sew.',
  ],
  'oyster-shucking-lesson-at-old-pier': [
    'A platter of oysters on crushed ice with lemon wedges.',
    'A hand holding an oyster knife at the hinge of a shell.',
    'A narrow raw bar with stools under warm pendant lights.',
  ],
  'martinis-and-a-short-history': [
    'Three martinis in chilled glasses with olives and a twist.',
    'A mixing glass with ice and a long bar spoon.',
    'A dark wood bar with a row of vintage glasses behind it.',
  ],
  'saturday-easy-run-in-sunset-park': [
    'A group of runners on a tree-lined hill in early light.',
    'Running shoes on a sidewalk at the starting corner.',
    'A hillside park with a skyline view at the top of the climb.',
  ],
  'post-run-stretch-on-the-grass': [
    'A few people stretching on a lawn in morning sun.',
    'Yoga mats scattered on the grass beside a water bottle.',
    'A thermos of coffee and paper cups on a park bench.',
  ],
  'long-table-supper-in-williamsburg': [
    'A long wooden table set with plates, candles, and bowls of food.',
    'A home cook carrying a steaming dish to the table.',
    'A market tote of seasonal vegetables on a kitchen counter.',
  ],
  'pie-crust-morning-in-williamsburg': [
    'A small pie with a crimped, golden crust on a cooling rack.',
    'A rolling pin and a disc of pastry dough on a floured board.',
    'Hands crimping the edge of a pie crust.',
  ],
  'kids-pizza-saturday-in-carroll-gardens': [
    'A row of personal pizzas on a home kitchen counter.',
    'A child sprinkling cheese over a small pizza.',
    'A pot of coffee and mugs set out for the grown-ups.',
  ],
};
