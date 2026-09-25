// Checkout (ORDERS.md §6, D-60, D-64, D-65). Revalidation and pricing reuse the cart quote exactly; the write
// transaction then re-checks what can be raced (coupon limits, the customer's own history, duplicate keys)
// under a lock on the customer row, and writes the whole order at once.
import { CLIENT_HEADERS } from '@jamzo/shared-types';
import { initialState } from '@jamzo/order-engine';
import { isUniqueViolation } from '@jamzo/database';
import { AppError } from '../../core/errors.js';
import { enqueueEvent } from '../../core/outbox.js';
import { NOT_COUNTED_STATUSES, priceCart } from '../customer/cart.js';
import { nextOrderNumber, publishOrder } from './service.js';

const blocked = (issues, quote) =>
  new AppError('CHECKOUT_BLOCKED', issues[0]?.message ?? 'This order cannot be placed right now.', {
    details: { issues, quote },
  });

/**
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {import('../../core/types.js').JamzoRequest} request
 * @param {any} body parsed checkoutBody
 * @param {{ id: string, codDisabled: boolean }} customer
 */
export async function placeOrder(app, request, body, customer) {
  const { prisma } = app;
  const { config } = app.services;
  const idempotencyKey = /** @type {string} */ (request.headers[CLIENT_HEADERS.idempotencyKey]);

  // A retried "Place order" returns the first order, even after the idempotency record has expired.
  const existing = await prisma.order.findUnique({
    where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey } },
  });
  if (existing) return { orderId: existing.id, created: false };

  const { view, context: c } = await priceCart(app, request, body, { audience: 'CUSTOMER' });
  if (!c) throw blocked(view.issues ?? [], view);
  if (c.blocking.length) throw blocked(c.blocking, view);
  const q = c.q;
  const total = q.totals.totalPayablePaise;

  // ── Payment method (D-60) ──
  if (total > 0 && body.paymentMethod !== 'COD')
    throw new AppError(
      'PAYMENT_METHOD_UNAVAILABLE',
      'Online payment is not available yet. Please choose cash on delivery.',
      { details: { available: ['COD'] } },
    );
  if (total > 0) {
    const [flags, cod] = await Promise.all([
      config.flagMap({
        userId: request.auth.userId,
        cityId: c.city.id,
        zoneId: c.zone.id,
        appId: 'CUSTOMER',
      }),
      config.resolve('cod', c.ctx),
    ]);
    const reason =
      !flags.cod || !cod.value.enabled
        ? 'Cash on delivery is not available here right now.'
        : customer.codDisabled
          ? 'Cash on delivery is not available for your account. Please contact support.'
          : total > cod.value.maxOrderValuePaise
            ? `Cash on delivery is available for orders up to ₹${Math.floor(cod.value.maxOrderValuePaise / 100)}.`
            : null;
    if (reason) throw blocked([{ code: 'COD_NOT_AVAILABLE', message: reason }], view);
  }
  if (total !== body.expectedTotalPaise)
    throw new AppError(
      'PRICE_CHANGED',
      'Prices changed since you last saw your cart. Please review the new total.',
      {
        details: { quote: view, previousTotalPaise: body.expectedTotalPaise },
      },
    );

  const address = await prisma.customerAddress.findFirst({
    where: { id: body.addressId, customerId: customer.id, deletedAt: null },
  });
  if (!address) throw new AppError('NOT_FOUND', 'Address not found.');

  const now = c.now;
  const acceptance = await config.resolve('orders.restaurantAcceptance', c.ctx);
  const couponDiscount = q.discounts.find((d) => d.source === 'COUPON');
  const init = initialState({
    paymentMethod: body.paymentMethod,
    totalPayablePaise: total,
    actor: { type: 'CUSTOMER', id: request.auth.userId },
    now,
  });

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      // Serialise this customer's checkouts: history-based coupon rules cannot be raced (D-65).
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id}::uuid FOR UPDATE`;
      const again = await tx.order.findUnique({
        where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey } },
      });
      if (again) return again.id;
      if (couponDiscount && c.coupon) {
        const coupon = c.coupon;
        if (coupon.perUserLimit) {
          const used = await tx.couponUsage.count({
            where: { couponId: coupon.id, customerId: customer.id, reversedAt: null },
          });
          if (used >= coupon.perUserLimit)
            throw blocked(
              [{ code: 'COUPON_NOT_APPLICABLE', message: 'You have already used this coupon.' }],
              view,
            );
        }
        if (coupon.firstOrderOnly) {
          const past = await tx.order.count({
            where: {
              customerId: customer.id,
              placedAt: { not: null },
              status: { notIn: NOT_COUNTED_STATUSES },
            },
          });
          if (past > 0)
            throw blocked(
              [{ code: 'COUPON_NOT_APPLICABLE', message: 'This coupon is only for your first order.' }],
              view,
            );
        }
        // The global limit: conditional increment, backed by the coupons_used_within_limit constraint.
        const took = await tx.$executeRaw`
          UPDATE coupons SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
          WHERE id = ${coupon.id}::uuid AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
        if (took !== 1)
          throw blocked(
            [{ code: 'COUPON_NOT_APPLICABLE', message: 'This coupon has been fully used.' }],
            view,
          );
      }

      const number = await nextOrderNumber(tx, c.city, now);
      const order = await tx.order.create({
        data: {
          ...number,
          customerId: customer.id,
          restaurantId: c.restaurant.id,
          branchId: c.branch.id,
          cityId: c.city.id,
          zoneId: c.zone.id,
          ...init.fields,
          paymentMethod: body.paymentMethod,
          idempotencyKey,
          totalPayablePaise: total,
          codAmountPaise: body.paymentMethod === 'COD' ? total : 0,
          itemCount: c.valid.reduce((n, l) => n + l.quantity, 0),
          deliveryInstructions: body.deliveryInstructions ?? null,
          restaurantInstructions: body.restaurantInstructions ?? null,
          contactless: body.contactless,
          appVersion: request.client?.appVersion ?? null,
          platform: /** @type {any} */ (request.client?.platform ?? null),
          createdAt: now,
          address: {
            create: {
              label: address.label,
              line1: address.line1,
              line2: address.line2,
              landmark: address.landmark,
              area: address.area,
              cityName: address.cityName ?? c.city.name,
              pincode: address.pincode,
              lat: address.lat,
              lng: address.lng,
              contactName: address.contactName,
              contactPhone: address.contactPhone,
            },
          },
          pricingSnapshot: { create: snapshotOf(q, c, now) },
        },
      });
      for (const [i, l] of q.lines.entries()) {
        const v = c.valid[i];
        const addonDisplay = l.addons.reduce((n, a) => n + a.displayPricePaise, 0);
        const itemDisplay = l.unitDisplayPaise - addonDisplay;
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: l.productId,
            variantId: l.variantId,
            productName: l.name,
            variantName: v.variantName,
            foodType: v.foodType,
            quantity: l.quantity,
            restaurantBasePricePaise: l.unitItemBasePaise,
            customerDisplayPricePaise: itemDisplay,
            markupType: l.markup?.type ?? null,
            markupValue: l.markup?.value ?? null,
            markupAmountPaise: itemDisplay - l.unitItemBasePaise,
            markupRuleId: l.markup?.ruleId ?? null,
            taxMode: l.tax.mode,
            taxRateBps: l.tax.rateBps,
            taxAmountPaise: l.tax.amountPaise,
            commissionBasis: l.commission.basis,
            commissionBasePaise: l.commission.basePaise,
            commissionRateBps: l.commission.rateBps,
            commissionAmountPaise: l.commission.amountPaise,
            packagingPaise: l.packagingPaise,
            lineTotalPaise: l.lineDisplayPaise,
            createdAt: now,
            addons: {
              create: l.addons.map((a) => ({
                addonId: a.addonId,
                groupName: a.groupName,
                name: a.name,
                restaurantBasePricePaise: a.basePricePaise,
                customerDisplayPricePaise: a.displayPricePaise,
                markupAmountPaise: a.markupPaise,
              })),
            },
          },
        });
      }
      if (couponDiscount && c.coupon)
        await tx.couponUsage.create({
          data: {
            couponId: c.coupon.id,
            customerId: customer.id,
            orderId: order.id,
            discountPaise: couponDiscount.amountPaise,
            createdAt: now,
          },
        });
      await tx.orderStatusHistory.createMany({
        data: init.history.map((h, i) => ({
          orderId: order.id,
          ...h,
          createdAt: new Date(now.getTime() + i),
        })),
      });
      await enqueueEvent(tx, {
        aggregateType: 'ORDER',
        aggregateId: order.id,
        eventType: init.emits,
        payload: { orderId: order.id, event: 'CHECKOUT', status: order.status },
      });
      if (order.status === 'PLACED')
        // Restaurant acceptance timeout (D-68): acts only if the kitchen is still NEW when it runs.
        await enqueueEvent(tx, {
          aggregateType: 'ORDER',
          aggregateId: order.id,
          eventType: 'order.acceptance_timeout',
          payload: { orderId: order.id, stage: 'TIMEOUT' },
          availableAt: new Date(now.getTime() + acceptance.value.timeoutSec * 1000),
        });
      await publishOrder(tx, order, {}, init.emits);
      return order.id;
    });
    return { orderId, created: true };
  } catch (err) {
    // Two taps raced past the first check: the unique (customerId, idempotencyKey) decides.
    if (isUniqueViolation(err)) {
      const first = await prisma.order.findUnique({
        where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey } },
      });
      if (first) return { orderId: first.id, created: false };
    }
    throw err;
  }
}

