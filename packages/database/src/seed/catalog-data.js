// Demo catalog for development (DECISIONS D-44): fictional Unjha restaurants with realistic menus.
// Prices are illustrative, in paise. Most restaurants are pure veg, reflecting the town. Every name and
// document number here is made up.

/** Platform food categories (taxonomy). */
export const DEMO_CATEGORIES = [
  ['thali', 'Thali'],
  ['gujarati', 'Gujarati'],
  ['punjabi', 'Punjabi'],
  ['chinese', 'Chinese'],
  ['pizza', 'Pizza'],
  ['south-indian', 'South Indian'],
  ['street-food', 'Street food'],
  ['farsan', 'Farsan & snacks'],
  ['sweets', 'Sweets'],
  ['ice-cream', 'Ice cream'],
  ['beverages', 'Beverages'],
  ['bakery', 'Bakery'],
  ['sandwiches', 'Sandwiches'],
  ['breakfast', 'Breakfast'],
];

/** Reusable add-on groups: [name, min, max, [[option, paise, foodType?], …]]. */
const G = {
  JAIN: [
    'Preparation',
    1,
    1,
    [
      ['Regular', 0],
      ['Jain (no onion, no garlic)', 0],
    ],
  ],
  ROTI: [
    'Extras',
    0,
    3,
    [
      ['Butter roti', 2500],
      ['Butter naan', 4000],
      ['Papad', 1500],
    ],
  ],
  BUTTER: ['Add butter', 0, 1, [['Amul butter', 2000]]],
  CHEESE: ['Add cheese', 0, 1, [['Extra cheese', 3000]]],
  CRUST: [
    'Crust',
    1,
    1,
    [
      ['Classic hand-tossed', 0],
      ['Thin crust', 0],
      ['Cheese burst', 6000],
    ],
  ],
  TOPPINGS: [
    'Extra toppings',
    0,
    4,
    [
      ['Onion', 2000],
      ['Capsicum', 2000],
      ['Sweet corn', 2500],
      ['Paneer', 4000],
      ['Jalapeño', 3000],
    ],
  ],
  DIP: [
    'Dips',
    0,
    2,
    [
      ['Mayonnaise', 1500],
      ['Schezwan sauce', 1500],
    ],
  ],
  SCOOP: [
    'Add a scoop',
    0,
    2,
    [
      ['Vanilla', 4000],
      ['Chocolate', 5000],
      ['Kesar pista', 6000],
    ],
  ],
  SPICE: [
    'Spice level',
    1,
    1,
    [
      ['Mild', 0],
      ['Medium', 0],
      ['Spicy', 0],
    ],
  ],
  EGG: [
    'Add egg',
    0,
    2,
    [
      ['Extra boiled egg', 1500, 'EGG'],
      ['Extra omelette layer', 2500, 'EGG'],
    ],
  ],
};

const lunchDinner = (days = [0, 1, 2, 3, 4, 5, 6]) =>
  days.flatMap((d) => [
    [d, '11:00', '15:00'],
    [d, '18:30', '23:00'],
  ]);
const allDay = (open, close) => [0, 1, 2, 3, 4, 5, 6].map((d) => [d, open, close]);

/**
 * Item: { n: name, p: price | v: [[variant, price], …] (first = default), c: category slug, d: description,
 *         a: add-on group keys, t: food type (default VEG), best, rec, feat, s: schedule rows, off: sold out }
 */
