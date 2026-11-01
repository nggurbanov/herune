/** Independent native adapter exports. The application bootstrap is still under integration. */
export { NativeBridge } from './bridge'
export { createNativeServices } from './services'
export { installNativeSockets } from './socket'
export { createInstalledPluginRuntime } from '../../plugin-sdk/src/plugin-runtime/installed'
export { installHostServices } from '../../plugin-sdk/src/services'
export { queryClient } from '../../plugin-sdk/src/lib/query-client'
/** Must be called after installing the SDK host services. */
export const loadBundledBots = () => import('../../builtin-bots/src/plugin')
