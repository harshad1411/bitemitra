// Realtime (D-10, D-62). PostgreSQL NOTIFY (sent inside the transaction that changed the order) → this
// process's LISTEN connection → Socket.IO rooms. Sockets only say "order X changed"; clients re-fetch over
// REST. A connection authenticates with the same access token and session checks as an HTTP request.
import pg from 'pg';
import { Server } from 'socket.io';
import { verifyAccessToken, PARTNER_APP_RESTAURANT_STATUSES } from '@jamzo/auth';
import { REALTIME_CHANNEL } from '../orders/service.js';

const APPS = new Set(['CUSTOMER', 'RESTAURANT', 'RIDER']);

/**
 * @param {import('../../core/types.js').JamzoApp} app
 * @param {{ databaseUrl: string, secret: string, corsOrigins?: string[] }} opts
 * @returns {Promise<{ io: Server, close: () => Promise<void> }>}
 */
export async function attachRealtime(app, { databaseUrl, secret, corsOrigins = [] }) {
  const prisma = app.prisma;
  const io = new Server(app.server, {
    path: '/v1/realtime',
    cors: { origin: corsOrigins.length ? corsOrigins : false },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const { token, appId } = socket.handshake.auth ?? {};
      if (!APPS.has(appId) || typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
      const verified = await verifyAccessToken(token, secret, appId);
      if ('reason' in verified)
        return next(new Error(verified.reason === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED'));
      const { sub, sid } = /** @type {any} */ (verified).claims;
      const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
      if (
        !session ||
        session.userId !== sub ||
        session.revokedAt ||
        session.expiresAt <= app.clock.now() ||
        session.appId !== appId ||
        session.user.status !== 'ACTIVE'
      )
        return next(new Error('UNAUTHENTICATED'));
      socket.data = { userId: sub, appId };
      next();
    } catch (err) {
      app.log.warn({ err }, 'realtime auth failed');
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, appId } = socket.data;
    if (appId === 'CUSTOMER') {
      const customer = await prisma.customer.findUnique({ where: { userId } });
      if (customer) socket.join(`customer:${customer.id}`);
    }
    if (appId === 'RIDER') {
      const rider = await prisma.rider.findUnique({ where: { userId } });
      if (rider?.onboardingStatus === 'ACTIVE') socket.join(`rider:${rider.id}`);
    }
    // Restaurant devices join only restaurants they are an active member of, and only while approved.
    socket.on('subscribe', async (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (appId !== 'RESTAURANT' || typeof msg?.restaurantId !== 'string') return reply({ ok: false });
      const m = await prisma.restaurantUser.findFirst({
        where: { restaurantId: msg.restaurantId, userId, isActive: true },
        include: { restaurant: true },
      });
      if (!m || !PARTNER_APP_RESTAURANT_STATUSES.includes(m.restaurant.onboardingStatus))
        return reply({ ok: false });
      socket.join(`restaurant:${msg.restaurantId}`);
      reply({ ok: true });
    });
  });

  const listener = new pg.Client({ connectionString: databaseUrl });
  await listener.connect();
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
  listener.on('notification', (n) => {
    let msg;
    try {
      msg = JSON.parse(n.payload ?? '');
    } catch {
      return;
    }
    if (msg.kind === 'offer') {
      io.to(`rider:${msg.riderId}`).emit('offer.new', {
        orderId: msg.orderId,
        assignmentId: msg.assignmentId,
      });
      return;
    }
    if (msg.kind === 'rider_location') {
      io.to(`customer:${msg.customerId}`).emit('rider.location', {
        orderId: msg.orderId,
        lat: msg.lat,
        lng: msg.lng,
        at: msg.at,
      });
      return;
    }
    if (msg.kind !== 'order') return;
    const update = {
      orderId: msg.orderId,
      event: msg.event,
      status: msg.status,
      restaurantStatus: msg.restaurantStatus,
      deliveryStatus: msg.deliveryStatus,
    };
    io.to(`restaurant:${msg.restaurantId}`).emit('order.updated', update);
    io.to(`customer:${msg.customerId}`).emit('order.updated', update);
    if (msg.riderId) io.to(`rider:${msg.riderId}`).emit('order.updated', update);
  });
  listener.on('error', (err) => app.log.error({ err }, 'realtime listener error'));

  return {
    io,
    close: async () => {
      io.close();
      await listener.end().catch(() => {});
    },
  };
}