export const DEMO_RESTAURANTS = [
  {
    slug: 'demo-kitchen',
    name: 'Jamzo Demo Kitchen',
    status: 'ACTIVE',
    cuisines: ['Gujarati', 'North Indian'],
    isPureVeg: true,
    phone: '+919000000101',
    branch: { area: 'Station Road', lat: 23.8045, lng: 72.3925, radiusM: 4000 },
    hours: lunchDinner(),
    menu: [
      [
        'Thalis',
        [
          {
            n: 'Gujarati Thali',
            v: [
              ['Regular', 18000],
              ['Unlimited', 25000],
            ],
            c: 'thali',
            d: 'Dal, kadhi, two shaaks, rotli, rice, farsan and a sweet.',
            a: ['JAIN'],
            best: true,
          },
          {
            n: 'Kathiyawadi Thali',
            p: 22000,
            c: 'thali',
            d: 'Sev tameta, ringan olo, bajra rotla, chaas.',
            a: ['JAIN'],
          },
        ],
      ],
      [
        'Main course',
        [
          {
            n: 'Paneer Butter Masala',
            v: [
              ['Half', 14000],
              ['Full', 22000],
            ],
            c: 'punjabi',
            a: ['JAIN', 'ROTI'],
            rec: true,
          },
          { n: 'Dal Tadka', p: 12000, c: 'punjabi', a: ['JAIN', 'ROTI'] },
          { n: 'Sev Tameta nu Shaak', p: 11000, c: 'gujarati', a: ['ROTI'] },
          { n: 'Kadhi Khichdi', p: 10000, c: 'gujarati', a: ['JAIN'] },
          { n: 'Undhiyu (winter special)', p: 16000, c: 'gujarati', off: true },
        ],
      ],
      ['Desserts', [{ n: 'Gulab Jamun (2 pcs)', p: 5000, c: 'sweets' }]],
      [
        'Drinks',
        [
          { n: 'Masala Chaas', p: 3000, c: 'beverages' },
          { n: 'Fresh Lime Soda', p: 5000, c: 'beverages' },
        ],
      ],
    ],
  },
  {
    slug: 'umiya-thali-house',
    name: 'Umiya Thali House',
    status: 'ACTIVE',
    cuisines: ['Gujarati', 'Thali'],
    isPureVeg: true,
    phone: '+919000000102',
    branch: { area: 'Ganj Bazar', lat: 23.8068, lng: 72.3962, radiusM: 5000 },
    hours: lunchDinner(),
    menu: [
      [
        'Thalis',
        [
          {
            n: 'Fixed Gujarati Thali',
            p: 16000,
            c: 'thali',
            d: 'Rotli, dal, bhaat, two shaaks, kathol, farsan, sweet, chaas.',
            a: ['JAIN'],
            best: true,
          },
          { n: 'Unlimited Gujarati Thali', p: 23000, c: 'thali', a: ['JAIN'], feat: true },
          { n: 'Mini Thali', p: 11000, c: 'thali', a: ['JAIN'] },
        ],
      ],
      [
        'Sweets',
        [
          {
            n: 'Shrikhand',
            v: [
              ['250 g', 9000],
              ['500 g', 17000],
            ],
            c: 'sweets',
          },
          {
            n: 'Mohanthal',
            v: [
              ['250 g', 12000],
              ['500 g', 23000],
            ],
            c: 'sweets',
          },
          { n: 'Basundi', p: 8000, c: 'sweets' },
        ],
      ],
      [
        'Farsan',
        [
          { n: 'Khaman', p: 6000, c: 'farsan' },
          { n: 'Patra', p: 7000, c: 'farsan' },
          { n: 'Handvo', p: 8000, c: 'farsan' },
        ],
      ],
      [
        'Drinks',
        [
          { n: 'Chaas', p: 2500, c: 'beverages' },
          { n: 'Aam Ras (seasonal)', p: 9000, c: 'beverages', off: true },
        ],
      ],
    ],
  },
  {
    slug: 'khodiyar-punjabi-dhaba',
    name: 'Shree Khodiyar Punjabi Dhaba',
    status: 'ACTIVE',
    cuisines: ['Punjabi', 'North Indian'],
    isPureVeg: true,
    phone: '+919000000103',
    branch: { area: 'Highway Road', lat: 23.8245, lng: 72.3905, radiusM: 6000 },
    hours: lunchDinner(),
    menu: [
      [
        'Starters',
        [
          { n: 'Paneer Tikka', p: 18000, c: 'punjabi', a: ['SPICE'], best: true },
          { n: 'Hara Bhara Kebab', p: 14000, c: 'punjabi' },
          { n: 'Veg Crispy', p: 13000, c: 'chinese', a: ['SPICE'] },
        ],
      ],
      [
        'Main course',
        [
          {
            n: 'Kaju Curry',
            v: [
              ['Half', 15000],
              ['Full', 24000],
            ],
            c: 'punjabi',
            a: ['JAIN', 'ROTI'],
          },
          {
            n: 'Veg Kolhapuri',
            v: [
              ['Half', 13000],
              ['Full', 21000],
            ],
            c: 'punjabi',
            a: ['SPICE', 'ROTI'],
          },
          { n: 'Dal Makhani', p: 16000, c: 'punjabi', a: ['BUTTER', 'ROTI'], rec: true },
          { n: 'Paneer Bhurji', p: 17000, c: 'punjabi', a: ['JAIN', 'ROTI'] },
        ],
      ],
      [
        'Breads & rice',
        [
          { n: 'Tandoori Roti', p: 2000, c: 'punjabi', a: ['BUTTER'] },
          { n: 'Garlic Naan', p: 5000, c: 'punjabi' },
          { n: 'Jeera Rice', p: 11000, c: 'punjabi' },
          { n: 'Veg Biryani', p: 17000, c: 'punjabi', a: ['SPICE'] },
        ],
      ],
    ],
  },
  {
    slug: 'dragon-wok-unjha',
    name: 'Dragon Wok Unjha',
    status: 'ACTIVE',
    cuisines: ['Chinese', 'Indo-Chinese'],
    isPureVeg: true,
    phone: '+919000000104',
    branch: { area: 'Kamli Road', lat: 23.8012, lng: 72.3998, radiusM: 4500 },
    hours: allDay('12:00', '23:30'),
    menu: [
      [
        'Soups',
        [
          { n: 'Manchow Soup', p: 9000, c: 'chinese', a: ['SPICE'] },
          { n: 'Hot & Sour Soup', p: 9000, c: 'chinese', a: ['SPICE'] },
          { n: 'Sweet Corn Soup', p: 8500, c: 'chinese' },
        ],
      ],
      [
        'Starters',
        [
          { n: 'Veg Manchurian (dry)', p: 13000, c: 'chinese', a: ['SPICE'], best: true },
          { n: 'Chilli Paneer', p: 16000, c: 'chinese', a: ['SPICE'] },
          { n: 'Spring Rolls', p: 12000, c: 'chinese', a: ['DIP'] },
          { n: 'Crispy Honey Potato', p: 12000, c: 'chinese' },
          { n: 'Manchurian Gravy', p: 14000, c: 'chinese', a: ['JAIN', 'SPICE'] },
        ],
      ],
      [
        'Noodles & rice',
        [
          {
            n: 'Hakka Noodles',
            v: [
              ['Half', 9000],
              ['Full', 14000],
            ],
            c: 'chinese',
            a: ['JAIN', 'SPICE'],
            rec: true,
          },
          {
            n: 'Schezwan Fried Rice',
            v: [
              ['Half', 10000],
              ['Full', 15000],
            ],
            c: 'chinese',
            a: ['JAIN', 'SPICE'],
          },
          { n: 'Triple Schezwan Rice', p: 19000, c: 'chinese', a: ['SPICE'] },
        ],
      ],
    ],
  },
  {
    slug: 'pizza-point-unjha',
    name: 'Pizza Point',
    status: 'ACTIVE',
    cuisines: ['Pizza', 'Fast food'],
    isPureVeg: true,
    phone: '+919000000105',
    branch: { area: 'Upera Road', lat: 23.8098, lng: 72.3871, radiusM: 5000 },
    hours: allDay('11:00', '23:30'),
    menu: [
      [
        'Pizzas',
        [
          {
            n: 'Margherita',
            v: [
              ['Regular 7"', 12000],
              ['Medium 10"', 22000],
              ['Large 12"', 32000],
            ],
            c: 'pizza',
            a: ['CRUST', 'CHEESE', 'TOPPINGS'],
            best: true,
          },
          {
            n: 'Farmhouse',
            v: [
              ['Regular 7"', 16000],
              ['Medium 10"', 29000],
              ['Large 12"', 41000],
            ],
            c: 'pizza',
            a: ['CRUST', 'CHEESE', 'TOPPINGS'],
          },
          {
            n: 'Paneer Tikka Pizza',
            v: [
              ['Regular 7"', 18000],
              ['Medium 10"', 32000],
              ['Large 12"', 45000],
            ],
            c: 'pizza',
            a: ['CRUST', 'CHEESE'],
            rec: true,
          },
          {
            n: 'Jain Veggie Delight',
            v: [
              ['Regular 7"', 15000],
              ['Medium 10"', 27000],
            ],
            c: 'pizza',
            d: 'No onion, no garlic, no root vegetables.',
            a: ['CRUST', 'CHEESE'],
          },
          {
            n: 'Corn & Cheese',
            v: [
              ['Regular 7"', 14000],
              ['Medium 10"', 25000],
            ],
            c: 'pizza',
            a: ['CRUST', 'CHEESE'],
          },
        ],
      ],
      [
        'Sides',
        [
          { n: 'Garlic Bread', p: 9000, c: 'bakery', a: ['CHEESE', 'DIP'] },
          {
            n: 'French Fries',
            v: [
              ['Regular', 7000],
              ['Large', 11000],
            ],
            c: 'street-food',
            a: ['DIP'],
          },
          { n: 'Cheese Sandwich', p: 8000, c: 'sandwiches' },
        ],
      ],
      [
        'Drinks',
        [
          { n: 'Cold Coffee', p: 9000, c: 'beverages', a: ['SCOOP'] },
          { n: 'Soft Drink (300 ml)', p: 4000, c: 'beverages' },
        ],
      ],
    ],
  },
  {
    slug: 'annapurna-dosa-corner',
    name: 'Annapurna Dosa Corner',
    status: 'ACTIVE',
    cuisines: ['South Indian'],
    isPureVeg: true,
    phone: '+919000000106',
    branch: { area: 'Sidhpur Road', lat: 23.7885, lng: 72.3934, radiusM: 4000 },
    hours: allDay('08:00', '22:30'),
    menu: [
      [
        'Breakfast (till 11:30)',
        [
          { n: 'Idli Sambar', p: 6000, c: 'breakfast', s: allDay('08:00', '11:30'), best: true },
          { n: 'Medu Vada', p: 7000, c: 'breakfast', s: allDay('08:00', '11:30') },
          { n: 'Upma', p: 6000, c: 'breakfast', s: allDay('08:00', '11:30') },
        ],
      ],
      [
        'Dosas',
        [
          { n: 'Masala Dosa', p: 9000, c: 'south-indian', a: ['BUTTER'], best: true },
          { n: 'Mysore Masala Dosa', p: 11000, c: 'south-indian', a: ['BUTTER', 'SPICE'] },
          { n: 'Paper Dosa', p: 10000, c: 'south-indian' },
          { n: 'Cheese Dosa', p: 12000, c: 'south-indian' },
          { n: 'Rava Masala Dosa', p: 11000, c: 'south-indian' },
        ],
      ],
      [
        'Uttapam',
        [
          { n: 'Onion Uttapam', p: 10000, c: 'south-indian' },
          { n: 'Mix Veg Uttapam', p: 11000, c: 'south-indian' },
        ],
      ],
      ['Drinks', [{ n: 'Filter Coffee', p: 4000, c: 'beverages', rec: true }]],
    ],
  },
  {
    slug: 'bapa-sitaram-farsan',
    name: 'Bapa Sitaram Farsan House',
    status: 'ACTIVE',
    cuisines: ['Farsan', 'Sweets', 'Gujarati'],
    isPureVeg: true,
    phone: '+919000000107',
    branch: { area: 'Bhagwati Chowk', lat: 23.8031, lng: 72.3903, radiusM: 3500 },
    hours: allDay('07:00', '21:00'),
    menu: [
      [
        'Morning specials (till 12:00)',
        [
          {
            n: 'Fafda Jalebi',
            v: [
              ['250 g', 12000],
              ['500 g', 23000],
            ],
            c: 'breakfast',
            s: allDay('07:00', '12:00'),
            best: true,
            feat: true,
          },
          {
            n: 'Gathiya',
            v: [
              ['250 g', 8000],
              ['500 g', 15000],
            ],
            c: 'farsan',
          },
        ],
      ],
      [
        'Farsan',
        [
          {
            n: 'Khaman Dhokla',
            v: [
              ['250 g', 6000],
              ['500 g', 11000],
            ],
            c: 'farsan',
          },
          { n: 'Samosa (2 pcs)', p: 4000, c: 'farsan' },
          { n: 'Kachori (2 pcs)', p: 4000, c: 'farsan' },
          { n: 'Sev Khamani', p: 7000, c: 'farsan' },
        ],
      ],
      [
        'Sweets',
        [
          {
            n: 'Kaju Katli',
            v: [
              ['250 g', 25000],
              ['500 g', 48000],
              ['1 kg', 95000],
            ],
            c: 'sweets',
            rec: true,
          },
          {
            n: 'Motichoor Ladoo',
            v: [
              ['250 g', 12000],
              ['500 g', 23000],
            ],
            c: 'sweets',
          },
          {
            n: 'Jalebi',
            v: [
              ['250 g', 9000],
              ['500 g', 17000],
            ],
            c: 'sweets',
          },
          { n: 'Gulab Jamun (4 pcs)', p: 8000, c: 'sweets' },
        ],
      ],
    ],
  },
  {
    slug: 'chill-out-ice-cream',
    name: 'Chill Out Ice Cream & Shakes',
    status: 'ACTIVE',
    cuisines: ['Ice cream', 'Desserts', 'Beverages'],
    isPureVeg: true,
    phone: '+919000000108',
    branch: { area: 'Aishwarya Park', lat: 23.8201, lng: 72.3978, radiusM: 5000 },
    hours: allDay('12:00', '24:00'),
    menu: [
      [
        'Scoops',
        [
          {
            n: 'Vanilla',
            v: [
              ['Single scoop', 5000],
              ['Double scoop', 9000],
            ],
            c: 'ice-cream',
          },
          {
            n: 'Belgian Chocolate',
            v: [
              ['Single scoop', 7000],
              ['Double scoop', 13000],
            ],
            c: 'ice-cream',
            best: true,
          },
          {
            n: 'Kesar Pista',
            v: [
              ['Single scoop', 7000],
              ['Double scoop', 13000],
            ],
            c: 'ice-cream',
          },
          {
            n: 'Sitaphal (seasonal)',
            v: [
              ['Single scoop', 8000],
              ['Double scoop', 15000],
            ],
            c: 'ice-cream',
            rec: true,
          },
        ],
      ],
      [
        'Sundaes',
        [
          { n: 'Hot Chocolate Fudge', p: 16000, c: 'ice-cream', a: ['SCOOP'] },
          { n: 'Dry Fruit Sundae', p: 18000, c: 'ice-cream', a: ['SCOOP'] },
        ],
      ],
      [
        'Shakes',
        [
          {
            n: 'Oreo Shake',
            v: [
              ['Regular', 11000],
              ['Large', 15000],
            ],
            c: 'beverages',
            a: ['SCOOP'],
          },
          {
            n: 'Kesar Badam Shake',
            v: [
              ['Regular', 12000],
              ['Large', 16000],
            ],
            c: 'beverages',
          },
          {
            n: 'Cold Coffee',
            v: [
              ['Regular', 9000],
              ['Large', 13000],
            ],
            c: 'beverages',
            a: ['SCOOP'],
          },
        ],
      ],
      ['Vegan', [{ n: 'Mango Sorbet', p: 8000, c: 'ice-cream', t: 'VEGAN' }]],
    ],
  },
  {
    slug: 'mahakali-pav-bhaji',
    name: 'Mahakali Pav Bhaji Centre',
    status: 'ACTIVE',
    cuisines: ['Street food', 'Fast food'],
    isPureVeg: true,
    phone: '+919000000109',
    branch: { area: 'APMC Road', lat: 23.7862, lng: 72.3881, radiusM: 4000 },
    // Evening street food, open past midnight (D-38).
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => [d, '17:00', '01:00']),
    menu: [
      [
        'Pav bhaji',
        [
          { n: 'Butter Pav Bhaji', p: 11000, c: 'street-food', a: ['JAIN', 'BUTTER'], best: true },
          { n: 'Cheese Pav Bhaji', p: 14000, c: 'street-food', a: ['JAIN'] },
          { n: 'Extra Pav (2 pcs)', p: 2000, c: 'street-food', a: ['BUTTER'] },
          { n: 'Paneer Pav Bhaji', p: 15000, c: 'street-food', a: ['JAIN'] },
          { n: 'Masala Pav', p: 7000, c: 'street-food' },
        ],
      ],
      [
        'Street food',
        [
          { n: 'Vada Pav', p: 3000, c: 'street-food' },
          { n: 'Dabeli', p: 3000, c: 'street-food', rec: true },
          { n: 'Masala Pulav', p: 10000, c: 'street-food', a: ['JAIN'] },
          { n: 'Tawa Pulav', p: 11000, c: 'street-food' },
          { n: 'Bombay Sandwich', p: 7000, c: 'sandwiches', a: ['CHEESE'] },
        ],
      ],
    ],
  },
  {
    slug: 'cafe-egg-station',
    name: 'Cafe Egg Station',
    status: 'APPROVED', // approved, not live yet — can prepare its menu in the partner app (D-34)
    cuisines: ['Cafe', 'Eggetarian'],
    isPureVeg: false,
    phone: '+919000000110',
    branch: { area: 'Unava Road', lat: 23.7938, lng: 72.4012, radiusM: 3500 },
    hours: allDay('07:00', '23:00'),
    menu: [
      [
        'Egg specials',
        [
          { n: 'Masala Omelette', p: 7000, c: 'breakfast', t: 'EGG', a: ['EGG'] },
          { n: 'Egg Bhurji Pav', p: 9000, c: 'street-food', t: 'EGG', a: ['EGG'], best: true },
          { n: 'Boiled Egg Fry', p: 8000, c: 'street-food', t: 'EGG' },
          { n: 'Egg Curry', p: 13000, c: 'punjabi', t: 'EGG', a: ['EGG'] },
        ],
      ],
      [
        'Veg',
        [
          { n: 'Veg Grilled Sandwich', p: 9000, c: 'sandwiches', a: ['CHEESE'] },
          { n: 'Masala Maggi', p: 7000, c: 'street-food' },
        ],
      ],
      ['Drinks', [{ n: 'Masala Tea', p: 2000, c: 'beverages' }]],
    ],
  },
  {
    slug: 'royal-bakery-unjha',
    name: 'Royal Bakery',
    status: 'REVIEW', // submitted, documents waiting for verification
    cuisines: ['Bakery', 'Desserts'],
    isPureVeg: true,
    phone: '+919000000111',
    branch: { area: 'Laxmipura', lat: 23.8155, lng: 72.3845, radiusM: 3000 },
    hours: allDay('09:00', '21:30'),
    menu: [
      [
        'Cakes (eggless)',
        [
          {
            n: 'Black Forest Cake',
            v: [
              ['500 g', 45000],
              ['1 kg', 85000],
            ],
            c: 'bakery',
          },
          {
            n: 'Pineapple Cake',
            v: [
              ['500 g', 40000],
              ['1 kg', 75000],
            ],
            c: 'bakery',
          },
        ],
      ],
      [
        'Bakes',
        [
          { n: 'Veg Puff', p: 3000, c: 'bakery' },
          { n: 'Nankhatai (250 g)', p: 12000, c: 'bakery' },
          { n: 'Chocolate Brownie', p: 8000, c: 'bakery' },
          { n: 'Khari (200 g)', p: 6000, c: 'bakery' },
          { n: 'Cream Roll (2 pcs)', p: 5000, c: 'bakery' },
        ],
      ],
    ],
  },
  {
    slug: 'pending-restaurant',
    name: 'Pending Restaurant',
    status: 'DRAFT', // onboarding just started: no hours or delivery area yet
    cuisines: ['Cafe'],
    isPureVeg: true,
    phone: null,
    branch: { area: 'Gandhi Chowk', lat: 23.8058, lng: 72.3941, radiusM: null },
    hours: [],
    menu: [],
  },
];

export const ADDON_GROUPS = G;
