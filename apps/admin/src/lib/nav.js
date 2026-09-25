// Primary navigation (spec §28). Modules that do not exist yet are shown disabled with the phase that
// delivers them — nothing looks finished that is not (OD-33).
import {
  Bike,
  Building2,
  Calculator,
  ChartColumn,
  CreditCard,
  FileClock,
  Home,
  Image,
  KeyRound,
  LayoutTemplate,
  LifeBuoy,
  MapPinned,
  Megaphone,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';

export const NAV = [
  {
    section: 'Operations',
    items: [
      { href: '/', label: 'Home', icon: Home, permission: 'dashboard.view' },
      { label: 'Orders', icon: ShoppingBag, phase: 5 },
      { label: 'Dispatch', icon: Truck, phase: 6 },
      { label: 'Support', icon: LifeBuoy, phase: 9 },
    ],
  },
  {
    section: 'Partners & customers',
    items: [
      { href: '/restaurants', label: 'Restaurants', icon: Building2, permission: 'restaurants.view' },
      { href: '/products', label: 'Products', icon: UtensilsCrossed, permission: 'restaurants.view' },
      { href: '/categories', label: 'Food categories', icon: Tags, permission: 'restaurants.view' },
      { label: 'Delivery partners', icon: Bike, phase: 6 },
      { href: '/customers', label: 'Customers', icon: UserRound, permission: 'customers.view' },
    ],
  },
  {
    section: 'Money',
    items: [
      { label: 'Payments', icon: CreditCard, phase: 7 },
      { label: 'Refunds', icon: Receipt, phase: 7 },
      { label: 'Settlements', icon: Wallet, phase: 8 },
      { href: '/pricing', label: 'Pricing', icon: Calculator, permission: 'pricing.view' },
      { href: '/offers', label: 'Offers & coupons', icon: Megaphone, permission: 'promotions.manage' },
    ],
  },
  {
    section: 'Platform',
    items: [
      { href: '/cities', label: 'Cities & zones', icon: MapPinned, permission: 'geo.view' },
      { href: '/content', label: 'Home & content', icon: LayoutTemplate, permission: 'cms.manage' },
      { href: '/media', label: 'Media', icon: Image, permission: 'media.view' },
      { href: '/settings', label: 'Configuration', icon: Settings, permission: 'config.view' },
      { label: 'Analytics', icon: ChartColumn, phase: 9 },
    ],
  },
  {
    section: 'Access',
    items: [
      { href: '/users', label: 'Admin users', icon: Users, permission: 'admins.view' },
      { href: '/roles', label: 'Roles', icon: ShieldCheck, permission: 'roles.view' },
      { href: '/permissions', label: 'Permissions', icon: KeyRound, permission: 'roles.view' },
      { href: '/audit', label: 'Audit log', icon: FileClock, permission: 'audit.view' },
    ],
  },
];
