// Address search and the address of a map spot (D-114), against real PostgreSQL and a fake Google endpoint.
// Not verified with Google: no key exists yet.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminLogin, bearer, headers, startTestApp } from './helpers.js';

const KEY = 'test-key-not-a-real-google-key';
let ctx;
let admin;
let google = 'ok'; // what the fake Google does: ok | down
const mapsFetch = vi.fn(async (url, _init = {}) => {
  if (google === 'down') return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 });
  const u = new URL(url);
  if (u.pathname === '/v1/places:autocomplete')
    return Response.json({
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJtemple',
            text: { text: 'Umiya Mata Temple, Unjha, Gujarat, India' },
            structuredFormat: {
              mainText: { text: 'Umiya Mata Temple' },
              secondaryText: { text: 'Unjha, Gujarat, India' },
            },
          },
        },
        { queryPrediction: { text: { text: 'temples near me' } } }, // not a place: skipped
      ],
    });
  if (u.pathname === '/v1/places/ChIJtemple')
    return Response.json({
      id: 'ChIJtemple',
      displayName: { text: 'Umiya Mata Temple' },
      formattedAddress: 'Umiya Mata Temple, Station Rd, Unjha, Gujarat 384170, India',
      location: { latitude: 23.80123456, longitude: 72.39234567 },
      addressComponents: [
        { longText: 'Station Road', types: ['route'] },
        { longText: 'Unjha', types: ['locality', 'political'] },
        { longText: '384170', types: ['postal_code'] },
      ],
    });
  if (u.pathname === '/maps/api/geocode/json')
    return Response.json({
      status: 'OK',
      results: [
        { formatted_address: 'QR2V+7G Unjha, Gujarat, India', types: ['plus_code'], address_components: [] },
        {
          formatted_address: '12, Station Rd, Patel Vas, Unjha, Gujarat 384170, India',
          types: ['street_address'],
          address_components: [
            { long_name: 'Patel Vas', types: ['sublocality_level_1', 'sublocality', 'political'] },
            { long_name: 'Unjha', types: ['locality', 'political'] },
            { long_name: '384170', types: ['postal_code'] },
          ],
        },
      ],
    });
  return new Response('not found', { status: 404 });
});

beforeAll(async () => {
  ctx = await startTestApp({ env: { GOOGLE_MAPS_API_KEY: KEY }, mapsFetch });
  admin = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

const get = (url) => ctx.app.inject({ method: 'GET', url, headers: headers('CUSTOMER') });
const setProvider = (provider) =>
  ctx.app.inject({
    method: 'PUT',
    url: '/v1/admin/settings',
    headers: bearer(admin),
    payload: { key: 'maps.provider', scope: 'GLOBAL', value: { provider }, reason: 'test' },
  });

describe('without Google (maps.provider NONE): Jamzo’s own areas', () => {
  it('opens the map at a live city when the customer shares no location', async () => {
    const res = await get('/v1/geo/cities');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items).toEqual([{ id: expect.any(String), name: 'Unjha', lat: 23.8053, lng: 72.3935 }]);
  });

  it('search matches zone and service area names, each with a position to move the map to', async () => {
    const res = await get('/v1/geo/places/search?q=north');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      source: 'LOCAL',
      items: [
        {
          id: expect.stringMatching(/^area:/),
          title: 'North residential (radius)',
          subtitle: 'Unjha North, Unjha',
          lat: 23.825,
          lng: 72.3925,
        },
        {
          id: expect.stringMatching(/^zone:/),
          title: 'Unjha North',
          subtitle: 'Unjha',
          lat: 23.825,
          lng: 72.3925,
        },
      ],
    });
    const details = await get(`/v1/geo/places/details?id=${res.json().items[1].id}`);
    expect(details.json()).toMatchObject({ lat: 23.825, lng: 72.3925, title: 'Unjha North' });
    expect(mapsFetch).not.toHaveBeenCalled(); // the key exists, but the admin setting says NONE
  });

  it('the address of a spot is its area and city, with whether Jamzo delivers there', async () => {
    expect((await get('/v1/geo/reverse?lat=23.805&lng=72.39')).json()).toEqual({
      source: 'LOCAL',
      address: {
        title: 'Unjha Central',
        line: 'Unjha Central, Unjha',
        area: 'Unjha Central',
        city: 'Unjha',
        pincode: null,
      },
      serviceable: true,
      reason: 'OK',
      city: { id: expect.any(String), name: 'Unjha' },
      zone: { id: expect.any(String), name: 'Unjha Central' },
    });
    expect((await get('/v1/geo/reverse?lat=23.825&lng=72.3925')).json().address.title).toBe(
      'North residential (radius)',
    );
    // Far outside every zone: no address, not served — the customer can still move the pin.
    expect((await get('/v1/geo/reverse?lat=19.07&lng=72.87')).json()).toMatchObject({
      address: null,
      serviceable: false,
      reason: 'NO_CITY',
    });
  });

  it('checks its input', async () => {
    expect((await get('/v1/geo/places/search?q=a')).statusCode).toBe(400);
    expect((await get('/v1/geo/places/search?q=temple&lat=23.8')).statusCode).toBe(400);
    expect((await get('/v1/geo/places/details?id=other:1')).statusCode).toBe(400);
    expect((await get('/v1/geo/places/details?id=g:ChIJtemple')).statusCode).toBe(404); // Google is off
    expect((await get('/v1/geo/reverse?lat=123&lng=72')).statusCode).toBe(400);
  });
});

