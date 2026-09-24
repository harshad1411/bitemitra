// Analytics abstraction (OD-26). No vendor is chosen: the default adapter does nothing, the console
// adapter is for development. A real adapter must respect consent (SECURITY.md §7) — Phase 3.

export const noopAnalytics = { track() {}, screen() {}, identify() {}, reset() {} };

export function createConsoleAnalytics(logger) {
  return {
    track: (event, props) => logger.debug(`analytics.track ${event}`, props),
    screen: (name, props) => logger.debug(`analytics.screen ${name}`, props),
    identify: (userId) => logger.debug('analytics.identify', { userId }),
    reset: () => logger.debug('analytics.reset'),
  };
}