/** The frozen financial snapshot (DATABASE.md, spec §27): written once, never updated. */
function snapshotOf(q, c, now) {
  const sum = (a) => a.reduce((n, x) => n + x, 0);
  const coupon = q.discounts.find((d) => d.source === 'COUPON');
  const groups = q.restaurant.commission.groups;
  return {
    engineVersion: q.engineVersion,
    restaurantBaseSubtotalPaise: q.totals.foodBasePaise,
    customerFoodSubtotalPaise: q.totals.foodDisplayPaise,
    markupTotalPaise: q.totals.markupPaise,
    packagingPaise: q.totals.packagingPaise,
    taxTotalPaise: q.taxes.exclusiveTotalPaise + q.taxes.inclusiveTotalPaise,
    taxBreakdown: q.taxes,
    deliveryFeePaise: q.totals.deliveryFeePaise,
    deliveryRule: q.delivery,
    distanceM: q.delivery.distanceM,
    distanceSource: q.delivery.distanceSource,
    distanceProvider: c.card.distanceProvider ?? null,
    platformFeePaise: q.totals.platformFeePaise,
    platformFeeRule: q.platformFee ?? undefined,
    smallOrderFeePaise: q.totals.smallOrderFeePaise,
    nightSurchargePaise: sum(q.surcharges.filter((s) => s.kind === 'NIGHT').map((s) => s.amountPaise)),
    surgePaise: sum(q.surcharges.filter((s) => s.kind !== 'NIGHT').map((s) => s.amountPaise)),
    surgeRules: q.surcharges,
    discountTotalPaise: q.totals.foodDiscountPaise + q.totals.deliveryDiscountPaise,
    restaurantFundedDiscountPaise: q.restaurant.restaurantFundedDiscountPaise,
    platformFundedDiscountPaise: q.platform.platformFundedDiscountPaise,
    couponCode: coupon?.code ?? null,
    couponSnapshot: coupon ?? undefined,
    tipPaise: q.totals.tipPaise,
    tipAllocation: { riderPaise: q.rider.tipPaise },
    markupDisclosure: q.customerBill.markupDisclosure,
    roundingAdjustmentPaise: q.totals.roundingAdjustmentPaise,
    totalPayablePaise: q.totals.totalPayablePaise,
    commissionRateBps: groups.length === 1 ? groups[0].rateBps : null,
    commissionAmountPaise: q.restaurant.commission.amountPaise,
    commissionTaxPaise: q.restaurant.commissionTax.amountPaise,
    commissionRule: groups,
    restaurantWithholdingPaise: sum(q.restaurant.withholdings.map((w) => w.amountPaise)),
    withholdings: q.restaurant.withholdings,
    restaurantPayablePaise: q.restaurant.payablePaise,
    riderEarningEstimatePaise: q.rider.totalPaise,
    riderEarningRule: q.rider,
    gatewayFeeEstimatePaise: q.platform.gatewayEstimatePaise,
    platformRevenue: q.platform,
    appliedRuleIds: q.rulesUsed,
    customerBill: q.customerBill,
    engineOutput: JSON.parse(JSON.stringify(q)),
    createdAt: now,
  };
}
