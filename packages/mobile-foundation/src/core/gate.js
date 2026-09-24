// Pure decision for what the app may show, from remote config (spec §72, §73). Order matters:
// maintenance beats everything; a required update beats a recommended one.

/**
 * @param {{ maintenance?: { enabled: boolean, message: string | null }, version?: { status: string, storeUrl: string | null } } | null} config
 * @returns {{ screen: 'MAINTENANCE' | 'FORCE_UPDATE' | 'APP', recommendUpdate: boolean, message?: string | null, storeUrl?: string | null }}
 */
export function decideGate(config) {
  if (config?.maintenance?.enabled)
    return { screen: 'MAINTENANCE', recommendUpdate: false, message: config.maintenance.message };
  const status = config?.version?.status;
  if (status === 'UPDATE_REQUIRED')
    return { screen: 'FORCE_UPDATE', recommendUpdate: false, storeUrl: config.version.storeUrl };
  return {
    screen: 'APP',
    recommendUpdate: status === 'UPDATE_RECOMMENDED',
    storeUrl: config?.version?.storeUrl ?? null,
  };
}
