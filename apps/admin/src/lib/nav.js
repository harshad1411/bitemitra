// Primary navigation (spec §28). Modules that do not exist yet are shown disabled with the phase that
// delivers them — nothing looks finished that is not (OD-33).
import {
  Bell,
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
  Star,
  Tags,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
  Banknote,
  Landmark,
} from 'lucide-react';

export const NAV = [
  {
    section: 'Operations',
    items: [
      { href: '/', label: 'Home', icon: Home, permission: 'dashboard.view' },
      { href: '/orders', label: 'Orders', icon: ShoppingBag, permission: 'orders.view' },
      { href: '/dispatch', label: 'Dispatch', icon: Truck, permission: 'orders.view' },
      { href: '/support', label: 'Support', icon: LifeBuoy, permission: 'support.manage' },
      { href: '/reviews', label: 'Reviews', icon: Star, permission: 'reviews.view' },
    ],
  },
  {
    section: 'Partners & customers',
    items: [
      { href: '/restaurants', label: 'Restaurants', icon: Building2, permission: 'restaurants.view' },
      { href: '/products', label: 'Products', icon: UtensilsCrossed, permission: 'restaurants.view' },
      { href: '/categories', label: 'Food categories', icon: Tags, permission: 'restaurants.view' },
      { href: '/riders', label: 'Delivery partners', icon: Bike, permission: 'riders.view' },
      { href: '/customers', label: 'Customers', icon: UserRound, permission: 'customers.view' },
    ],
  },
  {
    section: 'Money',
    items: [
      { href: '/payments', label: 'Payments', icon: CreditCard, permission: 'payments.view' },
      { href: '/refunds', label: 'Refunds', icon: Receipt, permission: 'payments.view' },
      { href: '/settlements', label: 'Settlements', icon: Wallet, permission: 'settlements.view' },
      { href: '/cod-deposits', label: 'Cash deposits', icon: Banknote, permission: 'settlements.view' },
      { href: '/finance', label: 'Finance', icon: Landmark, permission: 'settlements.view' },
      { href: '/pricing', label: 'Pricing', icon: Calculator, permission: 'pricing.view' },
      { href: '/offers', label: 'Offers & coupons', icon: Megaphone, permission: 'promotions.manage' },
    ],
  },
  {
    section: 'Platform',
    items: [
      { href: '/cities', label: 'Cities & zones', icon: MapPinned, permission: 'geo.view' },
      { href: '/content', label: 'Home & content', icon: LayoutTemplate, permission: 'cms.manage' },
      { href: '/notifications', label: 'Notifications', icon: Bell, permission: 'notifications.manage' },
      { href: '/media', label: 'Media', icon: Image, permission: 'media.view' },
      { href: '/settings', label: 'Configuration', icon: Settings, permission: 'config.view' },
      { href: '/analytics', label: 'Analytics', icon: ChartColumn, permission: 'analytics.view' },
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