describe('with Google (maps.provider GOOGLE)', () => {
  it('searches in India near the map, with the key only in the server request', async () => {
    expect((await setProvider('GOOGLE')).statusCode).toBe(200);
    const res = await get('/v1/geo/places/search?q=umiya%20temple&lat=23.805&lng=72.39&session=sess-0001');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      source: 'GOOGLE',
      items: [
        {
          id: 'g:ChIJtemple',
          title: 'Umiya Mata Temple',
          subtitle: 'Unjha, Gujarat, India',
          lat: null,
          lng: null,
        },
      ],
    });
    expect(res.body).not.toContain(KEY);
    const [url, init] = mapsFetch.mock.calls.at(-1);
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({
      input: 'umiya temple',
      includedRegionCodes: ['in'],
      languageCode: 'en',
      sessionToken: 'sess-0001',
      locationBias: { circle: { center: { latitude: 23.805, longitude: 72.39 }, radius: 30_000 } },
    });
  });

  it('a chosen result gives its position and address (same session token)', async () => {
    const res = await get('/v1/geo/places/details?id=g:ChIJtemple&session=sess-0001');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      lat: 23.801235,
      lng: 72.392346,
      title: 'Umiya Mata Temple',
      address: {
        title: 'Umiya Mata Temple',
        line: 'Umiya Mata Temple, Station Rd, Unjha',
        area: 'Unjha',
        city: 'Unjha',
        pincode: '384170',
      },
    });
    const [url, init] = mapsFetch.mock.calls.at(-1);
    expect(url).toBe(
      'https://places.googleapis.com/v1/places/ChIJtemple?languageCode=en&sessionToken=sess-0001',
    );
    expect(init.headers['x-goog-fieldmask']).toBe(
      'id,displayName,formattedAddress,location,addressComponents',
    );
  });

  it('the address of a spot comes from Google (plus codes skipped) and is cached per ~11 m', async () => {
    const before = mapsFetch.mock.calls.length;
    const res = await get('/v1/geo/reverse?lat=23.80501&lng=72.39001');
    expect(res.json()).toMatchObject({
      source: 'GOOGLE',
      address: {
        title: '12, Station Rd',
        line: '12, Station Rd, Patel Vas, Unjha',
        area: 'Patel Vas',
        city: 'Unjha',
        pincode: '384170',
      },
      serviceable: true,
      zone: { name: 'Unjha Central' },
    });
    expect(new URL(mapsFetch.mock.calls.at(-1)[0]).searchParams.get('latlng')).toBe('23.80501,72.39001');
    await get('/v1/geo/reverse?lat=23.80503&lng=72.39004'); // same ~11 m cell
    expect(mapsFetch.mock.calls.length).toBe(before + 1);
  });

  it('when Google fails, falls back to Jamzo areas instead of leaving the customer stuck', async () => {
    google = 'down';
    expect((await get('/v1/geo/places/search?q=central')).json()).toMatchObject({
      source: 'LOCAL',
      items: [{ title: 'Unjha Central' }],
    });
    expect((await get('/v1/geo/reverse?lat=23.79&lng=72.39')).json()).toMatchObject({
      source: 'LOCAL',
      address: { title: 'Unjha South' },
    });
    expect((await get('/v1/geo/places/details?id=g:ChIJtemple')).statusCode).toBe(404);
    google = 'ok';
  });
});
