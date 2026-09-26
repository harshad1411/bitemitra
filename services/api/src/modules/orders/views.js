// What each audience sees of an order. Customers see their bill; restaurants see their own prices and
// money (never markup, platform fees or platform revenue — D-67); admins see everything.
import { maskPhone } from '@jamzo/logger';

const timeline = (history) =>
  history
    .filter((h) => h.fromStatus !== h.toStatus)
    .map((h) => ({ status: h.toStatus, at: h.createdAt, actorType: h.actorType }));

const addMinutes = (d, m) => (d && m ? new Date(d.getTime() + m * 60_000) : null);

/** Customer's view of their own order. */
export function customerOrderView(o, { canCancel }) {
  const snap = o.pricingSnapshot;
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    restaurantStatus: o.restaurantStatus,
    deliveryStatus: o.deliveryStatus,
    version: o.version,
    restaurant: { id: o.restaurant.id, name: o.restaurant.name },
    placedAt: o.placedAt,
    createdAt: o.createdAt,
    acceptedAt: o.acceptedAt,
    readyAt: o.readyAt,
    cancelledAt: o.cancelledAt,
    prepTimeMinutes: o.prepTimeMinutes,
    estimatedReadyAt: addMinutes(o.acceptedAt, o.prepTimeMinutes),
    items: o.items.map((i) => ({
      id: i.id,
      name: i.productName,
      variantName: i.variantName,
      foodType: i.foodType,
      quantity: i.quantity,
      addons: i.addons.map((a) => a.name),
      lineTotalPaise: i.lineTotalPaise,
    })),
    bill: snap?.customerBill ?? null,
    totalPayablePaise: o.totalPayablePaise,
    payment: {
      method: o.paymentMethod,
      label: o.paymentMethod === 'COD' ? 'Cash on delivery' : o.paymentMethod,
      codAmountPaise: o.codAmountPaise,
    },
    address: o.address && {
      label: o.address.label,
      line1: o.address.line1,
      landmark: o.address.landmark,
      cityName: o.address.cityName,
    },
    deliveryInstructions: o.deliveryInstructions,
    restaurantInstructions: o.restaurantInstructions,
    contactless: o.contactless,
    timeline: timeline(o.statusHistory),
    cancellation: o.cancellation && {
      byType: o.cancellation.cancelledByType,
      reasonCode: o.cancellation.reasonCode,
      refundDuePaise: o.cancellation.refundDuePaise,
    },
    canCancel,
  };
}

export const customerOrderSummary = (o) => ({
  id: o.id,
  orderNumber: o.orderNumber,
  status: o.status,
  restaurant: { id: o.restaurant.id, name: o.restaurant.name },
  itemCount: o.itemCount,
  totalPayablePaise: o.totalPayablePaise,
  createdAt: o.createdAt,
});

/** Restaurant view (D-67). `finance` only for roles with orders.finance. */
export function restaurantOrderView(o, { finance, acceptBy }) {
  const snap = o.pricingSnapshot;
  const firstName = (o.customer?.user?.name ?? '').trim().split(/\s+/)[0] || 'Customer';
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    shortNumber: o.orderNumber.slice(-4),
    status: o.status,
    restaurantStatus: o.restaurantStatus,
    deliveryStatus: o.deliveryStatus,
    version: o.version,
    placedAt: o.placedAt,
    acceptBy,
    acceptedAt: o.acceptedAt,
    readyAt: o.readyAt,
    cancelledAt: o.cancelledAt,
    prepTimeMinutes: o.prepTimeMinutes,
    estimatedPickupAt: addMinutes(o.acceptedAt, o.prepTimeMinutes),
    customer: { firstName },
    items: o.items.map((i) => ({
      name: i.productName,
      variantName: i.variantName,
      foodType: i.foodType,
      quantity: i.quantity,
      addons: i.addons.map((a) => ({
        group: a.groupName,
        name: a.name,
        unitPricePaise: a.restaurantBasePricePaise,
      })),
      unitPricePaise: i.restaurantBasePricePaise,
      lineTotalPaise:
        (i.restaurantBasePricePaise + i.addons.reduce((n, a) => n + a.restaurantBasePricePaise, 0)) *
        i.quantity,
    })),
    itemCount: o.itemCount,
    foodValuePaise: snap?.restaurantBaseSubtotalPaise ?? null,
    restaurantInstructions: o.restaurantInstructions,
    payment: {
      method: o.paymentMethod,
      label:
        o.paymentMethod === 'COD' ? 'Cash on delivery (collected by the delivery partner)' : 'Paid online',
    },
    cancellation: o.cancellation && {
      byType: o.cancellation.cancelledByType,
      reasonCode: o.cancellation.reasonCode,
      reasonText: o.cancellation.reasonText,
    },
    finance:
      finance && snap
        ? {
            foodValuePaise: snap.restaurantBaseSubtotalPaise,
            restaurantFundedDiscountPaise: snap.restaurantFundedDiscountPaise,
            packagingPaise: snap.packagingPaise,
            commissionPaise: snap.commissionAmountPaise,
            commissionTaxPaise: snap.commissionTaxPaise,
            withholdingPaise: snap.restaurantWithholdingPaise,
            netPayablePaise: snap.restaurantPayablePaise,
            estimate: true, // final amounts come with settlements (Phase 8)
          }
        : null,
  };
}

/** Admin view: everything, including the frozen snapshot and history. */
export function adminOrderView(o, { maskPii }) {
  const phone = o.customer?.user?.phone ?? null;
  return {
    ...customerOrderView(o, { canCancel: false }),
    canCancel: undefined,
    cityId: o.cityId,
    zoneId: o.zoneId,
    branchId: o.branchId,
    financialStatus: o.financialStatus,
    needsAttention: o.needsAttention,
    attentionReason: o.attentionReason,
    restaurant: { id: o.restaurant.id, name: o.restaurant.name, city: o.restaurant.city?.name },
    customer: {
      id: o.customerId,
      name: o.customer?.user?.name ?? null,
      phone: phone && maskPii ? maskPhone(phone) : phone,
      masked: Boolean(phone && maskPii),
    },
    address: o.address && {
      ...o.address,
      lat: Number(o.address.lat),
      lng: Number(o.address.lng),
      ...(maskPii ? { line1: '••••', line2: null, contactPhone: null, masked: true } : {}),
    },
    items: o.items,
    pricingSnapshot: o.pricingSnapshot && { ...o.pricingSnapshot, engineOutput: undefined },
    history: o.statusHistory,
    cancellation: o.cancellation,
    notes: o.notes ?? [],
    appVersion: o.appVersion,
    platform: o.platform,
  };
}

export const adminOrderRow = (o) => ({
  id: o.id,
  orderNumber: o.orderNumber,
  createdAt: o.createdAt,
  status: o.status,
  restaurantStatus: o.restaurantStatus,
  deliveryStatus: o.deliveryStatus,
  financialStatus: o.financialStatus,
  paymentMethod: o.paymentMethod,
  totalPayablePaise: o.totalPayablePaise,
  itemCount: o.itemCount,
  needsAttention: o.needsAttention,
  restaurant: { id: o.restaurant.id, name: o.restaurant.name },
  city: o.restaurant.city?.name ?? null,
  customerName: o.customer?.user?.name ?? null,
});
